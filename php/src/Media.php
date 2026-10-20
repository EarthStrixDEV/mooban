<?php
declare(strict_types=1);

final class Media
{
    /** Recursively delete MEDIA_DIR/<key>. Ignored when absent; keys must be 16 hex chars. */
    public static function removeDir(string $key): void
    {
        if (preg_match('/^[0-9a-f]{16}$/D', $key) !== 1) {
            return;
        }
        $dir = rtrim((string) Config::get('MEDIA_DIR'), '/\\') . '/' . $key;
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
