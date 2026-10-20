import { pool } from './db.js';
import { HttpError } from './http.js';

/** Seconds left in the current minute window (at least 1). */
export function retryAfter() {
  return Math.max(1, 60 - (Math.floor(Date.now() / 1000) % 60));
}

/** Count one hit in the current fixed one-minute UTC window and return the window's total. */
export async function count(bucket) {
  const now = Math.floor(Date.now() / 1000);
  const window = `${new Date((now - (now % 60)) * 1000).toISOString().slice(0, 16).replace('T', ' ')}:00`;

  const [ins] = await pool.execute(
    'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1',
    [bucket, window],
  );
  // affectedRows is 1 for a fresh row, 2 when the duplicate branch updated it.
  if (ins.affectedRows === 1) {
    const cutoff = new Date((now - 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute('DELETE FROM rate_limits WHERE window_start < ?', [cutoff]);
  }
  const [rows] = await pool.execute(
    'SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?',
    [bucket, window],
  );
  return Number(rows[0].hits);
}

/** Over the limit -> 429 rate_limited with Retry-After. */
export async function hit(bucket, limit) {
  if (await count(bucket) > limit) {
    const retry = retryAfter();
    throw new HttpError(429, 'rate_limited', { retry_after: retry }, { 'Retry-After': String(retry) });
  }
}
