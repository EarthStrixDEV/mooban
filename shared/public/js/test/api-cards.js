// Cards 6-7: API request / load test (Tabby spec 8, Mooban spec 8) and seed controls.
import { h } from '../dom.js';
import { api, ApiError } from '../api.js';
import { median, percentile } from '../util.js';
import {
  card, button, note, kv, tiles, tile, busy, fmt1, forbiddenNote, tokenHeaders, serverTimingApp,
} from './common.js';

const ENDPOINTS = ['/api/ping', '/api/ping?db=1', '/api/posts?limit=20', '/api/stats', '/api/slow?ms=200', '/api/limited'];
const MAX_TOTAL = 1000;
const MAX_CONC = 50;
const dash = '—';

/** fetch + full body + timing; status 0 means a network failure. */
async function timed(path, init = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(path, { cache: 'no-store', ...init, headers: { ...tokenHeaders(), ...(init.headers ?? {}) } });
    const text = await res.text();
    return {
      status: res.status, ms: performance.now() - t0, text, app: serverTimingApp(res.headers.get('Server-Timing')),
    };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { status: 0, ms: performance.now() - t0, text: '', app: null };
  }
}

const json = (r) => { try { return JSON.parse(r.text); } catch { return {}; } };

function field(id, label, input) {
  return h('div', { class: 'tfield' }, h('label', { class: 'tfield__label', for: id }, label), input);
}

function numberInput(id, value, min, max, testid) {
  return h('input', { id, class: 'tfield__input', type: 'number', inputmode: 'numeric', min, max, step: 1, value, 'data-testid': testid });
}

function inRange(input, min, max) {
  const n = Number(input.value);
  return input.value !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// ---------------------------------------------------------------- 6. API request / load test

export function mountApiCard() {
  const { root, body } = card('6. API Request / Load test');
  const ctrl = new AbortController();
  const msg = note();

  // --- ping + echo
  const pingOut = h('div', { class: 'check__out', role: 'status', 'aria-live': 'polite', 'data-testid': 'test-ping-result' });
  const echoOut = h('div', { class: 'check__out', role: 'status', 'aria-live': 'polite', 'data-testid': 'test-echo-result' });
  const small = [];

  const quiet = (fn) => async () => { try { await fn(); } catch (e) { if (e?.name !== 'AbortError') throw e; } };
  const pingBtn = button('วัด ping', quiet(() => busy(small, async () => {
    const plain = await timed('/api/ping', { signal: ctrl.signal });
    const withDb = await timed('/api/ping?db=1', { signal: ctrl.signal });
    const dbj = json(withDb);
    const line = (r) => (r.status === 200 ? `${fmt1(r.ms)} ms${r.app === null ? '' : ` · app ${fmt1(r.app)} ms`}` : `ผิดพลาด (${r.status || 'network'})`);
    pingOut.replaceChildren(kv([
      ['/api/ping', line(plain)],
      ['/api/ping?db=1', line(withDb)],
      ['db_ms', dbj.db_ms === undefined ? dash : `${dbj.db_ms} ms`],
      ['stack', json(plain).stack ?? dash],
    ]));
  })), { variant: 'secondary', testid: 'test-ping-run' });

  const echoBtn = button('เรียก /api/echo', quiet(() => busy(small, async () => {
    const r = await timed('/api/echo?from=test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hello: 'mooban' }), signal: ctrl.signal,
    });
    if (r.status !== 200) { echoOut.replaceChildren(h('p', { class: 'tnote', 'data-kind': 'err' }, `/api/echo ผิดพลาด (${r.status || 'network'})`)); return; }
    const j = json(r);
    const hdr = (name) => {
      const k = Object.keys(j.headers ?? {}).find((x) => x.toLowerCase() === name.toLowerCase());
      return k ? String(j.headers[k]) : dash;
    };
    echoOut.replaceChildren(kv([
      ['client_ip', j.client_ip ?? dash],
      ['protocol', j.protocol ?? dash],
      ['method', j.method ?? dash],
      ['Host', hdr('Host')],
      ['X-Forwarded-For', hdr('X-Forwarded-For')],
      ['X-Forwarded-Proto', hdr('X-Forwarded-Proto')],
      ['X-Real-IP', hdr('X-Real-IP')],
    ]));
  })), { variant: 'secondary', testid: 'test-echo-run' });
  small.push(pingBtn, echoBtn);

  // --- load test
  const select = h('select', { id: 'lt-endpoint', class: 'tfield__input', 'data-testid': 'test-load-endpoint' },
    ENDPOINTS.map((p) => h('option', { value: p }, p)));
  const total = numberInput('lt-total', 100, 1, MAX_TOTAL, 'test-load-total');
  const conc = numberInput('lt-conc', 10, 1, MAX_CONC, 'test-load-conc');
  const progress = h('p', { class: 'tcard__sub', role: 'status', 'aria-live': 'polite' });
  const result = h('div', { class: 'tresult', 'data-testid': 'test-load-result', hidden: true });
  const lmsg = note();

  async function runLoad() {
    lmsg.clear();
    const n = inRange(total, 1, MAX_TOTAL);
    const c = inRange(conc, 1, MAX_CONC);
    if (n === null || c === null) {
      lmsg.show(`จำนวน request ต้องอยู่ระหว่าง 1–${MAX_TOTAL} และ concurrency ต้องอยู่ระหว่าง 1–${MAX_CONC}`);
      return;
    }
    const path = select.value;
    await busy([start], async () => {
      const lat = [];
      const apps = [];
      let ok = 0;
      let lastPaint = 0;
      const errors = new Map();
      let next = 0;
      let done = 0;
      const t0 = performance.now();
      const worker = async () => {
        while (next < n) {
          next += 1;
          const r = await timed(path, { signal: ctrl.signal });
          // Every completed HTTP response counts toward latency; only network failures (status 0) do not.
          if (r.status !== 0) {
            lat.push(r.ms);
            if (r.app !== null) apps.push(r.app);
          }
          if (r.status >= 200 && r.status < 300) ok += 1;
          else errors.set(r.status === 0 ? 'network' : String(r.status), (errors.get(r.status === 0 ? 'network' : String(r.status)) ?? 0) + 1);
          done += 1;
          const now = performance.now();
          if (now - lastPaint >= 500) { lastPaint = now; progress.textContent = `ส่งแล้ว ${done} / ${n}`; }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(c, n) }, worker));
      } catch (e) {
        if (e?.name === 'AbortError') return;
        throw e;
      }
      const wall = (performance.now() - t0) / 1000;
      progress.textContent = '';
      if (!ctrl.signal.aborted) paintLoad({ n, ok, lat, apps, errors, wall });
    });
  }

  const ms = (v) => (Number.isFinite(v) ? `${fmt1(v)} ms` : dash);

  function paintLoad({ n, ok, lat, apps, errors, wall }) {
    result.dataset.samples = String(lat.length);
    const errTotal = [...errors.values()].reduce((a, b) => a + b, 0);
    if (errors.has('403')) lmsg.show(forbiddenNote());
    const errList = errors.size
      ? h('ul', { class: 'terr' }, [...errors].sort((a, b) => b[1] - a[1]).map(([k, v]) => h('li', null, `${k} × ${v}`)))
      : h('span', null, 'ไม่มี');
    result.replaceChildren(
      tiles([
        tile('สำเร็จ', `${ok} / ${n}`),
        tile('ข้อผิดพลาด', h('span', null, String(errTotal))),
        tile('เฉลี่ย', ms(lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : NaN)),
        tile('มัธยฐาน', ms(lat.length ? median(lat) : NaN)),
        tile('p95', ms(lat.length ? percentile(lat, 0.95) : NaN)),
        tile('สูงสุด', ms(lat.length ? Math.max(...lat) : NaN)),
        tile('request/วินาที', fmt1(n / wall)),
        tile('Server-Timing (app) เฉลี่ย', ms(apps.length ? apps.reduce((a, b) => a + b, 0) / apps.length : NaN)),
      ]),
      kv([['error ตาม status', errList]]),
      h('p', { class: 'tcard__sub' }, 'ความหน่วงคิดจากทุกคำขอที่ได้รับคำตอบ (ไม่นับข้อผิดพลาดเครือข่าย) · p95 = ค่าลำดับที่ ceil(0.95 × N) หลังเรียงจากน้อยไปมาก'));
    result.hidden = false;
  }

  const start = button('เริ่ม Load test', runLoad, { testid: 'test-load-start' });

  body.append(
    h('h3', { class: 'tcard__h3' }, 'ping และ echo'),
    h('div', { class: 'trow' }, pingBtn, echoBtn), pingOut, echoOut,
    h('h3', { class: 'tcard__h3' }, 'Load test'),
    h('div', { class: 'tform' },
      field('lt-endpoint', 'Endpoint', select),
      field('lt-total', `จำนวน request (1–${MAX_TOTAL})`, total),
      field('lt-conc', `Concurrency (1–${MAX_CONC})`, conc)),
    h('p', { class: 'tcard__sub' }, 'Browser จำกัดราว 6 connection ต่อ host (HTTP/1.1) ค่า concurrency ที่สูงกว่านั้นจึงเป็นการต่อคิวในฝั่ง browser ถ้าต้องการ concurrency จริง ให้ใช้ hey หรือ ab จากภายนอก'),
    h('div', { class: 'trow' }, start), progress, lmsg.el, result, msg.el);

  return { root, destroy() { ctrl.abort(); } };
}

// ---------------------------------------------------------------- 7. Seed

export function mountSeedCard() {
  const { root, body } = card('7. ข้อมูล seed');
  const ctrl = new AbortController();
  const msg = note();
  const users = numberInput('seed-users', 20, 1, 100, 'test-seed-users');
  const posts = numberInput('seed-posts', 500, 0, 5000, 'test-seed-posts');
  const images = numberInput('seed-images', 30, 0, 200, 'test-seed-images');
  const reset = h('input', { id: 'seed-reset', type: 'checkbox', class: 'tcheck__box', 'data-testid': 'test-seed-reset' });
  const out = h('div', { class: 'tresult', role: 'status', 'aria-live': 'polite', 'data-testid': 'test-seed-result', hidden: true });
  const buttons = [];

  async function call(method, path, labels) {
    msg.clear();
    await busy(buttons, async () => {
      try {
        const r = await api(method, path, { auth: false, headers: tokenHeaders(), signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        out.replaceChildren(kv(labels.map(([key, label, unit]) => [`${label} (${key})`, r?.[key] === undefined ? dash : `${r[key]}${unit ?? ''}`])));
        out.hidden = false;
      } catch (err) {
        if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
        if (err instanceof ApiError && err.status === 403) msg.show(forbiddenNote());
        else if (err instanceof ApiError) msg.show(`ไม่สำเร็จ (${err.status} ${err.code})`);
        else msg.show('ไม่สำเร็จ (ข้อผิดพลาดเครือข่าย)');
      }
    });
  }

  const seedBtn = button('สร้างข้อมูล seed', () => {
    const u = inRange(users, 1, 100);
    const p = inRange(posts, 0, 5000);
    const i = inRange(images, 0, 200);
    if (u === null || p === null || i === null) { msg.show('users 1–100, posts 0–5,000, images 0–200'); return Promise.resolve(); }
    if (i > p) { msg.show('จำนวนรูปต้องไม่เกินจำนวนโพสต์'); return Promise.resolve(); }
    const q = new URLSearchParams({ users: u, posts: p, images: i });
    if (reset.checked) q.set('reset', '1');
    return call('POST', `/api/test/seed?${q}`, [['users', 'ผู้ใช้'], ['posts', 'โพสต์'], ['images', 'รูป'], ['duration_ms', 'ใช้เวลา', ' ms']]);
  }, { testid: 'test-seed-run' });
  const delBtn = button('ลบข้อมูล seed', () => call('DELETE', '/api/test/seed',
    [['deleted_users', 'ผู้ใช้ที่ลบ'], ['deleted_posts', 'โพสต์ที่ลบ'], ['deleted_images', 'รูปที่ลบ']]),
  { variant: 'outline', testid: 'test-seed-delete' });
  const orphBtn = button('ตรวจไฟล์รูปค้าง', () => call('GET', '/api/test/orphans',
    [['orphan_dirs', 'โฟลเดอร์ค้าง'], ['missing_files', 'ไฟล์ที่หาย']]),
  { variant: 'secondary', testid: 'test-orphans-run' });
  buttons.push(seedBtn, delBtn, orphBtn);

  body.append(
    h('div', { class: 'tform' },
      field('seed-users', 'ผู้ใช้ (users 1–100)', users),
      field('seed-posts', 'โพสต์ (posts 0–5,000)', posts),
      field('seed-images', 'รูป (images 0–200 ไม่เกินจำนวนโพสต์)', images)),
    h('label', { class: 'tcheck', for: 'seed-reset' }, reset, 'ลบข้อมูล seed เดิมก่อน (reset)'),
    h('div', { class: 'trow' }, seedBtn, delBtn, orphBtn),
    msg.el, out);

  return { root, destroy() { ctrl.abort(); } };
}
