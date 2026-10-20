// First-run / write-gate signup: bottom sheet on mobile, centered dialog on >= 720px (CSS only).
import { h, icon } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state, setToken, clearToken, emit } from '../store.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { reportApiError, GENERIC_ERROR } from './errors.js';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const LEN_RE = /^.{3,20}$/;
const CHARS_RE = /^[a-z0-9_]+$/;
const DEBOUNCE_MS = 400;
const SUFFIXES = ['_2', '99', '_th'];

const MSG = {
  checking: 'กำลังตรวจสอบ…',
  available: 'ชื่อนี้ใช้ได้',
  taken: 'ชื่อนี้มีคนใช้แล้ว ลองชื่อด้านล่างแทนได้เลย',
  rules: 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _',
  generic: GENERIC_ERROR,
};

let active = null;

export function openSignup({ reason = 'first' } = {}) {
  if (state.me) return Promise.resolve(true);
  if (active) return active;
  active = new Promise((resolve) => build(reason, resolve)).finally(() => { active = null; });
  return active;
}

export async function requireUser() {
  if (state.me) return true;
  return openSignup({ reason: 'write' });
}

// Call from any API failure path: an expired/invalid token sends the user back to signup.
export function handleAuthError(err) {
  if (!err || err.status !== 401) return false;
  clearToken();
  state.me = null;
  emit('me', null);
  toast('เซสชันหมดอายุ กรุณาตั้งชื่อใหม่', { error: true });
  openSignup({ reason: 'write' });
  return true;
}

function suggestionsFor(handle) {
  const out = [];
  for (const suffix of SUFFIXES) {
    // Trim the base, not the suffix, so a 20-char handle still yields a distinct 20-char name.
    const c = handle.slice(0, 20 - suffix.length) + suffix;
    if (c !== handle && HANDLE_RE.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

async function exists(handle, signal) {
  try {
    await api('GET', `/api/users/${encodeURIComponent(handle)}`, { auth: false, signal });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

function build(reason, resolve) {
  let signedUp = false;
  let submitting = false;
  let status = 'idle'; // idle | checking | available | taken | invalid | error
  let seq = 0;
  let timer = 0;
  let controller = null;

  const handleInput = h('input', {
    id: 'handle', type: 'text', class: 'field__input field__input--at', name: 'handle',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '40', enterkeyhint: 'next',
    'aria-describedby': 'handle-msg handle-rules', 'data-testid': 'signup-handle',
  });
  const handleMsg = h('p', { id: 'handle-msg', class: 'field__msg', role: 'status', 'data-testid': 'signup-msg' });
  const suggest = h('div', { class: 'chips', 'data-testid': 'signup-suggest', hidden: true });

  const rule = (text) => {
    const li = h('li', { class: 'rule', 'data-state': 'idle' }, h('span', { class: 'rule__mark', 'aria-hidden': 'true' }), text);
    return li;
  };
  const lenRule = rule('ยาว 3–20 ตัวอักษร');
  const charRule = rule('ใช้ได้เฉพาะ a-z, 0-9 และ _');
  const rules = h('ul', { id: 'handle-rules', class: 'rules' }, lenRule, charRule);

  const nameInput = h('input', {
    id: 'display-name', type: 'text', class: 'field__input', name: 'display_name',
    autocomplete: 'off', maxlength: '50', enterkeyhint: 'done',
    'aria-describedby': 'display-name-msg', 'data-testid': 'signup-display-name',
  });
  const nameMsg = h('p', { id: 'display-name-msg', class: 'field__msg', role: 'alert' });

  const submit = h('button', { class: 'btn btn--primary btn--lg', type: 'submit', disabled: true, 'data-testid': 'signup-submit' }, 'เข้าหมู่บ้าน');

  const peek = reason === 'first'
    ? h('button', { class: 'link-btn', type: 'button', onclick: () => { if (!submitting) close(); } }, 'ดูเฉยๆ ก่อน')
    : null;

  const form = h('form', { class: 'sheet__form', novalidate: true },
    h('label', { class: 'field__label', for: 'handle' }, 'ชื่อเล่น (handle)'),
    h('div', { class: 'field' }, h('span', { class: 'field__at', 'aria-hidden': 'true' }, '@'), handleInput),
    handleMsg, suggest, rules,
    h('label', { class: 'field__label', for: 'display-name' }, 'ชื่อที่แสดง'),
    h('div', { class: 'field' }, nameInput),
    nameMsg,
    submit);

  const el = h('div', { class: 'sheet', 'data-testid': 'signup-dialog' },
    h('div', { class: 'sheet__grip', 'aria-hidden': 'true' }),
    h('h2', { id: 'su-title', class: 'sheet__title' }, 'เข้าหมู่บ้านครั้งแรก'),
    h('p', { class: 'sheet__lead' }, 'ตั้งชื่อเล่นสำหรับให้คนอื่นเรียก ไม่ต้องสมัครด้วยอีเมลหรือรหัสผ่าน'),
    form,
    peek,
    h('p', { class: 'sheet__note' }, 'ระบบจะเก็บโทเคนไว้ในเครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ต้องตั้งชื่อใหม่'));

  const close = openDialog(el, {
    labelledBy: 'su-title',
    dismissible: () => !submitting,
    initialFocus: handleInput,
    onClose: () => {
      clearTimeout(timer);
      controller?.abort();
      seq += 1;
      resolve(signedUp);
    },
  });

  function setMsg(kind, text) {
    handleMsg.replaceChildren();
    handleMsg.dataset.kind = kind;
    handleMsg.setAttribute('role', kind === 'taken' ? 'alert' : 'status');
    if (!text) return;
    if (kind === 'available') handleMsg.append(icon('check', { size: 16, stroke: 2.4 }));
    else if (kind === 'taken' || kind === 'invalid' || kind === 'error') handleMsg.append(icon('close', { size: 16, stroke: 2.4 }));
    handleMsg.append(text);
  }

  function setStatus(next, text) {
    status = next;
    const bad = next === 'taken' || next === 'invalid';
    if (bad) handleInput.setAttribute('aria-invalid', 'true'); else handleInput.removeAttribute('aria-invalid');
    handleInput.dataset.state = next;
    setMsg(next, next === 'idle' ? '' : (text ?? MSG[next === 'invalid' ? 'rules' : next] ?? ''));
    updateSubmit();
  }

  function renderRules(v) {
    const mark = (li, state) => {
      li.dataset.state = state;
      const m = li.firstChild;
      m.replaceChildren();
      if (state === 'pass') m.append(icon('check', { size: 16, stroke: 2.4 }));
      else if (state === 'fail') m.append(icon('close', { size: 16, stroke: 2.4 }));
    };
    if (!v) { mark(lenRule, 'idle'); mark(charRule, 'idle'); return; }
    mark(lenRule, LEN_RE.test(v) ? 'pass' : 'fail');
    mark(charRule, CHARS_RE.test(v) ? 'pass' : 'fail');
  }

  function clearSuggestions() {
    suggest.replaceChildren();
    suggest.hidden = true;
  }

  function showSuggestions(names) {
    suggest.replaceChildren(...names.map((n) => h('button', {
      class: 'chip', type: 'button', 'data-handle': n,
      onclick: () => { setHandle(n); handleInput.focus(); },
    }, `@${n}`)));
    suggest.hidden = names.length === 0;
  }

  async function loadSuggestions(base, my, signal) {
    const free = await Promise.all(suggestionsFor(base).map(async (c) => {
      try { return (await exists(c, signal)) ? null : c; } catch { return null; }
    }));
    if (my !== seq) return;
    showSuggestions(free.filter(Boolean));
  }

  async function check(v, my) {
    controller = new AbortController();
    const { signal } = controller;
    try {
      const taken = await exists(v, signal);
      if (my !== seq) return;
      if (taken) {
        setStatus('taken');
        await loadSuggestions(v, my, signal);
      } else {
        setStatus('available');
      }
    } catch (e) {
      if (my !== seq || (e && e.name === 'AbortError')) return;
      setStatus('error', MSG.generic);
    }
  }

  // Re-evaluates the field. `immediate` skips the debounce (chips, 409 follow-up).
  function evaluate({ immediate = false } = {}) {
    clearTimeout(timer);
    controller?.abort();
    seq += 1;
    const my = seq;
    clearSuggestions();
    const v = handleInput.value;
    renderRules(v);
    if (!v) { setStatus('idle'); return; }
    if (!HANDLE_RE.test(v)) { setStatus('invalid'); return; }
    setStatus('checking');
    if (immediate) check(v, my);
    else timer = setTimeout(() => check(v, my), DEBOUNCE_MS);
  }

  function setHandle(value) {
    handleInput.value = value;
    evaluate({ immediate: true });
  }

  function setBusy(busy) {
    submitting = busy;
    handleInput.disabled = busy;
    nameInput.disabled = busy;
    for (const c of suggest.querySelectorAll('button')) c.disabled = busy;
    el.toggleAttribute('aria-busy', busy);
    updateSubmit();
  }

  function updateSubmit() {
    submit.disabled = submitting || status !== 'available' || nameInput.value.trim() === '';
  }

  handleInput.addEventListener('input', () => {
    const v = handleInput.value;
    const lower = v.toLowerCase();
    if (lower !== v) {
      const { selectionStart: a, selectionEnd: b } = handleInput;
      handleInput.value = lower;
      try { handleInput.setSelectionRange(a, b); } catch { /* not supported on this input */ }
    }
    evaluate();
  });

  nameInput.addEventListener('input', () => {
    if (nameMsg.textContent) {
      nameMsg.textContent = '';
      nameInput.removeAttribute('aria-invalid');
    }
    updateSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    setBusy(true);
    const handle = handleInput.value;
    try {
      const res = await api('POST', '/api/users', {
        json: { handle, display_name: nameInput.value.trim() },
        auth: false,
      });
      setToken(res.token);
      state.me = res.user;
      signedUp = true;
      emit('me', res.user);
      close();
      // DESIGN 4.12: focus goes to the composer when the page has one.
      document.querySelector('[data-testid="composer-input"]')?.focus({ preventScroll: true });
    } catch (err) {
      setBusy(false);
      if (!el.contains(document.activeElement)) (submit.disabled ? handleInput : submit).focus();
      if (err instanceof ApiError && err.status === 409) {
        clearTimeout(timer);
        controller?.abort();
        seq += 1;
        const my = seq;
        setStatus('taken');
        controller = new AbortController();
        loadSuggestions(handle, my, controller.signal);
      } else if (err instanceof ApiError && err.status === 422) {
        if (err.fields.handle) {
          seq += 1;
          setStatus('invalid', err.fields.handle);
        }
        if (err.fields.display_name) {
          nameMsg.replaceChildren(icon('close', { size: 16, stroke: 2.4 }), err.fields.display_name);
          nameInput.setAttribute('aria-invalid', 'true');
        }
        if (!err.fields.handle && !err.fields.display_name) toast(MSG.generic, { error: true });
      } else {
        reportApiError(err);
      }
    }
  });

  renderRules('');
  setStatus('idle');
}
