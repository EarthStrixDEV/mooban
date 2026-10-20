import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { HttpError, bearer } from './http.js';

/** users row {id, handle, display_name, created_at} for the Bearer token, or null. */
export async function optional(req) {
  const token = bearer(req);
  if (token === null) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.execute(
    'SELECT id, handle, display_name, created_at FROM users WHERE token_hash = ? LIMIT 1',
    [hash],
  );
  return rows[0] ?? null;
}

export async function require(req) {
  const user = await optional(req);
  if (user === null) throw new HttpError(401, 'unauthorized');
  return user;
}
