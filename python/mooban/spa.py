"""Static files from PUBLIC_DIR, then index.html for unknown GET/HEAD paths outside the reserved prefixes."""
import os
import re

from flask import request, send_file
from werkzeug.exceptions import NotFound
from werkzeug.security import safe_join

from . import config
from .http import raw_path

# Prefixes owned by the API/media/realtime layers: never answered with index.html.
_RESERVED_RE = re.compile(r'/(api|media|ws|download|upload|cache)(/|\Z)')
_HTML_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:",
    'X-Content-Type-Options': 'nosniff',
}
_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']


def _send(full):
    resp = send_file(full, conditional=True, etag=True, max_age=0)
    if os.path.basename(full) == 'index.html':
        resp.headers.update(_HTML_HEADERS)
    return resp


def serve(path):
    # A reserved prefix nothing above answered is a plain JSON 404, never HTML.
    if _RESERVED_RE.match(raw_path()):
        raise NotFound()
    if request.method not in ('GET', 'HEAD'):
        raise NotFound()
    # Dotfiles are never served (they fall through to index.html, like express.static 'ignore').
    if path and not any(part.startswith('.') for part in path.split('/')):
        full = safe_join(config.PUBLIC_DIR, path)
        if full is not None and os.path.isfile(full):
            return _send(full)
    return _send(os.path.join(config.PUBLIC_DIR, 'index.html'))


def init_app(app):
    app.add_url_rule('/', 'spa_root', serve, defaults={'path': ''}, methods=_METHODS,
                     provide_automatic_options=False)
    app.add_url_rule('/<path:path>', 'spa', serve, methods=_METHODS, provide_automatic_options=False)
