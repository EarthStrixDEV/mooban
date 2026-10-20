<?php
declare(strict_types=1);

final class Comments
{
    public const BODY_MSG = 'ต้องยาว 1–280 ตัวอักษร';

    public static function register(): void
    {
        Router::add('GET', '/api/posts/{id:\d+}/comments', [self::class, 'index']);
        Router::add('POST', '/api/posts/{id:\d+}/comments', [self::class, 'create']);
        Router::add('DELETE', '/api/comments/{id:\d+}', [self::class, 'destroy']);
    }

    /** Path id (digits only) -> int, or null when not ^[1-9][0-9]*$ or too large (R7). */
    private static function id(string $raw): ?int
    {
        return (string) (int) $raw === $raw ? (int) $raw : null;
    }

    /** Positive-integer query param, null when absent; 400 bad_params when malformed. */
    private static function intParam(string $name): ?int
    {
        if (!array_key_exists($name, $_GET)) {
            return null;
        }
        $v = $_GET[$name];
        if (!is_string($v) || preg_match('/^[1-9][0-9]*$/D', $v) !== 1 || (string) (int) $v !== $v) {
            Http::error(400, 'bad_params');
        }
        return (int) $v;
    }

    private static function postExists(PDO $pdo, ?int $id): bool
    {
        if ($id === null) {
            return false;
        }
        $st = $pdo->prepare('SELECT 1 FROM posts WHERE id = ?');
        $st->execute([$id]);
        return $st->fetchColumn() !== false;
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private static function shape(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'author' => [
                'handle' => (string) $row['handle'],
                'display_name' => (string) $row['display_name'],
            ],
            'body' => (string) $row['body'],
            'created_at' => Json::iso((string) $row['created_at']),
        ];
    }

    private const SELECT = 'SELECT c.id, c.body, c.created_at, u.handle, u.display_name
        FROM comments c JOIN users u ON u.id = c.user_id';

    /** @param array<string,string> $params */
    public static function index(array $params): never
    {
        $pdo = Db::pdo();
        $postId = self::id($params['id']);
        $limit = self::intParam('limit') ?? 20;
        $after = self::intParam('after');
        if ($limit > 50) {
            Http::error(400, 'bad_params');
        }
        if (!self::postExists($pdo, $postId)) {
            Http::error(404, 'not_found');
        }
        $sql = self::SELECT . ' WHERE c.post_id = ?';
        $args = [$postId];
        if ($after !== null) {
            $sql .= ' AND c.id > ?';
            $args[] = $after;
        }
        $sql .= ' ORDER BY c.id ASC LIMIT ' . ($limit + 1);
        $st = $pdo->prepare($sql);
        $st->execute($args);
        $rows = $st->fetchAll();
        $more = count($rows) > $limit;
        if ($more) {
            array_pop($rows);
        }
        $data = array_map([self::class, 'shape'], $rows);
        Http::json(200, [
            'data' => $data,
            'next_after' => $more ? $data[count($data) - 1]['id'] : null,
        ]);
    }

    /** @param array<string,string> $params */
    public static function create(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $pdo = Db::pdo();
        $postId = self::id($params['id']);
        if (!self::postExists($pdo, $postId)) {
            Http::error(404, 'not_found');
        }
        RateLimit::hit("user:$uid:write", 30);
        $in = Http::body();

        $body = is_string($in['body'] ?? null) ? Validate::trim($in['body']) : '';
        $len = Validate::len($body);
        if ($len < 1 || $len > 280) {
            Http::error(422, 'validation_failed', ['fields' => ['body' => self::BODY_MSG]]);
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)')
                ->execute([$postId, $uid, $body]);
            $cid = (int) $pdo->lastInsertId();
            $pdo->prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?')->execute([$postId]);
            $st = $pdo->prepare(self::SELECT . ' WHERE c.id = ?');
            $st->execute([$cid]);
            $comment = self::shape($st->fetch());
            $st = $pdo->prepare('SELECT comment_count FROM posts WHERE id = ?');
            $st->execute([$postId]);
            $count = (int) $st->fetchColumn();
            Events::emit($pdo, 'comment.created', [
                'post_id' => $postId,
                'comment' => $comment,
                'comment_count' => $count,
            ]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        Stats::invalidate();
        Http::json(201, $comment);
    }

    /** @param array<string,string> $params */
    public static function destroy(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $pdo = Db::pdo();
        $id = self::id($params['id']);
        $row = false;
        if ($id !== null) {
            $st = $pdo->prepare('SELECT id, post_id, user_id FROM comments WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
        }
        if ($row === false) {
            Http::error(404, 'not_found');
        }
        if ((int) $row['user_id'] !== $uid) {
            Http::error(403, 'not_owner');
        }
        RateLimit::hit("user:$uid:write", 30);

        $postId = (int) $row['post_id'];
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('DELETE FROM comments WHERE id = ?');
            $st->execute([$id]);
            if ($st->rowCount() === 0) {
                // deleted concurrently
                $pdo->rollBack();
                Http::error(404, 'not_found');
            }
            $pdo->prepare('UPDATE posts SET comment_count = comment_count - 1 WHERE id = ?')->execute([$postId]);
            $st = $pdo->prepare('SELECT comment_count FROM posts WHERE id = ?');
            $st->execute([$postId]);
            $count = (int) $st->fetchColumn();
            Events::emit($pdo, 'comment.deleted', [
                'post_id' => $postId,
                'comment_id' => $id,
                'comment_count' => $count,
            ]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        Stats::invalidate();
        Http::json(204, null);
    }
}
