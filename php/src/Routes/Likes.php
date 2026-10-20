<?php
declare(strict_types=1);

final class Likes
{
    public static function register(): void
    {
        Router::add('PUT', '/api/posts/{id:\d+}/like', [self::class, 'put']);
        Router::add('DELETE', '/api/posts/{id:\d+}/like', [self::class, 'remove']);
    }

    /** @param array<string,string> $params */
    public static function put(array $params): never
    {
        self::change($params['id'], true);
    }

    /** @param array<string,string> $params */
    public static function remove(array $params): never
    {
        self::change($params['id'], false);
    }

    private static function change(string $rawId, bool $like): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $pdo = Db::pdo();

        $id = (string) (int) $rawId === $rawId ? (int) $rawId : null;
        $exists = false;
        if ($id !== null) {
            $st = $pdo->prepare('SELECT 1 FROM posts WHERE id = ?');
            $st->execute([$id]);
            $exists = $st->fetchColumn() !== false;
        }
        if (!$exists) {
            Http::error(404, 'not_found');
        }
        RateLimit::hit("user:$uid:write", 30);

        $pdo->beginTransaction();
        try {
            if ($like) {
                $st = $pdo->prepare('INSERT IGNORE INTO likes (user_id, post_id) VALUES (?, ?)');
            } else {
                $st = $pdo->prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?');
            }
            $st->execute([$uid, $id]);
            $changed = $st->rowCount() > 0;
            if ($changed) {
                $delta = $like ? '+ 1' : '- 1';
                $pdo->prepare("UPDATE posts SET like_count = like_count $delta WHERE id = ?")->execute([$id]);
            }
            $st = $pdo->prepare('SELECT like_count FROM posts WHERE id = ?');
            $st->execute([$id]);
            $count = $st->fetchColumn();
            if ($count === false) {
                // post deleted concurrently
                $pdo->rollBack();
                Http::error(404, 'not_found');
            }
            $count = (int) $count;
            if ($changed) {
                Events::emit($pdo, 'like.changed', ['post_id' => $id, 'like_count' => $count]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        if ($changed) {
            Stats::invalidate();
        }
        Http::json(200, ['post_id' => $id, 'like_count' => $count, 'liked_by_me' => $like]);
    }
}
