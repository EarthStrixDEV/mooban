"""HTTP plumbing: errors, JSON responses, request parsing and the /api route table (mirrors php/src/Router.php)."""
import json
import re
import time
from urllib.parse import parse_qsl, quote

from flask import Response, current_app, g, request
from werkzeug.exceptions import HTTPException

from . import config
from .json_out import encode

BODY_LIMIT = 1024 * 1024
MAX_JSON_DEPTH = 512  # PHP json_decode default
INT64_MAX = 9223372036854775807

# /api plus the tool endpoints PHP also routes through api.php.
API_RE = re.compile(r'/(api|download|upload|cache)(/|\Z)')
_BEARER_RE = re.compile(r'Bearer[ \t\n\v\f\r]+([^ \t\n\v\f\r]+)[ \t\n\v\f\r]*', re.IGNORECASE)
_ID_RE = re.compile(r'[1-9][0-9]*\Z')
_SURROGATE_RE = re.compile('[\ud800-\udfff]')


class HttpError(Exception):
    """Raised anywhere in a handler; becomes {"error": code, **extra} with the given status."""

    def __init__(self, status, code, extra=None, headers=None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra or {}
        self.headers = headers or {}


def error(status, code, **extra):
    """Abort the request with a JSON error."""
    raise HttpError(status, code, extra)


class JsonResponse(Response):
    """Response without Werkzeug's default text/html Content-Type (204s carry none)."""

    default_mimetype = None


def json_response(status, body, headers=None):
    """JSON body with the given status; body None -> empty (e.g. 204)."""
    if body is None:
        resp = JsonResponse(status=status)
    else:
        resp = JsonResponse(encode(body).encode('utf-8'), status=status,
                            content_type='application/json; charset=utf-8')
    for name, value in (headers or {}).items():
        resp.headers[name] = value
    return resp


def error_response(status, code, extra=None, headers=None):
    return json_response(status, {'error': code, **(extra or {})}, headers)


# ---- request parsing -----------------------------------------------------------------------

def raw_target():
    """The request target as sent (still percent-encoded), like Node's req.url / PHP's REQUEST_URI."""
    env = request.environ
    raw = env.get('RAW_URI') or env.get('REQUEST_URI')
    if not raw:
        raw = quote(env.get('PATH_INFO', ''), safe="/:@!$&'()*+,;=-._~")
        if env.get('QUERY_STRING'):
            raw += '?' + env['QUERY_STRING']
    return raw


def raw_path():
    return raw_target().split('?', 1)[0]


def client_ip():
    """Client IP as PHP's REMOTE_ADDR would show it (X-Forwarded-For only with TRUST_PROXY=1)."""
    return request.remote_addr or ''


def bearer():
    """Bearer token from the Authorization header, or None."""
    h = request.headers.get('Authorization')
    if not isinstance(h, str):
        return None
    m = _BEARER_RE.fullmatch(h)
    return m.group(1) if m else None


def parse_query():
    """Query parameters like PHP's $_GET: last value wins, name[...] makes an array (list)."""
    target = raw_target()
    out = {}
    if '?' not in target:
        return out
    for k, v in parse_qsl(target.split('?', 1)[1], keep_blank_values=True):
        b = k.find('[')
        if b > 0 and k.find(']', b) > b:
            out[k[:b]] = []
        else:
            out[k] = v
    return out


def int_param(query, name):
    """Positive-integer query param: None when absent, 400 bad_params when malformed."""
    if name not in query:
        return None
    v = query[name]
    if not isinstance(v, str) or _ID_RE.match(v) is None or len(v) > 19 or int(v) > INT64_MAX:
        raise HttpError(400, 'bad_params')
    return int(v)


def parse_id(raw):
    """Numeric path id (Ruling R7: ^[1-9][0-9]*$ and fits int64), else None."""
    if _ID_RE.match(raw) is None or len(raw) > 19 or int(raw) > INT64_MAX:
        return None  # length first: int() on thousands of digits raises ValueError
    return int(raw)


def _reject_constant(_name):
    raise ValueError('NaN/Infinity are not JSON')


def _parse_int(text):
    # Python refuses int() on huge digit strings; PHP turns them into floats (never valid ids).
    return int(text) if len(text) < 4000 else float(text)


def _check_depth(text):
    """Raise when arrays/objects nest deeper than MAX_JSON_DEPTH (scans outside strings only)."""
    depth = 0
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if in_string:
            if c == '\\':
                i += 1
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c == '{' or c == '[':
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ValueError('too deep')
        elif c == '}' or c == ']':
            depth -= 1
        i += 1


def _check_surrogates(value):
    """PHP json_decode fails on lone surrogate escapes; Python keeps them, so reject them here."""
    stack = [value]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            if _SURROGATE_RE.search(v):
                raise ValueError('invalid utf-16')
        elif isinstance(v, dict):
            for k, item in v.items():
                if _SURROGATE_RE.search(k):
                    raise ValueError('invalid utf-16')
                stack.append(item)
        elif isinstance(v, list):
            stack.extend(v)


def read_raw(limit=BODY_LIMIT):
    """Raw request body (up to `limit` bytes, else 413 payload_too_large), read on demand."""
    length = request.content_length
    if length is not None and length > limit:
        raise HttpError(413, 'payload_too_large')
    chunks = []
    size = 0
    stream = request.stream  # raises 413 itself beyond MAX_CONTENT_LENGTH
    while True:
        chunk = stream.read(65536)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HttpError(413, 'payload_too_large')
        chunks.append(chunk)
    return b''.join(chunks)


def parse_object(raw):
    """Parse a raw body as a JSON object (anything else is 400 invalid_json)."""
    try:
        text = raw.decode('utf-8')  # strict; a BOM stays in the text and json.loads rejects it
        _check_depth(text)
        obj = json.loads(text, parse_int=_parse_int, parse_constant=_reject_constant)
        _check_surrogates(obj)
    except (ValueError, RecursionError):  # UnicodeDecodeError and JSONDecodeError are ValueErrors
        raise HttpError(400, 'invalid_json') from None
    if not isinstance(obj, dict):
        raise HttpError(400, 'invalid_json')
    return obj


def read_body():
    """Read and parse the JSON request body (lazily, so 401/404/429 can come first)."""
    return parse_object(read_raw())


# ---- route table (kept on the app, so a second create_app() starts empty) -----------------


def route(method, pattern, handler):
    """Pattern syntax: /api/posts/{id:[0-9]+} or /api/users/{handle} (default [^/]+).

    The handler gets a dict of the named groups and returns a Response (None -> 204).
    """
    src = re.sub(r'\{(\w+)(?::([^}]+))?\}', lambda m: f'(?P<{m.group(1)}>{m.group(2) or "[^/]+"})', pattern)
    current_app.extensions['mb_routes'].append((method.upper(), re.compile(src), handler))


def dispatch(path):
    """First route whose path and method match, else 405 / 404 (PHP Router::dispatch)."""
    path_matched = False
    for method, regex, handler in current_app.extensions['mb_routes']:
        m = regex.fullmatch(path)
        if m is None:
            continue
        path_matched = True
        if method != request.method:
            continue
        resp = handler(m.groupdict())
        return resp if resp is not None else json_response(204, None)
    raise HttpError(405 if path_matched else 404, 'method_not_allowed' if path_matched else 'not_found')


# ---- hooks and error handlers --------------------------------------------------------------

def _before_request():
    g.mb_start = time.perf_counter()
    path = raw_path()
    g.mb_api = API_RE.match(path) is not None
    if g.mb_api:
        return dispatch(path)
    return None


def _after_request(resp):
    resp.headers['X-Robots-Tag'] = 'noindex'
    if g.get('mb_api'):
        resp.headers['X-Stack'] = config.APP_STACK
        ms = (time.perf_counter() - g.mb_start) * 1000
        resp.headers['Server-Timing'] = f'app;dur={ms:.1f}'
    return resp


def _http_error(err):
    return error_response(err.status, err.code, err.extra, err.headers)


_STATUS_CODES = {404: 'not_found', 405: 'method_not_allowed', 413: 'payload_too_large'}


def _werkzeug_error(err):
    status = err.code or 500
    if status >= 500:
        return error_response(500, 'server_error')
    return error_response(status, _STATUS_CODES.get(status, 'bad_request'))


def _unexpected(err):
    # Class name only: never log request headers or bodies (tokens).
    print('mooban:', type(err).__name__, err.args[0] if err.args and isinstance(err.args[0], int) else '',
          flush=True)
    return error_response(500, 'server_error')


def init_app(app):
    app.extensions['mb_routes'] = []
    app.before_request(_before_request)
    app.after_request(_after_request)
    app.register_error_handler(HttpError, _http_error)
    app.register_error_handler(HTTPException, _werkzeug_error)
    app.register_error_handler(Exception, _unexpected)
