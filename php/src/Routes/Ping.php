<?php
declare(strict_types=1);

final class Ping
{
    public static function register(): void
    {
        Router::add('GET', '/api/ping', [self::class, 'handle']);
    }

    /** @param array<string,string> $params */
    public static function handle(array $params): never
    {
        $body = [
            'pong' => true,
            'stack' => Config::get('APP_STACK'),
            'unix_ms' => (int) floor(microtime(true) * 1000),
        ];
        if (($_GET['db'] ?? '') === '1') {
            $t = microtime(true);
            Db::pdo()->query('SELECT 1')->fetchColumn();
            $body['db_ms'] = round((microtime(true) - $t) * 1000, 1);
        }
        Http::json(200, $body);
    }
}
