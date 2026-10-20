// Composer (DESIGN 4.3, 5.2, 6.2): inline card on >= 720px, compact bar + full-screen dialog below.
import { h, icon } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state, on, getToken } from '../store.js';
import { codePointLength, formatBytes, firstGrapheme } from '../util.js';
import { openDialog } from './dialog.js';
import { requireUser, handleAuthError } from './signup.js';
import { reportApiError } from './errors.js';
import { confirmDialog } from './confirm.js';

const MAX = 280;
const WARN_AFTER = 260;
const PLACEHOLDER = 'วันนี้มีอะไรในหมู่บ้าน';

const IMAGE_ERRORS = {
  image_too_many_pixels: 'รูปมีขนาดเกิน 24 ล้านพิกเซล',
  image_invalid: 'ไฟล์รูปเสียหรือเปิดไม่ได้',
  quota_reached: 'อัปโหลดรูปครบโควตาแล้ว',
};

let uid = 0;
let overlayOpen = false;
let shared = null; // one draft shared by the inline card and the overlay, so a viewport change keeps it
let overlayCtl = null;

// /api/me may still be in flight when the user first touches the composer; give it a moment so a
// signed-in user is not sent to signup.
function whenMeSettled(ms = 3000) {
  if (state.me || !getToken()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const off = on('me', done);
    function done() { clearTimeout(timer); off(); resolve(); }
  });
}

async function ensureUser() {
  await whenMeSettled();
  return requireUser();
}

function firstMessage(fields) {
  return Object.values(fields || {}).find((v) => typeof v === 'string') ?? null;
}

function uploadMessage(err) {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 413) return 'ไฟล์ใหญ่เกิน 10 MB';
  if (err.status === 415) return 'รองรับเฉพาะ JPEG, PNG และ WebP';
  if (IMAGE_ERRORS[err.code]) return IMAGE_ERRORS[err.code];
  if (err.status === 422 && err.code === 'validation_failed') return firstMessage(err.fields);
  return null;
}

function discardImage(id) {
  api('DELETE', `/api/images/${id}`).catch(() => { /* best effort */ });
}

// Builds the form pieces. The caller places `row` (avatar + textarea + preview + error), `bar`
// (attach + counter [+ submit]) and, when `submitInBar` is false, `submitBtn` itself.
function createCore() {
  const id = ++uid;
  const inputId = `composer-body-${id}`;
  const countId = `composer-count-${id}`;
  let image = null; // {id, thumb_url, width, height, name, size}
  let uploading = false;
  let posting = false;
  let destroyed = false;
  let seq = 0;
  const self = { onPosted: null };

  const avatar = h('span', { class: 'avatar avatar--me', 'aria-hidden': 'true' });
  const paintAvatar = (me = state.me) => { avatar.textContent = me ? firstGrapheme(me.display_name) : 'ฉ'; };
  paintAvatar();
  const offMe = on('me', paintAvatar);

  const input = h('textarea', {
    id: inputId,
    class: 'composer__input',
    rows: 2,
    placeholder: PLACEHOLDER,
    'aria-describedby': countId,
    'data-testid': 'composer-input',
  });
  const preview = h('div', { class: 'composer__preview', 'data-testid': 'composer-preview', hidden: true });
  const error = h('p', { class: 'composer__error', role: 'alert', 'data-testid': 'composer-error' });

  const fileInput = h('input', {
    type: 'file',
    class: 'sr-only',
    accept: 'image/jpeg,image/png,image/webp',
    'aria-label': 'แนบรูป',
    'data-testid': 'composer-attach',
  });
  const attach = h('label', { class: 'composer__attach' }, icon('gallery', { size: 22 }), fileInput);
  const count = h('p', { id: countId, class: 'composer__count', 'data-testid': 'composer-count' });
  const submitBtn = h('button', {
    type: 'button',
    class: 'btn btn--primary composer__submit',
    'data-testid': 'composer-submit',
  }, 'โพสต์');

  const row = h('div', { class: 'composer__row' },
    avatar,
    h('div', { class: 'composer__fields' },
      h('label', { class: 'sr-only', for: inputId }, 'ข้อความโพสต์'),
      input, preview, error));
  const bar = h('div', { class: 'composer__bar' }, attach, count);

  const length = () => codePointLength(input.value);
  const canSubmit = () => !uploading && !posting && length() <= MAX && (length() > 0 || !!image);

  function refresh() {
    const n = length();
    count.textContent = `${n} / ${MAX}`;
    count.classList.toggle('composer__count--warn', n > WARN_AFTER && n < MAX);
    count.classList.toggle('composer__count--err', n >= MAX);
    submitBtn.disabled = !canSubmit();
    submitBtn.setAttribute('aria-busy', posting ? 'true' : 'false');
    input.readOnly = posting;
    const rm = preview.querySelector('.composer__remove');
    if (rm) rm.disabled = posting;
  }

  function setError(msg) {
    error.textContent = msg || '';
  }

  function renderPreview() {
    preview.replaceChildren();
    if (!uploading && !image) { preview.hidden = true; return; }
    preview.hidden = false;
    const frame = h('div', { class: 'composer__frame' });
    if (uploading) {
      frame.append(h('p', { class: 'composer__uploading', role: 'status' }, 'กำลังอัปโหลด…'));
    } else {
      frame.append(h('img', { src: image.thumb_url, alt: 'ตัวอย่างรูปที่แนบ', width: image.width, height: image.height }));
    }
    frame.append(h('button', {
      type: 'button',
      class: 'composer__remove',
      'aria-label': 'เอารูปออก',
      'data-testid': 'composer-remove-image',
      onclick: removeImage,
    }, icon('close', { size: 20, stroke: 2.2 })));
    preview.append(frame);
    frame.querySelector('.composer__remove').disabled = posting;
    if (image) {
      preview.append(h('p', { class: 'composer__caption' },
        `${image.name} · ${formatBytes(image.size)} จะถูกย่อให้อัตโนมัติ`));
    }
  }

  function removeImage() {
    seq += 1; // an upload still in flight is dropped when it lands
    const old = image;
    image = null;
    uploading = false;
    if (old) discardImage(old.id);
    setError('');
    renderPreview();
    refresh();
    input.focus();
  }

  async function onPick() {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file || posting || destroyed) return;
    if (!(await ensureUser())) return;
    if (destroyed) return;
    if (image) { discardImage(image.id); image = null; }
    const mine = ++seq;
    uploading = true;
    setError('');
    renderPreview();
    refresh();
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api('POST', '/api/images', { form });
      if (mine !== seq) { discardImage(res.id); return; }
      image = { id: res.id, thumb_url: res.thumb_url, width: res.width, height: res.height, name: file.name, size: file.size };
    } catch (err) {
      if (mine !== seq) return;
      if (handleAuthError(err)) return;
      const msg = uploadMessage(err);
      if (msg) setError(msg); else reportApiError(err);
    } finally {
      if (mine === seq) {
        uploading = false;
        renderPreview();
        refresh();
      }
    }
  }

  async function submit() {
    if (!canSubmit()) return;
    // Lock before awaiting so a double click cannot start a second request.
    posting = true;
    setError('');
    refresh();
    if (!(await ensureUser())) { posting = false; refresh(); return; }
    try {
      const payload = { body: input.value.trim() };
      if (image) payload.image_id = image.id;
      const post = await api('POST', '/api/posts', { json: payload });
      (state.sentPostIds ??= new Set()).add(post.id);
      image = null; // now owned by the post
      input.value = '';
      renderPreview();
      self.onPosted?.(post);
    } catch (err) {
      if (handleAuthError(err)) return;
      if (err instanceof ApiError && err.status === 422 && err.code === 'validation_failed') {
        const msg = err.fields?.body || err.fields?.image_id || firstMessage(err.fields);
        if (msg) { setError(msg); return; }
      }
      reportApiError(err);
    } finally {
      posting = false;
      refresh();
    }
  }

  // Writing needs an account: touching the field while signed out opens signup first.
  let gating = false;
  input.addEventListener('focus', async () => {
    if (state.me || gating || destroyed) return;
    gating = true;
    try { if (await ensureUser()) input.focus(); } finally { gating = false; }
  });
  input.addEventListener('input', refresh);
  fileInput.addEventListener('change', onPick);
  submitBtn.addEventListener('click', submit);
  refresh();

  Object.assign(self, {
    row,
    bar,
    submitBtn,
    input,
    focus: () => input.focus(),
    dirty: () => input.value.trim() !== '' || uploading || !!image,
    busy: () => posting,
    // Clears the draft and deletes an uploaded-but-unposted image.
    reset() {
      seq += 1;
      uploading = false;
      if (image) { discardImage(image.id); image = null; }
      input.value = '';
      setError('');
      renderPreview();
      refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      seq += 1;
      offMe();
      if (image) { discardImage(image.id); image = null; }
    },
  });
  return self;
}

function acquireCore() {
  if (!shared) shared = createCore();
  return shared;
}

export function openComposerOverlay({ onPosted } = {}) {
  if (overlayOpen) return () => {};
  overlayOpen = true;
  let close = () => {};
  let asking = false;
  const ctl = { keepDraft: false, close: () => close() };
  overlayCtl = ctl;

  const core = acquireCore();
  core.onPosted = (post) => { close(); onPosted?.(post); };
  core.input.rows = 4;
  core.bar.querySelector('.composer__submit')?.remove();

  async function requestCancel() {
    if (asking || core.busy()) return;
    if (!core.dirty()) { close(); return; }
    asking = true;
    const drop = await confirmDialog({ title: 'ทิ้งโพสต์นี้?', confirmText: 'ทิ้ง', cancelText: 'แก้ต่อ' });
    asking = false;
    if (drop) close(); else core.focus();
  }

  const el = h('div', { class: 'compose' },
    h('header', { class: 'compose__head' },
      h('button', { type: 'button', class: 'compose__cancel', onclick: requestCancel }, 'ยกเลิก'),
      h('h2', { id: 'compose-title', class: 'sr-only' }, 'โพสต์ใหม่'),
      core.submitBtn),
    h('div', { class: 'compose__main' }, core.row),
    core.bar);

  close = openDialog(el, {
    labelledBy: 'compose-title',
    // Esc / scrim with unsaved content asks first instead of closing.
    dismissible: () => {
      if (!core.dirty()) return true;
      requestCancel();
      return false;
    },
    initialFocus: () => core.input,
    onClose: () => {
      overlayOpen = false;
      overlayCtl = null;
      if (!ctl.keepDraft) core.reset();
    },
  });
  return close;
}

// A viewport change swaps the overlay for the inline card: close it but keep the draft.
function closeOverlayKeepingDraft() {
  if (!overlayCtl) return;
  overlayCtl.keepDraft = true;
  overlayCtl.close();
}

/** Drops the draft (and its uploaded image) when the feed goes away. */
export function discardDraft() {
  if (overlayCtl) overlayCtl.close();
  if (shared) { shared.destroy(); shared = null; }
}

function mountCompact(container, { onPosted }) {
  closeOverlayKeepingDraft();
  const avatar = h('span', { class: 'avatar avatar--me', 'aria-hidden': 'true' });
  const paint = (me = state.me) => { avatar.textContent = me ? firstGrapheme(me.display_name) : 'ฉ'; };
  paint();
  const offMe = on('me', paint);
  const btn = h('button', {
    type: 'button',
    class: 'composer-compact',
    'data-testid': 'composer-compact',
    onclick: async () => {
      if (!(await ensureUser())) return;
      openComposerOverlay({ onPosted });
    },
  }, avatar, h('span', { class: 'composer-compact__text' }, PLACEHOLDER));
  container.append(btn);
  return {
    focus: () => btn.focus(),
    open: () => btn.click(),
    destroy() { offMe(); btn.remove(); },
  };
}

function mountInline(container, { onPosted }) {
  closeOverlayKeepingDraft();
  const core = acquireCore();
  core.onPosted = onPosted;
  core.input.rows = 2;
  core.bar.append(core.submitBtn);
  const el = h('div', { class: 'composer card', 'data-testid': 'composer' }, core.row, core.bar);
  container.append(el);
  return {
    focus: () => core.focus(),
    open: () => core.focus(),
    // The draft lives in the shared core and moves to the next host.
    destroy() { el.remove(); },
  };
}

/** mountComposer(container, {variant: 'inline' | 'compact', onPosted}) -> {focus, open, destroy} */
export function mountComposer(container, { variant = 'inline', onPosted } = {}) {
  return variant === 'compact'
    ? mountCompact(container, { onPosted })
    : mountInline(container, { onPosted });
}
