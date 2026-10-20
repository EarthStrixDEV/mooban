import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, STACK } from './helpers.mjs';

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
