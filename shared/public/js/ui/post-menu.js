// Own-post menu (DESIGN 4.4, 6.7): ⋯ trigger, role=menu with edit / delete, inline editor.
// Works from the card's DOM only (data-id, .post__body, .post__img) so any view can reuse it.
// A deleted card announces itself with a bubbling `mooban:post-deleted` event ({detail: {id}}).
import { h, icon } from '../dom.js';
import { api, ApiError } from '../api.js';
import { codePointLength } from '../util.js';
import { confirmDialog } from './confirm.js';
import { handleAuthError } from './signup.js';
import { reportApiError } from './errors.js';
import { updatePostCard } from './post-card.js';

const MAX = 280;
const WARN_AFTER = 260;

// Adds or removes the menu so it always matches whether `own` is true.
export function syncPostMenu(card, own) {
  const slot = card.querySelector('.post__menu-slot');
  if (!slot) return;
  const has = !!slot.querySelector('.postmenu');
  if (own && !has) slot.append(buildMenu(card));
  else if (!own && has) {
    cancelEdit(card);
    slot.replaceChildren();
  }
}

function buildMenu(card) {
  const wrap = h('div', { class: 'postmenu' });
  const trigger = h('button', {
    type: 'button',
    class: 'icon-btn post__menu',
    'aria-label': 'ตัวเลือกโพสต์',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'data-testid': 'post-menu',
  }, icon('more', { size: 22 }));
  wrap.append(trigger);

  let menu = null;
  let items = [];

  function onOutside(e) {
    if (!wrap.isConnected) { close({ focus: false }); return; }
    if (!wrap.contains(e.target)) close({ focus: false });
  }

  function close({ focus = true } = {}) {
    document.removeEventListener('pointerdown', onOutside, true);
    if (!menu) return;
    menu.remove();
    menu = null;
    items = [];
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }

  function item(label, testid, onSelect, extra = '') {
    return h('button', {
      type: 'button',
      role: 'menuitem',
      tabindex: '-1',
      class: `menuitem${extra}`,
      'data-testid': testid,
      onclick: onSelect,
    }, label);
  }

  function open() {
    if (menu) return;
    items = [
      item('แก้ไขโพสต์', 'post-menu-edit', () => { close({ focus: false }); startEdit(card); }),
      // Focus goes back to the trigger first so the confirm dialog restores it there on cancel.
      item('ลบโพสต์', 'post-menu-delete', () => { close(); deletePost(card); }, ' menuitem--danger'),
    ];
    menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'ตัวเลือกโพสต์' }, items);
    menu.addEventListener('keydown', (e) => {
      const at = items.indexOf(document.activeElement);
      const go = (i) => { e.preventDefault(); items[(i + items.length) % items.length].focus(); };
      if (e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') close({ focus: false });
    });
    wrap.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    items[0].focus();
  }

  trigger.addEventListener('click', () => (menu ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (!menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); }
  });
  return wrap;
}

async function deletePost(card) {
  const ok = await confirmDialog({
    title: 'ลบโพสต์นี้และรูปของมัน?',
    confirmText: 'ลบ',
    danger: true,
  });
  if (!ok) return;
  const id = Number(card.dataset.id);
  try {
    await api('DELETE', `/api/posts/${id}`);
  } catch (err) {
    // Already gone elsewhere: the card should disappear either way.
    if (!(err instanceof ApiError && err.status === 404)) {
      if (!handleAuthError(err)) reportApiError(err);
      return;
    }
  }
  card.dispatchEvent(new CustomEvent('mooban:post-deleted', { bubbles: true, detail: { id } }));
  if (card.isConnected) card.remove();
  if (!document.activeElement || document.activeElement === document.body) {
    document.getElementById('main')?.focus({ preventScroll: true });
  }
}

function cancelEdit(card) {
  const editor = card.querySelector('.post__edit');
  if (!editor) return;
  editor.remove();
  const body = card.querySelector('.post__body');
  body.hidden = !body.textContent;
  const slot = card.querySelector('.post__menu-slot');
  if (slot) slot.hidden = false;
}

function startEdit(card) {
  if (card.querySelector('.post__edit')) return;
  const id = card.dataset.id;
  const body = card.querySelector('.post__body');
  const slot = card.querySelector('.post__menu-slot');
  const hasImage = !!card.querySelector('.post__img');
  const original = body.textContent;
  let saving = false;

  const inputId = `post-edit-${id}`;
  const countId = `post-edit-count-${id}`;
  const input = h('textarea', {
    id: inputId,
    class: 'post__edit-input',
    rows: 3,
    'aria-describedby': countId,
    'data-testid': 'post-edit-input',
  });
  input.value = original;
  const error = h('p', { class: 'composer__error', role: 'alert' });
  const count = h('p', { id: countId, class: 'composer__count' });
  const save = h('button', { type: 'button', class: 'btn btn--primary', 'data-testid': 'post-edit-save' }, 'บันทึก');
  const cancel = h('button', { type: 'button', class: 'btn btn--secondary', 'data-testid': 'post-edit-cancel' }, 'ยกเลิก');
  const editor = h('div', { class: 'post__edit' },
    h('label', { class: 'sr-only', for: inputId }, 'แก้ไขข้อความโพสต์'),
    input,
    error,
    h('div', { class: 'post__edit-bar' }, count, cancel, save));

  const valid = () => {
    const n = codePointLength(input.value);
    return n <= MAX && (n > 0 || hasImage);
  };
  function refresh() {
    const n = codePointLength(input.value);
    count.textContent = `${n} / ${MAX}`;
    count.classList.toggle('composer__count--warn', n > WARN_AFTER && n < MAX);
    count.classList.toggle('composer__count--err', n >= MAX);
    save.disabled = saving || !valid();
  }

  function finish() {
    cancelEdit(card);
    card.querySelector('.post__menu')?.focus();
  }

  async function submit() {
    if (saving || !valid()) return;
    const text = input.value.trim();
    if (text === original.trim()) { finish(); return; }
    saving = true;
    error.textContent = '';
    refresh();
    try {
      const post = await api('PUT', `/api/posts/${id}`, { json: { body: text } });
      updatePostCard(card, post);
      finish();
    } catch (err) {
      if (handleAuthError(err)) return;
      if (err instanceof ApiError && err.status === 422 && err.code === 'validation_failed') {
        const msg = err.fields?.body || Object.values(err.fields || {}).find((v) => typeof v === 'string');
        if (msg) { error.textContent = msg; return; }
      }
      reportApiError(err);
    } finally {
      saving = false;
      refresh();
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
  });
  save.addEventListener('click', submit);
  cancel.addEventListener('click', finish);

  body.hidden = true;
  if (slot) slot.hidden = true;
  body.after(editor);
  refresh();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
