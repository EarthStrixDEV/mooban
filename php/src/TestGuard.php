<?php
declare(strict_types=1);

final class TestGuard
{
    /** 403 {"error":"forbidden"} unless X-Test-Token matches TEST_TOKEN (constant-time compare). */
    public static function require(): void
    {
        $expected = (string) Config::get('TEST_TOKEN');
        $given = $_SERVER['HTTP_X_TEST_TOKEN'] ?? '';
        if ($expected === '' || !is_string($given) || !hash_equals($expected, $given)) {
            Http::error(403, 'forbidden');
        }
    }
}
