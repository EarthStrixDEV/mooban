<?php
declare(strict_types=1);

final class Validate
{
    public const HANDLE_MSG = 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _';
    public const DISPLAY_NAME_MSG = 'ต้องยาว 1–50 ตัวอักษร';

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
        $h = strtolower(trim($value));
        return preg_match('/^[a-z0-9_]{3,20}$/D', $h) === 1 ? $h : null;
    }

    /** Trimmed display name (1..50 code points), or null. */
    public static function displayName(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $n = trim($value);
        $len = self::len($n);
        return ($len >= 1 && $len <= 50) ? $n : null;
    }
}
