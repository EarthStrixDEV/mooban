<?php
declare(strict_types=1);

final class Validate
{
    public const HANDLE_MSG = 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _';
    public const DISPLAY_NAME_MSG = 'ต้องยาว 1–50 ตัวอักษร';

    public const BODY_EMPTY_MSG = 'ต้องมีข้อความหรือรูป';
    public const BODY_LONG_MSG = 'ยาวเกิน 280 ตัวอักษร';

    /** JavaScript String.prototype.trim character set (Ruling R5). */
    private const WS = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    /** Trim exactly like JS trim(); never PHP trim() (different character set). */
    public static function trim(string $s): string
    {
        $out = preg_replace('/^[' . self::WS . ']+|[' . self::WS . ']+$/uD', '', $s);
        return $out ?? $s;
    }

    /**
     * Post body after trim, plus the field error (if any).
     * Non-strings count as empty. Empty is only valid when the post keeps an image.
     *
     * @return array{0:string,1:?string} [trimmed body, error message]
     */
    public static function postBody(mixed $value, bool $hasImage): array
    {
        $b = is_string($value) ? self::trim($value) : '';
        $len = self::len($b);
        if ($len > 280) {
            return [$b, self::BODY_LONG_MSG];
        }
        if ($len === 0 && !$hasImage) {
            return [$b, self::BODY_EMPTY_MSG];
        }
        return [$b, null];
    }

    /** Length in Unicode code points. */
    public static function len(string $s): int
    {
        return mb_strlen($s, 'UTF-8');
    }

    /** Trimmed + lowercased handle, or null when it does not match [a-z0-9_]{3,20}. */
    public static function handle(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $h = strtolower(self::trim($value));
        return preg_match('/^[a-z0-9_]{3,20}$/D', $h) === 1 ? $h : null;
    }

    /** Trimmed display name (1..50 code points), or null. */
    public static function displayName(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $n = self::trim($value);
        $len = self::len($n);
        return ($len >= 1 && $len <= 50) ? $n : null;
    }
}
