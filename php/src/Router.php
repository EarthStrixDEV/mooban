<?php
declare(strict_types=1);

final class Router
{
    /** @var list<array{string,string,callable}> [method, compiled regex, handler] */
    private static array $routes = [];

    /** Pattern syntax: /api/posts/{id:\d+} or /api/users/{handle} (default [^/]+). */
    public static function add(string $method, string $pattern, callable $handler): void
    {
        $regex = preg_replace_callback(
            '/\{(\w+)(?::([^}]+))?\}/',
            static fn(array $m): string => '(?P<' . $m[1] . '>' . ($m[2] ?? '[^/]+') . ')',
            $pattern
        );
        self::$routes[] = [strtoupper($method), '#^' . $regex . '$#', $handler];
    }

    public static function dispatch(string $method, string $path): never
    {
        $method = strtoupper($method);
        $pathMatched = false;
        foreach (self::$routes as [$m, $regex, $handler]) {
            if (!preg_match($regex, $path, $matches)) {
                continue;
            }
            $pathMatched = true;
            if ($m !== $method) {
                continue;
            }
            $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
            $handler($params);
            // Handlers normally end via Http::json(); guard against fall-through.
            Http::json(204, null);
        }
        if ($pathMatched) {
            Http::error(405, 'method_not_allowed');
        }
        Http::error(404, 'not_found');
    }
}
