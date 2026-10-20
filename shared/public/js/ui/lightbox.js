// Lightbox (DESIGN 4.10): full-screen dark view on mobile, 980x640 dialog with a 320px panel on
// desktop. One DOM serves both; CSS (and the .lightbox--dark class) switches the layout.
import { h, icon } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state } from '../store.js';
import { timeAgo, imageLabel } from '../util.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { reportApiError } from './errors.js';
import { handleAuthError } from './signup.js';

const MOBILE = '(max-width: 719.98px)';
const SWIPE_PX = 50;
const CONFIRM_MS = 4000;
const HINT_MS = 3000;
const HINT_KEY = 'mb_lb_hint';
const FORMATS = { webp: 'WebP', jpeg: 'JPEG', jpg: 'JPEG', png: 'PNG', gif: 'GIF', avif: 'AVIF' };

let isOpen = false;
let hintShown = false;

/** The lightbox needs author + time; an image embedded in a post has neither, so borrow the post's. */
export function imageFromPost(post) {
  return { ...post.image, author: post.image.author ?? post.author, created_at: post.image.created_at ?? post.created_at };
}

function hintAlreadySeen() {
  if (hintShown) return true;
  try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
}

function markHintSeen() {
  hintShown = true;
  try { sessionStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked: once per page load */ }
}

function dimsText(image) {
  const parts = [`${image.width} × ${image.height}`];
  if (image.format) parts.push(FORMATS[image.format] ?? String(image.format).toUpperCase());
  if (image.bytes_display) parts.push(`${Math.round(image.bytes_display / 1024)} KB`);
  return parts.join(' · ');
}

/**
 * openLightbox(images, index, { total, returnFocus, returnFocusFor(image), onDeleted(id), onAltSaved(image) }) -> close()
 * On close focus goes back to `returnFocus`; if that element is gone (its image was deleted),
 * `returnFocusFor(image)` picks a new target for the image on screen (or the last one deleted), and <main> is the last resort.
 * `images` is the loaded sequence (each with author, created_at, display_url ...); `total` defaults to its length.
 */
export function openLightbox(images, index = 0, { total, returnFocus, returnFocusFor, onDeleted, onAltSaved } = {}) {
  if (isOpen || !images.length) return () => {};
  isOpen = true;

  const items = [...images];
  let at = Math.min(Math.max(index, 0), items.length - 1);
  let count = total ?? items.length;
  let busy = false;
  let confirmTimer = 0;
  let hintTimer = 0;
  let lastDeleted = null;
  let popped = false;
  let pushed = false;
  let close = () => {};
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mq = window.matchMedia(MOBILE);
  const preloaded = new Set();

  // ---------- static pieces ----------
  const img = h('img', { class: 'lightbox__img', alt: '', decoding: 'async', draggable: 'false' });
  const hint = h('p', { class: 'lightbox__hint', 'aria-hidden': 'true', hidden: true }, 'บีบนิ้วเพื่อซูม · ปัดซ้าย-ขวาเพื่อเปลี่ยนรูป');
  const prevBtn = h('button', {
    type: 'button', class: 'lightbox__nav lightbox__nav--prev', 'aria-label': 'รูปก่อนหน้า', 'data-testid': 'lightbox-prev',
    onclick: () => go(-1),
  }, icon('prev', { size: 24, stroke: 2.2 }));
  const nextBtn = h('button', {
    type: 'button', class: 'lightbox__nav lightbox__nav--next', 'aria-label': 'รูปถัดไป', 'data-testid': 'lightbox-next',
    onclick: () => go(1),
  }, icon('next', { size: 24, stroke: 2.2 }));
  const stage = h('div', { class: 'lightbox__stage' }, img, prevBtn, nextBtn, hint);

  const title = h('h2', { id: 'lb-title', class: 'lightbox__title' });
  const altText = h('p', { class: 'lightbox__alt', 'aria-hidden': 'true' });
  const by = h('p', { class: 'lightbox__by' });
  const counter = h('p', { class: 'lightbox__count', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const closeBtn = h('button', {
    type: 'button', class: 'icon-btn lightbox__close', 'aria-label': 'ปิดรูป', 'data-testid': 'lightbox-close',
    onclick: () => close(),
  }, icon('close', { size: 22, stroke: 2.2 }));
  const dims = h('p', { class: 'lightbox__dims' });
  const ownerSlot = h('div', { class: 'lightbox__owner-slot' });

  const panel = h('aside', { class: 'lightbox__panel', 'aria-label': 'รายละเอียดรูป' },
    h('div', { class: 'lightbox__head' },
      h('div', { class: 'lightbox__titles' }, title, altText, by, counter),
      closeBtn),
    dims,
    ownerSlot);

  const el = h('div', { class: 'lightbox', 'data-testid': 'lightbox' },
    h('div', { class: 'lightbox__frame' }, stage, panel));

  // ---------- rendering ----------
  const current = () => items[at];

  function preload(image) {
    if (!image || preloaded.has(image.display_url)) return;
    preloaded.add(image.display_url);
    new Image().src = image.display_url;
  }

  function paintText(image) {
    const label = imageLabel(image);
    title.textContent = label;
    altText.textContent = label;
    img.alt = label;
    by.replaceChildren(
      h('span', { class: 'lightbox__by-prefix' }, 'โดย '),
      `@${image.author?.handle ?? ''} · ${image.created_at ? timeAgo(image.created_at, { long: true }) : ''}`.replace(/ · $/, ''));
    dims.textContent = dimsText(image);
    counter.textContent = `${at + 1} / ${count}`;
  }

  function resetConfirm() {
    clearTimeout(confirmTimer);
    confirmTimer = 0;
  }

  function show() {
    const image = current();
    resetConfirm();
    img.src = image.display_url;
    img.width = image.width;
    img.height = image.height;
    paintText(image);
    prevBtn.hidden = nextBtn.hidden = items.length < 2;
    prevBtn.setAttribute('aria-disabled', String(at === 0));
    nextBtn.setAttribute('aria-disabled', String(at === items.length - 1));
    ownerSlot.replaceChildren();
    if (state.me && image.author?.handle === state.me.handle) ownerSlot.append(buildOwner(image));
    preload(items[at - 1]);
    preload(items[at + 1]);
    // Keep the entry's state in step with the image on screen; the entry itself stays ours.
    if (pushed) {
      try { window.history.replaceState({ lb: image.id, lbk: token }, ''); } catch { /* ignore */ }
    }
  }

  function go(delta) {
    const next = at + delta;
    if (busy || next < 0 || next >= items.length) return;
    at = next;
    show();
  }

  // ---------- owner tools ----------
  function buildOwner(image) {
    const input = h('textarea', {
      id: 'lb-alt', class: 'lightbox__alt-input', rows: '3', autocomplete: 'off',
      'aria-describedby': 'lb-alt-help lb-alt-err', 'data-testid': 'lightbox-alt-input',
    });
    input.value = image.alt ?? '';
    const err = h('p', { id: 'lb-alt-err', class: 'lightbox__err', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn lightbox__save', 'data-testid': 'lightbox-alt-save' }, 'บันทึกคำอธิบาย');
    const del = h('button', { type: 'button', class: 'btn lightbox__del', 'aria-live': 'polite', 'data-testid': 'lightbox-delete' }, 'ลบรูป');

    input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });

    async function saveAlt(e) {
      e.preventDefault();
      if (busy) return;
      busy = true;
      save.disabled = true;
      err.textContent = '';
      input.removeAttribute('aria-invalid');
      try {
        const updated = await api('PATCH', `/api/images/${image.id}`, { json: { alt: input.value } });
        const slot = items.findIndex((x) => x.id === image.id);
        if (slot >= 0) items[slot] = { ...items[slot], ...updated };
        onAltSaved?.(items[slot] ?? updated);
        if (current().id === image.id) {
          paintText(current());
          input.value = updated.alt ?? '';
        }
        toast('บันทึกคำอธิบายแล้ว');
      } catch (error) {
        if (error instanceof ApiError && error.status === 422 && error.fields?.alt) {
          err.textContent = error.fields.alt;
          input.setAttribute('aria-invalid', 'true');
        } else if (!handleAuthError(error)) {
          reportApiError(error);
        }
      } finally {
        busy = false;
        save.disabled = false;
      }
    }

    async function removeImage() {
      if (busy) return;
      if (!confirmTimer) {
        // First press only arms the button; it disarms itself after 4 s.
        del.textContent = 'ยืนยันลบ';
        del.classList.add('is-confirming');
        confirmTimer = setTimeout(() => {
          confirmTimer = 0;
          del.textContent = 'ลบรูป';
          del.classList.remove('is-confirming');
        }, CONFIRM_MS);
        return;
      }
      resetConfirm();
      busy = true;
      del.disabled = true;
      try {
        await api('DELETE', `/api/images/${image.id}`);
      } catch (error) {
        busy = false;
        del.disabled = false;
        del.textContent = 'ลบรูป';
        del.classList.remove('is-confirming');
        if (!handleAuthError(error)) reportApiError(error);
        return;
      }
      busy = false;
      const slot = items.findIndex((x) => x.id === image.id);
      lastDeleted = image;
      if (slot >= 0) items.splice(slot, 1);
      count -= 1;
      onDeleted?.(image.id);
      if (!items.length) { close(); return; }
      at = Math.min(slot >= 0 ? slot : at, items.length - 1);
      show();
      closeBtn.focus({ preventScroll: true });
    }

    del.addEventListener('click', removeImage);

    return h('form', { class: 'lightbox__owner', novalidate: true, onsubmit: saveAlt },
      h('p', { class: 'lightbox__owner-title' }, 'เครื่องมือเจ้าของรูป'),
      h('label', { class: 'lightbox__label', for: 'lb-alt' },
        h('span', { class: 'lightbox__label-d' }, 'คำอธิบายรูป (alt)'),
        h('span', { class: 'lightbox__label-m' }, 'คำอธิบายรูป (alt text)')),
      input,
      h('p', { id: 'lb-alt-help', class: 'lightbox__help' }, 'ช่วยให้คนที่ใช้โปรแกรมอ่านหน้าจอเข้าใจว่าในรูปมีอะไร'),
      err,
      h('div', { class: 'lightbox__actions' },
        save,
        h('div', { class: 'lightbox__own' }, h('span', null, 'รูปของคุณ'), del)));
  }

  // ---------- input ----------
  const onKey = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t instanceof Element) {
      if (t.closest('textarea, input, select, [contenteditable]')) return; // arrows move the caret there
      if (t !== document.body && !el.contains(t)) return; // another dialog is on top
    }
    e.preventDefault();
    go(e.key === 'ArrowRight' ? 1 : -1);
  };

  // Touch swipe with pointer events. A second finger (pinch) cancels the gesture.
  const touches = new Map();
  let startX = 0;
  let startY = 0;
  let spoiled = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    touches.set(e.pointerId, true);
    if (touches.size > 1) { spoiled = true; return; }
    spoiled = false;
    startX = e.clientX;
    startY = e.clientY;
  });
  const endTouch = (e) => {
    if (!touches.delete(e.pointerId)) return;
    if (spoiled || e.type === 'pointercancel') { if (!touches.size) spoiled = false; return; }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };
  stage.addEventListener('pointerup', endTouch);
  stage.addEventListener('pointercancel', endTouch);

  const onPop = () => {
    // Browser Back removed the entry we pushed: close without touching history again.
    if (window.history.state?.lbk !== token) { popped = true; close(); }
  };

  const syncLayout = () => { el.classList.toggle('lightbox--dark', mq.matches); };
  mq.addEventListener('change', syncLayout);
  syncLayout();

  // ---------- open ----------
  show();
  try {
    window.history.pushState({ lb: current().id, lbk: token }, '');
    pushed = true;
  } catch { /* ignore */ }
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);

  close = openDialog(el, {
    labelledBy: 'lb-title',
    scrim: 'lightbox',
    initialFocus: closeBtn,
    onClose: () => {
      isOpen = false;
      resetConfirm();
      clearTimeout(hintTimer);
      mq.removeEventListener('change', syncLayout);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      // Only undo our own entry; a route change has already left it behind.
      if (!popped && window.history.state?.lbk === token) window.history.back();
      const target = [returnFocus, returnFocusFor?.(items[at] ?? lastDeleted), document.getElementById('main')]
        .find((el) => el?.isConnected && !el.closest('[inert]'));
      target?.focus({ preventScroll: true });
    },
  });

  if (mq.matches && !hintAlreadySeen()) {
    markHintSeen();
    hint.hidden = false;
    hintTimer = setTimeout(() => { hint.hidden = true; }, HINT_MS);
  }

  return close;
}
