import { randomBytes, createHash } from 'node:crypto';
import * as auth from '../auth.js';
import { pool } from '../db.js';
import { HttpError, clientIp, readBody, route, sendJson } from '../http.js';
import * as json from '../json.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';
import * as v from '../validate.js';

const USER_COLUMNS = 'SELECT id, handle, display_name, created_at FROM users';

async function signup(req, res) {
  await ratelimit.hit(`ip:${clientIp(req)}:signup`, 5);
  const body = await readBody(req);

  const handle = v.handle(body.handle);
  const name = v.displayName(body.display_name);
  const fields = {};
  if (handle === null) fields.handle = v.HANDLE_MSG;
  if (name === null) fields.display_name = v.DISPLAY_NAME_MSG;
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation_failed', { fields });

  const [taken] = await pool.execute('SELECT 1 FROM users WHERE handle = ? LIMIT 1', [handle]);
  if (taken.length > 0) throw new HttpError(409, 'handle_taken');

  const token = randomBytes(32).toString('hex');
  let insertId;
  try {
    const [r] = await pool.execute(
      'INSERT INTO users (handle, display_name, token_hash) VALUES (?, ?, ?)',
      [handle, name, createHash('sha256').update(token).digest('hex')],
    );
    insertId = r.insertId;
  } catch (e) {
    if (e.errno === 1062) throw new HttpError(409, 'handle_taken');
    throw e;
  }

  const [rows] = await pool.execute(`${USER_COLUMNS} WHERE id = ?`, [insertId]);
  await stats.invalidate();
  sendJson(res, 201, { user: json.user(rows[0]), token });
}

async function show(req, res) {
  let raw = req.routeParams.handle;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // malformed escapes can never match a handle
  }
  const handle = v.asciiLower(raw);
  const [rows] = await pool.execute(`${USER_COLUMNS} WHERE handle = ? LIMIT 1`, [handle]);
  if (rows.length === 0) throw new HttpError(404, 'not_found');
  const row = rows[0];
  const [[posts]] = await pool.execute('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', [row.id]);
  const [[images]] = await pool.execute('SELECT COUNT(*) AS n FROM images WHERE user_id = ?', [row.id]);
  const { id, ...user } = json.user(row); // eslint-disable-line no-unused-vars
  sendJson(res, 200, { ...user, post_count: Number(posts.n), image_count: Number(images.n) });
}

async function me(req, res) {
  sendJson(res, 200, json.user(await auth.require(req)));
}

export function register() {
  route('POST', '/api/users', signup);
  route('GET', '/api/users/{handle}', show);
  route('GET', '/api/me', me);
}
