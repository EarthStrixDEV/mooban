// Cards 4-5: Bandwidth and Caching (Tabby spec 6 and 7, adapted).
import { h } from '../dom.js';
import { api, ApiError } from '../api.js';
import { median, formatBytes } from '../util.js';
import {
  card, button, note, table, kv, busy, fmt1, fmt0, forbiddenNote, tokenHeaders,
} from './common.js';

const MB = 1048576;
const CHUNK = 65536; // getRandomValues maximum
const ROUNDS = 3;

// ---------------------------------------------------------------- 4. Bandwidth

/** Random bytes made in the browser, 64 KiB at a time. */
function randomBlob(mb) {
  const chunks = [];
  for (let i = 0; i < (mb * MB) / CHUNK; i += 1) {
    const c = new Uint8Array(CHUNK);
    crypto.getRandomValues(c);
    chunks.push(c);
  }
  return new Blob(chunks, { type: 'application/octet-stream' });
}

class HttpFail extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function failFrom(res) {
  let code = `http_${res.status}`;
  try { const j = await res.json(); if (j?.error) code = j.error; } catch { /* not JSON */ }
  return new HttpFail(res.status, code);
}

/** One download: reads the stream to the end, counting bytes, keeping none. */
async function download(mb, signal) {
  const t0 = performance.now();
  const res = await fetch(`/download/${mb}`, { headers: tokenHeaders(), cache: 'no-store', signal });
  const ttfb = performance.now() - t0;
  if (!res.ok) throw await failFrom(res);
  let bytes = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
  } else {
    bytes = (await res.blob()).size;
  }
  return { bytes, ttfb, total: performance.now() - t0 };
}

async function upload(blob, signal) {
  const form = new FormData();
  form.append('file', blob, 'random.bin');
  const t0 = performance.now();
  const res = await fetch('/upload', { method: 'POST', headers: tokenHeaders(), body: form, signal });
  const ttfb = performance.now() - t0;
  if (!res.ok) throw await failFrom(res);
  await res.arrayBuffer();
  return { bytes: blob.size, ttfb, total: performance.now() - t0 };
}

const mbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;

export function mountBandwidthCard() {
  const { root, body } = card('4. Bandwidth');
  const msg = note();
  const rows = new Map(); // label -> [cells]
  const resultHost = h('div', { class: 'tresult', 'data-testid': 'test-bw-result' });
  const status = h('p', { class: 'tcard__sub', role: 'status', 'aria-live': 'polite' });
  const ctrl = new AbortController();
  const all = [];

  function paintTable() {
    resultHost.replaceChildren(rows.size
      ? table(['การทดสอบ', 'ความเร็ว (Mbps)', 'TTFB (ms)', 'เวลารวม (ms)'], [...rows.values()], { caption: 'ผล Bandwidth' })
      : h('p', { class: 'tcard__sub' }, 'ยังไม่มีผล'));
  }
  paintTable();

  function fail(err, label) {
    if (err?.name === 'AbortError') return;
    if (err instanceof HttpFail && err.status === 403) msg.show(forbiddenNote());
    else if (err instanceof HttpFail) msg.show(`${label} ถูกปฏิเสธ (${err.status} ${err.code})`);
    else msg.show(`${label} ไม่สำเร็จ (ข้อผิดพลาดเครือข่าย)`);
  }

  async function runSize(kind, mb) {
    const label = `${kind === 'down' ? 'Download' : 'Upload'} ${mb} MB`;
    msg.clear();
    await busy(all, async () => {
      const done = [];
      try {
        const blob = kind === 'up' ? randomBlob(mb) : null;
        for (let i = 0; i < ROUNDS; i += 1) {
          status.textContent = `${label}: รอบ ${i + 1} / ${ROUNDS}`;
          done.push(kind === 'down' ? await download(mb, ctrl.signal) : await upload(blob, ctrl.signal));
        }
        rows.set(label, [
          label,
          fmt1(median(done.map((d) => mbps(d.bytes, d.total)))),
          fmt0(median(done.map((d) => d.ttfb))),
          fmt0(median(done.map((d) => d.total))),
        ]);
        paintTable();
      } catch (err) {
        fail(err, label);
      } finally {
        status.textContent = '';
      }
    });
  }

  // 5 x 10 MB at once: aggregate = all bytes / wall time.
  async function runParallel() {
    const label = '5 พร้อมกัน (5 × 10 MB)';
    msg.clear();
    await busy(all, async () => {
      status.textContent = `${label}: กำลังดาวน์โหลด…`;
      try {
        const t0 = performance.now();
        const res = await Promise.all(Array.from({ length: 5 }, () => download(10, ctrl.signal)));
        const wall = performance.now() - t0;
        const bytes = res.reduce((a, r) => a + r.bytes, 0);
        rows.set(label, [label, fmt1(mbps(bytes, wall)), fmt0(median(res.map((r) => r.ttfb))), fmt0(wall)]);
        paintTable();
      } catch (err) {
        fail(err, label);
      } finally {
        status.textContent = '';
      }
    });
  }

  const sizes = [1, 10, 100];
  const mk = (label, fn, testid) => { const b = button(label, fn, { variant: 'secondary', testid }); all.push(b); return b; };
  body.append(
    h('p', { class: 'tcard__sub' }, 'แต่ละขนาดรัน 3 รอบ แสดงค่ามัธยฐาน · ชุดเต็มใช้ข้อมูลราว 716 MB ต่อ stack ตรวจโควตา bandwidth ก่อนเริ่ม'),
    h('div', { class: 'trow', role: 'group', 'aria-label': 'Download' },
      sizes.map((mb) => mk(`Download ${mb} MB`, () => runSize('down', mb), `test-bw-down-${mb}`))),
    h('div', { class: 'trow', role: 'group', 'aria-label': 'Upload' },
      sizes.map((mb) => mk(`Upload ${mb} MB`, () => runSize('up', mb), `test-bw-up-${mb}`))),
    h('div', { class: 'trow' }, mk('5 พร้อมกัน', runParallel, 'test-bw-parallel')),
    status, msg.el, resultHost);

  return { root, destroy() { ctrl.abort(); } };
}

// ---------------------------------------------------------------- 5. Caching

const abs = (path) => new URL(path, location.href).href;

/** Resource Timing entries for `path` made since the last clear; fetch() entries land a tick late. */
async function timingFor(path) {
  await new Promise((r) => { setTimeout(r, 30); });
  return performance.getEntriesByName(abs(path));
}

// Chosen heuristic: a Resource Timing entry with transferSize === 0 and a non-empty body was
// served from the browser cache (same-origin, so the sizes are exposed).
const fromCache = (e) => e && e.transferSize === 0 && e.decodedBodySize > 0;

async function getText(path, init = {}) {
  const res = await fetch(path, init);
  const text = await res.text();
  return { res, text };
}

const verdict = (kind, text) => h('span', { class: `tverdict tverdict--${kind}` }, kind === 'pass' ? '✓ ผ่าน' : kind === 'fail' ? '✗ ไม่ผ่าน' : 'ℹ ข้อมูล', ` · ${text}`);

const CHECKS = [
  {
    id: 'browser',
    title: 'Browser cache',
    how: 'เปิด /cache/static สองครั้งติดกัน ครั้งที่สองควรมาจาก cache (วัดจาก Resource Timing: transferSize = 0)',
    async run() {
      performance.clearResourceTimings();
      const a = await getText('/cache/static');
      await getText('/cache/static');
      const [e1, e2] = (await timingFor('/cache/static')).slice(-2);
      const known = !!e1 && !!e2;
      const hit = fromCache(e2);
      return {
        rows: [
          ['ETag', a.res.headers.get('ETag') ?? '—'],
          ['Cache-Control', a.res.headers.get('Cache-Control') ?? '—'],
          ['ครั้งที่ 1', known ? (fromCache(e1) ? 'จาก browser cache' : `จากเครือข่าย (${formatBytes(e1.transferSize)})`) : 'ไม่พบ Resource Timing'],
          ['ครั้งที่ 2', known ? (hit ? 'จาก browser cache' : `จากเครือข่าย (${formatBytes(e2.transferSize)})`) : 'ไม่พบ Resource Timing'],
        ],
        verdict: !known ? verdict('info', 'อ่าน Resource Timing ไม่ได้') : hit ? verdict('pass', 'ครั้งที่สองมาจาก cache ไม่ยิงไป server') : verdict('fail', 'ครั้งที่สองยิงไป server'),
      };
    },
  },
  {
    id: 'conditional',
    title: 'Conditional request',
    how: 'ส่ง If-None-Match ด้วย ETag ของ /cache/static ควรได้ 304 และไม่มี body',
    async run() {
      const first = await fetch('/cache/static', { cache: 'reload' });
      await first.arrayBuffer();
      const etag = first.headers.get('ETag');
      if (!etag) return { rows: [['ETag', '—']], verdict: verdict('fail', 'ไม่มี ETag ใน response') };
      const res = await fetch('/cache/static', { headers: { 'If-None-Match': etag } });
      const text = await res.text();
      return {
        rows: [['If-None-Match', etag], ['สถานะ', String(res.status)], ['ขนาด body', `${text.length} B`]],
        verdict: res.status === 304 && text.length === 0 ? verdict('pass', '304 ไม่มี body') : verdict('fail', `ได้ ${res.status}`),
      };
    },
  },
  {
    id: 'nostore',
    title: 'no-store',
    how: 'เปิด /cache/none สองครั้ง ทุกครั้งควรยิงไป server',
    async run() {
      performance.clearResourceTimings();
      const a = await getText('/cache/none');
      await getText('/cache/none');
      const [e1, e2] = (await timingFor('/cache/none')).slice(-2);
      const known = !!e1 && !!e2;
      const bothNet = known && !fromCache(e1) && !fromCache(e2);
      return {
        rows: [
          ['Cache-Control', a.res.headers.get('Cache-Control') ?? '—'],
          ['ครั้งที่ 1', known ? (fromCache(e1) ? 'จาก browser cache' : 'จากเครือข่าย') : 'ไม่พบ Resource Timing'],
          ['ครั้งที่ 2', known ? (fromCache(e2) ? 'จาก browser cache' : 'จากเครือข่าย') : 'ไม่พบ Resource Timing'],
        ],
        verdict: !known ? verdict('info', 'อ่าน Resource Timing ไม่ได้') : bothNet ? verdict('pass', 'ทุกครั้งยิงไป server') : verdict('fail', 'มีครั้งที่มาจาก cache'),
      };
    },
  },
  {
    id: 'servertime',
    title: 'Cache ฝั่ง server / proxy',
    how: 'เรียก /cache/time สองครั้งห่างกันไม่เกิน 1 วินาที (ข้าม browser cache) แล้วเทียบ unix_ms',
    async run() {
      const a = await (await fetch('/cache/time', { cache: 'no-store' })).json();
      const b = await (await fetch('/cache/time', { cache: 'no-store' })).json();
      const same = a.unix_ms === b.unix_ms;
      return {
        rows: [['unix_ms ครั้งที่ 1', String(a.unix_ms)], ['unix_ms ครั้งที่ 2', String(b.unix_ms)], ['ต่างกัน', `${b.unix_ms - a.unix_ms} ms`]],
        verdict: same ? verdict('info', 'ค่าเท่ากัน = มี cache ฝั่ง server หรือ proxy') : verdict('info', 'ค่าต่างกัน = ไม่มี cache (จดไว้เป็นผล ไม่ถือว่าผิด)'),
      };
    },
  },
  {
    id: 'gzip',
    title: 'Compression',
    how: 'ดึง /cache/gzip (204,800 byte) ควรมี Content-Encoding เป็น gzip หรือ br และขนาดที่รับน้อยกว่า 25%',
    async run() {
      performance.clearResourceTimings();
      const { res, text } = await getText('/cache/gzip', { cache: 'reload' });
      const [e] = (await timingFor('/cache/gzip')).slice(-1);
      const enc = res.headers.get('Content-Encoding');
      const decoded = e?.decodedBodySize || text.length;
      const encoded = e?.encodedBodySize ?? null;
      const ratio = encoded === null ? null : (encoded / decoded) * 100;
      const ok = !!enc && ratio !== null && ratio < 25;
      return {
        rows: [
          ['Content-Encoding', enc ?? 'ไม่มี'],
          ['ขนาดที่รับ (encoded)', encoded === null ? '—' : formatBytes(encoded)],
          ['ขนาดจริง (decoded)', formatBytes(decoded)],
          ['สัดส่วน', ratio === null ? '—' : `${fmt1(ratio)}%`],
        ],
        verdict: ok ? verdict('pass', 'บีบอัดแล้วเหลือน้อยกว่า 25%') : verdict('fail', enc ? 'บีบอัดแต่ยังไม่ถึงเกณฑ์ 25%' : 'ไม่มี Content-Encoding'),
      };
    },
  },
  {
    id: 'appcache',
    title: 'App-level cache',
    how: 'เรียก /api/stats สองครั้งใน 10 วินาที คาดหวัง MISS แล้ว HIT (ถ้าเริ่มที่ HIT แสดงว่า cache ยังไม่หมดอายุ)',
    async run() {
      const a = await fetch('/api/stats', { cache: 'no-store' });
      await a.arrayBuffer();
      const b = await fetch('/api/stats', { cache: 'no-store' });
      await b.arrayBuffer();
      const x = a.headers.get('X-App-Cache');
      const y = b.headers.get('X-App-Cache');
      return {
        rows: [['X-App-Cache ครั้งที่ 1', x ?? '—'], ['X-App-Cache ครั้งที่ 2', y ?? '—']],
        verdict: y === 'HIT' ? verdict('pass', x === 'MISS' ? 'MISS แล้ว HIT ตามคาด' : 'ครั้งที่สองเป็น HIT (ครั้งแรก cache ยังอยู่)') : verdict('fail', 'ครั้งที่สองไม่ใช่ HIT'),
      };
    },
  },
  {
    id: 'static',
    title: 'ไฟล์ static',
    how: 'ดู header ของ app.js และ style.css ควรมี ETag หรือ Last-Modified (จด Cache-Control ที่ server ให้มา)',
    async run() {
      const rows = [];
      let ok = true;
      for (const path of ['/app.js', '/style.css']) {
        const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
        const etag = res.headers.get('ETag');
        const lm = res.headers.get('Last-Modified');
        ok = ok && (!!etag || !!lm);
        rows.push([`${path} ETag`, etag ?? '—'], [`${path} Last-Modified`, lm ?? '—'], [`${path} Cache-Control`, res.headers.get('Cache-Control') ?? '—']);
      }
      return { rows, verdict: ok ? verdict('pass', 'มี ETag หรือ Last-Modified') : verdict('fail', 'ไม่มีทั้ง ETag และ Last-Modified') };
    },
  },
];

export function mountCachingCard() {
  const { root, body } = card('5. Caching');
  const msg = note();
  const buttons = [];

  const checkEl = (c) => {
    const out = h('div', { class: 'check__out', role: 'status', 'aria-live': 'polite', 'data-testid': `test-cache-${c.id}` });
    const run = button('ทดสอบ', async () => {
      msg.clear();
      await busy(buttons, async () => {
        out.replaceChildren(h('p', { class: 'tcard__sub' }, 'กำลังทดสอบ…'));
        try {
          const r = await c.run();
          out.replaceChildren(kv(r.rows), h('p', { class: 'check__verdict' }, r.verdict));
        } catch {
          out.replaceChildren(h('p', { class: 'tnote', 'data-kind': 'err' }, 'ทดสอบไม่สำเร็จ (ข้อผิดพลาดเครือข่าย)'));
        }
      });
    }, { variant: 'secondary', testid: `test-cache-run-${c.id}` });
    run.setAttribute('aria-label', `ทดสอบ ${c.title}`);
    buttons.push(run);
    return h('div', { class: 'check' },
      h('div', { class: 'check__head' }, h('h3', { class: 'tcard__h3' }, c.title), run),
      h('p', { class: 'tcard__sub' }, c.how), out);
  };

  // app-level cache counters and reset (guarded)
  const statsOut = h('div', { class: 'check__out', role: 'status', 'aria-live': 'polite', 'data-testid': 'test-cache-stats' });
  async function showStats() {
    const s = await api('GET', '/api/cache-stats', { auth: false });
    statsOut.replaceChildren(kv([['hit', String(s.hits)], ['miss', String(s.misses)]]));
  }
  const statsBtn = button('ดู cache-stats', async () => {
    msg.clear();
    await busy(buttons, async () => {
      try { await showStats(); } catch { msg.show('ดู cache-stats ไม่สำเร็จ'); }
    });
  }, { variant: 'secondary', testid: 'test-cache-run-stats' });
  const clearBtn = button('ล้าง cache', async () => {
    msg.clear();
    await busy(buttons, async () => {
      try {
        await api('DELETE', '/api/cache', { auth: false, headers: tokenHeaders() });
        await showStats();
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) msg.show(forbiddenNote());
        else msg.show('ล้าง cache ไม่สำเร็จ');
      }
    });
  }, { variant: 'outline', testid: 'test-cache-clear' });
  buttons.push(statsBtn, clearBtn);

  body.append(
    ...CHECKS.map(checkEl),
    h('div', { class: 'check' },
      h('div', { class: 'check__head' }, h('h3', { class: 'tcard__h3' }, 'ตัวนับ app-level cache'), statsBtn, clearBtn),
      h('p', { class: 'tcard__sub' }, 'GET /api/cache-stats · ล้างด้วย DELETE /api/cache (ต้องมี Test token)'), statsOut),
    msg.el);

  return { root, destroy() {} };
}
