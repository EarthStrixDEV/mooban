import time

from flask import g, request
from werkzeug.formparser import FormDataParser

from .. import auth, config, db, images, json_out, media, ratelimit, stats
from .. import validate as v
from ..http import HttpError, int_param, json_response, parse_id, parse_query, read_body, route

USER_QUOTA = 100
STACK_QUOTA = 500
ALT_MAX = 200
ALT_LONG_MSG = 'ยาวเกิน 200 ตัวอักษร'
FILE_MISSING_MSG = 'ต้องแนบไฟล์'

SELECT = """SELECT i.id, i.user_id, i.media_key, i.width, i.height, i.format,
        i.bytes_display, i.bytes_thumb, i.alt, i.created_at, u.handle, u.display_name
    FROM images i
    JOIN users u ON u.id = i.user_id"""


def find(image_id):
    return None if image_id is None else db.one(f'{SELECT} WHERE i.id = %s', (image_id,))


class _StrictFormParser(FormDataParser):
    """Werkzeug swallows multipart errors (silent=True) and just drops a half-received file.
    Here a truncated / malformed body raises ValueError, and we note that a file part had begun."""

    def __init__(self, *args, **kwargs):
        kwargs['silent'] = False
        factory = kwargs['stream_factory']

        def noting_factory(*a, **kw):  # called once per uploaded file part, before its bytes arrive
            g.mb_file_started = True
            return factory(*a, **kw)

        kwargs['stream_factory'] = noting_factory
        super().__init__(*args, **kwargs)


def _upload_file():
    """The `file` part of the multipart body (None when absent). A body cut off after the file part
    began is an invalid image (PHP UPLOAD_ERR_PARTIAL); cut off before it, the file is simply missing."""
    request.max_form_memory_size = config.MAX_CONTENT_LENGTH
    request.form_data_parser_class = _StrictFormParser
    g.mb_file_started = False
    try:
        upload = request.files.get('file')
    except ValueError:
        raise HttpError(422, 'image_invalid') if g.mb_file_started else _file_missing() from None
    return upload if upload is not None and upload.filename else None


def _file_missing():
    return HttpError(422, 'validation_failed', {'fields': {'file': FILE_MISSING_MSG}})


def _file_size(fp):
    fp.seek(0, 2)
    n = fp.tell()
    fp.seek(0)
    return n


def create(_params):
    user = auth.require()
    uid = int(user['id'])
    ratelimit.hit(f'user:{uid}:upload', 10)

    mine = db.one('SELECT COUNT(*) AS n FROM images WHERE user_id = %s', (uid,))
    total = db.one("SELECT COUNT(*) AS n FROM images i JOIN users u ON u.id = i.user_id "
                   "WHERE LEFT(u.handle, 5) <> 'seed_'")
    if int(mine['n']) >= USER_QUOTA or int(total['n']) >= STACK_QUOTA:
        raise HttpError(422, 'quota_reached')

    media_key = None
    try:
        # First touch of the body: Werkzeug parses the multipart form here (a body beyond
        # MAX_CONTENT_LENGTH raises 413, mapped to JSON by the error handler). A long `alt` is a
        # field error, not a size error, so the in-memory field cap is lifted to the body cap.
        upload = _upload_file()
        if upload is None:
            raise _file_missing()

        # From here on the file is fully received (Werkzeug spooled it): processing_ms starts counting.
        t0 = time.perf_counter()
        size = _file_size(upload.stream)
        if size > config.MAX_UPLOAD_BYTES:
            raise HttpError(413, 'payload_too_large')
        if images.detect(upload.stream.read(12)) is None:
            raise HttpError(415, 'unsupported_media_type')

        alt = None
        alt_in = request.form.get('alt')
        if isinstance(alt_in, str):
            alt = v.trim(alt_in)
            if v.length(alt) > ALT_MAX:
                raise HttpError(422, 'validation_failed', {'fields': {'alt': ALT_LONG_MSG}})
            if alt == '':
                alt = None

        r = images.process(upload.stream, size)
        media_key = r['media_key']
        ms = int(round((time.perf_counter() - t0) * 1000))

        _, new_id = db.run(
            'INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, alt) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (uid, media_key, r['width'], r['height'], r['format'], r['bytes_display'], r['bytes_thumb'], alt))
        row = find(new_id)
        if row is None:
            raise RuntimeError('inserted image row not found')
        media_key = None  # committed: the files now belong to the row
        stats.invalidate()
        return json_response(201, {**json_out.image(row), 'processing_ms': ms})
    except BaseException:
        if media_key is not None:
            media.remove_dir(media_key)
        raise
    finally:
        request.close()  # closes Werkzeug's spooled upload temp file on every path


def index(_params):
    q = parse_query()
    limit = int_param(q, 'limit')
    if limit is None:
        limit = 40
    before = int_param(q, 'before')
    if limit > 100:
        raise HttpError(400, 'bad_params')
    handle = None
    if 'user' in q:
        if not isinstance(q['user'], str):
            raise HttpError(400, 'bad_params')
        handle = v.ascii_lower(q['user'])

    sql = f'{SELECT} WHERE 1 = 1'
    args = []
    if handle is not None:
        sql += ' AND u.handle = %s'
        args.append(handle)
    if before is not None:
        sql += ' AND i.id < %s'
        args.append(before)
    sql += f' ORDER BY i.id DESC LIMIT {limit + 1}'

    rows = db.all_rows(sql, args)
    more = len(rows) > limit
    if more:
        rows.pop()
    data = [json_out.image(r) for r in rows]
    return json_response(200, {'data': data, 'next_before': data[-1]['id'] if more else None})


def _owned(raw_id, uid):
    """404 -> 403 gate shared by PATCH and DELETE."""
    row = find(parse_id(raw_id))
    if row is None:
        raise HttpError(404, 'not_found')
    if int(row['user_id']) != uid:
        raise HttpError(403, 'not_owner')
    return row


def patch(params):
    user = auth.require()
    uid = int(user['id'])
    row = _owned(params['id'], uid)
    ratelimit.hit(f'user:{uid}:write', 30)
    data = read_body()

    alt = data.get('alt')
    if alt is not None and not isinstance(alt, str):
        raise HttpError(422, 'validation_failed', {'fields': {'alt': 'ต้องเป็นข้อความ'}})
    if alt is not None:
        alt = v.trim(alt)
        if v.length(alt) > ALT_MAX:
            raise HttpError(422, 'validation_failed', {'fields': {'alt': ALT_LONG_MSG}})
        if alt == '':
            alt = None

    image_id = int(row['id'])
    db.run('UPDATE images SET alt = %s WHERE id = %s', (alt, image_id))
    fresh = find(image_id)
    if fresh is None:
        raise HttpError(404, 'not_found')
    stats.invalidate()
    return json_response(200, json_out.image(fresh))


def destroy(params):
    user = auth.require()
    uid = int(user['id'])
    row = _owned(params['id'], uid)
    ratelimit.hit(f'user:{uid}:write', 30)

    # posts.image_id goes NULL through the FK (ON DELETE SET NULL)
    db.run('DELETE FROM images WHERE id = %s', (int(row['id']),))
    media.remove_dir(str(row['media_key']))
    stats.invalidate()
    return json_response(204, None)


def register():
    route('POST', '/api/images', create)
    route('GET', '/api/images', index)
    route('PATCH', '/api/images/{id:[0-9]+}', patch)
    route('DELETE', '/api/images/{id:[0-9]+}', destroy)
