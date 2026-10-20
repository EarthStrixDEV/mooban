<?php
declare(strict_types=1);

final class Tools
{
    private const LIMITED_MAX = 10;
    private const ECHO_MAX = 1048576;
    private const STATIC_LAST_MODIFIED = 'Mon, 01 Jan 2024 00:00:00 GMT';

    public static function register(): void
    {
        Router::add('GET', '/api/stats', [self::class, 'stats']);
        Router::add('GET', '/api/cache-stats', [self::class, 'cacheStats']);
        Router::add('DELETE', '/api/cache', [self::class, 'clearCache']);
        Router::add('GET', '/api/slow', [self::class, 'slow']);
        foreach (['GET', 'POST', 'PUT', 'DELETE'] as $m) {
            Router::add($m, '/api/echo', [self::class, 'echo']);
        }
        Router::add('GET', '/api/limited', [self::class, 'limited']);
        Router::add('GET', '/download/{mb}', [self::class, 'download']);
        Router::add('POST', '/upload', [self::class, 'upload']);
        Router::add('GET', '/cache/static', [self::class, 'cacheStatic']);
        Router::add('GET', '/cache/none', [self::class, 'cacheNone']);
        Router::add('GET', '/cache/time', [self::class, 'cacheTime']);
        Router::add('GET', '/cache/gzip', [self::class, 'cacheGzip']);
    }

    /** @param array<string,string> $params */
    public static function stats(array $params): never
    {
        [$json, $hit] = Stats::get();
        http_response_code(200);
        Http::commonHeaders();
        header('Content-Type: application/json; charset=utf-8');
        header('X-App-Cache: ' . ($hit ? 'HIT' : 'MISS'));
        header(sprintf('Server-Timing: app;dur=%.1f', Http::elapsedMs()));
        echo $json;
        exit;
    }

    /** @param array<string,string> $params */
    public static function cacheStats(array $params): never
    {
        Http::json(200, Stats::counters());
    }

    /** @param array<string,string> $params */
    public static function clearCache(array $params): never
    {
        TestGuard::require();
        Stats::clearAll();
        Http::json(204, null);
    }

    /** @param array<string,string> $params */
    public static function slow(array $params): never
    {
        TestGuard::require();
        $ms = $_GET['ms'] ?? null;
        if (!is_string($ms) || !preg_match('/^(0|[1-9][0-9]{0,4})$/', $ms) || (int) $ms > 10000) {
            Http::error(400, 'bad_params');
        }
        set_time_limit(0);
        usleep((int) $ms * 1000);
        Http::json(200, ['slept_ms' => (int) $ms]);
    }

    /** @param array<string,string> $params */
    public static function echo(array $params): never
    {
        $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($len > self::ECHO_MAX) {
            Http::error(413, 'payload_too_large');
        }
        $in = fopen('php://input', 'rb');
        $body = $in === false ? '' : (string) stream_get_contents($in, self::ECHO_MAX + 1);
        if ($in !== false) {
            fclose($in);
        }
        if (strlen($body) > self::ECHO_MAX) {
            Http::error(413, 'payload_too_large');
        }

        $headers = [];
        $map = [
            'Host' => 'HTTP_HOST',
            'User-Agent' => 'HTTP_USER_AGENT',
            'X-Forwarded-For' => 'HTTP_X_FORWARDED_FOR',
            'X-Forwarded-Proto' => 'HTTP_X_FORWARDED_PROTO',
            'X-Real-IP' => 'HTTP_X_REAL_IP',
            'Content-Type' => 'CONTENT_TYPE',
            'Content-Length' => 'CONTENT_LENGTH',
        ];
        foreach ($map as $name => $key) {
            if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
                $headers[$name] = (string) $_SERVER[$key];
            }
        }
        $https = $_SERVER['HTTPS'] ?? '';
        Http::json(200, [
            'method' => $_SERVER['REQUEST_METHOD'] ?? 'GET',
            'path' => (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH),
            'query' => (object) $_GET,
            'protocol' => ($https !== '' && strtolower((string) $https) !== 'off') ? 'https' : 'http',
            'client_ip' => Http::clientIp(),
            'headers' => (object) $headers,
            'body_size' => strlen($body),
            'body_preview' => mb_scrub(mb_strcut($body, 0, 1024, 'UTF-8'), 'UTF-8'),
        ]);
    }

    /** @param array<string,string> $params */
    public static function limited(array $params): never
    {
        $hits = RateLimit::count('ip:' . Http::clientIp() . ':limited');
        $h = [
            'X-RateLimit-Limit' => (string) self::LIMITED_MAX,
            'X-RateLimit-Remaining' => (string) max(0, self::LIMITED_MAX - $hits),
        ];
        if ($hits > self::LIMITED_MAX) {
            $retry = RateLimit::retryAfter();
            Http::error(429, 'rate_limited', ['retry_after' => $retry], $h + ['Retry-After' => (string) $retry]);
        }
        Http::json(200, ['ok' => true], $h);
    }

    /** @param array<string,string> $params */
    public static function download(array $params): never
    {
        TestGuard::require();
        if (!in_array($params['mb'] ?? '', ['1', '10', '100'], true)) {
            Http::error(400, 'bad_params');
        }
        $size = (int) $params['mb'] * 1048576;

        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        @ini_set('zlib.output_compression', '0');
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        set_time_limit(0);
        ignore_user_abort(false);

        http_response_code(200);
        Http::commonHeaders();
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . $size);
        header('Cache-Control: no-store');
        header('X-Accel-Buffering: no');

        $chunk = 65536;
        for ($sent = 0; $sent < $size; $sent += $chunk) {
            echo random_bytes(min($chunk, $size - $sent));
            flush();
            if (connection_aborted()) {
                break;
            }
        }
        exit;
    }

    /** @param array<string,string> $params */
    public static function upload(array $params): never
    {
        TestGuard::require();
        $t0 = $_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true);

        // PHP drops the whole body (no $_FILES) when it exceeds post_max_size.
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        $isMultipart = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
        if ($isMultipart && $contentLength > 0 && $_POST === [] && $_FILES === []) {
            $postMax = self::iniBytes((string) ini_get('post_max_size'));
            if ($postMax > 0 && $contentLength > $postMax) {
                Http::error(413, 'payload_too_large');
            }
        }

        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || is_array($file['error'] ?? null) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            Http::error(422, 'validation_failed', ['fields' => ['file' => 'ต้องแนบไฟล์']]);
        }
        $err = (int) $file['error'];
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            Http::error(413, 'payload_too_large');
        }
        if ($err !== UPLOAD_ERR_OK) {
            Http::error(400, 'bad_params');
        }
        $size = (int) $file['size'];
        @unlink((string) $file['tmp_name']);
        Http::json(200, [
            'received_bytes' => $size,
            'duration_ms' => (int) round((microtime(true) - (float) $t0) * 1000),
        ]);
    }

    private static function iniBytes(string $v): int
    {
        if (!preg_match('/^\s*(\d+)\s*([KMG]?)/i', $v, $m)) {
            return 0;
        }
        $n = (int) $m[1];
        return match (strtoupper($m[2])) {
            'K' => $n * 1024,
            'M' => $n * 1048576,
            'G' => $n * 1073741824,
            default => $n,
        };
    }

    private static function staticBody(): string
    {
        $line = "Mooban cache test body. This text never changes between calls.\n";
        return substr(str_repeat($line, 40), 0, 2048);
    }

    private static function textHeaders(string $cacheControl): void
    {
        http_response_code(200);
        Http::commonHeaders();
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: ' . $cacheControl);
    }

    /** @param array<string,string> $params */
    public static function cacheStatic(array $params): never
    {
        $body = self::staticBody();
        $etag = '"' . hash('sha256', $body) . '"';
        $inm = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
        $match = false;
        if ($inm !== '') {
            foreach (explode(',', $inm) as $tag) {
                // Weak prefix and the "-gzip" suffix mod_deflate appends to the ETag are ignored.
                $tag = preg_replace('/^W\//', '', trim($tag));
                $tag = preg_replace('/-gzip"$/', '"', (string) $tag);
                if ($tag === '*' || $tag === $etag) {
                    $match = true;
                    break;
                }
            }
        }
        self::textHeaders('public, max-age=60');
        header('ETag: ' . $etag);
        header('Last-Modified: ' . self::STATIC_LAST_MODIFIED);
        if ($match) {
            http_response_code(304);
            header_remove('Content-Type');
            exit;
        }
        header('Content-Length: ' . strlen($body));
        echo $body;
        exit;
    }

    /** @param array<string,string> $params */
    public static function cacheNone(array $params): never
    {
        $body = self::staticBody();
        self::textHeaders('no-store');
        header('Content-Length: ' . strlen($body));
        echo $body;
        exit;
    }

    /** @param array<string,string> $params */
    public static function cacheTime(array $params): never
    {
        $ms = (int) floor(microtime(true) * 1000);
        Http::json(200, [
            'server_time' => gmdate('Y-m-d\TH:i:s\Z', intdiv($ms, 1000)),
            'unix_ms' => $ms,
        ], ['Cache-Control' => 'public, max-age=10']);
    }

    /** @param array<string,string> $params */
    public static function cacheGzip(array $params): never
    {
        $line = "The quick brown fox jumps over the lazy dog. Mooban compression test line.\n";
        $body = substr(str_repeat($line, intdiv(204800, strlen($line)) + 1), 0, 204800);
        self::textHeaders('no-cache');
        echo $body;
        exit;
    }
}
