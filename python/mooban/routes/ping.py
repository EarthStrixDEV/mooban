import time

from .. import config, db
from ..http import json_response, parse_query, route


def ping(_params):
    body = {'pong': True, 'stack': config.APP_STACK, 'unix_ms': int(time.time() * 1000)}
    if parse_query().get('db') == '1':
        t = time.perf_counter()
        db.one('SELECT 1')
        body['db_ms'] = round((time.perf_counter() - t) * 1000, 1)
    return json_response(200, body)


def register():
    route('GET', '/api/ping', ping)
