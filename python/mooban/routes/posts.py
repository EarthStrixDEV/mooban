import pymysql

from .. import auth, db, events, json_out, media, ratelimit, stats
from .. import validate as v
from ..http import (INT64_MAX, HttpError, int_param, json_response, parse_id, parse_query, read_body,
                    route)

IMAGE_MISSING_MSG = 'ไม่พบรูปนี้'
IMAGE_USED_MSG = 'รูปนี้ถูกใช้กับโพสต์อื่นแล้ว'

# First placeholder is the viewer id (0 = anonymous) for the liked_by_me join.
SELECT = """SELECT p.id, p.user_id, p.body, p.image_id, p.like_count, p.comment_count,
        p.created_at, p.updated_at, u.handle, u.display_name,
        i.id AS img_id, i.media_key AS img_key, i.format AS img_format,
        i.width AS img_width, i.height AS img_height, i.alt AS img_alt,
        l.post_id AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN images i ON i.id = p.image_id
    LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = %s"""


def load(post_id, viewer_id):
    """Post object (liked_by_me false when viewer_id is None) or None when absent."""
    row = db.one(f'{SELECT} WHERE p.id = %s', (viewer_id or 0, post_id))
    return None if row is None else json_out.post(row)


def index(_params):
    q = parse_query()
    limit = int_param(q, 'limit')
    if limit is None:
        limit = 20
    before = int_param(q, 'before')
    if limit > 50:
        raise HttpError(400, 'bad_params')
    handle = None
    if 'user' in q:
        if not isinstance(q['user'], str):
            raise HttpError(400, 'bad_params')
        handle = v.ascii_lower(q['user'])
    viewer = auth.optional()

    sql = f'{SELECT} WHERE 1 = 1'
    args = [0 if viewer is None else viewer['id']]
    if handle is not None:
        sql += ' AND u.handle = %s'
        args.append(handle)
    if before is not None:
        sql += ' AND p.id < %s'
        args.append(before)
    sql += f' ORDER BY p.id DESC LIMIT {limit + 1}'

    rows = db.all_rows(sql, args)
    more = len(rows) > limit
    if more:
        rows.pop()
    data = [json_out.post(r) for r in rows]
    return json_response(200, {'data': data, 'next_before': data[-1]['id'] if more else None})


def show(params):
    post_id = parse_id(params['id'])
    viewer = auth.optional()
    post = None if post_id is None else load(post_id, None if viewer is None else viewer['id'])
    if post is None:
        raise HttpError(404, 'not_found')
    return json_response(200, post)


def _check_image(raw, uid):
    """Field error for an image_id the author may not attach, or None when it is theirs and free."""
    # JSON integers only: True/False, floats and strings are not ids (PHP is_int).
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1 or raw > INT64_MAX:
        return IMAGE_MISSING_MSG
    owner = db.one('SELECT user_id FROM images WHERE id = %s', (raw,))
    if owner is None or int(owner['user_id']) != uid:
        return IMAGE_MISSING_MSG
    if db.one('SELECT 1 FROM posts WHERE image_id = %s', (raw,)) is not None:
        return IMAGE_USED_MSG
    return None


def create(_params):
    user = auth.require()
    uid = int(user['id'])
    ratelimit.hit(f'user:{uid}:write', 30)
    data = read_body()

    fields = {}
    image_id = None
    if data.get('image_id') is not None:
        msg = _check_image(data['image_id'], uid)
        if msg is None:
            image_id = data['image_id']
        else:
            fields['image_id'] = msg
    body, err = v.post_body(data.get('body'), image_id is not None)
    if err is not None:
        fields['body'] = err
    if fields:
        raise HttpError(422, 'validation_failed', {'fields': fields})

    with db.tx():
        try:
            _, new_id = db.run('INSERT INTO posts (user_id, body, image_id) VALUES (%s, %s, %s)',
                               (uid, body, image_id))
        except pymysql.err.IntegrityError as e:
            # Lost a race: another request took the image (uq_image) or it was deleted (FK).
            if e.args[0] in (1062, 1452):
                msg = IMAGE_USED_MSG if e.args[0] == 1062 else IMAGE_MISSING_MSG
                raise HttpError(422, 'validation_failed', {'fields': {'image_id': msg}}) from None
            raise
        created = load(new_id, uid)
        events.emit('post.created', {'post': json_out.post_for_event(created)})
    stats.invalidate()
    return json_response(201, created)


def _owned(raw_id, uid):
    """404 -> 403 gate shared by PUT and DELETE; returns the posts row (id, user_id, image_id)."""
    post_id = parse_id(raw_id)
    row = None
    if post_id is not None:
        row = db.one('SELECT id, user_id, image_id FROM posts WHERE id = %s', (post_id,))
    if row is None:
        raise HttpError(404, 'not_found')
    if int(row['user_id']) != uid:
        raise HttpError(403, 'not_owner')
    return row


def update(params):
    user = auth.require()
    uid = int(user['id'])
    row = _owned(params['id'], uid)
    ratelimit.hit(f'user:{uid}:write', 30)
    data = read_body()

    body, err = v.post_body(data.get('body'), row['image_id'] is not None)
    if err is not None:
        raise HttpError(422, 'validation_failed', {'fields': {'body': err}})

    post_id = int(row['id'])
    with db.tx():
        db.run('UPDATE posts SET body = %s, updated_at = NOW() WHERE id = %s', (body, post_id))
        updated = load(post_id, uid)
        if updated is None:
            raise HttpError(404, 'not_found')
        events.emit('post.updated', {'post': json_out.post_for_event(updated)})
    stats.invalidate()
    return json_response(200, updated)


def destroy(params):
    user = auth.require()
    uid = int(user['id'])
    row = _owned(params['id'], uid)
    ratelimit.hit(f'user:{uid}:write', 30)

    post_id = int(row['id'])
    image_id = None if row['image_id'] is None else int(row['image_id'])
    key = None
    with db.tx():
        if image_id is not None:
            img = db.one('SELECT media_key FROM images WHERE id = %s', (image_id,))
            key = None if img is None else str(img['media_key'])
        db.run('DELETE FROM posts WHERE id = %s', (post_id,))
        if image_id is not None:
            db.run('DELETE FROM images WHERE id = %s', (image_id,))
        events.emit('post.deleted', {'id': post_id})
    if key is not None:
        media.remove_dir(key)
    stats.invalidate()
    return json_response(204, None)


def register():
    route('GET', '/api/posts', index)
    route('POST', '/api/posts', create)
    route('GET', '/api/posts/{id:[0-9]+}', show)
    route('PUT', '/api/posts/{id:[0-9]+}', update)
    route('DELETE', '/api/posts/{id:[0-9]+}', destroy)
