<?php
declare(strict_types=1);

$mbStart = microtime(true);

require __DIR__ . '/../src/bootstrap.php';

Http::start($mbStart);
Http::commonHeaders();

try {
    Ping::register();
    Users::register();

    Router::dispatch(
        $_SERVER['REQUEST_METHOD'] ?? 'GET',
        (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)
    );
} catch (Throwable $e) {
    error_log('mooban: ' . get_class($e) . ': ' . $e->getMessage());
    Http::error(500, 'server_error');
}
