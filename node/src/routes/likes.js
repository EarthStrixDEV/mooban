import * as auth from '../auth.js';
import { pool, withTx } from '../db.js';
import * as events from '../events.js';
import { HttpError, parseId, route, sendJson } from '../http.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';

async function change(req, res, like) {
  const user = await auth.require(req);
  const uid = Number(user.id);

  const id = parseId(req.routeParams.id);
  let exists = false;
  if (id !== null) {
    const [rows] = await pool.execute('SELECT 1 FROM posts WHERE id = ?', [id]);
    exists = rows.length > 0;
  }
  if (!exists) throw new HttpError(404, 'not_found');
  await ratelimit.hit(`user:${uid}:write`, 30);

  const { changed, count } = await withTx(async (conn) => {
    const [r] = like
      ? await conn.execute('INSERT IGNORE INTO likes (user_id, post_id) VALUES (?, ?)', [uid, id])
      : await conn.execute('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [uid, id]);
    const didChange = r.affectedRows > 0;
    if (didChange) {
      const delta = like ? '+ 1' : '- 1';
      await conn.execute(`UPDATE posts SET like_count = like_count ${delta} WHERE id = ?`, [id]);
    }
    const [rows] = await conn.execute('SELECT like_count FROM posts WHERE id = ?', [id]);
    if (rows.length === 0) throw new HttpError(404, 'not_found'); // post deleted concurrently
    const likeCount = Number(rows[0].like_count);
    if (didChange) await events.emit(conn, 'like.changed', { post_id: id, like_count: likeCount });
    return { changed: didChange, count: likeCount };
  });
  if (changed) await stats.invalidate();
  sendJson(res, 200, { post_id: id, like_count: count, liked_by_me: like });
}

export function register() {
  route('PUT', String.raw`/api/posts/{id:\d+}/like`, (req, res) => change(req, res, true));
  route('DELETE', String.raw`/api/posts/{id:\d+}/like`, (req, res) => change(req, res, false));
}
