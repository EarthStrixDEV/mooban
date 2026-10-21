import { pool } from '../db.js';
import { HttpError, clientIp, parseQuery, route } from '../http.js';
import { config } from '../config.js';
import * as sse from '../sse.js';

const ROW_TTL_SECONDS = 70;
const RETRY_AFTER = 5;
const ID_RE = /^[0-9]{1,18}$/;

/** Valid Last-Event-ID header, else valid ?last_id, else null (R15). */
function givenId(req) {
  const q = parseQuery(req).last_id;
  for (const raw of [req.headers['last-event-id'], q]) {
    if (typeof raw === 'string' && ID_RE.test(raw)) return Number(raw);
  }
  return null;
}

async function handle(req, res) {
  const ip = clientIp(req);

  // 1. Over-limit check BEFORE any SSE header, so 429 is a normal JSON response.
  await pool.execute('DELETE FROM streams WHERE expires_at <= UTC_TIMESTAMP()');
  const [[cnt]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM streams WHERE ip = ? AND expires_at > UTC_TIMESTAMP()',
    [ip],
  );
  if (Number(cnt.n) >= config.MAX_STREAMS_PER_IP) {
    throw new HttpError(429, 'rate_limited', { retry_after: RETRY_AFTER }, { 'Retry-After': String(RETRY_AFTER) });
  }

  // 2. Reserve a slot (expires after 70 s even if cleanup never runs).
  const [ins] = await pool.execute(
    `INSERT INTO streams (ip, expires_at) VALUES (?, UTC_TIMESTAMP() + INTERVAL ${ROW_TTL_SECONDS} SECOND)`,
    [ip],
  );
  const rowId = Number(ins.insertId);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pool.execute('DELETE FROM streams WHERE id = ?', [rowId]).catch(() => {}); // the 70 s expiry reclaims the slot
  };

  let client = null;
  let gone = false;
  // res 'close' = the client left (or the response finished); req 'close' fires as soon as a bodiless GET is read.
  res.once('close', () => {
    gone = true;
    if (client !== null) sse.close(client);
    else release();
  });

  try {
    // 3. Resolve the start point before the headers, so a client that sees them can emit and not miss it.
    const start = await sse.startPoint(givenId(req));
    if (gone) return;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders(); // Server-Timing is added by the writeHead hook in http.js
    res.socket?.setNoDelay(true);
    res.write('retry: 3000\n\n');

    client = sse.join(res, { ...start, onClose: release });
  } catch (e) {
    release();
    throw e;
  }
}

export function register() {
  route('GET', '/api/stream', handle);
}
