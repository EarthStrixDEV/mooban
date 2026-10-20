// Toasts: role=status for info, role=alert for errors.
import { h } from '../dom.js';

const MAX = 3;
const OK_MS = 4000;
const ERR_MS = 6000;

let root = null;
let polite = null;
let alerts = null;
const live = [];

function ensureRoot() {
  if (root && root.isConnected) return;
  polite = h('div', { class: 'toasts__list' });
  alerts = h('div', { class: 'toasts__list' });
  root = h('div', { class: 'toasts', 'data-dialog-ignore': '' }, polite, alerts);
  document.body.append(root);
}

function remove(entry) {
  if (entry.gone) return;
  entry.gone = true;
  clearTimeout(entry.timer);
  entry.el.remove();
  const i = live.indexOf(entry);
  if (i !== -1) live.splice(i, 1);
}

export function toast(message, { error = false } = {}) {
  ensureRoot();
  const duration = error ? ERR_MS : OK_MS;
  const entry = { gone: false, timer: 0, left: duration, started: 0, hovered: false, focused: false };

  const start = () => {
    clearTimeout(entry.timer);
    entry.started = Date.now();
    entry.timer = setTimeout(() => remove(entry), entry.left);
  };
  const pause = () => {
    clearTimeout(entry.timer);
    entry.left = Math.max(0, entry.left - (Date.now() - entry.started));
  };
  const maybeResume = () => { if (!entry.hovered && !entry.focused) start(); };

  const el = h('div', {
    class: error ? 'toast toast--error' : 'toast',
    role: error ? 'alert' : 'status',
    'aria-live': error ? 'assertive' : 'polite',
    'data-testid': 'toast',
  },
    h('p', { class: 'toast__msg' }, message),
    h('button', { class: 'toast__close', type: 'button', onclick: () => remove(entry) }, 'ปิด'));
  entry.el = el;

  el.addEventListener('mouseenter', () => { if (!entry.hovered && !entry.focused) pause(); entry.hovered = true; });
  el.addEventListener('mouseleave', () => { entry.hovered = false; maybeResume(); });
  el.addEventListener('focusin', () => { if (!entry.hovered && !entry.focused) pause(); entry.focused = true; });
  el.addEventListener('focusout', (e) => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    entry.focused = false;
    maybeResume();
  });

  (error ? alerts : polite).append(el);
  live.push(entry);
  while (live.length > MAX) remove(live[0]);
  start();
}
