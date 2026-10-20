import { createHash, randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { test as base, expect } from '@playwright/test';

export { expect };

async function db() {
  const c = await mysql.createConnection({
    host: process.env.E2E_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.E2E_DB_PORT ?? 3307),
    user: process.env.E2E_DB_USER ?? 'mb',
    password: process.env.E2E_DB_PASS ?? 'mb',
    database: process.env.E2E_DB ?? 'mb_apache',
    charset: 'utf8mb4',
  });
  await c.query("SET time_zone = '+00:00'");
  return c;
}

export function uniqueHandle(prefix = 'e') {
  return (prefix + randomBytes(10).toString('hex')).slice(0, 20).toLowerCase();
}

// Direct insert, same approach as tests/contract/helpers.mjs. Returns the plaintext token.
export async function createUser({ handle, display_name } = {}) {
  handle = handle ?? uniqueHandle('u');
  display_name = display_name ?? handle;
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const c = await db();
  try {
    const [r] = await c.execute(
      'INSERT INTO users (handle, display_name, token_hash) VALUES (?, ?, ?)',
      [handle, display_name, hash]);
    return { id: r.insertId, handle, display_name, token };
  } finally {
    await c.end();
  }
}

// Signup is limited to 5 per IP per minute; specs that sign up through the UI reset it first.
export async function resetRateLimits() {
  const c = await db();
  try { await c.query('DELETE FROM rate_limits'); } finally { await c.end(); }
}

// The server frees an SSE slot only when it notices the disconnect (~70 s), so specs that open
// several streams clear the counter rows first to stay under the 10-per-IP limit.
export async function clearStreams() {
  const c = await db();
  try { await c.query('DELETE FROM streams'); } finally { await c.end(); }
}

// Injects mb_token before any page script runs, so the app boots as that user.
export async function signedInPage(page, user) {
  user = user ?? await createUser();
  await page.addInitScript((t) => {
    try { localStorage.setItem('mb_token', t); } catch { /* storage blocked */ }
  }, user.token);
  return user;
}

// Every spec imports `test` from here: the auto fixture frees SSE slots before each test, so the
// 10-streams-per-IP limit (slots linger ~70 s on the dev stack) never turns the live status to blocked.
export const test = base.extend({
  _streams: [async ({}, use) => { await clearStreams(); await use(); }, { auto: true }],
});
