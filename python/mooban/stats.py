"""App-level stats cache (Spec Mooban section 8): CACHE_DIR/stats.json for 10 s, hit/miss counters in
CACHE_DIR/cache-counters.json. Mirrors php/src/Stats.php."""
import json
import os
import secrets
import time
from datetime import datetime, timezone

from . import config, db
from .json_out import encode

try:
    import fcntl
except ImportError:  # not POSIX: counters are then best effort
    fcntl = None

TTL = 10


def stats_file():
    return os.path.join(config.CACHE_DIR, 'stats.json')


def counters_file():
    return os.path.join(config.CACHE_DIR, 'cache-counters.json')


def _unlink_quiet(path):
    try:
        os.unlink(path)
    except OSError:
        pass  # absent or unwritable: nothing to drop


def invalidate():
    """Drop the cached /api/stats payload after a successful write."""
    _unlink_quiet(stats_file())


def clear_all():
    """DELETE /api/cache: remove the cached payload and the hit/miss counters."""
    invalidate()
    _unlink_quiet(counters_file())


def _compute():
    row = db.one(
        'SELECT'
        ' (SELECT COUNT(*) FROM users) AS users,'
        ' (SELECT COUNT(*) FROM posts) AS posts,'
        ' (SELECT COUNT(*) FROM comments) AS comments,'
        ' (SELECT COUNT(*) FROM likes) AS likes,'
        ' (SELECT COUNT(*) FROM images) AS images,'
        ' (SELECT COALESCE(SUM(bytes_display + bytes_thumb), 0) FROM images) AS media_bytes,'
        ' (SELECT COALESCE(MAX(id), 0) FROM events) AS last_event_id')
    out = {k: int(row[k]) for k in ('users', 'posts', 'comments', 'likes', 'images', 'media_bytes', 'last_event_id')}
    out['generated_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return out


def _read_counts(raw):
    try:
        d = json.loads(raw)
    except ValueError:
        d = None
    c = {'hits': 0, 'misses': 0}
    if isinstance(d, dict):
        for k in c:
            v = d.get(k)
            c[k] = v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else 0
    return c


def _bump(key):
    """Increment one counter under an exclusive flock (cross-thread and cross-process)."""
    try:
        os.makedirs(config.CACHE_DIR, exist_ok=True)
        fd = os.open(counters_file(), os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        return
    try:
        if fcntl is not None:
            fcntl.flock(fd, fcntl.LOCK_EX)
        size = os.fstat(fd).st_size
        c = _read_counts(os.read(fd, size).decode('utf-8', 'replace') if size else '')
        c[key] += 1
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps(c).encode('ascii'))
    except OSError:
        pass
    finally:
        os.close(fd)  # also releases the lock


def counters():
    try:
        with open(counters_file(), encoding='utf-8') as fh:
            return _read_counts(fh.read())
    except OSError:
        return {'hits': 0, 'misses': 0}


def get():
    """(json text, served from cache): the cached payload when younger than 10 s, else a fresh one
    written atomically."""
    path = stats_file()
    try:
        fresh = int(time.time()) - int(os.stat(path).st_mtime) < TTL
    except OSError:
        fresh = False
    if fresh:
        try:
            with open(path, encoding='utf-8') as fh:
                cached = fh.read()
        except OSError:
            cached = ''
        if cached:
            _bump('hits')
            return cached, True

    text = encode(_compute())
    try:
        os.makedirs(config.CACHE_DIR, exist_ok=True)
        tmp = f'{path}.{secrets.token_hex(6)}.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as fh:
                fh.write(text)
            os.replace(tmp, path)
        except OSError:
            _unlink_quiet(tmp)
    except OSError:
        pass
    _bump('misses')
    return text, False
