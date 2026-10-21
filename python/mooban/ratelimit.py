"""Fixed one-minute (UTC) rate limit windows stored in rate_limits."""
import time
from datetime import datetime, timezone

from . import db
from .http import HttpError


def retry_after():
    """Seconds left in the current minute window (at least 1)."""
    return max(1, 60 - (int(time.time()) % 60))


def _fmt(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def count(bucket):
    """Count one hit in the current window and return the window's total."""
    now = int(time.time())
    window = _fmt(now - (now % 60))
    affected, _ = db.run(
        'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (%s, %s, 1) '
        'ON DUPLICATE KEY UPDATE hits = hits + 1',
        (bucket, window),
    )
    # affected rows: 1 for a fresh row, 2 when the duplicate branch updated it.
    if affected == 1:
        db.run('DELETE FROM rate_limits WHERE window_start < %s', (_fmt(now - 3600),))
    row = db.one('SELECT hits FROM rate_limits WHERE bucket = %s AND window_start = %s', (bucket, window))
    return int(row['hits'])


def hit(bucket, limit):
    """Over the limit -> 429 rate_limited with Retry-After."""
    if count(bucket) > limit:
        retry = retry_after()
        raise HttpError(429, 'rate_limited', {'retry_after': retry}, {'Retry-After': str(retry)})
