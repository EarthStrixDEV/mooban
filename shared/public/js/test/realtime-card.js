// Card 2: SSE stream status, event log and latency measurement (Spec 8, DESIGN 4.13).
import { h } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state, on } from '../store.js';
import { sse } from '../sse.js';
import { median, percentile } from '../util.js';
import { lineChart, rawValues } from '../ui/charts.js';
import { card, pill, tile, tiles, button, note, forbiddenNote, isForbidden, tokenHeaders, fmt0 } from './common.js';

const ROUNDS = 10;
const TIMEOUT_MS = 5000;
const LOG_MAX = 50;
const TYPES = [
  'post.created', 'post.updated', 'post.deleted', 'like.changed',
  'comment.created', 'comment.deleted', 'resync', 'test.ping',
];
const STATUS = {
  connecting: 'กำลังเชื่อมต่อ…',
  open: 'เชื่อมต่อแล้ว',
  reconnecting: 'เชื่อมต่อใหม่…',
  blocked: 'เชื่อมต่อสดไม่ได้ (มีการเชื่อมต่อมากเกินไป)',
};

const pad = (n) => String(n).padStart(2, '0');
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const randomNonce = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export function mountRealtimeCard() {
  const { root, body } = card('2. ความหน่วง Realtime (SSE)');
  const status = pill('', 'connecting', { testid: 'test-sse-status' });
  const closedNote = h('p', { class: 'tcard__sub', hidden: true }, 'ยังไม่ได้เชื่อมต่อสตรีม');
  const start = button('วัด latency 10 ครั้ง', measure, { testid: 'test-sse-start' });
  const progress = h('p', { class: 'tcard__sub', role: 'status', 'aria-live': 'polite' });
  const msg = note();
  const stats = h('div', { class: 'tresult', 'data-testid': 'test-sse-stats', hidden: true });
  const chartHost = h('div', { class: 'tchart' });
  const log = h('ol', { class: 'tlog', tabindex: '0', 'data-testid': 'test-sse-log', 'aria-label': 'บันทึกเหตุการณ์จากสตรีม' });
  const logEmpty = h('p', { class: 'tcard__sub' }, 'ยังไม่มีเหตุการณ์');

  body.append(
    h('div', { class: 'trow' }, status.el, start),
    closedNote, progress, msg.el, stats, chartHost,
    h('h3', { class: 'tcard__h3' }, 'บันทึกเหตุการณ์'), logEmpty, log);

  const ctrl = new AbortController();
  let running = false;
  let gone = false;
  const paintStatus = (s = sse.status) => {
    status.set(STATUS[s] ?? STATUS.connecting, s);
    closedNote.hidden = s === 'open';
    start.disabled = s !== 'open' || running;
  };
  paintStatus();
  const offStatus = on('sse-status', paintStatus);

  // Waiters for test.ping, keyed by nonce.
  const waiters = new Map();
  const offs = TYPES.map((type) => sse.on(type, (data, id) => {
    const t = performance.now();
    if (type === 'test.ping' && waiters.has(data?.nonce)) waiters.get(data.nonce)(t);
    addLog(type, id);
  }));

  function addLog(type, id) {
    logEmpty.hidden = true;
    log.prepend(h('li', null, `${clock()} · ${type} · ${id || '—'}`));
    while (log.children.length > LOG_MAX) log.lastElementChild.remove();
  }

  /** Resolves with the arrival time, or null after the timeout. Registered before the POST is sent. */
  function waitPing(nonce) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(nonce); resolve(null); }, TIMEOUT_MS);
      waiters.set(nonce, (t) => { clearTimeout(timer); waiters.delete(nonce); resolve(t); });
    });
  }

  async function measure() {
    if (running || sse.status !== 'open') return;
    running = true;
    start.disabled = true;
    msg.clear();
    const values = [];
    let dropped = 0;
    let rounds = 0;
    try {
      for (let i = 0; i < ROUNDS && !gone; i += 1) {
        if (gone) break;
        progress.textContent = `กำลังวัด… ${i + 1} / ${ROUNDS}`;
        const nonce = randomNonce();
        const pending = waitPing(nonce);
        const t0 = performance.now();
        try {
          await api('POST', '/api/test/emit', { json: { nonce }, auth: false, headers: tokenHeaders(), signal: ctrl.signal });
        } catch (err) {
          waiters.delete(nonce);
          if (gone || err?.name === 'AbortError') break;
          if (isForbidden(err)) msg.show(forbiddenNote());
          else msg.show(`ส่ง event ไม่สำเร็จ (${err instanceof ApiError ? `${err.status} ${err.code}` : 'network'})`);
          break;
        }
        const arrived = await pending;
        rounds += 1;
        if (arrived === null) dropped += 1;
        else values.push(Math.round((arrived - t0) * 10) / 10);
      }
    } finally {
      running = false;
      if (!gone) { progress.textContent = ''; paintStatus(); }
    }
    if (gone || rounds === 0) return;
    paintResult(values, dropped, rounds);
  }

  function paintResult(values, dropped, rounds) {
    const med = values.length ? median(values) : NaN;
    const p95 = values.length ? percentile(values, 0.95) : NaN;
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
    if (values.length) state.lastLatencyMs = med;
    const pct = (dropped / rounds) * 100;
    const ms = (n) => (Number.isFinite(n) ? `${fmt0(n)} ms` : '—');

    const dropV = h('span', null, String(dropped), h('span', { class: 'only-wide' }, ` (${Math.round(pct * 10) / 10}%)`));
    stats.replaceChildren(tiles([
      tile('มัธยฐาน', ms(med)),
      tile('p95', ms(p95)),
      tile('เฉลี่ย', ms(avg)),
      tile('ตกหล่น', dropV),
    ]));
    stats.hidden = false;

    if (!values.length) { chartHost.replaceChildren(h('p', { class: 'tcard__sub' }, 'ไม่มี event ไหนมาถึงภายใน 5 วินาที')); return; }
    const label = `กราฟความหน่วง ${values.length} ครั้ง มัธยฐาน ${fmt0(med)} ms p95 ${fmt0(p95)} ms`;
    chartHost.replaceChildren(
      lineChart({ values, p50: med, p95, label }),
      h('p', { class: 'tlegend' },
        h('span', { class: 'tlegend__i tlegend__i--line' }, 'ความหน่วงแต่ละครั้ง'),
        h('span', { class: 'tlegend__i tlegend__i--p50' }, 'มัธยฐาน'),
        h('span', { class: 'tlegend__i tlegend__i--p95' }, 'p95')),
      rawValues(values));
  }

  return {
    root,
    destroy() {
      gone = true;
      ctrl.abort();
      offStatus();
      offs.forEach((off) => off());
      // release anyone still waiting for a ping so the measuring loop exits now
      for (const release of [...waiters.values()]) release(null);
      waiters.clear();
    },
  };
}
