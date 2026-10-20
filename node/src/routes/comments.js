import * as auth from '../auth.js';
import { pool, withTx } from '../db.js';
import * as events from '../events.js';
import { HttpError, intParam, parseId, parseQuery, readBody, route, sendJson } from '../http.js';
import * as json from '../json.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';
import * as v from '../validate.js';

const BODY_MSG = 'ต้องยาว 1–280 ตัวอักษร';

const SELECT = `SELECT c.id, c.body, c.created_at, u.handle, u.display_name
    FROM comments c JOIN users u ON u.id = c.user_id`;

function shape(row) {
  return {
    id: Number(row.id),
    author: { handle: String(row.handle), display_name: String(row.display_name) },
    body: String(row.body),
    created_at: json.iso(row.created_at),
  };
}

async function postExists(id) {
  if (id === null) return false;
  const [rows] = await pool.execute('SELECT 1 FROM posts WHERE id = ?', [id]);
  return rows.length > 0;
}

async function index(req, res) {
  const postId = parseId(req.routeParams.id);
  const q = parseQuery(req);
  const limit = intParam(q, 'limit') ?? 20;
  const after = intParam(q, 'after');
  if (Number(limit) > 50) throw new HttpError(400, 'bad_params');
  if (!await postExists(postId)) throw new HttpError(404, 'not_found');

  let sql = `${SELECT} WHERE c.post_id = ?`;
  const args = [postId];
  if (after !== null) {
    sql += ' AND c.id > ?';
    args.push(after);
  }
  sql += ` ORDER BY c.id ASC LIMIT ${Number(limit) + 1}`;
  const [rows] = await pool.execute(sql, args);
  const more = rows.length > limit;
  if (more) rows.pop();
  const data = rows.map(shape);
  sendJson(res, 200, { data, next_after: more ? data[data.length - 1].id : null });
}

async function create(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const postId = parseId(req.routeParams.id);
  if (!await postExists(postId)) throw new HttpError(404, 'not_found');
  await ratelimit.hit(`user:${uid}:write`, 30);
  const input = await readBody(req);

  const body = typeof input.body === 'string' ? v.trim(input.body) : '';
  const l = v.len(body);
  if (l < 1 || l > 280) throw new HttpError(422, 'validation_failed', { fields: { body: BODY_MSG } });

  const comment = await withTx(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)',
      [postId, uid, body],
    );
    await conn.execute('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [postId]);
    const [rows] = await conn.execute(`${SELECT} WHERE c.id = ?`, [r.insertId]);
    const created = shape(rows[0]);
    const [counts] = await conn.execute('SELECT comment_count FROM posts WHERE id = ?', [postId]);
    await events.emit(conn, 'comment.created', {
      post_id: postId,
      comment: created,
      comment_count: Number(counts[0].comment_count),
    });
    return created;
  });
  await stats.invalidate();
  sendJson(res, 201, comment);
}

async function destroy(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const id = parseId(req.routeParams.id);
  let row;
  if (id !== null) {
    const [rows] = await pool.execute('SELECT id, post_id, user_id FROM comments WHERE id = ?', [id]);
    row = rows[0];
  }
  if (row === undefined) throw new HttpError(404, 'not_found');
  if (Number(row.user_id) !== uid) throw new HttpError(403, 'not_owner');
  await ratelimit.hit(`user:${uid}:write`, 30);

  const postId = Number(row.post_id);
  await withTx(async (conn) => {
    const [r] = await conn.execute('DELETE FROM comments WHERE id = ?', [id]);
    if (r.affectedRows === 0) throw new HttpError(404, 'not_found'); // deleted concurrently
    await conn.execute('UPDATE posts SET comment_count = comment_count - 1 WHERE id = ?', [postId]);
    const [counts] = await conn.execute('SELECT comment_count FROM posts WHERE id = ?', [postId]);
    await events.emit(conn, 'comment.deleted', {
      post_id: postId,
      comment_id: Number(id),
      comment_count: Number(counts[0].comment_count),
    });
  });
  await stats.invalidate();
  sendJson(res, 204, null);
}

export function register() {
  route('GET', String.raw`/api/posts/{id:\d+}/comments`, index);
  route('POST', String.raw`/api/posts/{id:\d+}/comments`, create);
  route('DELETE', String.raw`/api/comments/{id:\d+}`, destroy);
}
