import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../../shared/public/js/api.js';
import * as store from '../../shared/public/js/store.js';

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}
let calls;
function stubFetch(r) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (r instanceof Error) throw r;
    return r;
  };
}
function stubStorage(throwing = false) {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => { if (throwing) throw new Error('denied'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (throwing) throw new Error('denied'); m.set(k, String(v)); },
    removeItem: (k) => { if (throwing) throw new Error('denied'); m.delete(k); },
  };
}
beforeEach(() => { stubStorage(); store.clearToken(); });

test('adds Bearer when token present and auth default', async () => {
  store.setToken('tok123');
  stubFetch(res(200, { ok: 1 }));
  assert.deepEqual(await api('GET', '/api/me'), { ok: 1 });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123');
  assert.equal(calls[0].init.method, 'GET');
});

test('auth:false omits Authorization; json sets body and content-type', async () => {
  store.setToken('tok123');
  stubFetch(res(201, { id: 1 }));
  await api('POST', '/api/signup', { json: { a: 1 }, auth: false });
  const { headers, body } = calls[0].init;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(body, '{"a":1}');
});

test('form passes FormData without content-type', async () => {
  stubFetch(res(201, {}));
  const fd = new FormData();
  await api('POST', '/api/images', { form: fd });
  assert.equal(calls[0].init.body, fd);
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
});

test('204 -> null', async () => {
  stubFetch(res(204));
  assert.equal(await api('DELETE', '/api/posts/1'), null);
});

test('422 -> ApiError with code and fields', async () => {
  stubFetch(res(422, { error: 'validation_failed', fields: { handle: 'x' } }));
  await assert.rejects(api('POST', '/api/signup'), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 422);
    assert.equal(e.code, 'validation_failed');
    assert.deepEqual(e.fields, { handle: 'x' });
    assert.equal(e.retryAfter, null);
    return true;
  });
});

test('429 -> retryAfter from body, else header', async () => {
  stubFetch(res(429, { error: 'rate_limited', retry_after: 17 }));
  await assert.rejects(api('GET', '/x'), (e) => e.status === 429 && e.retryAfter === 17);
  stubFetch(res(429, 'nope', { 'Retry-After': '9' }));
  await assert.rejects(api('GET', '/x'), (e) => e.code === 'http_429' && e.retryAfter === 9 && Object.keys(e.fields).length === 0);
});

test('network failure -> status 0 network', async () => {
  stubFetch(new TypeError('failed'));
  await assert.rejects(api('GET', '/x'), (e) => e instanceof ApiError && e.status === 0 && e.code === 'network');
});

test('storage throwing: setToken does not throw, getToken returns memory value', () => {
  stubStorage(true);
  assert.doesNotThrow(() => store.setToken('mem'));
  assert.equal(store.getToken(), 'mem');
  assert.doesNotThrow(() => store.clearToken());
  assert.equal(store.getToken(), null);
});

test('store state and emitter', () => {
  assert.deepEqual(store.state, { me: null });
  const got = [];
  const off = store.on('e', (d) => got.push(d));
  store.emit('e', 1);
  off();
  store.emit('e', 2);
  assert.deepEqual(got, [1]);
});
