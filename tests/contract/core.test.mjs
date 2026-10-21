import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, STACK, createUser } from './helpers.mjs';

test('GET /api/ping returns pong with stack and headers', async () => {
  const r = await api('GET', '/api/ping');
  assert.equal(r.status, 200);
  assert.equal(r.json.pong, true);
  assert.equal(r.json.stack, STACK);
  assert.equal(typeof r.json.unix_ms, 'number');
  assert.ok(!('db_ms' in r.json));
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/i);
  assert.equal(r.headers.get('x-stack'), STACK);
  assert.match(r.headers.get('server-timing'), /^app;dur=\d+(\.\d+)?$/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
});

test('GET /api/ping?db=1 includes db_ms', async () => {
  const r = await api('GET', '/api/ping?db=1');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.db_ms, 'number');
});

test('unknown API path is 404 not_found', async () => {
  const r = await api('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'not_found' });
  assert.equal(r.headers.get('x-stack'), STACK);
});

test('wrong method on known path is 405 method_not_allowed', async () => {
  const r = await api('DELETE', '/api/ping');
  assert.equal(r.status, 405);
  assert.deepEqual(r.json, { error: 'method_not_allowed' });
});

test('F9: SPA paths serve index.html with CSP and nosniff', async () => {
  for (const p of ['/gallery', '/u/someone', '/test', '/']) {
    const r = await api('GET', p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/, p);
    assert.equal(r.headers.get('content-security-policy'),
      "default-src 'self'; img-src 'self' data:", p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex', p);
  }
});

test('GET /robots.txt disallows all', async () => {
  const r = await api('GET', '/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.text, /Disallow: \//);
});

test('huge integer literal in a JSON body does not drop the connection (422)', async () => {
  const r = await api('POST', '/api/users', {
    body: '{"handle":"!!","display_name":"x","n":' + '1'.repeat(5000) + '}',
  });
  assert.ok(r.status === 422, `status ${r.status}`);
  assert.notEqual(r.json, null);
  const ping = await api('GET', '/api/ping');
  assert.equal(ping.status, 200);
});

test('5000-digit image_id is rejected as a missing image', async () => {
  const u = await createUser();
  const r = await api('POST', '/api/posts', {
    token: u.token,
    body: '{"body":"x","image_id":' + '1'.repeat(5000) + '}',
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.fields.image_id, 'ไม่พบรูปนี้');
});
