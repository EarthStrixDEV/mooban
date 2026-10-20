// Card 3: WebSocket RTT (Node/Python only; Spec 7-8, DESIGN 4.13).
import { h } from '../dom.js';
import { barChart, rawValues } from '../ui/charts.js';
import { card, pill, button, note, sleep } from './common.js';

const PINGS = 20;
const PONG_TIMEOUT_MS = 5000;
const NO_WS = 'stack นี้ไม่รองรับ WebSocket';
const TEXT = {
  idle: 'ยังไม่เชื่อมต่อ',
  connecting: 'กำลังเชื่อมต่อ…',
  open: 'เชื่อมต่อแล้ว',
  lost: 'หลุด',
};

export function mountWsCard() {
  const { root, body } = card('3. WebSocket RTT');
  const status = pill(TEXT.idle, 'idle', { testid: 'test-ws-status' });
  const connect = button('เชื่อมต่อ', onConnect, { testid: 'test-ws-connect' });
  const ping = button('ส่ง ping', onPing, { testid: 'test-ws-ping' });
  const disc = button('ตัดการเชื่อมต่อ', onDisconnect, { variant: 'outline', testid: 'test-ws-disconnect' });
  const controls = h('div', { class: 'trow' }, connect, ping, disc);
  const summary = h('p', { class: 'tcard__sub', role: 'status', 'aria-live': 'polite', 'data-testid': 'test-ws-rtt' });
  const msg = note();
  const chartHost = h('div', { class: 'tchart' });
  body.append(status.el, controls, summary, msg.el, chartHost);

  let ws = null;
  let openedAt = 0;
  let manual = false;
  let pinging = false;
  let gone = false;
  let pong = null; // {t, resolve}
  let rtts = [];

  const sync = () => {
    const open = ws?.readyState === WebSocket.OPEN;
    connect.disabled = !!ws && ws.readyState <= WebSocket.OPEN;
    ping.disabled = !open || pinging;
    disc.disabled = !open;
  };
  sync();

  function unsupported() {
    controls.hidden = true;
    summary.hidden = true;
    status.set(NO_WS, 'unsupported');
  }

  // The PHP stacks have no WebSocket: say so up front instead of failing a handshake.
  (async () => {
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' });
      const stack = (res.headers.get('X-Stack') ?? '').toLowerCase();
      if (!gone && (stack === 'apache' || stack === 'nginx')) unsupported();
    } catch { /* unknown stack: let the user try */ }
  })();

  function onConnect() {
    msg.clear();
    manual = false;
    openedAt = 0;
    status.set(TEXT.connecting, 'connecting');
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      openedAt = Date.now();
      status.set(TEXT.open, 'open');
      sync();
    };
    sock.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m && m.type === 'pong' && pong && m.t === pong.t) pong.resolve(Date.now() - m.t);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      pong?.resolve(null);
      if (gone) return;
      if (!openedAt) {
        status.set(TEXT.idle, 'idle');
        msg.show(NO_WS, 'info');
      } else if (manual) {
        status.set(TEXT.idle, 'idle');
      } else {
        status.set(TEXT.lost, 'lost');
        msg.show(`หลุดหลังเชื่อมต่อ ${Math.round((Date.now() - openedAt) / 1000)} วินาที`, 'info');
      }
      sync();
    };
    sync();
  }

  function onDisconnect() {
    if (!ws) return;
    manual = true;
    ws.close();
  }

  function paint() {
    const last = rtts[rtts.length - 1];
    const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    summary.replaceChildren('RTT ล่าสุด ', h('strong', null, `${last} ms`), ` · เฉลี่ย ${Math.round(avg)} ms จาก ${rtts.length} ครั้ง`);
    chartHost.replaceChildren(
      h('div', { class: 'only-wide' }, barChart({ values: rtts, label: `กราฟ RTT ${rtts.length} ครั้ง ล่าสุด ${last} ms เฉลี่ย ${Math.round(avg)} ms` })),
      rawValues(rtts));
  }

  async function onPing() {
    if (!ws || ws.readyState !== WebSocket.OPEN || pinging) return;
    pinging = true;
    rtts = [];
    msg.clear();
    sync();
    try {
      for (let i = 0; i < PINGS && ws?.readyState === WebSocket.OPEN; i += 1) {
        const t = Date.now();
        const got = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), PONG_TIMEOUT_MS);
          pong = { t, resolve: (v) => { clearTimeout(timer); resolve(v); } };
        });
        ws.send(JSON.stringify({ type: 'ping', t }));
        const rtt = await got;
        pong = null;
        if (rtt === null) { if (ws) msg.show('ไม่ได้รับ pong ภายใน 5 วินาที'); break; }
        rtts.push(rtt);
        paint();
        await sleep(0);
      }
    } finally {
      pinging = false;
      sync();
    }
  }

  return {
    root,
    destroy() {
      gone = true;
      manual = true;
      ws?.close();
    },
  };
}
