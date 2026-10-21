"""GET /api/stream: Server-Sent Events (Spec section 7, Python section 9). One stream = one worker thread
that polls the events table itself every SSE_POLL_MS on its own DB connection (mirrors php/src/Routes/Stream.php)."""
import re
import select
import socket
import threading
import time

from flask import request, stream_with_context

from .. import config, db
from ..http import HttpError, JsonResponse, client_ip, parse_query, route

ROW_TTL_SECONDS = 70
PING_AFTER_SECONDS = 15
BATCH = 500
RETRY_AFTER = 5
_ID_RE = re.compile(r'[0-9]{1,18}\Z')
_EVENTS_SQL = f'SELECT id, type, payload FROM events WHERE id > %s ORDER BY id LIMIT {BATCH}'


def _given_id():
    """Valid Last-Event-ID header, else valid ?last_id, else None (R15)."""
    q = parse_query().get('last_id')
    for raw in (request.headers.get('Last-Event-ID'), q):
        if isinstance(raw, str) and _ID_RE.match(raw):
            return int(raw)
    return None


class _Slot:
    """One row of `streams`; release() is idempotent and never raises (the 70 s expiry is the backstop)."""

    def __init__(self, row_id):
        self.row_id = row_id
        self._lock = threading.Lock()
        self._released = False

    def release(self):
        with self._lock:
            if self._released:
                return
            self._released = True
        try:
            c = db.connect()
            try:
                with c.cursor() as cur:
                    cur.execute('DELETE FROM streams WHERE id = %s', (self.row_id,))
            finally:
                c.close()
        except Exception:  # noqa: BLE001 - the row expires on its own
            pass


class _SseBody:
    """The response iterable. With direct_passthrough the server closes this object itself (WSGI close()),
    so it is the place that guarantees the slot is freed even if the generator never started."""

    def __init__(self, gen, slot):
        self._gen = gen
        self._slot = slot

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._gen)

    def close(self):
        try:
            self._gen.close()
        finally:
            self._slot.release()


def _peer_gone(sock):
    """True when the client closed its end (a readable socket that yields EOF). Cheap, so a closed tab frees
    its thread and slot at the next poll instead of at the next failed write."""
    if sock is None:
        return False
    try:
        readable, _, _ = select.select([sock], [], [], 0)
        return bool(readable) and sock.recv(1, socket.MSG_PEEK) == b''
    except ValueError:  # e.g. TLS sockets refuse MSG_PEEK: fall back to detecting failed writes
        return False
    except OSError:
        return True


def _events(slot, cursor, resync, sock):
    conn = None
    try:
        yield b'retry: 3000\n\n'
        if resync:
            yield b'event: resync\ndata: {}\n\n'

        conn = db.connect()  # dedicated: the request's connection is gone once this runs
        poll = max(50, config.SSE_POLL_MS) / 1000
        last_sent = time.monotonic()
        deadline = last_sent + config.SSE_MAX_SECONDS
        while True:
            with conn.cursor() as cur:
                cur.execute(_EVENTS_SQL, (cursor,))
                rows = cur.fetchall()
            if rows:
                out = []
                for r in rows:
                    out.append(f"id: {r['id']}\nevent: {r['type']}\ndata: {r['payload']}\n\n")
                    cursor = int(r['id'])
                yield ''.join(out).encode('utf-8')
                last_sent = time.monotonic()
                if len(rows) == BATCH and last_sent < deadline:
                    continue  # more backlog waiting, don't sleep
            elif time.monotonic() - last_sent >= PING_AFTER_SECONDS:
                yield b': ping\n\n'
                last_sent = time.monotonic()

            remaining = deadline - time.monotonic()
            if remaining <= 0 or _peer_gone(sock):
                break
            time.sleep(min(poll, remaining))
    except Exception as e:  # noqa: BLE001 - headers are sent: never emit a JSON error into the stream
        print('mooban: stream:', type(e).__name__, flush=True)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
        slot.release()


def handle(_params):
    ip = client_ip()

    # 1. Over-limit check BEFORE any SSE header, so 429 is a normal JSON response.
    db.run('DELETE FROM streams WHERE expires_at <= UTC_TIMESTAMP()')
    row = db.one('SELECT COUNT(*) AS n FROM streams WHERE ip = %s AND expires_at > UTC_TIMESTAMP()', (ip,))
    if int(row['n']) >= config.MAX_STREAMS_PER_IP:
        raise HttpError(429, 'rate_limited', {'retry_after': RETRY_AFTER}, {'Retry-After': str(RETRY_AFTER)})

    # 2. Reserve a slot (expires after 70 s even if cleanup never runs).
    _, row_id = db.run(
        f'INSERT INTO streams (ip, expires_at) VALUES (%s, UTC_TIMESTAMP() + INTERVAL {ROW_TTL_SECONDS} SECOND)',
        (ip,))
    slot = _Slot(row_id)

    try:
        # 3. Resolve the start point before returning the response, so a client that sees the headers
        # can emit and not miss the event.
        given = _given_id()
        r = db.one('SELECT MIN(id) AS lo, MAX(id) AS hi FROM events')
        lo = int(r['lo']) if r['lo'] is not None else None
        hi = int(r['hi']) if r['hi'] is not None else 0
        resync = False
        cursor = hi
        if given is not None:
            if lo is not None and given < lo:
                resync = True
            else:
                cursor = given
        gen = stream_with_context(_events(slot, cursor, resync, request.environ.get('gunicorn.socket')))
    except BaseException:
        slot.release()
        raise

    db.close()  # a stream holds a thread for up to a minute, not a request connection
    resp = JsonResponse(_SseBody(gen, slot), status=200, direct_passthrough=True,
                        content_type='text/event-stream; charset=utf-8')
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['X-Accel-Buffering'] = 'no'
    return resp


def register():
    route('GET', '/api/stream', handle)
