import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

export const BASE = process.env.BASE_URL ?? '';
export const TEST_TOKEN = process.env.TEST_TOKEN ?? 'dev-test-token-0123456789abcd';
export const STACK = process.env.STACK ?? '';

export async function api(method, p, { body, token, headers = {}, form } = {}) {
  const h = { ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!Object.keys(h).some(k => k.toLowerCase() === 'content-type')) {
      h['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

export async function db() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.DB_USER ?? 'mb',
    password: process.env.DB_PASS ?? 'mb',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  await c.query("SET time_zone = '+00:00'");
  return c;
}

export function uniq(prefix = 't') {
  const rand = randomBytes(8).toString('hex');
  return (prefix + rand).slice(0, 20).toLowerCase();
}

export async function createUser({ handle, display_name } = {}) {
  handle = handle ?? uniq('u');
  display_name = display_name ?? handle;
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const c = await db();
  try {
    const [r] = await c.execute(
      'INSERT INTO users (handle, display_name, token_hash) VALUES (?, ?, ?)',
      [handle, display_name, hash]);
    return { id: r.insertId, handle, token };
  } finally {
    await c.end();
  }
}

export async function resetRateLimits() {
  const c = await db();
  try {
    await c.query('DELETE FROM rate_limits');
  } finally {
    await c.end();
  }
}

// Rate limits are fixed 1-minute UTC windows: a burst that crosses a minute boundary
// would reset the counter mid-test. Start such bursts early in the minute (spec §11).
export async function waitForMinuteStart(maxStartSecond = 10) {
  const now = new Date();
  const sec = now.getUTCSeconds();
  if (sec <= maxStartSecond) return;
  const msToNextMinute = (60 - sec) * 1000 - now.getUTCMilliseconds();
  await new Promise(r => setTimeout(r, msToNextMinute + 200));
}

export function fixture(name) {
  return path.join(root, 'tests', 'fixtures', name);
}

// Host fallback (MEDIA_DIR_HOST set): the app runs on the host, so ls/mkdir/rm on the media dir are
// done with node:fs and print what `docker exec` would. MEDIA_DIR_IN_CONTAINER maps to MEDIA_DIR_HOST.
async function mediaExecHost(args) {
  const inContainer = (process.env.MEDIA_DIR_IN_CONTAINER ?? '').replace(/\/+$/, '');
  const hostDir = process.env.MEDIA_DIR_HOST;
  const [cmd, ...rest] = args;
  const flags = rest.filter(a => a.startsWith('-'));
  const target = rest.filter(a => !a.startsWith('-')).at(-1);
  if (!target || !(target === inContainer || target.startsWith(inContainer + '/'))) {
    throw new Error(`mediaExec host fallback: ${cmd} outside MEDIA_DIR_IN_CONTAINER: ${target}`);
  }
  const p = path.join(hostDir, target.slice(inContainer.length));
  switch (cmd) {
    case 'ls': {
      const names = await fsp.readdir(p); // readdir omits . and .., like `ls -A`
      return names.sort().map(n => n + '\n').join('');
    }
    case 'mkdir':
      await fsp.mkdir(p, { recursive: flags.some(f => f.includes('p')) });
      return '';
    case 'rm':
      await fsp.rm(p, { recursive: flags.some(f => /[rR]/.test(f)), force: flags.some(f => f.includes('f')) });
      return '';
    default:
      throw new Error(`mediaExec host fallback does not support: ${cmd}`);
  }
}

export async function mediaExec(args) {
  if (process.env.MEDIA_DIR_HOST) return mediaExecHost(args);
  const service = process.env.SERVICE;
  if (!service) throw new Error('SERVICE env is required for mediaExec');
  const { stdout } = await execFileP('docker', [
    'compose', '-f', path.join(root, 'dev', 'docker-compose.yml'),
    'exec', '-T', service, ...args,
  ], { cwd: root });
  return stdout;
}
