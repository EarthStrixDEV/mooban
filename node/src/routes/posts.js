import * as auth from '../auth.js';
import { pool, withTx } from '../db.js';
import * as events from '../events.js';
import { HttpError, intParam, parseId, parseQuery, readBody, route, sendJson } from '../http.js';
import * as json from '../json.js';
import * as media from '../media.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';
import * as v from '../validate.js';

const IMAGE_MISSING_MSG = 'ไม่พบรูปนี้';
const IMAGE_USED_MSG = 'รูปนี้ถูกใช้กับโพสต์อื่นแล้ว';

// First placeholder is the viewer id (0 = anonymous) for the liked_by_me join.
const SELECT = `SELECT p.id, p.user_id, p.body, p.image_id, p.like_count, p.comment_count,
        p.created_at, p.updated_at, u.handle, u.display_name,
        i.id AS img_id, i.media_key AS img_key, i.format AS img_format,
        i.width AS img_width, i.height AS img_height, i.alt AS img_alt,
        l.post_id AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN images i ON i.id = p.image_id
    LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = ?`;

/** Post object (liked_by_me false when viewerId is null) or null when absent. `db` = pool or tx connection. */
async function load(db, id, viewerId) {
  const [rows] = await db.execute(`${SELECT} WHERE p.id = ?`, [viewerId ?? 0, id]);
  return rows.length === 0 ? null : json.post(rows[0]);
}

async function index(req, res) {
  const q = parseQuery(req);
  const limit = intParam(q, 'limit') ?? 20;
  const before = intParam(q, 'before');
  if (Number(limit) > 50) throw new HttpError(400, 'bad_params');
  let handle = null;
  if ('user' in q) {
    if (typeof q.user !== 'string') throw new HttpError(400, 'bad_params');
    handle = v.asciiLower(q.user);
  }
  const viewer = await auth.optional(req);

  let sql = `${SELECT} WHERE 1 = 1`;
  const args = [viewer === null ? 0 : viewer.id];
  if (handle !== null) {
    sql += ' AND u.handle = ?';
    args.push(handle);
  }
  if (before !== null) {
    sql += ' AND p.id < ?';
    args.push(before);
  }
  sql += ` ORDER BY p.id DESC LIMIT ${Number(limit) + 1}`;

  const [rows] = await pool.execute(sql, args);
  const more = rows.length > limit;
  if (more) rows.pop();
  const data = rows.map(json.post);
  sendJson(res, 200, { data, next_before: more ? data[data.length - 1].id : null });
}

async function show(req, res) {
  const id = parseId(req.routeParams.id);
  const viewer = await auth.optional(req);
  const post = id === null ? null : await load(pool, id, viewer === null ? null : viewer.id);
  if (post === null) throw new HttpError(404, 'not_found');
  sendJson(res, 200, post);
}

/** Field error for an image_id the author may not attach, or null when it is theirs and free. */
async function checkImage(raw, uid) {
  if (!Number.isSafeInteger(raw) || raw < 1) return IMAGE_MISSING_MSG;
  const [owner] = await pool.execute('SELECT user_id FROM images WHERE id = ?', [raw]);
  if (owner.length === 0 || Number(owner[0].user_id) !== uid) return IMAGE_MISSING_MSG;
  const [used] = await pool.execute('SELECT 1 FROM posts WHERE image_id = ?', [raw]);
  return used.length === 0 ? null : IMAGE_USED_MSG;
}

async function create(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  await ratelimit.hit(`user:${uid}:write`, 30);
  const input = await readBody(req);

  const fields = {};
  let imageId = null;
  if (Object.hasOwn(input, 'image_id') && input.image_id !== null) {
    const msg = await checkImage(input.image_id, uid);
    if (msg === null) imageId = input.image_id;
    else fields.image_id = msg;
  }
  const [body, err] = v.postBody(input.body, imageId !== null);
  if (err !== null) fields.body = err;
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation_failed', { fields });

  const post = await withTx(async (conn) => {
    let insertId;
    try {
      const [r] = await conn.execute(
        'INSERT INTO posts (user_id, body, image_id) VALUES (?, ?, ?)',
        [uid, body, imageId],
      );
      insertId = r.insertId;
    } catch (e) {
      // Lost a race: another request took the image (uq_image) or it was deleted (FK).
      if (e.errno === 1062 || e.errno === 1452) {
        throw new HttpError(422, 'validation_failed', {
          fields: { image_id: e.errno === 1062 ? IMAGE_USED_MSG : IMAGE_MISSING_MSG },
        });
      }
      throw e;
    }
    const created = await load(conn, insertId, uid);
    await events.emit(conn, 'post.created', { post: json.postForEvent(created) });
    return created;
  });
  await stats.invalidate();
  sendJson(res, 201, post);
}

/** 404 -> 403 gate shared by PUT and DELETE; returns the posts row (id, user_id, image_id). */
async function owned(rawId, uid) {
  const id = parseId(rawId);
  let row;
  if (id !== null) {
    const [rows] = await pool.execute('SELECT id, user_id, image_id FROM posts WHERE id = ?', [id]);
    row = rows[0];
  }
  if (row === undefined) throw new HttpError(404, 'not_found');
  if (Number(row.user_id) !== uid) throw new HttpError(403, 'not_owner');
  return row;
}

async function update(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const row = await owned(req.routeParams.id, uid);
  await ratelimit.hit(`user:${uid}:write`, 30);
  const input = await readBody(req);

  const [body, err] = v.postBody(input.body, row.image_id !== null);
  if (err !== null) throw new HttpError(422, 'validation_failed', { fields: { body: err } });

  const id = Number(row.id);
  const post = await withTx(async (conn) => {
    await conn.execute('UPDATE posts SET body = ?, updated_at = NOW() WHERE id = ?', [body, id]);
    const updated = await load(conn, id, uid);
    if (updated === null) throw new HttpError(404, 'not_found');
    await events.emit(conn, 'post.updated', { post: json.postForEvent(updated) });
    return updated;
  });
  await stats.invalidate();
  sendJson(res, 200, post);
}

async function destroy(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const row = await owned(req.routeParams.id, uid);
  await ratelimit.hit(`user:${uid}:write`, 30);

  const id = Number(row.id);
  const imageId = row.image_id === null ? null : Number(row.image_id);
  const key = await withTx(async (conn) => {
    let mediaKey = null;
    if (imageId !== null) {
      const [rows] = await conn.execute('SELECT media_key FROM images WHERE id = ?', [imageId]);
      mediaKey = rows.length === 0 ? null : String(rows[0].media_key);
    }
    await conn.execute('DELETE FROM posts WHERE id = ?', [id]);
    if (imageId !== null) await conn.execute('DELETE FROM images WHERE id = ?', [imageId]);
    await events.emit(conn, 'post.deleted', { id });
    return mediaKey;
  });
  if (key !== null) await media.removeDir(key);
  await stats.invalidate();
  sendJson(res, 204, null);
}

export function register() {
  route('GET', '/api/posts', index);
  route('POST', '/api/posts', create);
  route('GET', String.raw`/api/posts/{id:\d+}`, show);
  route('PUT', String.raw`/api/posts/{id:\d+}`, update);
  route('DELETE', String.raw`/api/posts/{id:\d+}`, destroy);
}
