import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, STACK } from './helpers.mjs';

const skip = !['node', 'python'].includes(STACK);
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error before open')), { once: true });
    ws.addEventListener('close', () => reject(new Error('ws closed before open')), { once: true });
  });
}

function closed(ws) {
  return new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e.code), { once: true }));
}

function rawUpgrade(path = '/ws') {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE);
    const req = http.request({
      host: u.hostname, port: u.port, path,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers }); });
    req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); });
    req.on('error', reject);
    req.end();
  });
}

test('ws: GET /ws upgrades with HTTP 101', { skip }, async () => {
  const r = await rawUpgrade();
  assert.equal(r.status, 101);
});

test('ws: a client can connect (open)', { skip }, async () => {
  const ws = await openWs();
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  await closed(ws);
});

test('ws: 20 sequential pings each get a pong with the identical t', { skip }, async () => {
  const ws = await openWs();
  try {
    for (let i = 0; i < 20; i += 1) {
      const t = Date.now() + i;
      const got = new Promise((resolve) => ws.addEventListener('message', (e) => resolve(e.data), { once: true }));
      ws.send(JSON.stringify({ type: 'ping', t }));
      assert.deepEqual(JSON.parse(await got), { type: 'pong', t });
    }
  } finally {
    ws.close();
  }
});

test('ws: a 2048-byte message closes the connection with 1009', { skip }, async () => {
  const ws = await openWs();
  const code = closed(ws);
  ws.send('x'.repeat(2048));
  assert.equal(await code, 1009);
});

test('ws: the 21st concurrent connection is refused (503 on raw upgrade, never opens)', { skip }, async () => {
  const open = [];
  try {
    for (let i = 0; i < 20; i += 1) open.push(await openWs());
    await assert.rejects(openWs());
    const r = await rawUpgrade();
    assert.equal(r.status, 503);
  } finally {
    for (const ws of open) ws.close();
    await Promise.all(open.map(closed));
  }
  // a slot is free again once the others have closed
  await sleep(100);
  const again = await openWs();
  again.close();
  await closed(again);
});

test('ws: invalid JSON or another type gets no reply and the connection stays open', { skip }, async () => {
  const ws = await openWs();
  try {
    const msgs = [];
    ws.addEventListener('message', (e) => msgs.push(e.data));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'hello', t: 1 }));
    ws.send(JSON.stringify({ type: 'ping', t: 'x' }));
    await sleep(500);
    assert.deepEqual(msgs, []);
    assert.equal(ws.readyState, WebSocket.OPEN);
  } finally {
    ws.close();
  }
});
