"""GET /ws: WebSocket ping endpoint (Spec section 7, Python section 9; mirrors node/src/ws.js).

Client {"type":"ping","t":n} gets {"type":"pong","t":n}; everything else is ignored. The server sends nothing
else, never pings, has no idle timeout and never closes on its own. Message contents are never logged.
Needs a threaded WSGI server that exposes the socket (gunicorn gthread, or Werkzeug's dev server).
"""
import json
import math
import threading

from flask_sock import Sock
from simple_websocket import ConnectionClosed

from . import config
from .http import JsonResponse, error_response

MAX_CONNECTIONS = 20  # per process (spec 7)
MAX_MESSAGE = 1024  # bytes; larger closes with 1009
CLOSE_TOO_BIG = 1009

_lock = threading.Lock()
_open = 0


def _acquire():
    global _open
    with _lock:
        if _open >= MAX_CONNECTIONS:
            return False
        _open += 1
        return True


def _release():
    global _open
    with _lock:
        _open -= 1


def _reject_constant(_name):
    raise ValueError('NaN/Infinity are not JSON')


def _pong(data):
    """Reply text for a valid ping, else None. t must be a finite JSON number (not a bool)."""
    try:
        m = json.loads(data, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        return None
    if not isinstance(m, dict) or m.get('type') != 'ping':
        return None
    t = m.get('t')
    if isinstance(t, bool) or not isinstance(t, (int, float)):
        return None
    if isinstance(t, float) and not math.isfinite(t):  # e.g. 1e999
        return None
    return json.dumps({'type': 'pong', 't': t}, separators=(',', ':'))


class _ReaderThread(threading.Thread):
    """simple-websocket's reader thread. When the library itself ends the connection (it closes with 1009
    from inside that thread) it can set the wake-up event before it clears ws.connected, and receive() then
    sleeps forever, leaking the handler thread and its connection slot. Waking the handler once the reader
    has really finished closes that gap."""

    def __init__(self, *args, target=None, **kwargs):
        super().__init__(*args, target=target, **kwargs)
        self._ws = getattr(target, '__self__', None)

    def run(self):
        try:
            super().run()
        finally:
            if self._ws is not None:
                self._ws.connected = False
                self._ws.event.set()


def _serve(ws):
    while True:
        data = ws.receive()  # blocks; ConnectionClosed ends the loop (handled by flask-sock)
        size = len(data.encode('utf-8')) if isinstance(data, str) else len(data)
        if size > MAX_MESSAGE:  # before any parsing
            ws.close(CLOSE_TOO_BIG, 'Message is too big')
            return
        if isinstance(data, bytes):
            continue
        reply = _pong(data)
        if reply is not None:
            ws.send(reply)


class _Upgraded(JsonResponse):
    """Wraps flask-sock's WebSocketResponse. Flask re-classes any Response that is not an instance of
    app.response_class (here JsonResponse), which would drop WebSocketResponse.__call__: the one that stops
    the server from writing a normal HTTP response onto the socket that now belongs to the WebSocket."""

    def __init__(self, inner):
        super().__init__()
        self._inner = inner

    def __call__(self, environ, start_response):
        return self._inner(environ, start_response)


def init_app(app):
    # ping_interval None: no server pings. max_message_size makes simple-websocket reject an oversize frame
    # (1009) as soon as the chunks received exceed it, without buffering the rest.
    app.config['SOCK_SERVER_OPTIONS'] = {
        'ping_interval': None, 'max_message_size': MAX_MESSAGE, 'thread_class': _ReaderThread,
    }
    sock = Sock(app)
    sock.route('/ws')(_serve)
    upgrade = app.view_functions['_serve']

    def gated(*args, **kwargs):
        # Cap check BEFORE the upgrade (flask-sock handshakes inside the call to
        # upgrade). The slot is returned in a finally once the socket has ended.
        if not _acquire():
            return error_response(503, 'server_busy', headers={'X-Stack': config.APP_STACK})
        try:
            return _Upgraded(upgrade(*args, **kwargs))
        finally:
            _release()

    app.view_functions['_serve'] = gated
