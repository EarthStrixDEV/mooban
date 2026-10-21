#!/usr/bin/env node
// SSE load tester (Mooban). Node >= 22, no dependencies.
//
//   node tools/sse-load.js --base <url> --token <TEST_TOKEN> [--levels 5,10,20,50] [--hold 120] [--json]
//
// Per level: open N concurrent /api/stream connections, time the first `retry:` line,
// POST /api/test/emit once, time the matching `test.ping`, keep streams open until
// --hold seconds after the level started, then count early closes and statuses.
// Exit code is 0 even when the server refuses connections (results are data);
// non-zero only for bad arguments.

const CONNECT_TIMEOUT_MS = 15000;
const FIRST_LINE_WAIT_MS = 15000;
const PING_TIMEOUT_MS = 10000;
const PRE_EMIT_MS = 1000;
const BETWEEN_LEVELS_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  process.stderr.write(`sse-load: ${msg}\n`);
  process.stderr.write('usage: node tools/sse-load.js --base <url> --token <TEST_TOKEN> [--levels 5,10,20,50] [--hold 120] [--json]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { base: undefined, token: process.env.TEST_TOKEN, levels: [5, 10, 20, 50], hold: 120, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--base') o.base = val();
    else if (a === '--token') o.token = val();
    else if (a === '--levels') {
      const parts = val().split(',').map((s) => s.trim());
      if (!parts.length || parts.some((p) => !/^[1-9]\d*$/.test(p))) fail('--levels must be comma-separated positive integers');
      o.levels = parts.map(Number);
    } else if (a === '--hold') {
      const v = val();
      if (!/^\d+(\.\d+)?$/.test(v)) fail('--hold must be a non-negative number of seconds');
      o.hold = Number(v);
    } else if (a === '--json') o.json = true;
    else fail(`unknown argument ${a}`);
  }
  if (!o.base) fail('--base is required');
  try { o.base = new URL(o.base).origin; } catch { fail('--base must be a valid URL'); }
  if (!o.token) fail('--token (or env TEST_TOKEN) is required');
  return o;
}

// percentile rank = ceil(p * N), 1-based
function pct(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return Math.round(sorted[Math.min(rank, sorted.length) - 1] * 10) / 10;
}
const sortNum = (arr) => [...arr].sort((a, b) => a - b);

/** One SSE connection. Resolves `ready` once headers arrive (or the request fails). */
function connect(base, nonceRef) {
  const c = {
    status: null, // number, or 'error' / 'timeout'
    firstLineMs: null,
    pingMs: null,
    ended: false,
    aborted: false, // closed by us
    ac: new AbortController(),
  };
  const t0 = performance.now();
  let onFirst, onPing;
  c.firstLine = new Promise((r) => { onFirst = r; });
  c.ping = new Promise((r) => { onPing = r; });

  const connectTimer = setTimeout(() => { c.status ??= 'timeout'; c.ac.abort(); }, CONNECT_TIMEOUT_MS);

  c.done = (async () => {
    let res;
    try {
      res = await fetch(`${base}/api/stream`, { headers: { Accept: 'text/event-stream' }, signal: c.ac.signal });
    } catch {
      c.status ??= 'error';
      return;
    } finally {
      clearTimeout(connectTimer);
    }
    c.status = res.status;
    if (res.status !== 200 || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return;
    }
    c.open = true;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let ev = { event: 'message', data: [] };
    const line = (l) => {
      if (l === '') {
        if (ev.event === 'test.ping' && c.pingMs === null && nonceRef.value !== null) {
          try {
            if (JSON.parse(ev.data.join('\n')).nonce === nonceRef.value) { c.pingMs = performance.now() - nonceRef.t0; onPing(); }
          } catch { /* not json */ }
        }
        ev = { event: 'message', data: [] };
        return;
      }
      if (l.startsWith(':')) return;
      const i = l.indexOf(':');
      const field = i < 0 ? l : l.slice(0, i);
      let v = i < 0 ? '' : l.slice(i + 1);
      if (v.startsWith(' ')) v = v.slice(1);
      if (field === 'retry' && c.firstLineMs === null) { c.firstLineMs = performance.now() - t0; onFirst(); }
      else if (field === 'event') ev.event = v;
      else if (field === 'data') ev.data.push(v);
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let m;
        while ((m = /\r\n|\n|\r/.exec(buf))) {
          const l = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          line(l);
        }
      }
    } catch { /* aborted or network error */ }
    c.ended = true;
  })();
  return c;
}

const withTimeout = (p, ms) => Promise.race([p, sleep(ms)]);

async function runLevel(o, n) {
  const levelStart = performance.now();
  const nonceRef = { value: null, t0: 0 };
  const conns = Array.from({ length: n }, () => connect(o.base, nonceRef));

  // Wait until every connection has its first line, or failed to open.
  await withTimeout(Promise.all(conns.map((c) => Promise.race([c.firstLine, c.done]))), FIRST_LINE_WAIT_MS);
  await sleep(PRE_EMIT_MS);

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  nonceRef.value = nonce;
  nonceRef.t0 = performance.now();
  let emitStatus = null;
  try {
    const r = await fetch(`${o.base}/api/test/emit`, {
      method: 'POST',
      headers: { 'X-Test-Token': o.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce }),
    });
    emitStatus = r.status;
    await r.text();
  } catch { emitStatus = 'error'; }
  if (emitStatus !== 200) process.stderr.write(`sse-load: level ${n}: POST /api/test/emit returned ${emitStatus}\n`);

  const live = conns.filter((c) => c.open);
  await withTimeout(Promise.all(live.map((c) => Promise.race([c.ping, c.done]))), PING_TIMEOUT_MS);

  // Hold until --hold seconds after the level began.
  const remaining = o.hold * 1000 - (performance.now() - levelStart);
  if (remaining > 0) await withTimeout(Promise.all(live.map((c) => c.done)), remaining);

  const statuses = {};
  for (const c of conns) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
  const dropped = live.filter((c) => c.ended).length;

  for (const c of conns) { c.aborted = true; c.ac.abort(); }
  await withTimeout(Promise.all(conns.map((c) => c.done)), 2000);

  const first = sortNum(conns.map((c) => c.firstLineMs).filter((v) => v !== null));
  const pings = sortNum(conns.map((c) => c.pingMs).filter((v) => v !== null));
  return {
    level: n,
    opened: live.length,
    first_line_ms: { p50: pct(first, 0.5), p95: pct(first, 0.95) },
    ping_ms: { p50: pct(pings, 0.5), p95: pct(pings, 0.95), max: pings.length ? pct(pings, 1) : null },
    received: pings.length,
    dropped,
    statuses,
  };
}

function table(rows) {
  const f = (v) => (v === null ? '-' : String(v));
  const head = ['level', 'opened', 'first p50', 'first p95', 'ping p50', 'ping p95', 'ping max', 'recv/opened', 'dropped', 'statuses'];
  const body = rows.map((r) => [
    r.level, r.opened, f(r.first_line_ms.p50), f(r.first_line_ms.p95),
    f(r.ping_ms.p50), f(r.ping_ms.p95), f(r.ping_ms.max),
    `${r.received}/${r.opened}`, r.dropped,
    Object.entries(r.statuses).map(([k, v]) => `${k}:${v}`).join(' '),
  ].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [fmt(head), fmt(w.map((x) => '-'.repeat(x))), ...body.map(fmt)].join('\n');
}

const o = parseArgs(process.argv.slice(2));
const results = [];
for (let i = 0; i < o.levels.length; i++) {
  if (i > 0) await sleep(BETWEEN_LEVELS_MS);
  const r = await runLevel(o, o.levels[i]);
  results.push(r);
  if (!o.json) process.stderr.write(`sse-load: level ${r.level} done\n`);
}
process.stdout.write((o.json ? JSON.stringify(results, null, 2) : table(results)) + '\n');
process.exit(0);
