import hashlib
import secrets
from urllib.parse import unquote

import pymysql

from .. import auth, db, json_out, ratelimit, stats
from .. import validate as v
from ..http import HttpError, client_ip, json_response, read_body, route

_USER_COLUMNS = 'SELECT id, handle, display_name, created_at FROM users'


def signup(_params):
    ratelimit.hit(f'ip:{client_ip()}:signup', 5)
    body = read_body()

    handle = v.handle(body.get('handle'))
    name = v.display_name(body.get('display_name'))
    fields = {}
    if handle is None:
        fields['handle'] = v.HANDLE_MSG
    if name is None:
        fields['display_name'] = v.DISPLAY_NAME_MSG
    if fields:
        raise HttpError(422, 'validation_failed', {'fields': fields})

    if db.one('SELECT 1 FROM users WHERE handle = %s LIMIT 1', (handle,)) is not None:
        raise HttpError(409, 'handle_taken')

    token = secrets.token_hex(32)
    try:
        _, user_id = db.run(
            'INSERT INTO users (handle, display_name, token_hash) VALUES (%s, %s, %s)',
            (handle, name, hashlib.sha256(token.encode('utf-8')).hexdigest()),
        )
    except pymysql.err.IntegrityError as e:
        if e.args[0] == 1062:
            raise HttpError(409, 'handle_taken') from None
        raise

    row = db.one(f'{_USER_COLUMNS} WHERE id = %s', (user_id,))
    stats.invalidate()
    return json_response(201, {'user': json_out.user(row), 'token': token})


def show(params):
    handle = v.ascii_lower(unquote(params['handle']))
    row = db.one(f'{_USER_COLUMNS} WHERE handle = %s LIMIT 1', (handle,))
    if row is None:
        raise HttpError(404, 'not_found')
    posts = db.one('SELECT COUNT(*) AS n FROM posts WHERE user_id = %s', (row['id'],))
    images = db.one('SELECT COUNT(*) AS n FROM images WHERE user_id = %s', (row['id'],))
    user = json_out.user(row)
    del user['id']
    user['post_count'] = int(posts['n'])
    user['image_count'] = int(images['n'])
    return json_response(200, user)


def me(_params):
    return json_response(200, json_out.user(auth.require()))


def register():
    route('POST', '/api/users', signup)
    route('GET', '/api/users/{handle}', show)
    route('GET', '/api/me', me)
