import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, db, createUser, resetRateLimits, waitForMinuteStart } from './helpers.mjs';

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const BODY_MSG = 'ต้องยาว 1–280 ตัวอักษร';

before(async () => { await resetRateLimits(); });

async function mkPost(u, body = 'p') {
  return (await api('POST', '/api/posts', { token: u.token, body: { body } })).json;
}

async function maxEventId() {
  const c = await db();
  try {
    const [[{ m }]] = await c.query('SELECT COALESCE(MAX(id), 0) AS m FROM events');
    return Number(m);
  } finally { await c.end(); }
}

/** Events after `since` whose parsed payload belongs to one of postIds. */
async function eventsFor(since, postIds, types) {
  const c = await db();
  try {
    const [rows] = await c.execute('SELECT type, payload FROM events WHERE id > ? ORDER BY id', [since]);
    return rows
      .map(r => ({ type: r.type, data: JSON.parse(r.payload), raw: r.payload }))
      .filter(e => types.includes(e.type) && postIds.includes(e.data.post_id));
  } finally { await c.end(); }
}

test('F5 like is idempotent, one event per real change', async () => {
  const a = await createUser();
  const b = await createUser();
  const p = await mkPost(a, 'like me');
  const since = await maxEventId();

  const noAuth = await api('PUT', `/api/posts/${p.id}/like`);
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error, 'unauthorized');
  const noAuthDel = await api('DELETE', `/api/posts/${p.id}/like`);
  assert.equal(noAuthDel.status, 401);
  for (const m of ['PUT', 'DELETE']) {
    const nf = await api(m, '/api/posts/99999999/like', { token: b.token });
    assert.equal(nf.status, 404, m);
    assert.equal(nf.json.error, 'not_found');
  }

  const l1 = await api('PUT', `/api/posts/${p.id}/like`, { token: b.token });
  assert.equal(l1.status, 200);
  assert.deepEqual(l1.json, { post_id: p.id, like_count: 1, liked_by_me: true });
  const l2 = await api('PUT', `/api/posts/${p.id}/like`, { token: b.token });
  assert.equal(l2.status, 200);
  assert.deepEqual(l2.json, { post_id: p.id, like_count: 1, liked_by_me: true });

  const get = await api('GET', `/api/posts/${p.id}`, { token: b.token });
  assert.equal(get.json.liked_by_me, true);
  assert.equal(get.json.like_count, 1);
  const getOther = await api('GET', `/api/posts/${p.id}`, { token: a.token });
  assert.equal(getOther.json.liked_by_me, false);

  // owner can like own post too (no 403)
  const own = await api('PUT', `/api/posts/${p.id}/like`, { token: a.token });
  assert.equal(own.status, 200);
  assert.equal(own.json.like_count, 2);
  assert.equal((await api('DELETE', `/api/posts/${p.id}/like`, { token: a.token })).json.like_count, 1);

  const d1 = await api('DELETE', `/api/posts/${p.id}/like`, { token: b.token });
  assert.equal(d1.status, 200);
  assert.deepEqual(d1.json, { post_id: p.id, like_count: 0, liked_by_me: false });
  const d2 = await api('DELETE', `/api/posts/${p.id}/like`, { token: b.token });
  assert.equal(d2.status, 200);
  assert.deepEqual(d2.json, { post_id: p.id, like_count: 0, liked_by_me: false });

  const evs = await eventsFor(since, [p.id], ['like.changed']);
  // b like, a like, a unlike, b unlike = 4 real changes; repeats emit nothing
  assert.deepEqual(evs.map(e => e.data), [
    { post_id: p.id, like_count: 1 },
    { post_id: p.id, like_count: 2 },
    { post_id: p.id, like_count: 1 },
    { post_id: p.id, like_count: 0 },
  ]);
});

test('F6 comments: create, counter, owner-only delete, validation', async () => {
  const a = await createUser();
  const b = await createUser();
  const p = await mkPost(a, 'comment target');
  const since = await maxEventId();

  const noAuth = await api('POST', `/api/posts/${p.id}/comments`, { body: { body: 'x' } });
  assert.equal(noAuth.status, 401);
  const nf = await api('POST', '/api/posts/99999999/comments', { token: b.token, body: { body: 'x' } });
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error, 'not_found');

  const c1 = await api('POST', `/api/posts/${p.id}/comments`, { token: b.token, body: { body: '  ดีจ้า  ' } });
  assert.equal(c1.status, 201);
  assert.deepEqual(Object.keys(c1.json).sort(), ['author', 'body', 'created_at', 'id']);
  assert.equal(c1.json.body, 'ดีจ้า');
  assert.deepEqual(c1.json.author, { handle: b.handle, display_name: b.handle });
  assert.match(c1.json.created_at, ISO);
  const c2 = await api('POST', `/api/posts/${p.id}/comments`, { token: a.token, body: { body: 'two' } });
  assert.equal(c2.status, 201);

  assert.equal((await api('GET', `/api/posts/${p.id}`)).json.comment_count, 2);

  const nodel = await api('DELETE', `/api/comments/${c1.json.id}`);
  assert.equal(nodel.status, 401);
  const other = await api('DELETE', `/api/comments/${c1.json.id}`, { token: a.token });
  assert.equal(other.status, 403);
  assert.equal(other.json.error, 'not_owner');
  const missing = await api('DELETE', '/api/comments/99999999', { token: a.token });
  assert.equal(missing.status, 404);
  for (const bad of ['007', '0', '1.5']) {
    const r = await api('DELETE', `/api/comments/${bad}`, { token: a.token });
    assert.equal(r.status, 404, bad);
  }

  const del = await api('DELETE', `/api/comments/${c1.json.id}`, { token: b.token });
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  assert.equal((await api('GET', `/api/posts/${p.id}`)).json.comment_count, 1);
  const again = await api('DELETE', `/api/comments/${c1.json.id}`, { token: b.token });
  assert.equal(again.status, 404);

  // validation + check order (400 before 422)
  const badJson = await api('POST', `/api/posts/${p.id}/comments`, { token: b.token, body: '{bad' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.error, 'invalid_json');
  for (const body of ['', '   ', 'x'.repeat(281), '😀'.repeat(281)]) {
    const r = await api('POST', `/api/posts/${p.id}/comments`, { token: b.token, body: { body } });
    assert.equal(r.status, 422);
    assert.equal(r.json.error, 'validation_failed');
    assert.equal(r.json.fields.body, BODY_MSG);
  }
  const missingField = await api('POST', `/api/posts/${p.id}/comments`, { token: b.token, body: {} });
  assert.equal(missingField.status, 422);
  const max = await api('POST', `/api/posts/${p.id}/comments`, { token: b.token, body: { body: '😀'.repeat(280) } });
  assert.equal(max.status, 201);
  assert.equal((await api('GET', `/api/posts/${p.id}`)).json.comment_count, 2);

  const evs = await eventsFor(since, [p.id], ['comment.created', 'comment.deleted']);
  assert.deepEqual(evs.map(e => e.type), [
    'comment.created', 'comment.created', 'comment.deleted', 'comment.created']);
  assert.equal(evs[0].data.comment.id, c1.json.id);
  assert.deepEqual(evs[0].data.comment, c1.json);
  assert.equal(evs[0].data.comment_count, 1);
  assert.equal(evs[1].data.comment_count, 2);
  assert.deepEqual(evs[2].data, { post_id: p.id, comment_id: c1.json.id, comment_count: 1 });
  assert.equal(evs[3].data.comment_count, 2);
});

test('comments list: oldest first, limit, after, bad params', async () => {
  const a = await createUser();
  const p = await mkPost(a, 'list target');
  const ids = [];
  for (const t of ['one', 'two', 'three']) {
    ids.push((await api('POST', `/api/posts/${p.id}/comments`, { token: a.token, body: { body: t } })).json.id);
  }

  const r = await api('GET', `/api/posts/${p.id}/comments?limit=2`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map(x => x.id), [ids[0], ids[1]]);
  assert.equal(r.json.next_after, r.json.data[1].id);
  assert.deepEqual(Object.keys(r.json.data[0]).sort(), ['author', 'body', 'created_at', 'id']);

  const r2 = await api('GET', `/api/posts/${p.id}/comments?limit=2&after=${r.json.next_after}`);
  assert.deepEqual(r2.json.data.map(x => x.id), [ids[2]]);
  assert.equal(r2.json.next_after, null);

  const exact = await api('GET', `/api/posts/${p.id}/comments?limit=3`);
  assert.equal(exact.json.data.length, 3);
  assert.equal(exact.json.next_after, null);

  const dflt = await api('GET', `/api/posts/${p.id}/comments`);
  assert.equal(dflt.status, 200);
  assert.equal(dflt.json.data.length, 3);

  for (const q of ['limit=0', 'limit=51', 'after=abc', 'limit=-1', 'after=0', 'limit=1.5',
    `after=${'1'.repeat(25)}`]) {
    const bad = await api('GET', `/api/posts/${p.id}/comments?${q}`);
    assert.equal(bad.status, 400, q);
    assert.equal(bad.json.error, 'bad_params');
  }
  const nf = await api('GET', '/api/posts/99999999/comments');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error, 'not_found');

  const empty = await mkPost(a, 'no comments');
  const e = await api('GET', `/api/posts/${empty.id}/comments`);
  assert.deepEqual(e.json, { data: [], next_after: null });
});

test('likes and comments share the write rate limit bucket (429 after 30)', async () => {
  const a = await createUser();
  const b = await createUser();
  const p = await mkPost(a, 'rl target');
  await waitForMinuteStart();
  await resetRateLimits();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await api(i % 2 === 0 ? 'PUT' : 'DELETE', `/api/posts/${p.id}/like`, { token: b.token });
    if (i < 30) assert.equal(last.status, 200, `request ${i + 1}`);
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
  assert.ok(last.json.retry_after >= 1 && last.json.retry_after <= 60);
  // 404 is checked before 429
  const nf = await api('PUT', '/api/posts/99999999/like', { token: b.token });
  assert.equal(nf.status, 404);
});
