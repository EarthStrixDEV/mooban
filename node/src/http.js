import { config } from './config.js';
import { encode } from './json.js';

const BODY_LIMIT = 1024 * 1024;
const BACKSLASH = String.fromCharCode(0x5c);
const MAX_JSON_DEPTH = 512; // PHP json_decode default
const INT64_MAX = 9223372036854775807n;

// /api plus the tool endpoints PHP also routes through api.php.
const API_RE = /^\/(api|download|upload|cache)(\/|$)/;

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code error code placed in {"error": code}
   * @param {object} [extra] merged into the body next to "error"
   * @param {Record<string,string>} [headers]
   */
  constructor(status, code, extra = {}, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
}

export function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (body === null || body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(encode(body));
}

export function sendError(res, status, code, extra = {}, headers = {}) {
  sendJson(res, status, { error: code, ...extra }, headers);
}

/** Headers every response carries; /api/* also gets X-Stack and Server-Timing (set as headers are written). */
export function baseHeaders(req, res, next) {
  const start = process.hrtime.bigint();
  res.setHeader('X-Robots-Tag', 'noindex');
  if (API_RE.test(req.path)) {
    res.setHeader('X-Stack', config.APP_STACK);
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      if (!this.headersSent) {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        this.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
      }
      return writeHead.apply(this, args);
    };
  }
  next();
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    sendError(res, err.status, err.code, err.extra, err.headers);
    return;
  }
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    sendError(res, err.status, 'bad_request');
    return;
  }
  console.error('mooban:', err?.name, err?.code ?? '', err?.message);
  sendError(res, 500, 'server_error');
}

/** Client IP as PHP's REMOTE_ADDR would show it (IPv4-mapped IPv6 unwrapped). */
export function clientIp(req) {
  const ip = req.ip ?? '';
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

/** Bearer token from the Authorization header, or null. */
export function bearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer[ \t\n\v\f\r]+([^ \t\n\v\f\r]+)[ \t\n\v\f\r]*$/i.exec(h);
  return m ? m[1] : null;
}

// ---- request parsing -------------------------------------------------------------------

/**
 * Query parameters like PHP's $_GET: last value wins, name[...] makes an array.
 * Returns a null-prototype object of string | array.
 */
export function parseQuery(req) {
  const i = req.url.indexOf('?');
  const out = Object.create(null);
  if (i < 0) return out;
  for (const [k, v] of new URLSearchParams(req.url.slice(i + 1))) {
    const b = k.indexOf('[');
    if (b > 0 && k.indexOf(']', b) > b) out[k.slice(0, b)] = [];
    else out[k] = v;
  }
  return out;
}

/** Positive-integer query param: null when absent, 400 bad_params when malformed. */
export function intParam(query, name) {
  if (!(name in query)) return null;
  const v = query[name];
  if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v) || BigInt(v) > INT64_MAX) {
    throw new HttpError(400, 'bad_params');
  }
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
}

/** Numeric path id (Ruling R7: ^[1-9][0-9]*$ and fits int64), else null. */
export function parseId(raw) {
  if (!/^[1-9][0-9]*$/.test(raw) || BigInt(raw) > INT64_MAX) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : raw;
}

// Rejects lone surrogates (PHP json_decode fails on them) and marks a non-integer
// image_id literal (1.0, 1e2) as NaN: PHP decodes those as floats, not ints.
function reviver(key, value, context) {
  if (!key.isWellFormed()) throw new SyntaxError('invalid utf-16');
  if (typeof value === 'string' && !value.isWellFormed()) throw new SyntaxError('invalid utf-16');
  if (key === 'image_id' && typeof value === 'number' && context?.source !== undefined
      && !/^-?\d+$/.test(context.source)) {
    return Number.NaN;
  }
  return value;
}

/** Throws when objects/arrays nest deeper than MAX_JSON_DEPTH (scans outside strings only). */
function checkDepth(text) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === BACKSLASH) i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      if (++depth > MAX_JSON_DEPTH) throw new SyntaxError('too deep');
    } else if (c === '}' || c === ']') depth--;
  }
}

/**
 * Read and parse the JSON request body (lazily, so 401/404/429 can come first).
 * Anything but a JSON object (empty, malformed, array, scalar) is 400 invalid_json.
 */
export async function readBody(req) {
  return parseObject(await readRaw(req));
}

/** Raw request body (up to `limit` bytes, else 413 payload_too_large). */
export async function readRaw(req, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Parse a raw body as a JSON object (anything else is 400 invalid_json). */
export function parseObject(raw) {
  let obj;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    checkDepth(text);
    obj = JSON.parse(text, reviver);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new HttpError(400, 'invalid_json');
  }
  return obj;
}

// ---- route table (mirrors php/src/Router.php) ------------------------------------------

const routes = [];

/** Pattern syntax: /api/posts/{id:\d+} or /api/users/{handle} (default [^/]+). */
export function route(method, pattern, handler) {
  const src = pattern.replace(/\{(\w+)(?::([^}]+))?\}/g, (_, name, re) => `(?<${name}>${re ?? '[^/]+'})`);
  routes.push([method.toUpperCase(), new RegExp(`^${src}$`), asyncHandler(async (req, res) => {
    await handler(req, res);
    // Like PHP's Router: a handler that returns without answering yields 204.
    if (!res.headersSent && !res.writableEnded) sendJson(res, 204, null);
  })]);
}

/** Express middleware: first route whose path and method match, else 405 / 404. */
export function dispatch(req, res, next) {
  let pathMatched = false;
  for (const [method, re, handler] of routes) {
    const m = re.exec(req.path);
    if (!m) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    req.routeParams = { ...m.groups };
    handler(req, res, (err) => {
      if (err) next(err);
    });
    return;
  }
  next(pathMatched ? new HttpError(405, 'method_not_allowed') : new HttpError(404, 'not_found'));
}
