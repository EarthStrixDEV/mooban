import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import busboy from 'busboy';
import { HttpError, clientIp, parseQuery, readRaw, route, sendJson } from '../http.js';
import * as ratelimit from '../ratelimit.js';
import * as stats from '../stats.js';
import * as guard from '../testguard.js';

const LIMITED_MAX = 10;
const ECHO_MAX = 1048576;
const UPLOAD_MAX_BODY = 12 * 1024 * 1024; // whole request body: same ceiling as PHP post_max_size / nginx client_max_body_size
const CHUNK = 65536;
const FILE_MISSING_MSG = 'ต้องแนบไฟล์';
const STATIC_LAST_MODIFIED = 'Mon, 01 Jan 2024 00:00:00 GMT';

// ---- stats / cache ---------------------------------------------------------------------

async function statsHandler(req, res) {
  const [json, hit] = await stats.get();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-App-Cache', hit ? 'HIT' : 'MISS');
  res.end(json);
}

async function cacheStats(req, res) {
  sendJson(res, 200, await stats.counters());
}

async function clearCache(req, res) {
  guard.require(req);
  await stats.clearAll();
  sendJson(res, 204, null);
}

// ---- /api/slow, /api/echo, /api/limited ---------------------------------------------------

async function slow(req, res) {
  guard.require(req);
  const ms = parseQuery(req).ms;
  if (typeof ms !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(ms) || Number(ms) > 10000) {
    throw new HttpError(400, 'bad_params');
  }
  const ac = new AbortController();
  res.once('close', () => ac.abort());
  try {
    await sleep(Number(ms), undefined, { signal: ac.signal });
  } catch {
    return; // client went away
  }
  sendJson(res, 200, { slept_ms: Number(ms) });
}

/** First 1024 bytes cut on a character boundary, invalid UTF-8 replaced with '?' (mb_strcut + mb_scrub). */
function preview(body) {
  let cut = Math.min(body.length, 1024);
  while (cut > 0 && cut < body.length && (body[cut] & 0xc0) === 0x80) cut--;
  const head = body.subarray(0, cut);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(head);
  } catch {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(head).replaceAll('�', '?');
  }
}

async function echo(req, res) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > ECHO_MAX) {
    throw new HttpError(413, 'payload_too_large');
  }
  const body = await readRaw(req, ECHO_MAX);

  const headers = {};
  const map = {
    Host: 'host',
    'User-Agent': 'user-agent',
    'X-Forwarded-For': 'x-forwarded-for',
    'X-Forwarded-Proto': 'x-forwarded-proto',
    'X-Real-IP': 'x-real-ip',
    'Content-Type': 'content-type',
    'Content-Length': 'content-length',
  };
  for (const [name, key] of Object.entries(map)) {
    const v = req.headers[key];
    if (typeof v === 'string' && v !== '') headers[name] = v;
  }
  sendJson(res, 200, {
    method: req.method,
    path: req.path,
    query: parseQuery(req),
    protocol: req.socket.encrypted ? 'https' : 'http',
    client_ip: clientIp(req),
    headers,
    body_size: body.length,
    body_preview: preview(body),
  });
}

async function limited(req, res) {
  const hits = await ratelimit.count(`ip:${clientIp(req)}:limited`);
  const h = {
    'X-RateLimit-Limit': String(LIMITED_MAX),
    'X-RateLimit-Remaining': String(Math.max(0, LIMITED_MAX - hits)),
  };
  if (hits > LIMITED_MAX) {
    const retry = ratelimit.retryAfter();
    throw new HttpError(429, 'rate_limited', { retry_after: retry }, { ...h, 'Retry-After': String(retry) });
  }
  sendJson(res, 200, { ok: true }, h);
}

// ---- /download, /upload ---------------------------------------------------------------------

/** Resolves when the socket has room again (or the client left). */
function drained(res) {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

async function download(req, res) {
  guard.require(req);
  const mb = req.routeParams.mb;
  if (!['1', '10', '100'].includes(mb)) throw new HttpError(400, 'bad_params');
  const size = Number(mb) * 1048576;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (let sent = 0; sent < size; sent += CHUNK) {
    if (res.destroyed) return;
    if (!res.write(randomBytes(Math.min(CHUNK, size - sent)))) await drained(res);
  }
  res.end();
}

/** Count the bytes of the `file` part without storing them. size is null when there was no file part. */
function countUpload(req, res) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { fields: 20, files: 5, fieldSize: 64 * 1024 } });
    } catch {
      resolve({ size: null }); // missing / non-multipart Content-Type
      return;
    }

    let size = null;
    let failed = false;
    let total = 0;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe(bb);
      bb.destroy();
      if (err instanceof HttpError && err.status === 413) res.once('finish', () => req.destroy());
      reject(err);
    };

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > UPLOAD_MAX_BODY) fail(new HttpError(413, 'payload_too_large'));
    });
    req.on('close', () => { if (!req.complete) fail(new Error('client aborted')); });
    req.on('error', fail);

    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || size !== null || !info.filename) {
        stream.resume(); // not the upload slot (PHP: an empty filename is UPLOAD_ERR_NO_FILE)
        return;
      }
      size = 0;
      stream.on('data', (chunk) => { size += chunk.length; });
    });
    bb.on('error', () => {
      // Truncated / malformed multipart: PHP reports a partial file as 400, no file as 422.
      fail(size !== null ? new HttpError(400, 'bad_params')
        : new HttpError(422, 'validation_failed', { fields: { file: FILE_MISSING_MSG } }));
    });
    bb.on('close', () => { if (!failed) resolve({ size }); });
    req.pipe(bb);
  });
}

async function upload(req, res) {
  guard.require(req);
  const t0 = Date.now();
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > UPLOAD_MAX_BODY) {
    throw new HttpError(413, 'payload_too_large');
  }
  const { size } = await countUpload(req, res);
  if (size === null) throw new HttpError(422, 'validation_failed', { fields: { file: FILE_MISSING_MSG } });
  sendJson(res, 200, { received_bytes: size, duration_ms: Date.now() - t0 });
}

// ---- /cache/* ---------------------------------------------------------------------------------

const STATIC_BODY = 'Mooban cache test body. This text never changes between calls.\n'.repeat(40).slice(0, 2048);
const STATIC_ETAG = `"${createHash('sha256').update(STATIC_BODY).digest('hex')}"`;
const GZIP_LINE = 'The quick brown fox jumps over the lazy dog. Mooban compression test line.\n';
const GZIP_BODY = GZIP_LINE.repeat(Math.floor(204800 / GZIP_LINE.length) + 1).slice(0, 204800);

function sendText(res, cacheControl, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Length', String(Buffer.byteLength(body)));
  res.end(body);
}

/** If-None-Match match, ignoring a weak prefix and the "-gzip" suffix mod_deflate appends. */
function etagMatches(header) {
  const inm = (header ?? '').trim();
  if (inm === '') return false;
  return inm.split(',').some((raw) => {
    const tag = raw.trim().replace(/^W\//, '').replace(/-gzip"$/, '"');
    return tag === '*' || tag === STATIC_ETAG;
  });
}

function cacheStatic(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('ETag', STATIC_ETAG);
  res.setHeader('Last-Modified', STATIC_LAST_MODIFIED);
  if (etagMatches(req.headers['if-none-match'])) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(STATIC_BODY.length));
  res.end(STATIC_BODY);
}

function cacheTime(req, res) {
  const ms = Date.now();
  sendJson(res, 200, {
    server_time: `${new Date(ms - (ms % 1000)).toISOString().slice(0, 19)}Z`,
    unix_ms: ms,
  }, { 'Cache-Control': 'public, max-age=10' });
}

export function register() {
  route('GET', '/api/stats', statsHandler);
  route('GET', '/api/cache-stats', cacheStats);
  route('DELETE', '/api/cache', clearCache);
  route('GET', '/api/slow', slow);
  for (const m of ['GET', 'POST', 'PUT', 'DELETE']) route(m, '/api/echo', echo);
  route('GET', '/api/limited', limited);
  route('GET', '/download/{mb}', download);
  route('POST', '/upload', upload);
  route('GET', '/cache/static', cacheStatic);
  route('GET', '/cache/none', (req, res) => sendText(res, 'no-store', STATIC_BODY));
  route('GET', '/cache/time', cacheTime);
  route('GET', '/cache/gzip', (req, res) => sendText(res, 'no-cache', GZIP_BODY));
}
