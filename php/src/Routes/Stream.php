<?php
declare(strict_types=1);

final class Stream
{
    private const ROW_TTL_SECONDS = 70;
    private const PING_AFTER_SECONDS = 15;
    private const BATCH = 500;
    private const RETRY_AFTER = 5;
    private const PROBE_US = 250_000;

    public static function register(): void
    {
        Router::add('GET', '/api/stream', [self::class, 'handle']);
    }

    /** @param array<string,string> $params */
    public static function handle(array $params): never
    {
        $pdo = Db::pdo();
        $ip = Http::clientIp();
        $max = (int) Config::get('MAX_STREAMS_PER_IP');

        // 1. Over-limit check BEFORE any SSE header, so 429 is a normal JSON response.
        $pdo->exec('DELETE FROM streams WHERE expires_at <= UTC_TIMESTAMP()');
        $st = $pdo->prepare('SELECT COUNT(*) FROM streams WHERE ip = ? AND expires_at > UTC_TIMESTAMP()');
        $st->execute([$ip]);
        if ((int) $st->fetchColumn() >= $max) {
            Http::error(429, 'rate_limited', ['retry_after' => self::RETRY_AFTER], ['Retry-After' => (string) self::RETRY_AFTER]);
        }

        // 2. Reserve a slot (expires after 70 s even if cleanup never runs).
        $pdo->prepare('INSERT INTO streams (ip, expires_at) VALUES (?, UTC_TIMESTAMP() + INTERVAL ' . self::ROW_TTL_SECONDS . ' SECOND)')
            ->execute([$ip]);
        $rowId = (int) $pdo->lastInsertId();
        $released = false;
        $release = static function () use ($pdo, $rowId, &$released): void {
            if ($released) {
                return;
            }
            $released = true;
            try {
                $pdo->prepare('DELETE FROM streams WHERE id = ?')->execute([$rowId]);
            } catch (Throwable $e) {
                // the 70 s expiry reclaims the slot
            }
        };
        register_shutdown_function($release);

        // 3. Turn off every layer that could buffer or compress.
        @ini_set('zlib.output_compression', '0');
        @ini_set('output_buffering', '0');
        @ini_set('implicit_flush', '1');
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        ignore_user_abort(false);
        set_time_limit(75);

        http_response_code(200);
        Http::commonHeaders();
        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Accel-Buffering: no');

        // 4. retry first, right now.
        self::write("retry: 3000\n\n");

        $lastId = self::startPoint($pdo);
        $pollUs = max(50, (int) Config::get('SSE_POLL_MS')) * 1000;
        $started = microtime(true);
        $deadline = $started + (int) Config::get('SSE_MAX_SECONDS');
        $lastSent = $started;

        $sel = $pdo->prepare('SELECT id, type, payload FROM events WHERE id > ? ORDER BY id LIMIT ' . self::BATCH);
        while (!connection_aborted()) {
            $sel->bindValue(1, $lastId, PDO::PARAM_INT);
            $sel->execute();
            $rows = $sel->fetchAll();
            if ($rows) {
                $out = '';
                foreach ($rows as $r) {
                    $out .= 'id: ' . $r['id'] . "\nevent: " . $r['type'] . "\ndata: " . $r['payload'] . "\n\n";
                    $lastId = (int) $r['id'];
                }
                self::write($out);
                $lastSent = microtime(true);
                if (count($rows) === self::BATCH) {
                    continue; // more backlog waiting, don't sleep
                }
            } elseif (microtime(true) - $lastSent >= self::PING_AFTER_SECONDS) {
                self::write(": ping\n\n");
                $lastSent = microtime(true);
            }

            // Wait for the next poll in short slices. Each slice writes a bare blank line:
            // every SSE parser ignores it, but the write is the only way Apache/mod_php
            // notices a vanished client (it needs ~3 failed writes), so an idle stream
            // frees its streams slot in about a second instead of at the next 15 s ping.
            $nextPoll = microtime(true) + $pollUs / 1_000_000;
            while (microtime(true) < $nextPoll && microtime(true) < $deadline) {
                usleep(self::PROBE_US);
                self::write("\n");
                if (connection_aborted()) {
                    break 2;
                }
            }
            if (microtime(true) >= $deadline) {
                break;
            }
        }

        $release();
        exit;
    }

    /** Resolve where to start; may emit a resync event. */
    private static function startPoint(PDO $pdo): int
    {
        $raw = $_SERVER['HTTP_LAST_EVENT_ID'] ?? ($_GET['last_id'] ?? null);
        $given = (is_string($raw) && preg_match('/^[0-9]{1,18}$/D', $raw)) ? (int) $raw : null;

        $row = $pdo->query('SELECT MIN(id) AS lo, MAX(id) AS hi FROM events')->fetch();
        $lo = $row['lo'] !== null ? (int) $row['lo'] : null;
        $hi = $row['hi'] !== null ? (int) $row['hi'] : 0;

        if ($given === null) {
            return $hi;
        }
        if ($lo !== null && $given < $lo) {
            self::write("event: resync\ndata: {}\n\n");
            return $hi;
        }
        return $given;
    }

    private static function write(string $chunk): void
    {
        echo $chunk;
        flush();
    }
}
