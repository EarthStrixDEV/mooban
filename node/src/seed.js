import { createHash, randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { pool, withTx } from './db.js';
import * as images from './images.js';
import * as media from './media.js';
import * as stats from './stats.js';

// Test-data tools (Spec section 8): seed, wipe and the media/DB consistency check. Mirrors php/src/Seed.php.

const SPAN_SECONDS = 7 * 86400;
const BATCH = 500;
const SEED_LIKE = 'seed\\_%'; // MySQL pattern seed\_% (escaped underscore)
const KEY_RE = /^[0-9a-f]{16}$/;

const fmt = (ts) => new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');

async function texts() {
  const candidates = [
    path.resolve(config.PUBLIC_DIR, '..', 'seed-texts.json'),
    new URL('../../shared/seed-texts.json', import.meta.url),
  ];
  for (const file of candidates) {
    let list;
    try {
      list = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      continue;
    }
    if (Array.isArray(list) && list.length > 0) return list.map(String);
  }
  throw new Error('seed-texts.json missing or invalid');
}

/** @returns {Promise<{users:number,posts:number,images:number,duration_ms:number}>} */
export async function run(users, posts, imageCount) {
  const t0 = process.hrtime.bigint();
  const list = await texts();

  // Continue after the highest existing seed_NNN.
  let max = 0;
  const [existing] = await pool.execute('SELECT handle FROM users WHERE handle LIKE ?', [SEED_LIKE]);
  for (const { handle } of existing) {
    const m = /^seed_([0-9]+)$/.exec(String(handle));
    if (m) max = Math.max(max, Number(m[1]));
  }

  const start = Math.floor(Date.now() / 1000) - SPAN_SECONDS;
  // Post i: evenly spread over the last 7 days, oldest first (ids rise with time).
  const at = (i) => start + Math.floor((i * SPAN_SECONDS) / Math.max(1, posts));

  const keys = [];
  try {
    // Process sample.jpg once; the first image keeps that dir, the others are copies.
    let img = null;
    if (imageCount > 0) {
      const file = path.join(config.PUBLIC_DIR, 'sample.jpg');
      const size = (await fs.stat(file).catch(() => null))?.size;
      if (size === undefined) throw new Error('sample.jpg not found');
      img = await images.processUpload(file, size);
      const ext = img.format === 'webp' ? 'webp' : 'jpg';
      keys.push(img.media_key);
      const dir = path.join(config.MEDIA_DIR, img.media_key);
      const [display, thumb] = await Promise.all([
        fs.readFile(path.join(dir, `display.${ext}`)),
        fs.readFile(path.join(dir, `thumb.${ext}`)),
      ]);
      for (let i = 1; i < imageCount; i++) keys.push(await images.store(display, thumb, ext));
    }

    await withTx(async (conn) => {
      const handles = [];
      const ph = [];
      const args = [];
      for (let i = 1; i <= users; i++) {
        const n = String(max + i).padStart(3, '0');
        handles.push(`seed_${n}`);
        ph.push('(?, ?, ?, ?)');
        // Token is random and thrown away: only its hash is stored.
        args.push(`seed_${n}`, `Seed ${n}`, createHash('sha256').update(randomBytes(32).toString('hex')).digest('hex'), fmt(start));
      }
      await conn.execute(`INSERT INTO users (handle, display_name, token_hash, created_at) VALUES ${ph.join(',')}`, args);
      const [rows] = await conn.execute(
        `SELECT handle, id FROM users WHERE handle IN (${handles.map(() => '?').join(',')})`,
        handles,
      );
      const idByHandle = new Map(rows.map((r) => [String(r.handle), Number(r.id)]));
      const userIds = handles.map((h) => idByHandle.get(h));

      // Image i belongs to the author of post i and is attached to it below.
      const imageIds = [];
      for (let i = 0; i < imageCount; i++) {
        const [r] = await conn.execute(
          `INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, alt, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          [userIds[i % users], keys[i], img.width, img.height, img.format, img.bytes_display, img.bytes_thumb, fmt(at(i))],
        );
        imageIds[i] = Number(r.insertId);
      }

      for (let from = 0; from < posts; from += BATCH) {
        const to = Math.min(posts, from + BATCH);
        const pph = [];
        const pargs = [];
        for (let i = from; i < to; i++) {
          const ts = fmt(at(i));
          pph.push('(?, ?, ?, ?, ?)');
          pargs.push(userIds[i % users], list[randomInt(0, list.length)], imageIds[i] ?? null, ts, ts);
        }
        await conn.execute(
          `INSERT INTO posts (user_id, body, image_id, created_at, updated_at) VALUES ${pph.join(',')}`,
          pargs,
        );
      }
    });
  } catch (e) {
    for (const k of keys) await media.removeDir(k).catch(() => {});
    throw e;
  }

  await stats.invalidate();
  return {
    users,
    posts,
    images: imageCount,
    duration_ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6),
  };
}

/** @returns {Promise<{deleted_users:number,deleted_posts:number,deleted_images:number}>} */
export async function wipe() {
  const [[u]] = await pool.execute('SELECT COUNT(*) AS n FROM users WHERE handle LIKE ?', [SEED_LIKE]);
  const [[p]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE u.handle LIKE ?',
    [SEED_LIKE],
  );
  const [keys] = await pool.execute(
    'SELECT i.media_key FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE ?',
    [SEED_LIKE],
  );

  // FKs cascade posts, images, likes and comments; the media dirs are ours to remove.
  await pool.execute('DELETE FROM users WHERE handle LIKE ?', [SEED_LIKE]);
  for (const k of keys) await media.removeDir(String(k.media_key));
  await stats.invalidate();

  return { deleted_users: Number(u.n), deleted_posts: Number(p.n), deleted_images: keys.length };
}

/** @returns {Promise<{orphan_dirs:number,missing_files:number}>} */
export async function orphans() {
  const root = config.MEDIA_DIR;
  const isFile = (f) => fs.stat(f).then((s) => s.isFile(), () => false);
  const known = new Set();
  let missing = 0;
  const [rows] = await pool.execute('SELECT media_key, format FROM images');
  for (const r of rows) {
    const key = String(r.media_key);
    known.add(key);
    const ext = r.format === 'webp' ? 'webp' : 'jpg';
    if (!(await isFile(path.join(root, key, `display.${ext}`))) || !(await isFile(path.join(root, key, `thumb.${ext}`)))) {
      missing++;
    }
  }

  let count = 0;
  const names = await fs.readdir(root).catch(() => []);
  for (const name of names) {
    if (!KEY_RE.test(name) || known.has(name)) continue;
    if ((await fs.stat(path.join(root, name)).catch(() => null))?.isDirectory()) count++;
  }
  return { orphan_dirs: count, missing_files: missing };
}
