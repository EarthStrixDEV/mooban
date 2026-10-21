"""Tabby test tools: /api/stats, /api/cache-stats, /api/slow, /api/echo, /api/limited, /download, /upload, /cache/*
(mirrors php/src/Routes/Tools.php)."""
import hashlib
import os
import re
import time
from datetime import datetime, timezone

from flask import g, request
from werkzeug.http import parse_options_header
from werkzeug.sansio.multipart import NEED_DATA, Data, Epilogue, Field, File, MultipartDecoder

from .. import ratelimit, stats, testguard
from ..http import (JsonResponse, HttpError, client_ip, json_response, parse_query, raw_path,
                    read_raw, route)

LIMITED_MAX = 10
ECHO_MAX = 1048576
CHUNK = 65536
FILE_MISSING_MSG = 'ต้องแนบไฟล์'
STATIC_LAST_MODIFIED = 'Mon, 01 Jan 2024 00:00:00 GMT'
_SLOW_RE = re.compile(r'(0|[1-9][0-9]{0,4})\Z')

# ---- stats / cache ---------------------------------------------------------------------------


def stats_handler(_params):
    text, hit = stats.get()
    resp = JsonResponse(text.encode('utf-8'), status=200, content_type='application/json; charset=utf-8')
    resp.headers['X-App-Cache'] = 'HIT' if hit else 'MISS'
    return resp


def cache_stats(_params):
    return json_response(200, stats.counters())


def clear_cache(_params):
    testguard.require()
    stats.clear_all()
    return json_response(204, None)


# ---- /api/slow, /api/echo, /api/limited -------------------------------------------------------


def slow(_params):
    testguard.require()
    ms = parse_query().get('ms')
    if not isinstance(ms, str) or _SLOW_RE.match(ms) is None or int(ms) > 10000:
        raise HttpError(400, 'bad_params')
    time.sleep(int(ms) / 1000)
    return json_response(200, {'slept_ms': int(ms)})


def _preview(body):
    """First 1024 bytes cut on a character boundary, invalid UTF-8 replaced with '?' (mb_strcut + mb_scrub)."""
    cut = min(len(body), 1024)
    while 0 < cut < len(body) and (body[cut] & 0xC0) == 0x80:
        cut -= 1
    head = body[:cut]
    try:
        return head.decode('utf-8')
    except UnicodeDecodeError:
        return head.decode('utf-8', 'replace').replace('�', '?')


def echo(_params):
    body = read_raw(ECHO_MAX)  # 413 payload_too_large beyond 1 MiB, declared or streamed

    headers = {}
    for name in ('Host', 'User-Agent', 'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Real-IP',
                 'Content-Type', 'Content-Length'):
        value = request.headers.get(name)
        if value:
            headers[name] = value
    return json_response(200, {
        'method': request.method,
        'path': raw_path(),
        'query': parse_query(),
        'protocol': 'https' if request.environ.get('wsgi.url_scheme') == 'https' else 'http',
        'client_ip': client_ip(),
        'headers': headers,
        'body_size': len(body),
        'body_preview': _preview(body),
    })


def limited(_params):
    hits = ratelimit.count(f'ip:{client_ip()}:limited')
    h = {'X-RateLimit-Limit': str(LIMITED_MAX), 'X-RateLimit-Remaining': str(max(0, LIMITED_MAX - hits))}
    if hits > LIMITED_MAX:
        retry = ratelimit.retry_after()
        raise HttpError(429, 'rate_limited', {'retry_after': retry}, {**h, 'Retry-After': str(retry)})
    return json_response(200, {'ok': True}, h)


# ---- /download, /upload -----------------------------------------------------------------------


def download(params):
    testguard.require()
    mb = params['mb']
    if mb not in ('1', '10', '100'):
        raise HttpError(400, 'bad_params')
    size = int(mb) * 1048576

    def chunks():
        sent = 0
        while sent < size:  # a client that leaves ends the server's write -> GeneratorExit here
            n = min(CHUNK, size - sent)
            yield os.urandom(n)
            sent += n

    resp = JsonResponse(chunks(), status=200, direct_passthrough=True, content_type='application/octet-stream')
    resp.headers['Content-Length'] = str(size)
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['X-Accel-Buffering'] = 'no'
    return resp


def _count_upload():
    """Bytes of the first `file` part with a filename, counted from the request stream (nothing is
    written to disk); None when the body has no such part. A body cut off after the file part began
    is 400 bad_params (PHP UPLOAD_ERR_PARTIAL); cut off before it, the file is simply missing."""
    ctype = request.headers.get('Content-Type', '')
    if not ctype.lower().startswith('multipart/form-data'):
        return None
    boundary = parse_options_header(ctype)[1].get('boundary')
    if not boundary:
        return None
    try:
        decoder = MultipartDecoder(boundary.encode('ascii'))
    except UnicodeEncodeError:
        return None

    stream = request.stream  # 413 itself once the body passes MAX_CONTENT_LENGTH (12 MiB)
    size = None
    counting = False
    try:
        while True:
            chunk = stream.read(CHUNK)
            decoder.receive_data(chunk or None)
            while True:
                ev = decoder.next_event()
                if ev is NEED_DATA:
                    break
                if isinstance(ev, File):
                    counting = ev.name == 'file' and size is None and bool(ev.filename)
                    if counting:
                        size = 0
                elif isinstance(ev, Field):
                    counting = False
                elif isinstance(ev, Data):
                    if counting:
                        size += len(ev.data)
                elif isinstance(ev, Epilogue):
                    return size
    except ValueError:  # truncated / malformed multipart
        if size is not None:
            raise HttpError(400, 'bad_params') from None
        return None


def upload(_params):
    testguard.require()
    size = _count_upload()
    if size is None:
        raise HttpError(422, 'validation_failed', {'fields': {'file': FILE_MISSING_MSG}})
    return json_response(200, {
        'received_bytes': size,
        'duration_ms': int(round((time.perf_counter() - g.mb_start) * 1000)),
    })


# ---- /cache/* ---------------------------------------------------------------------------------

_STATIC_BODY = ('Mooban cache test body. This text never changes between calls.\n' * 40)[:2048].encode('utf-8')
_STATIC_ETAG = '"' + hashlib.sha256(_STATIC_BODY).hexdigest() + '"'
_GZIP_LINE = 'The quick brown fox jumps over the lazy dog. Mooban compression test line.\n'
_GZIP_BODY = (_GZIP_LINE * (204800 // len(_GZIP_LINE) + 1))[:204800].encode('utf-8')


def _text(cache_control, body):
    resp = JsonResponse(body, status=200, content_type='text/plain; charset=utf-8')
    resp.headers['Cache-Control'] = cache_control
    return resp


def _etag_matches(header):
    """If-None-Match match, ignoring a weak prefix and the "-gzip" suffix mod_deflate appends."""
    inm = (header or '').strip()
    if not inm:
        return False
    for raw in inm.split(','):
        tag = raw.strip()
        if tag.startswith('W/'):
            tag = tag[2:]
        if tag.endswith('-gzip"'):
            tag = tag[:-6] + '"'
        if tag == '*' or tag == _STATIC_ETAG:
            return True
    return False


def cache_static(_params):
    if _etag_matches(request.headers.get('If-None-Match')):
        resp = JsonResponse(status=304)
    else:
        resp = JsonResponse(_STATIC_BODY, status=200, content_type='text/plain; charset=utf-8')
    resp.headers['Cache-Control'] = 'public, max-age=60'
    resp.headers['ETag'] = _STATIC_ETAG
    resp.headers['Last-Modified'] = STATIC_LAST_MODIFIED
    return resp


def cache_time(_params):
    ms = int(time.time() * 1000)
    return json_response(200, {
        'server_time': datetime.fromtimestamp(ms // 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'unix_ms': ms,
    }, {'Cache-Control': 'public, max-age=10'})


def register():
    route('GET', '/api/stats', stats_handler)
    route('GET', '/api/cache-stats', cache_stats)
    route('DELETE', '/api/cache', clear_cache)
    route('GET', '/api/slow', slow)
    for m in ('GET', 'POST', 'PUT', 'DELETE'):
        route(m, '/api/echo', echo)
    route('GET', '/api/limited', limited)
    route('GET', '/download/{mb}', download)
    route('POST', '/upload', upload)
    route('GET', '/cache/static', cache_static)
    route('GET', '/cache/none', lambda _p: _text('no-store', _STATIC_BODY))
    route('GET', '/cache/time', cache_time)
    route('GET', '/cache/gzip', lambda _p: _text('no-cache', _GZIP_BODY))
