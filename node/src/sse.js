import { config } from './config.js';
import { pool } from './db.js';

// One poll loop for the whole process (Spec section 9, Node): a single timer reads `events` and the rows
// are broadcast to every connected client. A client whose Last-Event-ID / ?last_id is older than the
// poller's position first reads its own backlog (one query from its cursor, bounded by the poller's
// position at join time), buffering what the poller broadcasts meanwhile, then switches to live.
// Per client, ids are strictly increasing and never repeated.

const ROW_TTL_SECONDS = 70;
const PING_AFTER_MS = 15_000;
const BATCH = 500;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // a client that cannot keep up is dropped

/** @type {Set<Client>} */
const clients = new Set();
let pollTimer = null;
let lastSeen = 0; // highest event id the poller has read (valid while the poller runs)
let polling = false;
let epoch = 0; // bumped each time the poller starts, so a stale in-flight poll cannot move lastSeen

/**
 * @typedef {object} Client
 * @property {import('node:http').ServerResponse} res
 * @property {number} cursor highest id delivered to this client
 * @property {boolean} live false while the client reads its own backlog
 * @property {Array<{id:number,type:string,payload:string}>} pending broadcast rows held back during catch-up
 * @property {number} lastWrite
 * @property {NodeJS.Timeout|null} pingTimer
 * @property {NodeJS.Timeout|null} deadlineTimer
 * @property {boolean} closed
 * @property {() => void} onClose
 */

const frame = (r) => `id: ${r.id}\nevent: ${r.type}\ndata: ${r.payload}\n\n`;

function write(client, text) {
  if (client.closed) return;
  client.lastWrite = Date.now();
  client.res.write(text);
  if (client.res.writableLength > MAX_BUFFERED_BYTES) {
    client.dropped = true;
    close(client);
  }
}

/** Deliver rows newer than the client's cursor, in order. */
function deliver(client, rows) {
  let out = '';
  for (const r of rows) {
    if (r.id <= client.cursor) continue;
    out += frame(r);
    client.cursor = r.id;
  }
  if (out !== '') write(client, out);
}

function broadcast(rows) {
  for (const client of [...clients]) {
    if (client.closed) continue;
    if (client.live) deliver(client, rows);
    else client.pending.push(...rows);
  }
}

async function selectAfter(id) {
  const [rows] = await pool.execute(
    `SELECT id, type, payload FROM events WHERE id > ? ORDER BY id LIMIT ${BATCH}`,
    [id],
  );
  return rows.map((r) => ({ id: Number(r.id), type: String(r.type), payload: String(r.payload) }));
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  const myEpoch = epoch;
  try {
    for (;;) {
      const rows = await selectAfter(lastSeen);
      if (myEpoch !== epoch) break; // the poller was stopped and restarted while the query ran
      if (rows.length > 0) {
        lastSeen = rows[rows.length - 1].id;
        broadcast(rows);
      }
      if (rows.length < BATCH || clients.size === 0) break; // a full batch means more is waiting: no sleep
    }
  } catch (e) {
    console.error('mooban: sse poll failed:', e?.code ?? e?.name);
  } finally {
    polling = false;
  }
}

function startPoller(from) {
  epoch++;
  lastSeen = from;
  pollTimer = setInterval(pollOnce, Math.max(50, config.SSE_POLL_MS));
}

function stopPollerIfIdle() {
  if (clients.size === 0 && pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Where a new stream starts: the client's id, or "now"; `resync` when the id is older than the oldest kept event. */
export async function startPoint(given) {
  const [[row]] = await pool.execute('SELECT MIN(id) AS lo, MAX(id) AS hi FROM events');
  const lo = row.lo !== null ? Number(row.lo) : null;
  const hi = row.hi !== null ? Number(row.hi) : 0;
  if (given === null) return { cursor: hi, hi, resync: false };
  if (lo !== null && given < lo) return { cursor: hi, hi, resync: true };
  return { cursor: given, hi, resync: false };
}

export function release(client) {
  if (client.closed) return;
  client.closed = true;
  clearTimeout(client.pingTimer);
  clearTimeout(client.deadlineTimer);
  clients.delete(client);
  stopPollerIfIdle();
}

/** End one client: stop its timers, leave the broadcast and finish the response. */
function close(client) {
  if (client.closed) return;
  release(client);
  client.pending = [];
  if (client.dropped) client.res.destroy(); // slow reader: free the socket and its buffer now
  else if (!client.res.writableEnded) client.res.end();
  client.onClose();
}

function schedulePing(client) {
  const wait = Math.max(0, client.lastWrite + PING_AFTER_MS - Date.now());
  client.pingTimer = setTimeout(() => {
    if (client.closed) return;
    if (Date.now() - client.lastWrite >= PING_AFTER_MS) write(client, ': ping\n\n');
    schedulePing(client);
  }, wait);
}

async function catchUp(client, bound) {
  while (!client.closed && client.cursor < bound) {
    const [rows] = await pool.execute(
      `SELECT id, type, payload FROM events WHERE id > ? AND id <= ? ORDER BY id LIMIT ${BATCH}`,
      [client.cursor, bound],
    );
    if (rows.length === 0) break; // the rest of the range was purged
    deliver(client, rows.map((r) => ({ id: Number(r.id), type: String(r.type), payload: String(r.payload) })));
  }
  if (client.closed) return;
  // Synchronous from here: no broadcast can slip in between draining the buffer and going live.
  const held = client.pending;
  client.pending = [];
  client.live = true;
  deliver(client, held);
}

/**
 * Attach an already-answered SSE response (headers sent, `retry:` written) to the broadcast.
 * @param {object} opts
 * @param {number} opts.cursor first id to deliver is > cursor
 * @param {number} opts.hi MAX(events.id) read when the start point was resolved
 * @param {boolean} opts.resync write the resync event first
 * @param {() => void} opts.onClose called once when the client is finished (slot release)
 * @returns {Client}
 */
export function join(res, { cursor, hi, resync, onClose }) {
  const client = {
    res, cursor, live: false, pending: [], lastWrite: Date.now(),
    pingTimer: null, deadlineTimer: null, closed: false, onClose,
  };
  if (pollTimer === null) startPoller(hi); // never the client's own id: a huge ?last_id must not move the shared position
  clients.add(client);

  if (resync) write(client, 'event: resync\ndata: {}\n\n');
  client.deadlineTimer = setTimeout(() => close(client), config.SSE_MAX_SECONDS * 1000);
  schedulePing(client);

  catchUp(client, lastSeen).catch((e) => {
    console.error('mooban: sse backlog failed:', e?.code ?? e?.name);
    close(client);
  });
  return client;
}

export { close };
