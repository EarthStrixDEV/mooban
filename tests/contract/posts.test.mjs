import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, db, createUser, resetRateLimits, waitForMinuteStart } from './helpers.mjs';

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const EMPTY_MSG = 'ต้องมีข้อความหรือรูป';
const LONG_MSG = 'ยาวเกิน 280 ตัวอักษร';

before(async () => { await resetRateLimits(); });

async function post(u, body) {
  return api('POST', '/api/posts', { token: u.token, body: { body } });
}

test('F3 owner create / edit / delete, others get 403, missing gets 404', async () => {
  const a = await createUser();
  const b = await createUser();

  const noAuth = await api('POST', '/api/posts', { body: { body: 'x' } });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error, 'unauthorized');

  const c = await post(a, '  สวัสดีหมู่บ้าน  ');
  assert.equal(c.status, 201);
  const p = c.json;
  assert.deepEqual(Object.keys(p).sort(), [
    'author', 'body', 'comment_count', 'created_at', 'id', 'image',
    'like_count', 'liked_by_me', 'updated_at']);
  assert.equal(p.body, 'สวัสดีหมู่บ้าน');
  assert.deepEqual(p.author, { handle: a.handle, display_name: a.handle });
  assert.equal(p.image, null);
  assert.equal(p.like_count, 0);
  assert.equal(p.comment_count, 0);
  assert.equal(p.liked_by_me, false);
  assert.match(p.created_at, ISO);
  assert.match(p.updated_at, ISO);

  const get = await api('GET', `/api/posts/${p.id}`);
  assert.equal(get.status, 200);
  assert.equal(get.json.id, p.id);
  assert.equal(get.json.liked_by_me, false);

  const forbiddenPut = await api('PUT', `/api/posts/${p.id}`, { token: b.token, body: { body: 'hack' } });
  assert.equal(forbiddenPut.status, 403);
  assert.equal(forbiddenPut.json.error, 'not_owner');
  const forbiddenDel = await api('DELETE', `/api/posts/${p.id}`, { token: b.token });
  assert.equal(forbiddenDel.status, 403);
  assert.equal(forbiddenDel.json.error, 'not_owner');

  const put = await api('PUT', `/api/posts/${p.id}`, { token: a.token, body: { body: 'แก้แล้ว' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.id, p.id);
  assert.equal(put.json.body, 'แก้แล้ว');

  const del = await api('DELETE', `/api/posts/${p.id}`, { token: a.token });
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  const gone = await api('GET', `/api/posts/${p.id}`);
  assert.equal(gone.status, 404);

  for (const [m, body] of [['PUT', { body: 'x' }], ['DELETE', undefined]]) {
    const nf = await api(m, `/api/posts/${p.id}`, { token: a.token, body });
    assert.equal(nf.status, 404, m);
    assert.equal(nf.json.error, 'not_found');
  }
  const unauth = await api('DELETE', `/api/posts/${p.id}`);
  assert.equal(unauth.status, 401);
});

test('PUT/POST check order: 403 before 400, then 400, then 422', async () => {
  const a = await createUser();
  const b = await createUser();
  const p = (await post(a, 'hello')).json;
  const badJson = await api('PUT', `/api/posts/${p.id}`, { token: b.token, body: '{bad' });
  assert.equal(badJson.status, 403);
  const bad = await api('PUT', `/api/posts/${p.id}`, { token: a.token, body: '{bad' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_json');
  const empty = await api('PUT', `/api/posts/${p.id}`, { token: a.token, body: { body: ' ' } });
  assert.equal(empty.status, 422);
  assert.equal(empty.json.fields.body, EMPTY_MSG);
  const badPost = await api('POST', '/api/posts', { token: a.token, body: '{bad' });
  assert.equal(badPost.status, 400);
});

test('F4 body validation counts code points after trim', async () => {
  const u = await createUser();
  const blank = await post(u, '   ');
  assert.equal(blank.status, 422);
  assert.equal(blank.json.error, 'validation_failed');
  assert.equal(blank.json.fields.body, EMPTY_MSG);

  // Ruling R5: ideographic space + NBSP are trimmed (JS trim set)
  const ideo = await post(u, '\u3000\u00A0');
  assert.equal(ideo.status, 422);
  assert.equal(ideo.json.fields.body, EMPTY_MSG);

  const ok = await post(u, 'ก่'.repeat(140));
  assert.equal(ok.status, 201);
  const over = await post(u, 'ก่'.repeat(140) + 'ก');
  assert.equal(over.status, 422);
  assert.equal(over.json.fields.body, LONG_MSG);

  const emoji = await post(u, '😀'.repeat(280));
  assert.equal(emoji.status, 201);
  assert.equal(emoji.json.body, '😀'.repeat(280));
  const emojiOver = await post(u, '😀'.repeat(281));
  assert.equal(emojiOver.status, 422);
  assert.equal(emojiOver.json.fields.body, LONG_MSG);
});

test('image_id of a missing image is rejected; null is ignored', async () => {
  const u = await createUser();
  const r = await api('POST', '/api/posts', { token: u.token, body: { body: 'x', image_id: 999999 } });
  assert.equal(r.status, 422);
  assert.equal(r.json.fields.image_id, 'ไม่พบรูปนี้');
  const nul = await api('POST', '/api/posts', { token: u.token, body: { body: 'x', image_id: null } });
  assert.equal(nul.status, 201);
});

test('list: newest first, limit, next_before, filters, bad params', async () => {
  const u = await createUser();
  const ids = [];
  for (const t of ['one', 'two', 'three']) ids.push((await post(u, t)).json.id);

  const r = await api('GET', `/api/posts?limit=2&user=${u.handle}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map(x => x.id), [ids[2], ids[1]]);
  assert.equal(r.json.next_before, r.json.data[1].id);
  assert.equal(r.json.data[0].liked_by_me, false);

  const r2 = await api('GET', `/api/posts?limit=2&user=${u.handle}&before=${r.json.next_before}`);
  assert.deepEqual(r2.json.data.map(x => x.id), [ids[0]]);
  assert.equal(r2.json.next_before, null);

  const exact = await api('GET', `/api/posts?limit=3&user=${u.handle}`);
  assert.equal(exact.json.data.length, 3);
  assert.equal(exact.json.next_before, null);

  for (const q of ['limit=0', 'limit=51', 'before=abc', 'limit=-1', 'before=0', 'limit=1.5',
    `limit=${'9'.repeat(25)}`, `before=${'1'.repeat(25)}`]) {
    const bad = await api('GET', `/api/posts?${q}`);
    assert.equal(bad.status, 400, q);
    assert.equal(bad.json.error, 'bad_params');
  }
  const none = await api('GET', '/api/posts?user=nobody_here_zz');
  assert.equal(none.status, 200);
  assert.deepEqual(none.json, { data: [], next_before: null });

  const dflt = await api('GET', '/api/posts');
  assert.equal(dflt.status, 200);
  assert.ok(dflt.json.data.length <= 20);
});

test('path id longer than int64 is 404, not a server error', async () => {
  const r = await api('GET', `/api/posts/${'1'.repeat(25)}`);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found');
  const big = await api('GET', `/api/posts/${'1'.repeat(4000)}`);
  assert.equal(big.status, 404);
});

test('liked_by_me reflects likes only when a token is sent', async () => {
  const a = await createUser();
  const b = await createUser();
  const p = (await post(a, 'like me')).json;
  const c = await db();
  try {
    await c.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [b.id, p.id]);
    await c.execute('UPDATE posts SET like_count = 1 WHERE id = ?', [p.id]);
  } finally { await c.end(); }
  const anon = await api('GET', `/api/posts/${p.id}`);
  assert.equal(anon.json.liked_by_me, false);
  assert.equal(anon.json.like_count, 1);
  const mine = await api('GET', `/api/posts/${p.id}`, { token: b.token });
  assert.equal(mine.json.liked_by_me, true);
  const other = await api('GET', `/api/posts/${p.id}`, { token: a.token });
  assert.equal(other.json.liked_by_me, false);
  const list = await api('GET', `/api/posts?user=${a.handle}`, { token: b.token });
  assert.equal(list.json.data[0].liked_by_me, true);
});

test('events: created / updated / deleted payloads', async () => {
  const u = await createUser();
  const c = await db();
  try {
    const [[{ m }]] = await c.query('SELECT COALESCE(MAX(id), 0) AS m FROM events');
    const p = (await post(u, 'evt ไทย/ok')).json;
    await api('PUT', `/api/posts/${p.id}`, { token: u.token, body: { body: 'evt2' } });
    await api('DELETE', `/api/posts/${p.id}`, { token: u.token });
    const [rows] = await c.execute(
      'SELECT type, payload FROM events WHERE id > ? ORDER BY id', [m]);
    const mine = rows.filter(r => r.payload.includes(`"id":${p.id}`));
    assert.deepEqual(mine.map(r => r.type), ['post.created', 'post.updated', 'post.deleted']);
    const created = JSON.parse(mine[0].payload);
    assert.equal(created.post.id, p.id);
    assert.equal('liked_by_me' in created.post, false);
    assert.equal(created.post.author.handle, u.handle);
    assert.ok(mine[0].payload.includes('evt ไทย/ok'), 'unicode and slash are not escaped');
    assert.equal(mine[0].payload.includes('\n'), false);
    assert.equal(JSON.parse(mine[1].payload).post.body, 'evt2');
    assert.equal(mine[2].payload, `{"id":${p.id}}`);
  } finally { await c.end(); }
});

test('P3 write rate limit: 31st post in a minute gets 429', async () => {
  const u = await createUser();
  await waitForMinuteStart();
  await resetRateLimits();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await post(u, `rl ${i}`);
    if (i < 30) assert.equal(last.status, 201, `request ${i + 1}`);
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
  assert.ok(last.json.retry_after >= 1 && last.json.retry_after <= 60);
  assert.equal(last.headers.get('retry-after'), String(last.json.retry_after));
});
