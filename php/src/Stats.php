<?php
declare(strict_types=1);

final class Stats
{
    private const TTL = 10;

    private static function dir(): string
    {
        $dir = rtrim((string) Config::get('CACHE_DIR'), '/\\');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }

    private static function statsFile(): string
    {
        return self::dir() . '/stats.json';
    }

    private static function countersFile(): string
    {
        return self::dir() . '/cache-counters.json';
    }

    /** Drop the cached /api/stats payload after a successful write. */
    public static function invalidate(): void
    {
        $file = rtrim((string) Config::get('CACHE_DIR'), '/\\') . '/stats.json';
        if (is_file($file)) {
            @unlink($file);
        }
    }

    /** DELETE /api/cache: remove the cached payload and the hit/miss counters. */
    public static function clearAll(): void
    {
        self::invalidate();
        $file = rtrim((string) Config::get('CACHE_DIR'), '/\\') . '/cache-counters.json';
        if (is_file($file)) {
            @unlink($file);
        }
    }

    /**
     * Cached stats JSON (younger than 10 s) or a fresh one written atomically.
     *
     * @return array{string,bool} [json text, served from cache]
     */
    public static function get(): array
    {
        $file = self::statsFile();
        clearstatcache(true, $file);
        if (is_file($file) && (time() - (int) filemtime($file)) < self::TTL) {
            $cached = @file_get_contents($file);
            if (is_string($cached) && $cached !== '') {
                self::bump('hits');
                return [$cached, true];
            }
        }

        $json = json_encode(self::compute(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($tmp, $json) !== false && !@rename($tmp, $file)) {
            @unlink($tmp);
        }
        self::bump('misses');
        return [$json, false];
    }

    /** @return array{hits:int,misses:int} */
    public static function counters(): array
    {
        $raw = @file_get_contents(self::countersFile());
        $d = is_string($raw) ? json_decode($raw, true) : null;
        return [
            'hits' => is_array($d) ? (int) ($d['hits'] ?? 0) : 0,
            'misses' => is_array($d) ? (int) ($d['misses'] ?? 0) : 0,
        ];
    }

    private static function bump(string $key): void
    {
        $fh = @fopen(self::countersFile(), 'c+');
        if ($fh === false) {
            return;
        }
        if (flock($fh, LOCK_EX)) {
            $d = json_decode((string) stream_get_contents($fh), true);
            $c = ['hits' => 0, 'misses' => 0];
            if (is_array($d)) {
                $c['hits'] = (int) ($d['hits'] ?? 0);
                $c['misses'] = (int) ($d['misses'] ?? 0);
            }
            $c[$key]++;
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, json_encode($c));
            fflush($fh);
            flock($fh, LOCK_UN);
        }
        fclose($fh);
    }

    /** @return array<string,int|string> */
    private static function compute(): array
    {
        $row = Db::pdo()->query(
            'SELECT
               (SELECT COUNT(*) FROM users) AS users,
               (SELECT COUNT(*) FROM posts) AS posts,
               (SELECT COUNT(*) FROM comments) AS comments,
               (SELECT COUNT(*) FROM likes) AS likes,
               (SELECT COUNT(*) FROM images) AS images,
               (SELECT COALESCE(SUM(bytes_display + bytes_thumb), 0) FROM images) AS media_bytes,
               (SELECT COALESCE(MAX(id), 0) FROM events) AS last_event_id'
        )->fetch(PDO::FETCH_ASSOC);
        $out = [];
        foreach (['users', 'posts', 'comments', 'likes', 'images', 'media_bytes', 'last_event_id'] as $k) {
            $out[$k] = (int) $row[$k];
        }
        $out['generated_at'] = gmdate('Y-m-d\TH:i:s\Z');
        return $out;
    }
}
