<?php
declare(strict_types=1);

final class RateLimit
{
    /** Fixed one-minute UTC window per bucket; over the limit -> 429 with Retry-After. */
    public static function hit(string $bucket, int $limit): void
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
        $hits = (int) $sel->fetchColumn();

        if ($hits > $limit) {
            $retry = max(1, 60 - ($now % 60));
            Http::error(429, 'rate_limited', ['retry_after' => $retry], ['Retry-After' => (string) $retry]);
        }
    }
}
