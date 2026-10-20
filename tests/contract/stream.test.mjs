import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, db, createUser, resetRateLimits, TEST_TOKEN } from './helpers.mjs';
import { openStream } from './sse.mjs';

const T = { 'X-Test-Token': TEST_TOKEN };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function cleanStreams() {
  const c = await db();
  try { await c.query('DELETE FROM streams'); } finally { await c.end(); }
}
async function emit(nonce) {
  return api('POST', '/api/test/emit', { headers: T, body: nonce === undefined ? undefined : { nonce } });
}
async function newPost(u, body) {
  return api('POST', '/api/posts', { token: u.token, body: { body } });
}

before(async () => { await resetRateLimits(); await cleanStreams(); });

test('R1 first line retry: 3000 arrives within 1 s with correct headers', async () => {
  const s = await openStream('/api/stream');
  try {
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-type'), /^text\/event-stream; charset=utf-8$/i);
    assert.equal(s.headers.get('cache-control'), 'no-store');
    assert.equal(s.headers.get('x-accel-buffering'), 'no');
    assert.ok(s.headers.get('x-stack'));
    assert.equal(s.headers.get('content-encoding'), null);
    const t0 = Date.now();
    while (s.retry === undefined && Date.now() - t0 < 1500) await sleep(20);
    assert.equal(s.retry, 3000);
    assert.ok(s.firstLineAt >= 0 && s.firstLineAt < 1000, `first line at ${s.firstLineAt} ms`);
  } finally { s.close(); }
});

test('emit requires the test token and validates nonce', async () => {
  const no = await api('POST', '/api/test/emit', { body: {} });
  assert.equal(no.status, 403);
  assert.equal(no.json.error, 'forbidden');

  for (const bad of ['', 'x'.repeat(65), 123, null, ['a']]) {
    const r = await emit(bad);
    assert.equal(r.status, 422, JSON.stringify(bad));
    assert.equal(r.json.error, 'validation_failed');
    assert.equal(r.json.fields.nonce, 'ต้องยาว 1–64 ตัวอักษร');
  }
  const ok = await emit('x'.repeat(64));
  assert.equal(ok.status, 200);

  const auto = await emit();
  assert.equal(auto.status, 200);
  assert.match(auto.json.nonce, /^[0-9a-f]{16}$/);
  assert.equal(typeof auto.json.event_id, 'number');
});

test('emit -> stream gets test.ping; post.created has post shape without liked_by_me', async () => {
  const u = await createUser();
  const s = await openStream('/api/stream');
  try {
    const nonce = 'n-' + Math.random().toString(36).slice(2);
    const em = await emit(nonce);
    assert.equal(em.status, 200);
    assert.equal(em.json.nonce, nonce);
    const ev = await s.waitFor(e => e.event === 'test.ping' && JSON.parse(e.data).nonce === nonce, 2000);
    assert.equal(ev.id, String(em.json.event_id));
    assert.deepEqual(JSON.parse(ev.data), { nonce });

    const p = await newPost(u, 'สวัสดี stream');
    assert.equal(p.status, 201);
    const pe = await s.waitFor(e => e.event === 'post.created' && JSON.parse(e.data).post.id === p.json.id, 2500);
    const post = JSON.parse(pe.data).post;
    assert.equal('liked_by_me' in post, false);
    assert.equal(post.body, 'สวัสดี stream');
    assert.equal(post.author.handle, u.handle);
  } finally { s.close(); }
});

test('R5 resume with Last-Event-ID delivers the 3 missed posts in order, no duplicates', async () => {
  const u = await createUser();
  const s1 = await openStream('/api/stream');
  const em = await emit();
  const marker = await s1.waitFor(e => e.event === 'test.ping' && e.id === String(em.json.event_id), 2500);
  s1.close();

  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await newPost(u, 'missed ' + i)).json.id);

  const s2 = await openStream('/api/stream', { headers: { 'Last-Event-ID': marker.id } });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && s2.events.filter(e => e.event === 'post.created').length < 3) await sleep(50);
    const got = s2.events.filter(e => e.event === 'post.created');
    assert.deepEqual(got.map(e => JSON.parse(e.data).post.id), ids);
    const evIds = s2.events.map(e => Number(e.id));
    assert.ok(evIds.every((x, i) => i === 0 || x > evIds[i - 1]));
    assert.ok(evIds.every(x => x > Number(marker.id)));
    assert.equal(s2.events.some(e => e.event === 'resync'), false);
  } finally { s2.close(); }
});

test('?last_id works like Last-Event-ID; malformed values are ignored', async () => {
  const u = await createUser();
  const em = await emit();
  const p = await newPost(u, 'lastid');
  const s = await openStream(`/api/stream?last_id=${em.json.event_id}`);
  try {
    const ev = await s.waitFor(e => e.event === 'post.created' && JSON.parse(e.data).post.id === p.json.id, 3000);
    assert.ok(Number(ev.id) > em.json.event_id);
  } finally { s.close(); }

  // malformed -> treated as absent -> no replay of old events
  const bad = await openStream('/api/stream', { headers: { 'Last-Event-ID': 'abc' } });
  try {
    await sleep(1500);
    assert.equal(bad.events.length, 0);
  } finally { bad.close(); }
});

test('resync: Last-Event-ID older than the lowest remaining event', async () => {
  const em = await emit();
  await emit();
  const c = await db();
  try { await c.query('DELETE FROM events WHERE id <= ?', [em.json.event_id]); } finally { await c.end(); }
  const s = await openStream('/api/stream', { headers: { 'Last-Event-ID': '1' } });
  try {
    await s.waitFor(() => true, 3000);
    const first = s.events[0];
    assert.equal(first.event, 'resync');
    assert.equal(first.data, '{}');
    assert.equal(first.id, undefined);
    await sleep(1300);
    assert.equal(s.events.length, 1, 'nothing replayed after resync');
    const em2 = await emit();
    const ev = await s.waitFor(e => e.event === 'test.ping', 2500);
    assert.equal(ev.id, String(em2.json.event_id));
  } finally { s.close(); }
});

test('R7 11th stream gets 429 rate_limited; reopen succeeds after closing one', async () => {
  await cleanStreams();
  const open = [];
  try {
    for (let i = 0; i < 10; i++) {
      const s = await openStream('/api/stream');
      assert.equal(s.status, 200, `stream ${i + 1}`);
      open.push(s);
    }
    const over = await api('GET', '/api/stream');
    assert.equal(over.status, 429);
    assert.equal(over.json.error, 'rate_limited');
    assert.equal(over.json.retry_after, 5);
    assert.equal(over.headers.get('retry-after'), '5');
    assert.match(over.headers.get('content-type'), /application\/json/);

    open.pop().close();
    let again;
    const t0 = Date.now();
    for (;;) {
      again = await openStream('/api/stream');
      if (again.status === 200 || Date.now() - t0 > 2000) break;
      await sleep(200);
    }
    assert.equal(again.status, 200, `reopen after ${Date.now() - t0} ms`);
    open.push(again);
  } finally {
    open.forEach(s => s.close());
    await sleep(300);
  }
});

test('R8 5 users x 20 concurrent posts: stream records 100 post.created, ids increasing', async () => {
  await resetRateLimits();
  await cleanStreams();
  const users = await Promise.all([1, 2, 3, 4, 5].map(() => createUser()));
  const s = await openStream('/api/stream');
  try {
    await sleep(300);
    const results = await Promise.all(users.map(async (u) => {
      const out = [];
      for (let i = 0; i < 20; i++) out.push(await newPost(u, `r8 ${u.handle} ${i}`));
      return out;
    }));
    const all = results.flat();
    assert.equal(all.length, 100);
    assert.ok(all.every(r => r.status === 201), 'all 201');
    const wanted = new Set(all.map(r => r.json.id));

    const t0 = Date.now();
    const count = () => s.events.filter(e => e.event === 'post.created' && wanted.has(JSON.parse(e.data).post.id)).length;
    while (Date.now() - t0 < 8000 && count() < 100) await sleep(100);
    assert.equal(count(), 100);

    const ids = s.events.map(e => Number(e.id));
    assert.ok(ids.every((x, i) => i === 0 || x > ids[i - 1]), 'strictly increasing event ids');
    const postIds = s.events.filter(e => e.event === 'post.created').map(e => JSON.parse(e.data).post.id);
    assert.equal(new Set(postIds).size, postIds.length, 'no duplicates');
  } finally { s.close(); }
});

test('R3 idle 40 s yields at least 2 pings', { skip: !process.env.SLOW }, async () => {
  await cleanStreams();
  const s = await openStream('/api/stream');
  try {
    await sleep(40_000);
    assert.ok(s.comments.filter(c => c.text === 'ping').length >= 2, JSON.stringify(s.comments));
  } finally { s.close(); }
});

test('R4 server closes the stream at 60 +/- 5 s', { skip: !process.env.SLOW }, async () => {
  await cleanStreams();
  const s = await openStream('/api/stream');
  try {
    await Promise.race([s.done, sleep(70_000)]);
    assert.equal(s.ended, true, 'server should have closed');
    assert.ok(Math.abs(s.endedAt - 60_000) <= 5000, `closed at ${Math.round(s.endedAt)} ms`);
  } finally { s.close(); }
});
