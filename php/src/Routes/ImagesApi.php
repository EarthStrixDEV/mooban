<?php
declare(strict_types=1);

final class ImagesApi
{
    private const USER_QUOTA = 100;
    private const STACK_QUOTA = 500;
    private const ALT_MAX = 200;

    private const SELECT = 'SELECT i.id, i.user_id, i.media_key, i.width, i.height, i.format,
            i.bytes_display, i.bytes_thumb, i.alt, i.created_at, u.handle, u.display_name
        FROM images i
        JOIN users u ON u.id = i.user_id';

    public static function register(): void
    {
        Router::add('POST', '/api/images', [self::class, 'create']);
        Router::add('GET', '/api/images', [self::class, 'index']);
        Router::add('PATCH', '/api/images/{id:\d+}', [self::class, 'patch']);
        Router::add('DELETE', '/api/images/{id:\d+}', [self::class, 'destroy']);
    }

    /** @return array<string,mixed>|null images row joined with its author */
    private static function find(PDO $pdo, ?int $id): ?array
    {
        if ($id === null) {
            return null;
        }
        $st = $pdo->prepare(self::SELECT . ' WHERE i.id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** Path id (digits only, no leading zero) -> int, or null when it is not a valid id. */
    private static function id(string $raw): ?int
    {
        return (string) (int) $raw === $raw && (int) $raw > 0 ? (int) $raw : null;
    }

    /** Positive-integer query param, null when absent; 400 bad_params when malformed. */
    private static function intParam(string $name): ?int
    {
        if (!array_key_exists($name, $_GET)) {
            return null;
        }
        $v = $_GET[$name];
        if (!is_string($v) || preg_match('/^[1-9][0-9]*$/D', $v) !== 1 || (string) (int) $v !== $v) {
            Http::error(400, 'bad_params');
        }
        return (int) $v;
    }

    /** php.ini shorthand ("12M") -> bytes; 0 when unlimited/unparsable. */
    private static function iniBytes(string $name): int
    {
        $v = trim((string) ini_get($name));
        if ($v === '' || !preg_match('/^(\d+)\s*([KMG]?)/i', $v, $m)) {
            return 0;
        }
        $n = (int) $m[1];
        return match (strtoupper($m[2])) {
            'K' => $n * 1024,
            'M' => $n * 1024 * 1024,
            'G' => $n * 1024 * 1024 * 1024,
            default => $n,
        };
    }

    /** @param array<string,string> $params */
    public static function create(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        RateLimit::hit("user:$uid:upload", 10);

        $pdo = Db::pdo();
        $st = $pdo->prepare('SELECT COUNT(*) FROM images WHERE user_id = ?');
        $st->execute([$uid]);
        $mine = (int) $st->fetchColumn();
        $total = (int) $pdo->query(
            "SELECT COUNT(*) FROM images i JOIN users u ON u.id = i.user_id WHERE LEFT(u.handle, 5) <> 'seed_'"
        )->fetchColumn();
        if ($mine >= self::USER_QUOTA || $total >= self::STACK_QUOTA) {
            Http::error(422, 'quota_reached');
        }

        // PHP throws away the whole body (no $_FILES, no $_POST) when it exceeds post_max_size.
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        $isMultipart = stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
        if ($isMultipart && $contentLength > 0 && $_POST === [] && $_FILES === []) {
            $postMax = self::iniBytes('post_max_size');
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
        if ($err === UPLOAD_ERR_PARTIAL) {
            Http::error(422, 'image_invalid');
        }
        if ($err !== UPLOAD_ERR_OK) {
            throw new RuntimeException("upload error $err"); // no tmp dir, disk full, extension: server fault
        }
        $tmp = (string) $file['tmp_name'];
        if (!is_uploaded_file($tmp)) {
            Http::error(422, 'validation_failed', ['fields' => ['file' => 'ต้องแนบไฟล์']]);
        }

        // From here on the file is fully received: processing_ms starts counting.
        $t0 = microtime(true);
        $size = (int) filesize($tmp);
        if ($size > (int) Config::get('MAX_UPLOAD_BYTES')) {
            Http::error(413, 'payload_too_large');
        }
        if (Images::detect($tmp) === null) {
            Http::error(415, 'unsupported_media_type');
        }

        $alt = null;
        $altIn = $_POST['alt'] ?? null;
        if (is_string($altIn)) {
            $alt = Validate::trim($altIn);
            if (Validate::len($alt) > self::ALT_MAX) {
                Http::error(422, 'validation_failed', ['fields' => ['alt' => 'ยาวเกิน 200 ตัวอักษร']]);
            }
            if ($alt === '') {
                $alt = null;
            }
        }

        try {
            $r = Images::process($tmp, $size);
        } catch (ImageException $e) {
            Http::error($e->status, $e->errorCode);
        }
        $ms = (int) round((microtime(true) - $t0) * 1000);

        try {
            $pdo->prepare(
                'INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, alt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$uid, $r['media_key'], $r['width'], $r['height'], $r['format'],
                $r['bytes_display'], $r['bytes_thumb'], $alt]);
            $id = (int) $pdo->lastInsertId();
            $row = self::find($pdo, $id);
            if ($row === null) {
                throw new RuntimeException('inserted image row not found');
            }
        } catch (Throwable $e) {
            Media::removeDir($r['media_key']);
            throw $e;
        }
        Stats::invalidate();
        Http::json(201, Json::image($row) + ['processing_ms' => $ms]);
    }

    /** @param array<string,string> $params */
    public static function index(array $params): never
    {
        $limit = self::intParam('limit') ?? 40;
        $before = self::intParam('before');
        if ($limit > 100) {
            Http::error(400, 'bad_params');
        }
        $handle = null;
        if (array_key_exists('user', $_GET)) {
            if (!is_string($_GET['user'])) {
                Http::error(400, 'bad_params');
            }
            $handle = strtolower($_GET['user']);
        }

        $sql = self::SELECT . ' WHERE 1 = 1';
        $args = [];
        if ($handle !== null) {
            $sql .= ' AND u.handle = ?';
            $args[] = $handle;
        }
        if ($before !== null) {
            $sql .= ' AND i.id < ?';
            $args[] = $before;
        }
        $sql .= ' ORDER BY i.id DESC LIMIT ' . ($limit + 1);

        $st = Db::pdo()->prepare($sql);
        $st->execute($args);
        $rows = $st->fetchAll();
        $more = count($rows) > $limit;
        if ($more) {
            array_pop($rows);
        }
        $data = array_map(static fn(array $r): array => Json::image($r), $rows);
        Http::json(200, [
            'data' => $data,
            'next_before' => $more ? $data[count($data) - 1]['id'] : null,
        ]);
    }

    /**
     * 404 -> 403 gate shared by PATCH and DELETE.
     *
     * @return array<string,mixed>
     */
    private static function owned(string $rawId, int $uid): array
    {
        $row = self::find(Db::pdo(), self::id($rawId));
        if ($row === null) {
            Http::error(404, 'not_found');
        }
        if ((int) $row['user_id'] !== $uid) {
            Http::error(403, 'not_owner');
        }
        return $row;
    }

    /** @param array<string,string> $params */
    public static function patch(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $row = self::owned($params['id'], $uid);
        RateLimit::hit("user:$uid:write", 30);
        $in = Http::body();

        $alt = $in['alt'] ?? null;
        if ($alt !== null && !is_string($alt)) {
            Http::error(422, 'validation_failed', ['fields' => ['alt' => 'ต้องเป็นข้อความ']]);
        }
        if ($alt !== null) {
            $alt = Validate::trim($alt);
            if (Validate::len($alt) > self::ALT_MAX) {
                Http::error(422, 'validation_failed', ['fields' => ['alt' => 'ยาวเกิน 200 ตัวอักษร']]);
            }
            if ($alt === '') {
                $alt = null;
            }
        }

        $id = (int) $row['id'];
        $pdo = Db::pdo();
        $pdo->prepare('UPDATE images SET alt = ? WHERE id = ?')->execute([$alt, $id]);
        $fresh = self::find($pdo, $id);
        if ($fresh === null) {
            Http::error(404, 'not_found');
        }
        Stats::invalidate();
        Http::json(200, Json::image($fresh));
    }

    /** @param array<string,string> $params */
    public static function destroy(array $params): never
    {
        $user = Auth::require();
        $uid = (int) $user['id'];
        $row = self::owned($params['id'], $uid);
        RateLimit::hit("user:$uid:write", 30);

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            // posts.image_id goes NULL through the FK (ON DELETE SET NULL)
            $pdo->prepare('DELETE FROM images WHERE id = ?')->execute([(int) $row['id']]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        Media::removeDir((string) $row['media_key']);
        Stats::invalidate();
        Http::json(204, null);
    }
}
