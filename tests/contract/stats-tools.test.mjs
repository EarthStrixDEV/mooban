import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { api, db, createUser, resetRateLimits, BASE, STACK, TEST_TOKEN } from './helpers.mjs';

const G = { 'X-Test-Token': TEST_TOKEN };
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

before(async () => { await resetRateLimits(); });

test('P2 /api/stats app cache: MISS, HIT, MISS after a write; media_bytes = DB sum', async () => {
  const noTok = await api('DELETE', '/api/cache');
  assert.equal(noTok.status, 403);
  assert.deepEqual(noTok.json, { error: 'forbidden' });
  const del = await api('DELETE', '/api/cache', { headers: G });
  assert.equal(del.status, 204);

  const a = await api('GET', '/api/stats');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('x-app-cache'), 'MISS');
  const b = await api('GET', '/api/stats');
  assert.equal(b.headers.get('x-app-cache'), 'HIT');
  assert.deepEqual(b.json, a.json);

  for (const k of ['users', 'posts', 'comments', 'likes', 'images', 'media_bytes', 'last_event_id']) {
    assert.ok(Number.isInteger(a.json[k]), k);
  }
  assert.match(a.json.generated_at, ISO);

  const u = await createUser();
  const p = await api('POST', '/api/posts', { token: u.token, body: { body: 'stats' } });
  assert.equal(p.status, 201);
  const c = await api('GET', '/api/stats');
  assert.equal(c.headers.get('x-app-cache'), 'MISS');
  assert.ok(c.json.posts >= a.json.posts + 1);
  assert.ok(c.json.last_event_id > a.json.last_event_id);

  const conn = await db();
  try {
    const [[row]] = await conn.query(
      'SELECT COALESCE(SUM(bytes_display + bytes_thumb), 0) AS s, (SELECT COALESCE(MAX(id),0) FROM events) AS e FROM images');
    assert.equal(c.json.media_bytes, Number(row.s));
    assert.equal(c.json.last_event_id, Number(row.e));
  } finally { await conn.end(); }
});

test('/api/cache-stats counts hits and misses; DELETE /api/cache resets', async () => {
  await api('DELETE', '/api/cache', { headers: G });
  const z = await api('GET', '/api/cache-stats');
  assert.equal(z.status, 200);
  assert.deepEqual(z.json, { hits: 0, misses: 0 });
  await api('GET', '/api/stats');
  await api('GET', '/api/stats');
  await api('GET', '/api/stats');
  const r = await api('GET', '/api/cache-stats');
  assert.deepEqual(r.json, { hits: 2, misses: 1 });
});

test('TestGuard on /api/slow; ms range', async () => {
  const no = await api('GET', '/api/slow?ms=10');
  assert.equal(no.status, 403);
  assert.deepEqual(no.json, { error: 'forbidden' });
  const bad = await api('GET', '/api/slow?ms=10', { headers: { 'X-Test-Token': 'nope' } });
  assert.equal(bad.status, 403);
  const ok = await api('GET', '/api/slow?ms=10', { headers: G });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { slept_ms: 10 });
  assert.equal(ok.headers.get('x-stack'), STACK);
  for (const q of ['10001', '-1', 'abc', '1.5', '']) {
    const r = await api('GET', `/api/slow?ms=${q}`, { headers: G });
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, 'bad_params');
  }
  assert.equal((await api('GET', '/api/slow', { headers: G })).status, 400);
});

test('/download/{mb}: guard, sizes, headers', async () => {
  assert.equal((await api('GET', '/download/1')).status, 403);
  const res = await fetch(`${BASE}/download/1`, { headers: { ...G, 'Accept-Encoding': 'gzip, br' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '1048576');
  assert.equal(res.headers.get('content-encoding'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /^application\/octet-stream/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 1048576);
  const bad = await api('GET', '/download/2', { headers: G });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'bad_params');
  assert.equal((await api('GET', '/download/abc', { headers: G })).status, 400);
});

test('/upload: guard, received_bytes within 1%', async () => {
  const mk = () => {
    const f = new FormData();
    f.append('file', new Blob([randomBytes(1048576)]), 'x.bin');
    return f;
  };
  assert.equal((await api('POST', '/upload', { form: mk() })).status, 403);
  const r = await api('POST', '/upload', { form: mk(), headers: G });
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.json.received_bytes - 1048576) <= 1048576 * 0.01, String(r.json.received_bytes));
  assert.ok(Number.isInteger(r.json.duration_ms));
});

test('/upload over the server limit is 413 payload_too_large', async () => {
  const f = new FormData();
  f.append('file', new Blob([Buffer.alloc(14 * 1048576)]), 'big.bin');
  const r = await api('POST', '/upload', { form: f, headers: G });
  assert.equal(r.status, 413);
  assert.deepEqual(r.json, { error: 'payload_too_large' });
});

test('/cache/static: ETag, 304, fixed body; /cache/none; /cache/time; /cache/gzip', async () => {
  const a = await api('GET', '/cache/static');
  assert.equal(a.status, 200);
  assert.ok(a.text.length >= 1500 && a.text.length <= 2600, String(a.text.length));
  assert.equal(a.headers.get('cache-control'), 'public, max-age=60');
  const etag = a.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]+(-gzip)?"$/); // mod_deflate may append -gzip (Tabby: not a failure)
  const lm = a.headers.get('last-modified');
  assert.ok(lm);
  const b = await api('GET', '/cache/static');
  assert.equal(b.text, a.text);
  assert.equal(b.headers.get('last-modified'), lm);
  assert.equal(b.headers.get('etag'), etag);
  const c = await api('GET', '/cache/static', { headers: { 'If-None-Match': etag } });
  assert.equal(c.status, 304);
  assert.equal(c.text, '');

  const n = await api('GET', '/cache/none');
  assert.equal(n.status, 200);
  assert.equal(n.headers.get('cache-control'), 'no-store');
  assert.equal(n.text, a.text);

  const t = await api('GET', '/cache/time');
  assert.equal(t.headers.get('cache-control'), 'public, max-age=10');
  assert.match(t.json.server_time, ISO);
  assert.ok(Number.isInteger(t.json.unix_ms));

  const g = await fetch(`${BASE}/cache/gzip`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(g.status, 200);
  assert.match(g.headers.get('content-type'), /^text\/plain; charset=utf-8$/i);
  assert.equal((await g.arrayBuffer()).byteLength, 204800);
});

test('/api/echo: PUT hides Authorization/Cookie, previews body; >1MB is 413', async () => {
  const r = await api('PUT', '/api/echo?x=1', {
    body: 'hello', headers: { Authorization: 'Bearer secret', Cookie: 'a=b', 'Content-Type': 'text/plain' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.method, 'PUT');
  assert.equal(r.json.path, '/api/echo');
  assert.equal(r.json.body_size, 5);
  assert.equal(r.json.body_preview, 'hello');
  assert.ok(r.json.client_ip);
  assert.ok(['http', 'https'].includes(r.json.protocol));
  const names = Object.keys(r.json.headers).map(k => k.toLowerCase());
  assert.ok(!names.includes('authorization'));
  assert.ok(!names.includes('cookie'));
  assert.ok(names.includes('host'));
  assert.ok(!JSON.stringify(r.json).includes('secret'));
  for (const m of ['GET', 'POST', 'DELETE']) {
    const x = await api(m, '/api/echo');
    assert.equal(x.status, 200, m);
    assert.equal(x.json.method, m);
  }
  const big = await api('POST', '/api/echo', { body: 'a'.repeat(1048577), headers: { 'Content-Type': 'text/plain' } });
  assert.equal(big.status, 413);
  assert.equal(big.json.error, 'payload_too_large');
});

test('/api/limited: 10 per minute, headers on every response', async () => {
  await resetRateLimits();
  for (let i = 1; i <= 10; i++) {
    const r = await api('GET', '/api/limited');
    assert.equal(r.status, 200, `#${i}`);
    assert.equal(r.headers.get('x-ratelimit-limit'), '10');
    assert.equal(r.headers.get('x-ratelimit-remaining'), String(10 - i));
  }
  const r = await api('GET', '/api/limited');
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('x-ratelimit-limit'), '10');
  assert.equal(r.headers.get('x-ratelimit-remaining'), '0');
  assert.equal(r.json.error, 'rate_limited');
  assert.equal(r.headers.get('retry-after'), String(r.json.retry_after));
  await resetRateLimits();
});
