<?php
declare(strict_types=1);

final class Http
{
    private static float $start = 0.0;

    public static function start(float $t): void
    {
        self::$start = $t;
    }

    /** Milliseconds since the request started (for Server-Timing). */
    public static function elapsedMs(): float
    {
        return (microtime(true) - self::$start) * 1000;
    }

    /** Headers every /api/* response carries (also usable before streaming). */
    public static function commonHeaders(): void
    {
        header('X-Stack: ' . Config::get('APP_STACK'));
        header('X-Robots-Tag: noindex');
    }

    /**
     * @param array<string,string> $headers
     */
    public static function json(int $status, ?array $body, array $headers = []): never
    {
        http_response_code($status);
        self::commonHeaders();
        header(sprintf('Server-Timing: app;dur=%.1f', (microtime(true) - self::$start) * 1000));
        foreach ($headers as $name => $value) {
            header("$name: $value");
        }
        if ($body !== null) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }
        exit;
    }

    /**
     * @param array<string,mixed> $extra merged into the body next to "error"
     * @param array<string,string> $headers
     */
    public static function error(int $status, string $code, array $extra = [], array $headers = []): never
    {
        self::json($status, ['error' => $code] + $extra, $headers);
    }

    /** @return array<string,mixed> */
    public static function body(): array
    {
        $raw = file_get_contents('php://input');
        $obj = json_decode($raw === false ? '' : $raw, false);
        if (!($obj instanceof stdClass)) {
            self::error(400, 'invalid_json');
        }
        /** @var array<string,mixed> */
        return json_decode($raw, true);
    }

    public static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    public static function bearer(): ?string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;
        if ($h === null && function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $value) {
                if (strcasecmp((string) $name, 'Authorization') === 0) {
                    $h = $value;
                    break;
                }
            }
        }
        if (is_string($h) && preg_match('/^Bearer\s+(\S+)\s*$/i', $h, $m)) {
            return $m[1];
        }
        return null;
    }
}
