<?php
declare(strict_types=1);

/**
 * Upload pipeline (Spec section 6): sniff -> header pixel check -> decode -> EXIF orient ->
 * display (<=1080 long side) -> thumb (<=320 wide) -> write via .tmp-<key>/ then rename.
 * Throws ImageException for every client-side rejection.
 */
final class Images
{
    public const DISPLAY_MAX = 1080;
    public const THUMB_WIDTH = 320;

    /** Test hook: behave as if GD had no WebP encoder (SWH fallback path). */
    public static bool $forceJpeg = false;

    public static function webpAvailable(): bool
    {
        if (self::$forceJpeg || !function_exists('imagewebp')) {
            return false;
        }
        $info = function_exists('gd_info') ? gd_info() : [];
        return !empty($info['WebP Support']);
    }

    /** 'jpeg' | 'png' | 'webp' from the first bytes of the file, or null. Never trusts name or Content-Type. */
    public static function detect(string $path): ?string
    {
        $fh = @fopen($path, 'rb');
        if ($fh === false) {
            return null;
        }
        $head = (string) fread($fh, 12);
        fclose($fh);
        if (strncmp($head, "\xFF\xD8\xFF", 3) === 0) {
            return 'jpeg';
        }
        if (strncmp($head, "\x89PNG\r\n\x1A\n", 8) === 0) {
            return 'png';
        }
        if (strlen($head) === 12 && strncmp($head, 'RIFF', 4) === 0 && substr($head, 8, 4) === 'WEBP') {
            return 'webp';
        }
        return null;
    }

    /**
     * @return array{width:int,height:int,format:string,bytes_display:int,bytes_thumb:int,media_key:string}
     * @throws ImageException
     */
    public static function process(string $tmpPath, int $size): array
    {
        if ($size > (int) Config::get('MAX_UPLOAD_BYTES')) {
            throw new ImageException(413, 'payload_too_large');
        }
        $type = self::detect($tmpPath);
        if ($type === null) {
            throw new ImageException(415, 'unsupported_media_type');
        }

        // Header only: refuse decompression bombs before any pixel is decoded.
        $info = @getimagesize($tmpPath);
        $known = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP];
        if ($info === false || !in_array($info[2], $known, true) || $info[0] < 1 || $info[1] < 1) {
            throw new ImageException(422, 'image_invalid');
        }
        if ($info[0] * $info[1] > (int) Config::get('MAX_PIXELS')) {
            throw new ImageException(422, 'image_too_many_pixels');
        }

        $data = @file_get_contents($tmpPath);
        $src = $data === false ? false : @imagecreatefromstring($data);
        unset($data);
        if ($src === false) {
            throw new ImageException(422, 'image_invalid');
        }

        $webp = self::webpAvailable();
        $alpha = $type !== 'jpeg';
        $orientation = $type === 'jpeg' ? self::orientation($tmpPath) : 1;

        // Size is computed for the upright picture. The source is resized first and rotated
        // afterwards: same pixels as rotate-then-resize, but the 90-degree copy is made on the
        // small image instead of a second full-size one (matters at 24 MP under memory_limit).
        $sw = imagesx($src);
        $sh = imagesy($src);
        $swap = $orientation >= 5;
        $ow = $swap ? $sh : $sw;
        $oh = $swap ? $sw : $sh;
        $scale = min(1.0, self::DISPLAY_MAX / max($ow, $oh));
        $dw = max(1, (int) round($ow * $scale));
        $dh = max(1, (int) round($oh * $scale));

        $display = self::resample($src, $sw, $sh, $swap ? $dh : $dw, $swap ? $dw : $dh, $alpha);
        unset($src);
        $display = self::orient($display, $orientation);
        if ($alpha && !$webp) {
            $display = self::flattenOnWhite($display);
        }

        if ($dw <= self::THUMB_WIDTH) {
            $tw = $dw;
            $th = $dh;
        } else {
            $tw = self::THUMB_WIDTH;
            $th = max(1, (int) round($dh * self::THUMB_WIDTH / $dw));
        }
        $thumb = self::resample($display, $dw, $dh, $tw, $th, $alpha && $webp);

        $displayBytes = self::encode($display, $webp, $webp ? 80 : 82);
        $thumbBytes = self::encode($thumb, $webp, $webp ? 75 : 78);
        unset($display, $thumb);

        $ext = $webp ? 'webp' : 'jpg';
        $key = self::store($displayBytes, $thumbBytes, $ext);

        return [
            'width' => $dw,
            'height' => $dh,
            'format' => $webp ? 'webp' : 'jpeg',
            'bytes_display' => strlen($displayBytes),
            'bytes_thumb' => strlen($thumbBytes),
            'media_key' => $key,
        ];
    }

    /** EXIF orientation 1..8 (JPEG only); 1 when absent, unreadable or out of range. */
    private static function orientation(string $path): int
    {
        if (!function_exists('exif_read_data')) {
            return 1;
        }
        try {
            $exif = @exif_read_data($path, 'IFD0');
        } catch (Throwable) {
            return 1;
        }
        $o = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;
        return ($o >= 1 && $o <= 8) ? $o : 1;
    }

    /** Apply EXIF orientation 1..8 to an already-resized image. */
    private static function orient(GdImage $img, int $o): GdImage
    {
        switch ($o) {
            case 2:
                imageflip($img, IMG_FLIP_HORIZONTAL);
                return $img;
            case 3:
                return self::rotate($img, 180);
            case 4:
                imageflip($img, IMG_FLIP_VERTICAL);
                return $img;
            case 5: // transpose: rotate 90 clockwise, then mirror horizontally
            case 6: // rotate 90 clockwise
            case 7: // transverse: rotate 90 clockwise, then flip vertically
                $r = self::rotate($img, 270); // GD angles are counter-clockwise
                if ($o === 5) {
                    imageflip($r, IMG_FLIP_HORIZONTAL);
                } elseif ($o === 7) {
                    imageflip($r, IMG_FLIP_VERTICAL);
                }
                return $r;
            case 8:
                return self::rotate($img, 90);
            default:
                return $img;
        }
    }

    private static function rotate(GdImage $img, int $ccwDegrees): GdImage
    {
        $r = imagerotate($img, $ccwDegrees, 0);
        if ($r === false) {
            throw new RuntimeException('imagerotate failed');
        }
        return $r;
    }

    /** Smooth (not nearest-neighbour) resample into a fresh truecolor canvas. Always copies. */
    private static function resample(GdImage $src, int $sw, int $sh, int $tw, int $th, bool $keepAlpha): GdImage
    {
        $dst = imagecreatetruecolor($tw, $th);
        if ($dst === false) {
            throw new RuntimeException('imagecreatetruecolor failed');
        }
        if ($keepAlpha) {
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, (int) imagecolorallocatealpha($dst, 0, 0, 0, 127));
        } else {
            imagefill($dst, 0, 0, (int) imagecolorallocate($dst, 255, 255, 255));
        }
        if (!imagecopyresampled($dst, $src, 0, 0, 0, 0, $tw, $th, $sw, $sh)) {
            throw new RuntimeException('imagecopyresampled failed');
        }
        return $dst;
    }

    /** Composite an image that may carry alpha onto an opaque white canvas (JPEG fallback). */
    private static function flattenOnWhite(GdImage $img): GdImage
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $out = imagecreatetruecolor($w, $h);
        if ($out === false) {
            throw new RuntimeException('imagecreatetruecolor failed');
        }
        imagefill($out, 0, 0, (int) imagecolorallocate($out, 255, 255, 255));
        imagealphablending($out, true);
        imagecopy($out, $img, 0, 0, 0, 0, $w, $h);
        return $out;
    }

    /** GD re-encode: nothing from the original (EXIF, GPS, ICC, text chunks) survives. */
    private static function encode(GdImage $img, bool $webp, int $quality): string
    {
        ob_start();
        $ok = $webp ? imagewebp($img, null, $quality) : imagejpeg($img, null, $quality);
        $bytes = (string) ob_get_clean();
        if (!$ok || $bytes === '') {
            throw new RuntimeException('image encode failed');
        }
        return $bytes;
    }

    /**
     * Write both files into MEDIA_DIR/.tmp-<key>/ then rename to MEDIA_DIR/<key>/ so a reader
     * (or a crash) sees both files or neither. Removes the staging dir on any failure.
     */
    private static function store(string $displayBytes, string $thumbBytes, string $ext): string
    {
        $root = Media::dir();
        if (!is_dir($root) && !@mkdir($root, 0755, true) && !is_dir($root)) {
            throw new RuntimeException('cannot create MEDIA_DIR');
        }

        $key = null;
        $tmp = '';
        for ($i = 0; $i < 5; $i++) {
            $candidate = bin2hex(random_bytes(8));
            $tmp = $root . '/.tmp-' . $candidate;
            if (!is_dir($root . '/' . $candidate) && @mkdir($tmp, 0755)) {
                $key = $candidate;
                break;
            }
        }
        if ($key === null) {
            throw new RuntimeException('cannot allocate media key');
        }

        try {
            @chmod($tmp, 0755); // mkdir mode is masked by umask
            foreach (['display' => $displayBytes, 'thumb' => $thumbBytes] as $name => $bytes) {
                $file = $tmp . '/' . $name . '.' . $ext;
                if (file_put_contents($file, $bytes) !== strlen($bytes)) {
                    throw new RuntimeException("cannot write $name");
                }
                @chmod($file, 0644);
            }
            if (!@rename($tmp, $root . '/' . $key)) {
                throw new RuntimeException('cannot publish media dir');
            }
        } catch (Throwable $e) {
            Media::removeTmpDir($key);
            throw $e;
        }
        return $key;
    }
}
