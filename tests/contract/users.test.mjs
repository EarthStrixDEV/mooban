import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { api, db, createUser, resetRateLimits, uniq } from './helpers.mjs';

const HANDLE_MSG = 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _';
const NAME_MSG = 'ต้องยาว 1–50 ตัวอักษร';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

before(async () => { await resetRateLimits(); });

test('F1 signup normalizes, hashes token, rejects duplicates', async () => {
  await resetRateLimits();
  const n = uniq('x').slice(0, 8);
  const r = await api('POST', '/api/users', {
    body: { handle: `  Earth_${n}`, display_name: ' เอิร์ธ ' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.handle, `earth_${n}`);
  assert.equal(r.json.user.display_name, 'เอิร์ธ');
  assert.match(r.json.token, /^[0-9a-f]{64}$/);
  assert.match(r.json.user.created_at, ISO);
  assert.deepEqual(Object.keys(r.json.user).sort(), ['created_at', 'display_name', 'handle', 'id']);

  const c = await db();
  try {
    const [rows] = await c.execute('SELECT token_hash FROM users WHERE handle = ?', [`earth_${n}`]);
    assert.equal(rows[0].token_hash, createHash('sha256').update(r.json.token).digest('hex'));
  } finally { await c.end(); }

  const dup = await api('POST', '/api/users', {
    body: { handle: `EARTH_${n.toUpperCase()}`, display_name: 'x' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'handle_taken');
});

test('F1 signup validation', async () => {
  for (const handle of ['ab', 'a-b-c', 'x'.repeat(21)]) {
    await resetRateLimits(); // signup is limited to 5/min and every request counts
    const r = await api('POST', '/api/users', { body: { handle, display_name: 'ok' } });
    assert.equal(r.status, 422, handle);
    assert.equal(r.json.error, 'validation_failed');
    assert.equal(r.json.fields.handle, HANDLE_MSG);
    assert.equal(r.json.fields.display_name, undefined);
  }
  for (const display_name of ['', 'ก'.repeat(51)]) {
    await resetRateLimits();
    const r = await api('POST', '/api/users', { body: { handle: uniq('v'), display_name } });
    assert.equal(r.status, 422);
    assert.equal(r.json.fields.display_name, NAME_MSG);
  }
  await resetRateLimits();
  const both = await api('POST', '/api/users', { body: { handle: 'a', display_name: '' } });
  assert.equal(both.status, 422);
  assert.equal(both.json.fields.handle, HANDLE_MSG);
  assert.equal(both.json.fields.display_name, NAME_MSG);

  await resetRateLimits();
  const bad = await api('POST', '/api/users', { body: '{bad' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_json');
});

test('F1 display_name is trimmed with the JS trim set (R5)', async () => {
  await resetRateLimits();
  const r = await api('POST', '/api/users', {
    body: { handle: uniq('tr'), display_name: ' เอิร์ธ　' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.display_name, 'เอิร์ธ');
  await resetRateLimits();
});

test('GET /api/users/{handle}', async () => {
  const u = await createUser({ handle: uniq('Pro').toLowerCase() });
  const r = await api('GET', `/api/users/${u.handle.toUpperCase()}`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(),
    ['created_at', 'display_name', 'handle', 'image_count', 'post_count']);
  assert.equal(r.json.handle, u.handle);
  assert.equal(r.json.post_count, 0);
  assert.equal(r.json.image_count, 0);
  assert.match(r.json.created_at, ISO);

  const nf = await api('GET', `/api/users/${uniq('none')}`);
  assert.equal(nf.status, 404);
});

test('F2 GET /api/me', async () => {
  const u = await createUser();
  const none = await api('GET', '/api/me');
  assert.equal(none.status, 401);
  assert.equal(none.json.error, 'unauthorized');
  const wrong = await api('GET', '/api/me', { token: 'f'.repeat(64) });
  assert.equal(wrong.status, 401);
  const ok = await api('GET', '/api/me', { token: u.token });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.json).sort(), ['created_at', 'display_name', 'handle', 'id']);
  assert.equal(ok.json.id, u.id);
  assert.equal(ok.json.handle, u.handle);
  assert.match(ok.json.created_at, ISO);
});

test('P3 signup rate limit 5/min per ip', async () => {
  await resetRateLimits();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await api('POST', '/api/users', {
      body: { handle: uniq('r'), display_name: 'rl' },
    });
    if (i < 5) assert.equal(last.status, 201, `request ${i + 1}`);
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
  assert.ok(last.json.retry_after >= 1 && last.json.retry_after <= 60);
  assert.equal(last.headers.get('retry-after'), String(last.json.retry_after));
  await resetRateLimits();
});
