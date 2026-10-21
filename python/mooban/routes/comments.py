from .. import auth, db, events, json_out, ratelimit, stats
from .. import validate as v
from ..http import HttpError, int_param, json_response, parse_id, parse_query, read_body, route

BODY_MSG = 'ต้องยาว 1–280 ตัวอักษร'

SELECT = """SELECT c.id, c.body, c.created_at, u.handle, u.display_name
    FROM comments c JOIN users u ON u.id = c.user_id"""


def _shape(row):
    return {
        'id': int(row['id']),
        'author': {'handle': str(row['handle']), 'display_name': str(row['display_name'])},
        'body': str(row['body']),
        'created_at': json_out.iso(row['created_at']),
    }


def _post_exists(post_id):
    return post_id is not None and db.one('SELECT 1 FROM posts WHERE id = %s', (post_id,)) is not None


def index(params):
    post_id = parse_id(params['id'])
    q = parse_query()
    limit = int_param(q, 'limit')
    if limit is None:
        limit = 20
    after = int_param(q, 'after')
    if limit > 50:
        raise HttpError(400, 'bad_params')
    if not _post_exists(post_id):
        raise HttpError(404, 'not_found')

    sql = f'{SELECT} WHERE c.post_id = %s'
    args = [post_id]
    if after is not None:
        sql += ' AND c.id > %s'
        args.append(after)
    sql += f' ORDER BY c.id ASC LIMIT {limit + 1}'
    rows = db.all_rows(sql, args)
    more = len(rows) > limit
    if more:
        rows.pop()
    data = [_shape(r) for r in rows]
    return json_response(200, {'data': data, 'next_after': data[-1]['id'] if more else None})


def create(params):
    user = auth.require()
    uid = int(user['id'])
    post_id = parse_id(params['id'])
    if not _post_exists(post_id):
        raise HttpError(404, 'not_found')
    ratelimit.hit(f'user:{uid}:write', 30)
    data = read_body()

    raw = data.get('body')
    body = v.trim(raw) if isinstance(raw, str) else ''
    if not 1 <= v.length(body) <= 280:
        raise HttpError(422, 'validation_failed', {'fields': {'body': BODY_MSG}})

    with db.tx():
        _, comment_id = db.run('INSERT INTO comments (post_id, user_id, body) VALUES (%s, %s, %s)',
                               (post_id, uid, body))
        db.run('UPDATE posts SET comment_count = comment_count + 1 WHERE id = %s', (post_id,))
        created = _shape(db.one(f'{SELECT} WHERE c.id = %s', (comment_id,)))
        counts = db.one('SELECT comment_count FROM posts WHERE id = %s', (post_id,))
        events.emit('comment.created', {
            'post_id': post_id,
            'comment': created,
            'comment_count': int(counts['comment_count']),
        })
    stats.invalidate()
    return json_response(201, created)


def destroy(params):
    user = auth.require()
    uid = int(user['id'])
    comment_id = parse_id(params['id'])
    row = None
    if comment_id is not None:
        row = db.one('SELECT id, post_id, user_id FROM comments WHERE id = %s', (comment_id,))
    if row is None:
        raise HttpError(404, 'not_found')
    if int(row['user_id']) != uid:
        raise HttpError(403, 'not_owner')
    ratelimit.hit(f'user:{uid}:write', 30)

    post_id = int(row['post_id'])
    with db.tx():
        affected, _ = db.run('DELETE FROM comments WHERE id = %s', (comment_id,))
        if affected == 0:
            raise HttpError(404, 'not_found')  # deleted concurrently
        db.run('UPDATE posts SET comment_count = comment_count - 1 WHERE id = %s', (post_id,))
        counts = db.one('SELECT comment_count FROM posts WHERE id = %s', (post_id,))
        events.emit('comment.deleted', {
            'post_id': post_id,
            'comment_id': comment_id,
            'comment_count': int(counts['comment_count']),
        })
    stats.invalidate()
    return json_response(204, None)


def register():
    route('GET', '/api/posts/{id:[0-9]+}/comments', index)
    route('POST', '/api/posts/{id:[0-9]+}/comments', create)
    route('DELETE', '/api/comments/{id:[0-9]+}', destroy)
