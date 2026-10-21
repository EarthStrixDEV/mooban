"""App-level stats cache. (GET /api/stats and the hit/miss counters arrive with the stats task.)"""
import os

from . import config


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
