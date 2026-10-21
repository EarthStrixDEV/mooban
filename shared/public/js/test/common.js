// Shared bits of the /test page: the in-memory test token and the one card/tile/table style.
import { h } from '../dom.js';
import { ApiError } from '../api.js';

// Spec 12: the token lives only in this variable. Never localStorage, sessionStorage or the URL.
let testToken = '';
export const getTestToken = () => testToken;
export const setTestToken = (v) => { testToken = String(v); };
export const tokenHeaders = () => (testToken ? { 'X-Test-Token': testToken } : {});

export const WIDE = '(min-width: 720px)';

export const isForbidden = (err) => err instanceof ApiError && err.status === 403;

/** Inline 403 message for a card. */
export function forbiddenNote() {
  return h('span', null, 'Test token ไม่ถูกต้อง', h('span', { class: 'tnote__code' }, ' (403 forbidden)'));
}

export const fmt1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—');
export const fmt0 = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '—');

let cardSeq = 0;

/** Numbered card: <section> with an h2 (and an optional element beside it, as on the boards). Returns {root, body}. */
export function card(title, { span, testid, aside } = {}) {
  const id = `tcard-${++cardSeq}`;
  const body = h('div', { class: 'tcard__body' });
  const heading = h('h2', { id, class: 'tcard__title' }, title);
  const root = h('section', {
    class: `card tcard${span ? ` tcard--${span}` : ''}`, 'aria-labelledby': id, 'data-testid': testid,
  }, aside ? h('div', { class: 'tcard__head' }, heading, aside) : heading, body);
  return { root, body };
}

export const button = (label, onclick, { variant = 'primary', testid, type = 'button' } = {}) =>
  h('button', {
    type, class: `btn btn--${variant} tbtn`, 'data-testid': testid, onclick,
  }, label);

/** Status pill: dot + text. */
export function pill(text, state = 'idle', { testid } = {}) {
  const el = h('p', { class: 'tpill', role: 'status', 'data-state': state, 'data-testid': testid });
  const set = (t, s) => {
    el.dataset.state = s;
    el.replaceChildren(h('span', { class: 'live-dot', 'aria-hidden': 'true' }), t);
  };
  set(text, state);
  return { el, set };
}

/** One stat tile: small label above, big value below. */
export function tile(label, value, { desktop } = {}) {
  const valueEl = h('dd', { class: 'ttile__v' }, value);
  const el = h('div', { class: 'ttile' }, h('dt', { class: 'ttile__k' }, label), valueEl);
  return { el, valueEl, desktop };
}

/** Tile grid (a <dl>). */
export const tiles = (list) => h('dl', { class: 'ttiles' }, list.map((t) => t.el ?? t));

/** Labelled values: dt (sub) / dd (600). Rows: [label, value]. */
export function kv(rows) {
  return h('dl', { class: 'tkv' }, rows.map(([k, v]) => h('div', { class: 'tkv__row' }, h('dt', null, k), h('dd', null, v))));
}

/** Table with <th scope="col"> headers. */
export function table(columns, rows, { caption, testid } = {}) {
  return h('div', { class: 'ttable-wrap' },
    h('table', { class: 'ttable', 'data-testid': testid },
      caption ? h('caption', { class: 'sr-only' }, caption) : null,
      h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
}

/** Inline message area (alert) inside a card. */
export function note() {
  const el = h('p', { class: 'tnote', role: 'alert', hidden: true });
  return {
    el,
    show(content, kind = 'err') {
      el.dataset.kind = kind;
      el.replaceChildren(content);
      el.hidden = false;
    },
    clear() { el.hidden = true; el.replaceChildren(); },
  };
}

/** Disables buttons while `fn` runs; always re-enables. */
export async function busy(buttons, fn) {
  buttons.forEach((b) => { b.disabled = true; });
  try { return await fn(); } finally { buttons.forEach((b) => { b.disabled = false; }); }
}

export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** `app;dur=12.3` from a Server-Timing header, or null. */
export function serverTimingApp(value) {
  const m = /(?:^|,)\s*app\s*;(?:[^,]*;)?\s*dur=([\d.]+)/i.exec(value ?? '');
  return m ? Number(m[1]) : null;
}
