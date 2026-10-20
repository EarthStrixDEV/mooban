<?php
declare(strict_types=1);

final class TestEmit
{
    private const NONCE_MSG = 'ต้องยาว 1–64 ตัวอักษร';

    public static function register(): void
    {
        Router::add('POST', '/api/test/emit', [self::class, 'emit']);
    }

    /** @param array<string,string> $params */
    public static function emit(array $params): never
    {
        TestGuard::require();

        $raw = file_get_contents('php://input');
        $nonce = null;
        if ($raw !== false && $raw !== '') {
            $body = Http::body();
            if (array_key_exists('nonce', $body)) {
                $nonce = $body['nonce'];
                if (!is_string($nonce) || mb_strlen($nonce, 'UTF-8') < 1 || mb_strlen($nonce, 'UTF-8') > 64) {
                    Http::error(422, 'validation_failed', ['fields' => ['nonce' => self::NONCE_MSG]]);
                }
            }
        }
        if ($nonce === null) {
            $nonce = bin2hex(random_bytes(8));
        }

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $eventId = Events::emit($pdo, 'test.ping', ['nonce' => $nonce]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Events::afterCommit($pdo);
        Http::json(200, ['event_id' => $eventId, 'nonce' => $nonce]);
    }
}
