"""Input validation (Ruling R5 trim, code-point lengths, field messages)."""
import re

HANDLE_MSG = 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _'
DISPLAY_NAME_MSG = 'ต้องยาว 1–50 ตัวอักษร'
BODY_EMPTY_MSG = 'ต้องมีข้อความหรือรูป'
BODY_LONG_MSG = 'ยาวเกิน 280 ตัวอักษร'

# Exactly the JavaScript String.prototype.trim set (Ruling R5). Not str.strip() with no
# argument, whose whitespace set differs; an explicit character set is linear-time, unlike a regex.
_TRIM_CHARS = (
    ''.join(chr(c) for c in range(0x09, 0x0E))
    + '   '
    + ''.join(chr(c) for c in range(0x2000, 0x200B))
    + '    　﻿'
)
_HANDLE_RE = re.compile(r'[a-z0-9_]{3,20}\Z')
_ASCII_UPPER = {c: c + 32 for c in range(ord('A'), ord('Z') + 1)}


def trim(s):
    return s.strip(_TRIM_CHARS)


def length(s):
    """Length in Unicode code points."""
    return len(s)


def ascii_lower(s):
    """ASCII-only lowercase, like PHP strtolower (str.lower() also folds e.g. the Kelvin sign)."""
    return s.translate(_ASCII_UPPER)


def handle(value):
    """Trimmed + lowercased handle, or None when it does not match [a-z0-9_]{3,20}."""
    if not isinstance(value, str):
        return None
    h = ascii_lower(trim(value))
    return h if _HANDLE_RE.match(h) else None


def display_name(value):
    """Trimmed display name (1..50 code points), or None."""
    if not isinstance(value, str):
        return None
    n = trim(value)
    return n if 1 <= length(n) <= 50 else None


def post_body(value, has_image):
    """(trimmed body, field error or None). Non-strings count as empty; empty needs an image."""
    b = trim(value) if isinstance(value, str) else ''
    n = length(b)
    if n > 280:
        return b, BODY_LONG_MSG
    if n == 0 and not has_image:
        return b, BODY_EMPTY_MSG
    return b, None
