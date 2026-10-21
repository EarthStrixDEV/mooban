import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', '..', 'tools', 'sse-load.js');
const BASE = process.env.BASE_URL ?? 'http://localhost:8081';
const TOKEN = process.env.TEST_TOKEN ?? 'dev-test-token-0123456789abcd';
const DB_NAME = process.env.DB_NAME ?? 'mb_apache';

// PHP frees stream slots slowly (~60 s), so wipe them before each run.
beforeEach(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.DB_USER ?? 'mb',
    password: process.env.DB_PASS ?? 'mb',
    database: DB_NAME,
  });
  try { await c.query('DELETE FROM streams'); } finally { await c.end(); }
});

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--base', BASE, '--token', TOKEN, ...args],
      { timeout: 60000, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
}

test('3 streams: all receive the ping, none dropped', async () => {
  const r = await run(['--levels', '3', '--hold', '5', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.length, 1);
  const [l] = out;
  assert.equal(l.level, 3);
  assert.equal(l.opened, 3);
  assert.equal(l.received, 3);
  assert.equal(l.dropped, 0);
  assert.deepEqual(l.statuses, { 200: 3 });
  assert.ok(l.first_line_ms.p50 >= 0 && l.ping_ms.max < 3000);
  assert.equal(r.stdout.includes(TOKEN), false);
});

test('12 streams with MAX_STREAMS_PER_IP 10: two get 429', async () => {
  const r = await run(['--levels', '12', '--hold', '5', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const [l] = JSON.parse(r.stdout);
  assert.equal(l.statuses['429'], 2);
  assert.equal(l.statuses['200'], 10);
  assert.equal(l.received, 10);
  assert.equal(l.opened, 10);
});

test('bad args exit non-zero', async () => {
  const r = await run(['--levels', 'x']);
  assert.notEqual(r.code, 0);
});
