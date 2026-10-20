<?php
declare(strict_types=1);

final class Auth
{
    /** @return array<string,mixed>|null users row for the Bearer token, or null */
    public static function optional(): ?array
    {
        $token = Http::bearer();
        if ($token === null) {
            return null;
        }
        $st = Db::pdo()->prepare(
            'SELECT id, handle, display_name, created_at FROM users WHERE token_hash = ? LIMIT 1'
        );
        $st->execute([hash('sha256', $token)]);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<string,mixed> */
    public static function require(): array
    {
        $user = self::optional();
        if ($user === null) {
            Http::error(401, 'unauthorized');
        }
        return $user;
    }
}
