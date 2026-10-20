import { BASE } from './helpers.mjs';

/**
 * Open an SSE stream with fetch + getReader and parse it per the SSE spec.
 * Returns once response headers arrive. A non-event-stream response (e.g. a
 * 429 JSON) is returned with `body` set to its text and no reader loop.
 * t = ms since openStream() was called.
 */
export async function openStream(path, { headers = {} } = {}) {
  const ac = new AbortController();
  const t0 = performance.now();
  const now = () => performance.now() - t0;
  const res = await fetch(BASE + path, { headers: { Accept: 'text/event-stream', ...headers }, signal: ac.signal });

  const s = {
    status: res.status,
    headers: res.headers,
    events: [],
    comments: [],
    firstLineAt: -1,
    retry: undefined,
    ended: false,
    endedAt: -1,
    body: null,
    done: null,
    _waiters: [],
    waitFor(pred, timeoutMs = 3000) {
      const hit = s.events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => {
          s._waiters = s._waiters.filter(x => x !== w);
          reject(new Error(`waitFor timed out after ${timeoutMs} ms; got ${JSON.stringify(s.events.map(e => e.event))}`));
        }, timeoutMs);
        s._waiters.push(w);
      });
    },
    close() {
      ac.abort();
      for (const w of s._waiters) clearTimeout(w.timer);
      s._waiters = [];
    },
  };

  if (!(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
    s.body = await res.text();
    s.ended = true;
    s.done = Promise.resolve();
    return s;
  }

  const dispatch = (ev) => {
    s.events.push(ev);
    for (const w of [...s._waiters]) {
      if (w.pred(ev)) {
        clearTimeout(w.timer);
        s._waiters = s._waiters.filter(x => x !== w);
        w.resolve(ev);
      }
    }
  };

  s.done = (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let cur = { data: [] };
    let hasFields = false;
    const handleLine = (line) => {
      const t = now();
      if (s.firstLineAt < 0) s.firstLineAt = t;
      if (line === '') {
        if (hasFields && cur.data.length) {
          dispatch({ id: cur.id, event: cur.event ?? 'message', data: cur.data.join('\n'), t });
        }
        cur = { data: [] };
        hasFields = false;
        return;
      }
      if (line.startsWith(':')) {
        s.comments.push({ text: line.slice(1).trim(), t });
        return;
      }
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      let value = i < 0 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      hasFields = true;
      if (field === 'data') cur.data.push(value);
      else if (field === 'event') cur.event = value;
      else if (field === 'id') cur.id = value;
      else if (field === 'retry') s.retry = Number(value);
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let m;
        while ((m = /\r\n|\n|\r/.exec(buf))) {
          const line = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          handleLine(line);
        }
      }
    } catch { /* aborted or network error */ }
    s.ended = true;
    s.endedAt = now();
  })();

  return s;
}
