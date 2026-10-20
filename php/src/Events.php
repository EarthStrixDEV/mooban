<?php
declare(strict_types=1);

final class Events
{
    private static bool $cleanupPending = false;

    /**
     * Insert an event. Call it as the LAST statement of the write transaction.
     * Every 100th event id schedules a cleanup that afterCommit() runs, so the
     * DELETE never sits between the event INSERT and COMMIT.
     *
     * @param array<string,mixed> $data
     */
    public static function emit(PDO $pdo, string $type, array $data): int
    {
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $pdo->prepare('INSERT INTO events (type, payload) VALUES (?, ?)')->execute([$type, $payload]);
        $id = (int) $pdo->lastInsertId();
        if ($id % 100 === 0) {
            self::$cleanupPending = true;
        }
        return $id;
    }

    /** Run after COMMIT: drop events older than one hour if a cleanup was scheduled. */
    public static function afterCommit(PDO $pdo): void
    {
        if (!self::$cleanupPending) {
            return;
        }
        self::$cleanupPending = false;
        $pdo->exec('DELETE FROM events WHERE created_at < NOW(3) - INTERVAL 1 HOUR');
    }
}
