// Generic modal: scrim, inert background, focus trap, Esc, focus restore, scroll lock.
// Reused by signup, lightbox, composer overlay and confirm dialogs.
import { h } from '../dom.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack = [];
let locks = 0;

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

function lockScroll() {
  if (locks++ === 0) document.body.classList.add('scroll-locked');
}

function unlockScroll() {
  if (--locks <= 0) { locks = 0; document.body.classList.remove('scroll-locked'); }
}

function onKeydown(e) {
  const top = stack[stack.length - 1];
  if (!top || e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (top.canDismiss()) { e.preventDefault(); top.close(); }
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables(top.el);
  if (!items.length) { e.preventDefault(); top.el.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const outside = !top.el.contains(active);
  if (e.shiftKey && (active === first || outside || active === top.el)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || outside)) { e.preventDefault(); first.focus(); }
}

/**
 * Closes every open dialog, top first, so each onClose runs. Called on every route render.
 * A dialog that is not dismissible right now (signup with a POST in flight) is left alone and closes itself when settled.
 */
export function closeAllDialogs() {
  for (const entry of [...stack].reverse()) if (entry.canDismiss()) entry.close();
}

/**
 * openDialog(el, { labelledBy, onClose, dismissible = true (boolean or () => boolean), initialFocus, scrim = 'sheet' }) -> close()
 * `scrim` picks the backdrop variant: 'sheet' (--scrim-sheet) or 'lightbox' (--scrim).
 */
export function openDialog(el, { labelledBy, onClose, dismissible = true, initialFocus, scrim = 'sheet' } = {}) {
  const previous = document.activeElement;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (labelledBy) el.setAttribute('aria-labelledby', labelledBy);
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

  const backdrop = h('div', { class: `scrim scrim--${scrim}`, 'data-dialog-ignore': '' });

  // Make everything else on the page inert. Only elements we changed are restored.
  const madeInert = [];
  for (const child of document.body.children) {
    if (child === el || child === backdrop) continue;
    if (child.hasAttribute('data-dialog-ignore') || child.tagName === 'SCRIPT' || child.classList.contains('sprite')) continue;
    if (child.inert) continue;
    child.inert = true;
    madeInert.push(child);
  }

  document.body.append(backdrop, el);
  lockScroll();

  const canDismiss = () => (typeof dismissible === 'function' ? dismissible() : dismissible);
  const entry = { el, canDismiss, close: () => close() };
  if (stack.length === 0) document.addEventListener('keydown', onKeydown, true);
  stack.push(entry);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    if (stack.length === 0) document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    el.remove();
    for (const c of madeInert) c.inert = false;
    unlockScroll();
    if (previous && previous !== document.body && previous.isConnected && !previous.closest('[inert]')) {
      previous.focus({ preventScroll: true });
    }
    if (onClose) onClose();
  }

  backdrop.addEventListener('click', () => { if (canDismiss()) close(); });

  const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
  (target || focusables(el)[0] || el).focus({ preventScroll: true });

  return close;
}
