// Optimistic like button (DESIGN 4.5, 6.3).
// The UI flips at once; a per-button queue sends only the latest wanted state. While a request is
// in flight further clicks just move `want`; one follow-up request goes out afterwards, and only if
// `want` differs from what the server last confirmed.
import { h, icon } from '../dom.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { toast } from './toast.js';
import { requireUser, handleAuthError } from './signup.js';

const FAIL_TEXT = 'ถูกใจไม่สำเร็จ ลองอีกครั้ง';
const ctrls = new WeakMap(); // button -> controller

export function likeButton(post) {
  const liked = !!post.liked_by_me;
  const count = Number(post.like_count) || 0;
  const countEl = h('span', { class: 'count', 'data-count': 'like' }, String(count));
  const btn = h('button', {
    type: 'button',
    class: 'act act--like',
    'aria-pressed': String(liked),
    'aria-label': `ถูกใจ ${count}`,
    'data-testid': 'like-btn',
  }, icon('heart', { size: 20 }), countEl);

  const c = {
    id: post.id,
    btn,
    countEl,
    confirmed: { liked, count }, // last state the server told us
    liked,                       // what the screen shows
    count,
    want: liked,                 // latest state the user asked for
    busy: false,
  };
  ctrls.set(btn, c);
  btn.addEventListener('click', () => onClick(c));
  return btn;
}

function paint(c) {
  c.btn.setAttribute('aria-pressed', String(c.liked));
  c.btn.setAttribute('aria-label', `ถูกใจ ${c.count}`);
  c.countEl.textContent = String(c.count);
}

async function onClick(c) {
  if (!state.me) {
    await requireUser(); // the user taps again once signed up; this click never toggles
    return;
  }
  c.liked = !c.liked;
  c.count = Math.max(0, c.count + (c.liked ? 1 : -1));
  c.want = c.liked;
  paint(c);
  pump(c);
}

async function pump(c) {
  if (c.busy || c.want === c.confirmed.liked) return;
  c.busy = true;
  const target = c.want;
  try {
    const res = await api(target ? 'PUT' : 'DELETE', `/api/posts/${c.id}/like`);
    c.confirmed = { liked: !!res.liked_by_me, count: Number(res.like_count) || 0 };
    c.busy = false;
    if (c.want !== c.confirmed.liked) { pump(c); return; } // newer intent: send it next
    c.liked = c.confirmed.liked;
    c.count = c.confirmed.count;
    paint(c);
  } catch (err) {
    c.busy = false;
    c.want = c.confirmed.liked;
    c.liked = c.confirmed.liked;
    c.count = c.confirmed.count;
    paint(c);
    if (!handleAuthError(err)) toast(FAIL_TEXT, { error: true });
  }
}

function targets(target) {
  if (target instanceof Element) {
    return target.matches('[data-testid="like-btn"]') ? [target] : [...target.querySelectorAll('[data-testid="like-btn"]')];
  }
  return [...document.querySelectorAll(`.post[data-id="${CSS.escape(String(target))}"] [data-testid="like-btn"]`)];
}

// Count only: never touches aria-pressed. `target` is the button, a card element, or a post id
// (Task 18 SSE `like.changed`). Ignored while a local request for the post is in flight or a newer
// click is waiting, since the response would overwrite it anyway.
export function setLikeCount(target, n) {
  const value = Math.max(0, Number(n) || 0);
  for (const btn of targets(target)) {
    const c = ctrls.get(btn);
    if (!c) continue;
    if (c.busy || c.want !== c.confirmed.liked) continue;
    c.confirmed.count = value;
    c.count = value;
    paint(c);
  }
}
