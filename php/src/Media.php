<?php
declare(strict_types=1);

final class Media
{
    private const KEY_RE = '/^[0-9a-f]{16}$/D';

    /** MEDIA_DIR without a trailing slash. */
    public static function dir(): string
    {
        return rtrim((string) Config::get('MEDIA_DIR'), '/\\');
    }

    /** Public URL of one rendition: /media/<key>/<display|thumb>.<webp|jpg>. */
    public static function url(string $key, string $format, string $kind): string
    {
        return '/media/' . $key . '/' . $kind . '.' . ($format === 'webp' ? 'webp' : 'jpg');
    }

    /** Recursively delete MEDIA_DIR/<key>. Ignored when absent; keys must be 16 hex chars. */
    public static function removeDir(string $key): void
    {
        if (preg_match(self::KEY_RE, $key) !== 1) {
            return;
        }
        self::rm(self::dir() . '/' . $key);
    }

    /** Delete the half-written MEDIA_DIR/.tmp-<key> staging directory. */
    public static function removeTmpDir(string $key): void
    {
        if (preg_match(self::KEY_RE, $key) !== 1) {
            return;
        }
        self::rm(self::dir() . '/.tmp-' . $key);
    }

    private static function rm(string $dir): void
    {
        if (!is_dir($dir) || is_link($dir)) {
            return;
        }
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $entry) {
            if ($entry->isDir() && !$entry->isLink()) {
                @rmdir($entry->getPathname());
            } else {
                @unlink($entry->getPathname());
            }
        }
        @rmdir($dir);
    }
}
