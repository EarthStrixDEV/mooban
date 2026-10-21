"""Configuration from the environment; python/.env is optional and never overrides real variables."""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the python/ folder


def _load_env_file(path):
    try:
        with open(path, encoding='utf-8') as fh:
            lines = fh.read().splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_env_file(os.path.join(BASE_DIR, '.env'))


def _str(key, fallback=None):
    value = os.environ.get(key)
    if value is None or value == '':
        if fallback is None:
            raise RuntimeError(f'Missing config key: {key}')
        return fallback
    return value


def _int(key, fallback):
    try:
        return int(_str(key, str(fallback)))
    except ValueError:
        raise RuntimeError(f'Config key {key} must be an integer') from None


def _path(key):
    return os.path.abspath(os.path.join(BASE_DIR, _str(key)))  # absolute values win in join


DB_HOST = _str('DB_HOST')
DB_PORT = _int('DB_PORT', 3306)
DB_NAME = _str('DB_NAME')
DB_USER = _str('DB_USER')
DB_PASS = _str('DB_PASS', '')
APP_STACK = _str('APP_STACK')
TEST_TOKEN = _str('TEST_TOKEN', '')
PUBLIC_DIR = _path('PUBLIC_DIR')
MEDIA_DIR = _path('MEDIA_DIR')
CACHE_DIR = _path('CACHE_DIR')
PORT = _int('PORT', 8084)
TRUST_PROXY = _str('TRUST_PROXY', '0') == '1'
MAX_UPLOAD_BYTES = _int('MAX_UPLOAD_BYTES', 10485760)
MAX_PIXELS = _int('MAX_PIXELS', 24000000)
SSE_POLL_MS = _int('SSE_POLL_MS', 1000)
SSE_MAX_SECONDS = _int('SSE_MAX_SECONDS', 60)
MAX_STREAMS_PER_IP = _int('MAX_STREAMS_PER_IP', 10)

# Spec section 9: a little above MAX_UPLOAD_BYTES so an oversized upload becomes a JSON 413.
MAX_CONTENT_LENGTH = 12 * 1024 * 1024
