"""Media paths and cleanup. (Serving /media and image processing arrive with the images task.)"""
import os
import re
import shutil
import stat

from . import config

_KEY_RE = re.compile(r'[0-9a-f]{16}\Z')


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
