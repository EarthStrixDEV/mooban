import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import * as auth from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError, intParam, parseId, parseQuery, readBody, route, sendJson } from '../http.js';
import * as images from '../images.js';
import * as json from '../json.js';
import * as media from '../media.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';
import * as v from '../validate.js';

const USER_QUOTA = 100;
const STACK_QUOTA = 500;
const ALT_MAX = 200;
const ALT_LONG_MSG = 'ยาวเกิน 200 ตัวอักษร';
const FILE_MISSING_MSG = 'ต้องแนบไฟล์';
const MAX_BODY_BYTES = 12 * 1024 * 1024; // whole request (file + multipart overhead), PHP post_max_size
const ALT_FIELD_BYTES = 64 * 1024;

const SELECT = `SELECT i.id, i.user_id, i.media_key, i.width, i.height, i.format,
        i.bytes_display, i.bytes_thumb, i.alt, i.created_at, u.handle, u.display_name
    FROM images i
    JOIN users u ON u.id = i.user_id`;

async function find(id) {
  if (id === null) return null;
  const [rows] = await pool.execute(`${SELECT} WHERE i.id = ?`, [id]);
  return rows.length === 0 ? null : rows[0];
}

/**
 * Read the multipart body. The file part is streamed to `dir`, never held in memory.
 * Resolves {file: {path, size, truncated} | null, alt: string | null | undefined};
 * a body that is not multipart (or has no usable `file` part) yields file = null.
 * `alt` is undefined when absent, null when it was cut off by the field size cap.
 */
function receive(req, dir) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: config.MAX_UPLOAD_BYTES + 1, files: 1, fields: 5, fieldSize: ALT_FIELD_BYTES },
      });
    } catch {
      resolve({ file: null, alt: undefined }); // missing / non-multipart Content-Type
      return;
    }

    let file = null;
    let alt;
    let filePromise = Promise.resolve();
    let failed = false;
    let total = 0;

    const fail = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe(bb);
      req.resume(); // let Node discard the rest; nothing is kept
      reject(err);
    };

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) fail(new HttpError(413, 'payload_too_large'));
    });
    req.on('close', () => { if (!req.complete) fail(new Error('client aborted')); });
    req.on('error', fail);

    bb.on('field', (name, value, info) => {
      if (name === 'alt') alt = info.valueTruncated ? null : value;
    });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || file !== null || !info.filename) {
        stream.resume(); // not the upload slot (PHP: an empty filename is UPLOAD_ERR_NO_FILE)
        return;
      }
      const target = { path: path.join(dir, 'upload'), size: 0, truncated: false };
      file = target;
      stream.on('limit', () => { target.truncated = true; });
      const out = fs.createWriteStream(target.path, { mode: 0o600 });
      filePromise = pipeline(stream, out).then(() => { target.size = out.bytesWritten; });
      filePromise.catch(() => {}); // surfaced through the busboy 'error' / awaited at close
    });
    bb.on('error', () => {
      // Truncated / malformed multipart: a half-received file is an invalid image.
      fail(file !== null ? new HttpError(422, 'image_invalid') : new HttpError(422, 'validation_failed', {
        fields: { file: FILE_MISSING_MSG },
      }));
    });
    bb.on('close', () => {
      if (failed) return;
      filePromise.then(
        () => resolve({ file, alt }),
        () => fail(new HttpError(422, 'image_invalid')),
      );
    });
    req.pipe(bb);
  });
}

async function create(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  await ratelimit.hit(`user:${uid}:upload`, 10);

  const [[mine]] = await pool.execute('SELECT COUNT(*) AS n FROM images WHERE user_id = ?', [uid]);
  const [[total]] = await pool.query(
    "SELECT COUNT(*) AS n FROM images i JOIN users u ON u.id = i.user_id WHERE LEFT(u.handle, 5) <> 'seed_'",
  );
  if (Number(mine.n) >= USER_QUOTA || Number(total.n) >= STACK_QUOTA) {
    throw new HttpError(422, 'quota_reached');
  }

  // A declared body beyond the server-level limit is refused without reading it.
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mooban-up-'));
  let mediaKey = null;
  try {
    const { file, alt: altIn } = await receive(req, dir);
    if (file === null) {
      throw new HttpError(422, 'validation_failed', { fields: { file: FILE_MISSING_MSG } });
    }

    // From here on the file is fully received: processing_ms starts counting.
    const t0 = process.hrtime.bigint();
    if (file.truncated || file.size > config.MAX_UPLOAD_BYTES) throw new HttpError(413, 'payload_too_large');
    const fh = await fsp.open(file.path, 'r');
    let head;
    try {
      head = Buffer.alloc(12);
      const { bytesRead } = await fh.read(head, 0, 12, 0);
      head = head.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
    if (images.detect(head) === null) throw new HttpError(415, 'unsupported_media_type');

    let alt = null;
    if (altIn === null) { // cut off at the field size cap: certainly too long
      throw new HttpError(422, 'validation_failed', { fields: { alt: ALT_LONG_MSG } });
    }
    if (typeof altIn === 'string') {
      alt = v.trim(altIn);
      if (v.len(alt) > ALT_MAX) {
        throw new HttpError(422, 'validation_failed', { fields: { alt: ALT_LONG_MSG } });
      }
      if (alt === '') alt = null;
    }

    const r = await images.processUpload(file.path, file.size);
    mediaKey = r.media_key;
    const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

    const [ins] = await pool.execute(
      `INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, alt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, r.media_key, r.width, r.height, r.format, r.bytes_display, r.bytes_thumb, alt],
    );
    const row = await find(Number(ins.insertId));
    if (row === null) throw new Error('inserted image row not found');
    mediaKey = null; // committed: the files now belong to the row
    await stats.invalidate();
    sendJson(res, 201, { ...json.image(row), processing_ms: ms });
  } catch (e) {
    if (mediaKey !== null) await media.removeDir(mediaKey);
    throw e;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function index(req, res) {
  const q = parseQuery(req);
  const limit = intParam(q, 'limit') ?? 40;
  const before = intParam(q, 'before');
  if (Number(limit) > 100) throw new HttpError(400, 'bad_params');
  let handle = null;
  if ('user' in q) {
    if (typeof q.user !== 'string') throw new HttpError(400, 'bad_params');
    handle = v.asciiLower(q.user);
  }

  let sql = `${SELECT} WHERE 1 = 1`;
  const args = [];
  if (handle !== null) {
    sql += ' AND u.handle = ?';
    args.push(handle);
  }
  if (before !== null) {
    sql += ' AND i.id < ?';
    args.push(before);
  }
  sql += ` ORDER BY i.id DESC LIMIT ${Number(limit) + 1}`;

  const [rows] = await pool.execute(sql, args);
  const more = rows.length > limit;
  if (more) rows.pop();
  const data = rows.map((r) => json.image(r));
  sendJson(res, 200, { data, next_before: more ? data[data.length - 1].id : null });
}

/** 404 -> 403 gate shared by PATCH and DELETE. */
async function owned(rawId, uid) {
  const row = await find(parseId(rawId));
  if (row === null) throw new HttpError(404, 'not_found');
  if (Number(row.user_id) !== uid) throw new HttpError(403, 'not_owner');
  return row;
}

async function patch(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const row = await owned(req.routeParams.id, uid);
  await ratelimit.hit(`user:${uid}:write`, 30);
  const input = await readBody(req);

  let alt = input.alt ?? null;
  if (alt !== null && typeof alt !== 'string') {
    throw new HttpError(422, 'validation_failed', { fields: { alt: 'ต้องเป็นข้อความ' } });
  }
  if (alt !== null) {
    alt = v.trim(alt);
    if (v.len(alt) > ALT_MAX) {
      throw new HttpError(422, 'validation_failed', { fields: { alt: ALT_LONG_MSG } });
    }
    if (alt === '') alt = null;
  }

  const id = Number(row.id);
  await pool.execute('UPDATE images SET alt = ? WHERE id = ?', [alt, id]);
  const fresh = await find(id);
  if (fresh === null) throw new HttpError(404, 'not_found');
  await stats.invalidate();
  sendJson(res, 200, json.image(fresh));
}

async function destroy(req, res) {
  const user = await auth.require(req);
  const uid = Number(user.id);
  const row = await owned(req.routeParams.id, uid);
  await ratelimit.hit(`user:${uid}:write`, 30);

  // posts.image_id goes NULL through the FK (ON DELETE SET NULL)
  await pool.execute('DELETE FROM images WHERE id = ?', [Number(row.id)]);
  await media.removeDir(String(row.media_key));
  await stats.invalidate();
  sendJson(res, 204, null);
}

export function register() {
  route('POST', '/api/images', create);
  route('GET', '/api/images', index);
  route('PATCH', String.raw`/api/images/{id:\d+}`, patch);
  route('DELETE', String.raw`/api/images/{id:\d+}`, destroy);
}
