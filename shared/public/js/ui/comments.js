// Comment toggle + thread (DESIGN 4.6). The thread is a <section id="thread-{id}"> inside the card.
// Task 18 helpers (appendComment / removeComment / setCommentCount) accept the thread/button
// element or a post id and find the card in the document by [data-id].
import { h, icon } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state } from '../store.js';
import { codePointLength, timeAgo, firstGrapheme } from '../util.js';
import { requireUser, handleAuthError } from './signup.js';
import { reportApiError } from './errors.js';

const PAGE = 20;
const LEN_MSG = 'ต้องยาว 1–280 ตัวอักษร';
const threads = new WeakMap(); // thread element -> state

export function commentsToggle(post) {
  const count = Number(post.comment_count) || 0;
  const countEl = h('span', { class: 'count', 'data-count': 'comment' }, String(count));
  const button = h('button', {
    type: 'button',
    class: 'act',
    'aria-expanded': 'false',
    'aria-controls': `thread-${post.id}`,
    'aria-label': `ความคิดเห็น ${count}`,
    'data-testid': 'comment-toggle',
  }, icon('comment', { size: 20 }), countEl);

  const list = h('div', { class: 'thread__list' });
  const status = h('p', { class: 'thread__status', role: 'status' });
  const more = h('button', { type: 'button', class: 'thread__more', hidden: true }, 'ดูความคิดเห็นเพิ่มเติม');
  const input = h('input', {
    id: `cm-${post.id}`,
    type: 'text',
    class: 'thread__input',
    placeholder: 'เขียนความคิดเห็น',
    autocomplete: 'off',
    'aria-describedby': `cm-${post.id}-err`,
  });
  const err = h('p', { id: `cm-${post.id}-err`, class: 'thread__err', role: 'alert' });
  const send = h('button', { type: 'submit', class: 'thread__send' }, 'ส่ง');
  const form = h('form', { class: 'thread__write', novalidate: true },
    h('label', { class: 'sr-only', for: `cm-${post.id}` }, 'เขียนความคิดเห็น'),
    input, send);
  const thread = h('section', {
    id: `thread-${post.id}`,
    class: 'thread',
    'aria-label': 'ความคิดเห็น',
    hidden: true,
  }, list, status, more, form, err);

  const s = {
    postId: post.id, button, countEl, thread, list, status, more, input, send, err,
    ids: new Set(), next: null, loaded: false, loading: false, sending: false, count,
  };
  threads.set(thread, s);

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    thread.hidden = !open;
    if (open && !s.loaded) loadPage(s);
  });
  more.addEventListener('click', () => loadPage(s));
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(s); });
  input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
  return { button, thread };
}

function setStatus(s, text, retry) {
  s.status.replaceChildren(text);
  if (retry) s.status.append(' ', h('button', { type: 'button', class: 'thread__retry', onclick: retry }, 'ลองอีกครั้ง'));
}

async function loadPage(s) {
  if (s.loading) return;
  s.loading = true;
  s.more.disabled = true;
  if (!s.loaded) setStatus(s, 'กำลังโหลดความคิดเห็น…');
  s.thread.setAttribute('aria-busy', 'true');
  try {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (s.next !== null) q.set('after', String(s.next));
    const res = await api('GET', `/api/posts/${s.postId}/comments?${q}`);
    for (const c of res.data) addItem(s, c);
    s.next = res.next_after ?? null;
    s.loaded = true;
    s.status.replaceChildren();
  } catch (e) {
    if (s.loaded) { s.status.replaceChildren(); reportApiError(e); }
    else setStatus(s, 'โหลดความคิดเห็นไม่สำเร็จ', () => loadPage(s));
  } finally {
    s.loading = false;
    s.more.disabled = false;
    s.more.hidden = s.next === null;
    s.thread.removeAttribute('aria-busy');
  }
}

function addItem(s, c) {
  if (s.ids.has(c.id)) return false;
  s.ids.add(c.id);
  s.list.append(renderComment(s, c));
  return true;
}

function renderComment(s, c) {
  const body = h('div', { class: 'comment__main' },
    h('div', { class: 'comment__bubble' },
      h('p', { class: 'comment__head' },
        h('span', { class: 'comment__name' }, c.author.display_name),
        h('span', { class: 'comment__time' }, ` · ${timeAgo(c.created_at)}`)),
      h('p', { class: 'comment__text' }, c.body)));
  const el = h('div', { class: 'comment', 'data-comment-id': c.id, 'data-author': c.author.handle },
    h('span', { class: 'comment__avatar', 'aria-hidden': 'true' }, firstGrapheme(c.author.display_name)),
    body);
  syncDelete(s, el, c.id, state.me);
  return el;
}

// "ลบ" shows only on the viewer's own comments. `me` can arrive after the thread was rendered.
function syncDelete(s, el, id, me) {
  const own = !!me && el.dataset.author === me.handle;
  const del = el.querySelector('.comment__del');
  if (own && !del) {
    const btn = h('button', { type: 'button', class: 'comment__del' }, 'ลบ');
    btn.addEventListener('click', () => deleteComment(s, id, btn));
    el.querySelector('.comment__main').append(btn);
  } else if (!own && del) {
    del.remove();
  }
}

// Called when /api/me resolves after threads were already open.
export function refreshCommentOwnership(me = state.me) {
  for (const thread of document.querySelectorAll('.thread')) {
    const s = threads.get(thread);
    if (!s) continue;
    for (const el of thread.querySelectorAll('.comment[data-author]')) {
      const id = [...s.ids].find((x) => String(x) === el.dataset.commentId);
      if (id !== undefined) syncDelete(s, el, id, me);
    }
  }
}

async function deleteComment(s, id, btn) {
  btn.disabled = true;
  try {
    await api('DELETE', `/api/comments/${id}`);
    if (dropItem(s, id)) setCount(s, s.count - 1);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) { dropItem(s, id); return; } // already gone
    btn.disabled = false;
    if (!handleAuthError(e)) reportApiError(e);
  }
}

function dropItem(s, id) {
  s.list.querySelector(`[data-comment-id="${CSS.escape(String(id))}"]`)?.remove();
  return s.ids.delete(id);
}

async function submit(s) {
  if (s.sending) return;
  const body = s.input.value.trim();
  const n = codePointLength(body);
  if (n < 1 || n > 280) { showErr(s, LEN_MSG); return; }
  if (!state.me && !(await requireUser())) return;
  s.sending = true;
  s.input.disabled = true;
  s.send.disabled = true;
  try {
    const c = await api('POST', `/api/posts/${s.postId}/comments`, { json: { body } });
    // 'dup' means the SSE echo already added it and already moved the count.
    if (appendTo(s, c) !== 'dup') setCount(s, s.count + 1);
    s.input.value = '';
    s.err.textContent = '';
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && e.fields?.body) showErr(s, e.fields.body);
    else if (!handleAuthError(e)) reportApiError(e);
  } finally {
    s.sending = false;
    s.input.disabled = false;
    s.send.disabled = false;
    s.input.focus();
  }
}

function showErr(s, msg) {
  s.err.textContent = msg;
  s.input.setAttribute('aria-invalid', 'true');
}

function appendTo(s, c) {
  if (s.ids.has(c.id)) return 'dup';
  if (!s.loaded) return 'skipped'; // the first page load will bring it
  addItem(s, c);
  return 'added';
}

function setCount(s, n) {
  s.count = Math.max(0, Number(n) || 0);
  s.countEl.textContent = String(s.count);
  s.button.setAttribute('aria-label', `ความคิดเห็น ${s.count}`);
}

function threadState(target) {
  if (target instanceof Element) {
    if (threads.has(target)) return threads.get(target);
    const t = (target.closest('.post') ?? target).querySelector('.thread');
    return t ? threads.get(t) ?? null : null;
  }
  const t = document.getElementById(`thread-${target}`);
  return t ? threads.get(t) ?? null : null;
}

// Task 18 (SSE comment.created). Only touches the list; the count comes from setCommentCount.
export function appendComment(target, comment) {
  const s = threadState(target);
  return s ? appendTo(s, comment) : 'skipped';
}

// Task 18 (SSE comment.deleted).
export function removeComment(target, commentId) {
  const s = threadState(target);
  return s ? dropItem(s, commentId) : false;
}

export function setCommentCount(target, n) {
  const s = threadState(target);
  if (s) setCount(s, n);
}
