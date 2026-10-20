export const HANDLE_MSG = 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _';
export const DISPLAY_NAME_MSG = 'ต้องยาว 1–50 ตัวอักษร';
export const BODY_EMPTY_MSG = 'ต้องมีข้อความหรือรูป';
export const BODY_LONG_MSG = 'ยาวเกิน 280 ตัวอักษร';

/** Ruling R5: String.prototype.trim is exactly the required character set. */
export function trim(s) {
  return s.trim();
}

/** Length in Unicode code points. */
export function len(s) {
  return [...s].length;
}

/** ASCII-only lowercase, like PHP strtolower (JS toLowerCase also folds e.g. the Kelvin sign). */
export function asciiLower(s) {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Trimmed + lowercased handle, or null when it does not match [a-z0-9_]{3,20}. */
export function handle(value) {
  if (typeof value !== 'string') return null;
  const h = asciiLower(trim(value));
  return /^[a-z0-9_]{3,20}$/.test(h) ? h : null;
}

/** Trimmed display name (1..50 code points), or null. */
export function displayName(value) {
  if (typeof value !== 'string') return null;
  const n = trim(value);
  const l = len(n);
  return l >= 1 && l <= 50 ? n : null;
}

/**
 * Post body after trim plus the field error (if any). Non-strings count as empty;
 * empty is only valid when the post keeps an image.
 * @returns {[string, string|null]}
 */
export function postBody(value, hasImage) {
  const b = typeof value === 'string' ? trim(value) : '';
  const l = len(b);
  if (l > 280) return [b, BODY_LONG_MSG];
  if (l === 0 && !hasImage) return [b, BODY_EMPTY_MSG];
  return [b, null];
}
