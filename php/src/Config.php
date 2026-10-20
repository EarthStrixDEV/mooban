<?php
declare(strict_types=1);

final class Config
{
    /** @var array<string,string|int>|null */
    private static ?array $values = null;

    public static function get(string $key): string|int
    {
        if (self::$values === null) {
            $loaded = require __DIR__ . '/../config.php';
            if (!is_array($loaded)) {
                throw new RuntimeException('config.php must return an array');
            }
            self::$values = $loaded;
        }
        if (!array_key_exists($key, self::$values)) {
            throw new RuntimeException("Missing config key: $key");
        }
        return self::$values[$key];
    }
}
