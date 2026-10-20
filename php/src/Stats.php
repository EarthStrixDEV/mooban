<?php
declare(strict_types=1);

final class Stats
{
    /** Drop the cached /api/stats payload after a successful write. */
    public static function invalidate(): void
    {
        $file = rtrim((string) Config::get('CACHE_DIR'), '/\\') . '/stats.json';
        if (is_file($file)) {
            @unlink($file);
        }
    }
}
