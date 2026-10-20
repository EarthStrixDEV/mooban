// One EventSource('/api/stream') per tab (DESIGN 6.5). The browser owns `retry:` and its own
// Last-Event-ID on automatic reconnects. A stream this module creates itself (after hiding or a
// backoff retry) has no such header, so it passes the last id seen as ?last_id=; the server
// prefers the header, so the browser's own reconnects never replay. Also: status reporting and
// 429 detection with backoff.
import { emit } from './store.js';

const URL_STREAM = '/api/stream';
const TYPES = [
  'post.created', 'post.updated', 'post.deleted',
  'like.changed', 'comment.created', 'comment.deleted',
  'resync', 'test.ping',
];
const MAX_ERRORS = 3;                       // consecutive errors without an `open` before probing
const BACKOFF_S = [5, 10, 20, 40, 60];      // retry delays after a failed attempt (cap 60)
const SHOW_RECONNECTING_MS = 4000;          // the server closes every 60 s; hide that blip from the status
const HIDDEN_MS = Number(globalThis.__MB_HIDDEN_MS) || 60_000; // close the stream after this long in a hidden tab (override: tests)

const handlers = new Map(); // type -> Set<fn>
let es = null;
let started = false;
let status = 'connecting';
let errors = 0;
let backoff = 0;
let retryTimer = null;
let hiddenTimer = null;
let suspended = false;
let probe = null;
let lastId = '';
let blipTimer = null;

function setStatus(next) {
  if (next === status) return;
  status = next;
  document.documentElement.dataset.sse = next; // test hook + styling
  emit('sse-status', next);
}

function dispatch(type, ev) {
  if (ev.lastEventId) lastId = ev.lastEventId;
  let data = {};
  try {
    data = ev.data ? JSON.parse(ev.data) : {};
  } catch { return; } // malformed payload: ignore
  if (data === null || typeof data !== 'object') return;
  for (const fn of [...(handlers.get(type) ?? [])]) {
    try { fn(data, ev.lastEventId); } catch { /* one bad handler must not stop the others */ }
  }
}

function closeStream() {
  if (es) { es.close(); es = null; }
  clearTimeout(retryTimer);
  clearTimeout(blipTimer);
  retryTimer = null;
  blipTimer = null;
  probe?.abort();
  probe = null;
}

function open() {
  closeStream();
  const mine = new EventSource(lastId ? `${URL_STREAM}?last_id=${encodeURIComponent(lastId)}` : URL_STREAM);
  es = mine;
  mine.addEventListener('open', () => {
    if (es !== mine) return;
    errors = 0;
    backoff = 0;
    clearTimeout(blipTimer);
    blipTimer = null;
    setStatus('open');
  });
  mine.addEventListener('error', () => {
    if (es !== mine) return;
    errors += 1;
    // CLOSED = the browser gave up (e.g. a 429 response): it will not retry by itself.
    if (mine.readyState === EventSource.CLOSED || errors >= MAX_ERRORS) {
      mine.close();
      es = null;
      checkAndRetry();
    } else if (!blipTimer) {
      // Only announce "reconnecting" if the stream has not come back by itself shortly.
      blipTimer = setTimeout(() => { blipTimer = null; if (es === mine && status === 'open') setStatus('reconnecting'); }, SHOW_RECONNECTING_MS);
    }
  });
  for (const type of TYPES) mine.addEventListener(type, (ev) => dispatch(type, ev));
}

// EventSource cannot see the HTTP status, so one fetch finds out whether the server said 429.
async function checkAndRetry() {
  const ctrl = new AbortController();
  probe = ctrl;
  let blocked = false;
  try {
    const res = await fetch(URL_STREAM, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
    blocked = res.status === 429;
    ctrl.abort(); // status only; never read the body
  } catch { /* offline or aborted: treated as a plain reconnect */ }
  if (probe !== ctrl || suspended) return;
  probe = null;
  setStatus(blocked ? 'blocked' : 'reconnecting');
  const wait = BACKOFF_S[Math.min(backoff, BACKOFF_S.length - 1)] * 1000;
  backoff += 1;
  errors = 0;
  retryTimer = setTimeout(() => { retryTimer = null; if (!suspended) open(); }, wait);
}

function onVisibility() {
  if (document.hidden) {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      hiddenTimer = null;
      suspended = true;
      closeStream();
    }, HIDDEN_MS);
    return;
  }
  clearTimeout(hiddenTimer);
  hiddenTimer = null;
  if (suspended) {
    suspended = false;
    errors = 0;
    backoff = 0;
    setStatus('connecting');
    open();
  }
}

export const sse = {
  get status() { return status; },
  connect() {
    if (started) return;
    started = true;
    document.documentElement.dataset.sse = status;
    open();
    document.addEventListener('visibilitychange', onVisibility);
    if (document.hidden) onVisibility();
  },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  },
};
