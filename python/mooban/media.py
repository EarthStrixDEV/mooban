"""Media paths, cleanup and the /media/<key>/<file> static handler."""
import os
import re
import shutil
import stat

from flask import send_from_directory
from werkzeug.exceptions import NotFound

from . import config

_KEY_RE = re.compile(r'[0-9a-f]{16}\Z')
_NAME_RE = re.compile(r'(?:display|thumb)\.(webp|jpg)\Z')
_MIME = {'webp': 'image/webp', 'jpg': 'image/jpeg'}
_CACHE_CONTROL = 'public, max-age=31536000, immutable'


def serve(key, name):
    """Immutable, nosniff, ETag/Last-Modified -> 304. Only <16 hex>/{display,thumb}.{webp,jpg}:
    anything else (listings, .tmp-* staging dirs, traversal) is a 404."""
    m = _NAME_RE.match(name)
    if m is None or _KEY_RE.match(key) is None:
        raise NotFound()
    resp = send_from_directory(config.MEDIA_DIR, f'{key}/{name}', mimetype=_MIME[m.group(1)],
                               max_age=31536000, conditional=True, etag=True)
    resp.headers['Cache-Control'] = _CACHE_CONTROL
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    return resp


def url(key, fmt, kind):
    """Public URL of one rendition: /media/<key>/<display|thumb>.<webp|jpg>."""
    return f'/media/{key}/{kind}.{"webp" if fmt == "webp" else "jpg"}'


def _rm(directory):
    try:
        mode = os.lstat(directory).st_mode
    except OSError:
        return
    if not stat.S_ISDIR(mode):  # lstat: a symlink is not a directory, so it is skipped
        return
    shutil.rmtree(directory, ignore_errors=True)


def remove_dir(key):
    """Recursively delete MEDIA_DIR/<key>. Ignored when absent; keys must be 16 hex chars."""
    if not _KEY_RE.match(key):
        return
    _rm(os.path.join(config.MEDIA_DIR, key))


def remove_tmp_dir(key):
    """Delete the half-written MEDIA_DIR/.tmp-<key> staging directory."""
    if not _KEY_RE.match(key):
        return
    _rm(os.path.join(config.MEDIA_DIR, f'.tmp-{key}'))
