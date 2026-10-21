import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';

const TTL_MS = 10_000;

const statsFile = () => path.join(config.CACHE_DIR, 'stats.json');
const countersFile = () => path.join(config.CACHE_DIR, 'cache-counters.json');

async function unlinkQuiet(file) {
  try {
    await fs.unlink(file);
  } catch {
    // absent or unwritable: nothing to drop
  }
}

/** Write text to `file` through a temp file + rename so readers never see a partial file. */
async function writeAtomic(file, text) {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.mkdir(config.CACHE_DIR, { recursive: true, mode: 0o775 });
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch {
    await unlinkQuiet(tmp);
  }
}

/** Drop the cached /api/stats payload after a successful write. */
export async function invalidate() {
  await unlinkQuiet(statsFile());
}

// Counter updates run one after another inside this process, so concurrent requests do not lose
// increments. Other processes are not coordinated (approximate counts are fine: Tabby).
let counterQueue = Promise.resolve();

function enqueue(fn) {
  const run = counterQueue.then(fn, fn);
  counterQueue = run.catch(() => {});
  return run;
}

async function readCounters() {
  try {
    const d = JSON.parse(await fs.readFile(countersFile(), 'utf8'));
    if (d !== null && typeof d === 'object') {
      return { hits: Math.trunc(Number(d.hits)) || 0, misses: Math.trunc(Number(d.misses)) || 0 };
    }
  } catch {
    // absent or unreadable: start from zero
  }
  return { hits: 0, misses: 0 };
}

function bump(key) {
  return enqueue(async () => {
    const c = await readCounters();
    c[key] += 1;
    await writeAtomic(countersFile(), JSON.stringify(c));
  });
}

/** {hits, misses} of /api/stats since the last DELETE /api/cache. */
export function counters() {
  return enqueue(readCounters);
}

/** DELETE /api/cache: remove the cached payload and the hit/miss counters. */
export function clearAll() {
  return enqueue(async () => {
    await invalidate();
    await unlinkQuiet(countersFile());
  });
}

async function compute() {
  const [[row]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM posts) AS posts,
       (SELECT COUNT(*) FROM comments) AS comments,
       (SELECT COUNT(*) FROM likes) AS likes,
       (SELECT COUNT(*) FROM images) AS images,
       (SELECT COALESCE(SUM(bytes_display + bytes_thumb), 0) FROM images) AS media_bytes,
       (SELECT COALESCE(MAX(id), 0) FROM events) AS last_event_id`,
  );
  const out = {};
  for (const k of ['users', 'posts', 'comments', 'likes', 'images', 'media_bytes', 'last_event_id']) {
    out[k] = Number(row[k]);
  }
  out.generated_at = `${new Date().toISOString().slice(0, 19)}Z`;
  return out;
}

/**
 * Cached stats JSON (younger than 10 s, served without touching the DB) or a fresh one written atomically.
 * @returns {Promise<[string, boolean]>} [json text, served from cache]
 */
export async function get() {
  const file = statsFile();
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs < TTL_MS) {
      const cached = await fs.readFile(file, 'utf8');
      if (cached !== '') {
        await bump('hits');
        return [cached, true];
      }
    }
  } catch {
    // no usable cache file: compute below
  }
  const json = JSON.stringify(await compute());
  await writeAtomic(file, json);
  await bump('misses');
  return [json, false];
}
