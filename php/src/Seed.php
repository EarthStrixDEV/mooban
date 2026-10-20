<?php
declare(strict_types=1);

/** Test-data tools (Spec section 8): seed, wipe and the media/DB consistency check. */
final class Seed
{
    private const SPAN_SECONDS = 7 * 86400;
    private const BATCH = 500;
    private const SEED_LIKE = 'seed\\_%'; // MySQL pattern seed\_% (escaped underscore)

    /** @return list<string> */
    private static function texts(): array
    {
        $raw = @file_get_contents(__DIR__ . '/../seed-texts.json');
        $list = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($list) || $list === [] || !array_is_list($list)) {
            throw new RuntimeException('seed-texts.json missing or invalid');
        }
        return array_map('strval', $list);
    }

    private static function samplePath(): string
    {
        $root = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
        $path = rtrim($root, '/\\') . '/sample.jpg';
        if ($root === '' || !is_file($path)) {
            $path = dirname(__DIR__) . '/public_html/sample.jpg';
        }
        if (!is_file($path)) {
            throw new RuntimeException('sample.jpg not found');
        }
        return $path;
    }

    /** @return array{users:int,posts:int,images:int,duration_ms:int} */
    public static function run(int $users, int $posts, int $images): array
    {
        $t0 = microtime(true);
        @set_time_limit(300);
        $pdo = Db::pdo();
        $texts = self::texts();
        $nTexts = count($texts);

        // Continue after the highest existing seed_NNN.
        $max = 0;
        $q = $pdo->prepare('SELECT handle FROM users WHERE handle LIKE ?');
        $q->execute([self::SEED_LIKE]);
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $h) {
            if (preg_match('/^seed_([0-9]+)$/D', (string) $h, $m) === 1) {
                $max = max($max, (int) $m[1]);
            }
        }

        $start = time() - self::SPAN_SECONDS;
        $fmt = static fn(int $ts): string => gmdate('Y-m-d H:i:s', $ts);
        // Post i: evenly spread over the last 7 days, oldest first (ids rise with time).
        $at = static fn(int $i): int => $start + intdiv($i * self::SPAN_SECONDS, max(1, $posts));

        $keys = [];
        try {
            // Process sample.jpg once; the first image keeps that dir, the others are copies.
            $img = null;
            if ($images > 0) {
                $path = self::samplePath();
                $img = Images::process($path, (int) filesize($path));
                $ext = $img['format'] === 'webp' ? 'webp' : 'jpg';
                $keys[] = $img['media_key'];
                $dir = Media::dir() . '/' . $img['media_key'];
                $display = (string) file_get_contents($dir . '/display.' . $ext);
                $thumb = (string) file_get_contents($dir . '/thumb.' . $ext);
                for ($i = 1; $i < $images; $i++) {
                    $keys[] = Images::store($display, $thumb, $ext);
                }
            }

            $pdo->beginTransaction();

            $handles = [];
            $ph = [];
            $args = [];
            for ($i = 1; $i <= $users; $i++) {
                $n = sprintf('%03d', $max + $i);
                $handles[] = 'seed_' . $n;
                $ph[] = '(?, ?, ?, ?)';
                // Token is random and thrown away: only its hash is stored.
                array_push($args, 'seed_' . $n, 'Seed ' . $n, hash('sha256', bin2hex(random_bytes(32))), $fmt($start));
            }
            $pdo->prepare('INSERT INTO users (handle, display_name, token_hash, created_at) VALUES ' . implode(',', $ph))
                ->execute($args);
            $sel = $pdo->prepare('SELECT handle, id FROM users WHERE handle IN (' . implode(',', array_fill(0, $users, '?')) . ')');
            $sel->execute($handles);
            $idByHandle = $sel->fetchAll(PDO::FETCH_KEY_PAIR);
            $userIds = [];
            foreach ($handles as $h) {
                $userIds[] = (int) $idByHandle[$h];
            }

            // Image i belongs to the author of post i and is attached to it below.
            $imageIds = [];
            if ($img !== null) {
                $ins = $pdo->prepare(
                    'INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, alt, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)'
                );
                for ($i = 0; $i < $images; $i++) {
                    $ins->execute([
                        $userIds[$i % $users], $keys[$i], $img['width'], $img['height'], $img['format'],
                        $img['bytes_display'], $img['bytes_thumb'], $fmt($at($i)),
                    ]);
                    $imageIds[$i] = (int) $pdo->lastInsertId();
                }
            }

            for ($from = 0; $from < $posts; $from += self::BATCH) {
                $to = min($posts, $from + self::BATCH);
                $ph = [];
                $args = [];
                for ($i = $from; $i < $to; $i++) {
                    $ts = $fmt($at($i));
                    $ph[] = '(?, ?, ?, ?, ?)';
                    array_push($args, $userIds[$i % $users], $texts[random_int(0, $nTexts - 1)], $imageIds[$i] ?? null, $ts, $ts);
                }
                $pdo->prepare('INSERT INTO posts (user_id, body, image_id, created_at, updated_at) VALUES ' . implode(',', $ph))
                    ->execute($args);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            foreach ($keys as $k) {
                Media::removeDir($k);
            }
            throw $e;
        }

        Stats::invalidate();
        return [
            'users' => $users,
            'posts' => $posts,
            'images' => $images,
            'duration_ms' => (int) round((microtime(true) - $t0) * 1000),
        ];
    }

    /** @return array{deleted_users:int,deleted_posts:int,deleted_images:int} */
    public static function wipe(): array
    {
        @set_time_limit(300);
        $pdo = Db::pdo();

        $q = $pdo->prepare('SELECT COUNT(*) FROM users WHERE handle LIKE ?');
        $q->execute([self::SEED_LIKE]);
        $users = (int) $q->fetchColumn();

        $q = $pdo->prepare('SELECT COUNT(*) FROM posts p JOIN users u ON u.id = p.user_id WHERE u.handle LIKE ?');
        $q->execute([self::SEED_LIKE]);
        $posts = (int) $q->fetchColumn();

        $q = $pdo->prepare('SELECT i.media_key FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE ?');
        $q->execute([self::SEED_LIKE]);
        $keys = $q->fetchAll(PDO::FETCH_COLUMN);

        // FKs cascade posts, images, likes and comments; the media dirs are ours to remove.
        $pdo->prepare('DELETE FROM users WHERE handle LIKE ?')->execute([self::SEED_LIKE]);
        foreach ($keys as $k) {
            Media::removeDir((string) $k);
        }
        Stats::invalidate();

        return ['deleted_users' => $users, 'deleted_posts' => $posts, 'deleted_images' => count($keys)];
    }

    /** @return array{orphan_dirs:int,missing_files:int} */
    public static function orphans(): array
    {
        $root = Media::dir();
        $known = [];
        $missing = 0;
        foreach (Db::pdo()->query('SELECT media_key, format FROM images') as $r) {
            $key = (string) $r['media_key'];
            $known[$key] = true;
            $ext = $r['format'] === 'webp' ? 'webp' : 'jpg';
            if (!is_file("$root/$key/display.$ext") || !is_file("$root/$key/thumb.$ext")) {
                $missing++;
            }
        }

        $orphans = 0;
        $entries = is_dir($root) ? scandir($root) : false;
        foreach ($entries === false ? [] : $entries as $name) {
            if (preg_match('/^[0-9a-f]{16}$/D', $name) === 1 && is_dir("$root/$name") && !isset($known[$name])) {
                $orphans++;
            }
        }
        return ['orphan_dirs' => $orphans, 'missing_files' => $missing];
    }
}
