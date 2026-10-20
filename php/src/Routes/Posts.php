<?php
declare(strict_types=1);

final class Posts
{
    private const SELECT = 'SELECT p.id, p.user_id, p.body, p.image_id, p.like_count, p.comment_count,
            p.created_at, p.updated_at, u.handle, u.display_name,
            i.id AS img_id, i.media_key AS img_key, i.format AS img_format,
            i.width AS img_width, i.height AS img_height, i.alt AS img_alt,
            l.post_id AS liked
        FROM posts p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN images i ON i.id = p.image_id
        LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = ?';

    public static function register(): void
    {
        Router::add('GET', '/api/posts', [self::class, 'index']);
        Router::add('POST', '/api/posts', [self::class, 'create']);
        Router::add('GET', '/api/posts/{id:\d+}', [self::class, 'show']);
        Router::add('PUT', '/api/posts/{id:\d+}', [self::class, 'update']);
        Router::add('DELETE', '/api/posts/{id:\d+}', [self::class, 'destroy']);
    }

    /**
     * Post object (liked_by_me is false when $viewerId is null), or null when absent.
     * Use Json::postForEvent() for event payloads.
     *
     * @return array<string,mixed>|null
     */
    public static function load(PDO $pdo, int $id, ?int $viewerId): ?array
    {
        $st = $pdo->prepare(self::SELECT . ' WHERE p.id = ?');
        $st->execute([$viewerId ?? 0, $id]);
        $row = $st->fetch();
        return $row === false ? null : Json::post($row);
    }

    /** Path id (digits only) -> int, or null when it does not fit an int. */
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

    /** @param array<string,string> $params */
    public static function index(array $params): never
    {
        $limit = self::intParam('limit') ?? 20;
        $before = self::intParam('before');
        if ($limit > 50) {
            Http::error(400, 'bad_params');
        }
        $handle = null;
        if (array_key_exists('user', $_GET)) {
            if (!is_string($_GET['user'])) {
                Http::error(400, 'bad_params');
            }
            $handle = strtolower($_GET['user']);
        }
        $viewer = Auth::optional();
        $viewerId = $viewer === null ? 0 : (int) $viewer['id'];

        $sql = self::SELECT . ' WHERE 1 = 1';
        $args = [$viewerId];
        if ($handle !== null) {
            $sql .= ' AND u.handle = ?';
            $args[] = $handle;
        }
        if ($before !== null) {
            $sql .= ' AND p.id < ?';
            $args[] = $before;
        }
        $sql .= ' ORDER BY p.id DESC LIMIT ' . ($limit + 1);

        $st = Db::pdo()->prepare($sql);
        $st->execute($args);
        $rows = $st->fetchAll();
        $more = count($rows) > $limit;
        if ($more) {
            array_pop($rows);
        }
        $data = array_map([Json::class, 'post'], $rows);
        Http::json(200, [
            'data' => $data,
            'next_before' => $more ? $data[count($data) - 1]['id'] : null,
        ]);
    }

    /** @param array<string,string> $params */
    public static function show(array $params): never
    {
        $id = self::id($params['id']);
        $viewer = Auth::optional();
        $post = $id === null ? null : self::load(Db::pdo(), $id, $viewer === null ? null : (int) $viewer['id']);
        if ($post === null) {
            Http::error(404, 'not_found');
        }
        Http::json(200, $post);
    }

    /** @param array<string,string> $params */
    public static function create(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        RateLimit::hit("user:$uid:write", 30);
        $in = Http::body();

        $fields = [];
        // Task 7 replaces this with the real image lookup.
        if (array_key_exists('image_id', $in) && $in['image_id'] !== null) {
            $fields['image_id'] = 'ไม่พบรูปนี้';
        }
        [$body, $err] = Validate::postBody($in['body'] ?? null, false);
        if ($err !== null) {
            $fields['body'] = $err;
        }
        if ($fields !== []) {
            Http::error(422, 'validation_failed', ['fields' => $fields]);
        }

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO posts (user_id, body) VALUES (?, ?)')->execute([$uid, $body]);
            $id = (int) $pdo->lastInsertId();
            $post = self::load($pdo, $id, $uid);
            Events::emit($pdo, 'post.created', ['post' => Json::postForEvent($post)]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        Stats::invalidate();
        Http::json(201, $post);
    }

    /**
     * 404 -> 403 gate shared by PUT and DELETE.
     *
     * @return array<string,mixed> the posts row (id, user_id, image_id)
     */
    private static function owned(string $rawId, int $uid): array
    {
        $id = self::id($rawId);
        $row = false;
        if ($id !== null) {
            $st = Db::pdo()->prepare('SELECT id, user_id, image_id FROM posts WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
        }
        if ($row === false) {
            Http::error(404, 'not_found');
        }
        if ((int) $row['user_id'] !== $uid) {
            Http::error(403, 'not_owner');
        }
        return $row;
    }

    /** @param array<string,string> $params */
    public static function update(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $row = self::owned($params['id'], $uid);
        RateLimit::hit("user:$uid:write", 30);
        $in = Http::body();

        [$body, $err] = Validate::postBody($in['body'] ?? null, $row['image_id'] !== null);
        if ($err !== null) {
            Http::error(422, 'validation_failed', ['fields' => ['body' => $err]]);
        }

        $id = (int) $row['id'];
        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE posts SET body = ?, updated_at = NOW() WHERE id = ?')->execute([$body, $id]);
            $post = self::load($pdo, $id, $uid);
            if ($post === null) {
                $pdo->rollBack();
                Http::error(404, 'not_found');
            }
            Events::emit($pdo, 'post.updated', ['post' => Json::postForEvent($post)]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        Stats::invalidate();
        Http::json(200, $post);
    }

    /** @param array<string,string> $params */
    public static function destroy(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $row = self::owned($params['id'], $uid);
        RateLimit::hit("user:$uid:write", 30);

        $id = (int) $row['id'];
        $imageId = $row['image_id'] === null ? null : (int) $row['image_id'];
        $pdo = Db::pdo();
        $key = null;
        $pdo->beginTransaction();
        try {
            if ($imageId !== null) {
                $st = $pdo->prepare('SELECT media_key FROM images WHERE id = ?');
                $st->execute([$imageId]);
                $k = $st->fetchColumn();
                $key = $k === false ? null : (string) $k;
            }
            $pdo->prepare('DELETE FROM posts WHERE id = ?')->execute([$id]);
            if ($imageId !== null) {
                $pdo->prepare('DELETE FROM images WHERE id = ?')->execute([$imageId]);
            }
            Events::emit($pdo, 'post.deleted', ['id' => $id]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        if ($key !== null) {
            Media::removeDir($key);
        }
        Events::afterCommit($pdo);
        Stats::invalidate();
        Http::json(204, null);
    }
}
