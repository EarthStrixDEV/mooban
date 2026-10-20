<?php
declare(strict_types=1);

/** HTTP layer for the test data tools. (Named SeedApi: the autoloader maps class name to file, and Seed is the domain class.) */
final class SeedApi
{
    public static function register(): void
    {
        Router::add('POST', '/api/test/seed', [self::class, 'seed']);
        Router::add('DELETE', '/api/test/seed', [self::class, 'wipe']);
        Router::add('GET', '/api/test/orphans', [self::class, 'orphans']);
    }

    /** Integer query param in [min, max]; absent -> default; anything else -> 400 bad_params. */
    private static function intParam(string $name, int $default, int $min, int $max): int
    {
        if (!array_key_exists($name, $_GET)) {
            return $default;
        }
        $v = $_GET[$name];
        if (!is_string($v) || preg_match('/^(0|[1-9][0-9]{0,8})$/D', $v) !== 1 || (int) $v < $min || (int) $v > $max) {
            Http::error(400, 'bad_params');
        }
        return (int) $v;
    }

    /** @param array<string,string> $params */
    public static function seed(array $params): never
    {
        TestGuard::require();
        $users = self::intParam('users', 20, 1, 100);
        $posts = self::intParam('posts', 500, 0, 5000);
        $images = self::intParam('images', 30, 0, 200);
        $reset = self::intParam('reset', 0, 0, 1);
        if ($images > $posts) {
            Http::error(400, 'bad_params');
        }
        if ($reset === 1) {
            Seed::wipe();
        }
        Http::json(200, Seed::run($users, $posts, $images));
    }

    /** @param array<string,string> $params */
    public static function wipe(array $params): never
    {
        TestGuard::require();
        Http::json(200, Seed::wipe());
    }

    /** @param array<string,string> $params */
    public static function orphans(array $params): never
    {
        TestGuard::require();
        Http::json(200, Seed::orphans());
    }
}
