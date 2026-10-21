"""Test endpoints: POST /api/test/emit, POST|DELETE /api/test/seed, GET /api/test/orphans
(mirrors php/src/Routes/TestEmit.php and SeedApi.php). All need X-Test-Token."""
import re
import secrets

from .. import db, events, seed, testguard
from .. import validate as v
from ..http import HttpError, json_response, parse_object, parse_query, read_raw, route

NONCE_MSG = 'ต้องยาว 1–64 ตัวอักษร'
_INT_RE = re.compile(r'(0|[1-9][0-9]{0,8})\Z')


def emit(_params):
    testguard.require()

    nonce = None
    raw = read_raw()
    if raw:
        body = parse_object(raw)
        if 'nonce' in body:
            nonce = body['nonce']  # opaque (R16): not trimmed
            if not isinstance(nonce, str) or not 1 <= v.length(nonce) <= 64:
                raise HttpError(422, 'validation_failed', {'fields': {'nonce': NONCE_MSG}})
    if nonce is None:
        nonce = secrets.token_hex(8)

    # The event is the only write; db.tx() purges old events after the commit when id % 100 == 0.
    with db.tx():
        event_id = events.emit('test.ping', {'nonce': nonce})
    return json_response(200, {'event_id': event_id, 'nonce': nonce})


def _int_param(q, name, default, lo, hi):
    """Integer query param in [lo, hi]; absent -> default; anything else -> 400 bad_params."""
    if name not in q:
        return default
    val = q[name]
    if not isinstance(val, str) or _INT_RE.match(val) is None or not lo <= int(val) <= hi:
        raise HttpError(400, 'bad_params')
    return int(val)


def seed_run(_params):
    testguard.require()
    q = parse_query()
    users = _int_param(q, 'users', 20, 1, 100)
    posts = _int_param(q, 'posts', 500, 0, 5000)
    images = _int_param(q, 'images', 30, 0, 200)
    reset = _int_param(q, 'reset', 0, 0, 1)
    if images > posts:  # R17: checked on the effective values
        raise HttpError(400, 'bad_params')
    if reset == 1:
        seed.wipe()
    return json_response(200, seed.run(users, posts, images))


def seed_wipe(_params):
    testguard.require()
    return json_response(200, seed.wipe())


def orphans(_params):
    testguard.require()
    return json_response(200, seed.orphans())


def register():
    route('POST', '/api/test/emit', emit)
    route('POST', '/api/test/seed', seed_run)
    route('DELETE', '/api/test/seed', seed_wipe)
    route('GET', '/api/test/orphans', orphans)
