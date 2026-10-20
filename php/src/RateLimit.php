<?php
declare(strict_types=1);

final class RateLimit
{
    /** Fixed one-minute UTC window per bucket; over the limit -> 429 with Retry-After. */
    public static function hit(string $bucket, int $limit): void
    {
        if (self::count($bucket) > $limit) {
            $retry = self::retryAfter();
            Http::error(429, 'rate_limited', ['retry_after' => $retry], ['Retry-After' => (string) $retry]);
        }
    }

    /** Seconds left in the current minute window (at least 1). */
    public static function retryAfter(): int
    {
        return max(1, 60 - (time() % 60));
    }

    /** Count one hit in the current window and return the window's total. */
    public static function count(string $bucket): int
    {
        $pdo = Db::pdo();
        $now = time();
        $window = gmdate('Y-m-d H:i:00', $now - ($now % 60));

        $ins = $pdo->prepare(
            'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE hits = hits + 1'
        );
        $ins->execute([$bucket, $window]);

        // rowCount() is 1 for a fresh row, 2 when the duplicate branch updated it.
        if ($ins->rowCount() === 1) {
            $pdo->prepare('DELETE FROM rate_limits WHERE window_start < ?')
                ->execute([gmdate('Y-m-d H:i:s', $now - 3600)]);
        }

        $sel = $pdo->prepare('SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?');
        $sel->execute([$bucket, $window]);
        return (int) $sel->fetchColumn();
    }
}
