from .. import auth, db, events, ratelimit, stats
from ..http import HttpError, json_response, parse_id, route


def _change(params, like):
    user = auth.require()
    uid = int(user['id'])

    post_id = parse_id(params['id'])
    exists = post_id is not None and db.one('SELECT 1 FROM posts WHERE id = %s', (post_id,)) is not None
    if not exists:
        raise HttpError(404, 'not_found')
    ratelimit.hit(f'user:{uid}:write', 30)

    with db.tx():
        if like:
            affected, _ = db.run('INSERT IGNORE INTO likes (user_id, post_id) VALUES (%s, %s)', (uid, post_id))
        else:
            affected, _ = db.run('DELETE FROM likes WHERE user_id = %s AND post_id = %s', (uid, post_id))
        changed = affected > 0
        if changed:
            delta = '+ 1' if like else '- 1'
            db.run(f'UPDATE posts SET like_count = like_count {delta} WHERE id = %s', (post_id,))
        row = db.one('SELECT like_count FROM posts WHERE id = %s', (post_id,))
        if row is None:
            raise HttpError(404, 'not_found')  # post deleted concurrently
        count = int(row['like_count'])
        if changed:
            events.emit('like.changed', {'post_id': post_id, 'like_count': count})
    if changed:
        stats.invalidate()
    return json_response(200, {'post_id': post_id, 'like_count': count, 'liked_by_me': like})


def register():
    route('PUT', '/api/posts/{id:[0-9]+}/like', lambda p: _change(p, True))
    route('DELETE', '/api/posts/{id:[0-9]+}/like', lambda p: _change(p, False))
