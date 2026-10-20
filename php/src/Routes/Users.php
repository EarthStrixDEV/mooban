<?php
declare(strict_types=1);

final class Users
{
    public static function register(): void
    {
        Router::add('POST', '/api/users', [self::class, 'signup']);
        Router::add('GET', '/api/users/{handle}', [self::class, 'show']);
        Router::add('GET', '/api/me', [self::class, 'me']);
    }

    /** @param array<string,string> $params */
    public static function signup(array $params): never
    {
        RateLimit::hit('ip:' . Http::clientIp() . ':signup', 5);
        $body = Http::body();

        $handle = Validate::handle($body['handle'] ?? null);
        $name = Validate::displayName($body['display_name'] ?? null);
        $fields = [];
        if ($handle === null) {
            $fields['handle'] = Validate::HANDLE_MSG;
        }
        if ($name === null) {
            $fields['display_name'] = Validate::DISPLAY_NAME_MSG;
        }
        if ($fields !== []) {
            Http::error(422, 'validation_failed', ['fields' => $fields]);
        }

        $pdo = Db::pdo();
        $chk = $pdo->prepare('SELECT 1 FROM users WHERE handle = ? LIMIT 1');
        $chk->execute([$handle]);
        if ($chk->fetchColumn() !== false) {
            Http::error(409, 'handle_taken');
        }

        $token = bin2hex(random_bytes(32));
        try {
            $pdo->prepare('INSERT INTO users (handle, display_name, token_hash) VALUES (?, ?, ?)')
                ->execute([$handle, $name, hash('sha256', $token)]);
        } catch (PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                Http::error(409, 'handle_taken');
            }
            throw $e;
        }

        $st = $pdo->prepare('SELECT id, handle, display_name, created_at FROM users WHERE id = ?');
        $st->execute([(int) $pdo->lastInsertId()]);
        Stats::invalidate();
        Http::json(201, ['user' => Json::user($st->fetch()), 'token' => $token]);
    }

    /** @param array<string,string> $params */
    public static function show(array $params): never
    {
        $handle = strtolower(rawurldecode($params['handle']));
        $pdo = Db::pdo();
        $st = $pdo->prepare('SELECT id, handle, display_name, created_at FROM users WHERE handle = ? LIMIT 1');
        $st->execute([$handle]);
        $row = $st->fetch();
        if ($row === false) {
            Http::error(404, 'not_found');
        }
        $posts = $pdo->prepare('SELECT COUNT(*) FROM posts WHERE user_id = ?');
        $posts->execute([$row['id']]);
        $images = $pdo->prepare('SELECT COUNT(*) FROM images WHERE user_id = ?');
        $images->execute([$row['id']]);
        $user = Json::user($row);
        unset($user['id']);
        Http::json(200, $user + [
            'post_count' => (int) $posts->fetchColumn(),
            'image_count' => (int) $images->fetchColumn(),
        ]);
    }

    /** @param array<string,string> $params */
    public static function me(array $params): never
    {
        Http::json(200, Json::user(Auth::require()));
    }
}
