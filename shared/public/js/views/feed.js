import { h } from '../dom.js';
import { api } from '../api.js';
import { getToken, state, on } from '../store.js';
import { renderPostCard, applyOwnership, updatePostCard } from '../ui/post-card.js';
import { infiniteList } from '../ui/infinite.js';
import { mountRail } from '../ui/rail.js';
import { livePill } from '../ui/live-pill.js';
import { sse } from '../sse.js';
import { setLikeCount } from '../ui/like-button.js';
import { appendComment, removeComment, setCommentCount, refreshCommentOwnership } from '../ui/comments.js';
import { mountComposer, openComposerOverlay, discardDraft } from '../ui/composer.js';

const PAGE = 20;
const DESKTOP = '(min-width: 720px)';
const DELETED_TEXT = 'โพสต์นี้ถูกลบแล้ว';

const cardOf = (feed, id) => feed.querySelector(`.post[data-id="${CSS.escape(String(id))}"]`);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function mount(main, rail) {
  const ctrl = new AbortController();
  let fetchedWithToken = false;

  const feed = h('div', { class: 'feed', 'data-testid': 'feed' });
  // Always present so screen readers announce the button when it appears; it floats over the page
  // (height 0) and never pushes content, DESIGN 4.7.
  const pillWrap = h('div', { class: 'live-pill-wrap', 'aria-live': 'polite' });
  main.append(
    h('h1', { tabindex: '-1' }, 'ฟีด'),
    pillWrap,
    h('div', { id: 'composer-slot' }),
    feed,
  );

  const list = infiniteList({
    container: feed,
    emptyText: 'ยังไม่มีโพสต์ในหมู่บ้าน เป็นคนแรกที่โพสต์เลย',
    idOf: (post) => post.id,
    render: (post) => renderPostCard(post, { me: state.me }),
    async load(cursor) {
      if (cursor === null) fetchedWithToken = !!getToken();
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (cursor !== null) q.set('before', cursor);
      const res = await api('GET', `/api/posts?${q}`, { signal: ctrl.signal });
      return { items: res.data, next: res.next_before ?? null };
    },
  });

  const pill = livePill(pillWrap, {
    skip: (post) => !!cardOf(feed, post.id) || !!state.sentPostIds?.has(post.id),
    onFlush(posts) {
      list.prepend(posts);
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
  });

  // A post of my own goes straight to the top; its id is remembered so the SSE echo is skipped.
  const onPosted = (post) => {
    list.prepend(post);
    window.scrollTo({ top: 0 });
  };
  feed.addEventListener('mooban:post-deleted', (e) => list.remove(e.detail.id));

  // Inline composer on desktop, compact bar (-> full-screen dialog) below 720px.
  const slot = main.querySelector('#composer-slot');
  const mq = window.matchMedia(DESKTOP);
  let composer = null;
  const mountForViewport = () => {
    composer?.destroy();
    composer = mountComposer(slot, { variant: mq.matches ? 'inline' : 'compact', onPosted });
  };
  mountForViewport();
  mq.addEventListener('change', mountForViewport);
  const onCompose = () => {
    if (mq.matches) composer.focus();
    else openComposerOverlay({ onPosted });
  };
  document.addEventListener('mooban:compose', onCompose);

  // The feed never waits for /api/me: api() sends the stored token, so liked_by_me is right already.
  const offMe = on('me', (me) => {
    if (!me || !fetchedWithToken) list.reload();
    else for (const card of feed.querySelectorAll('.post[data-author]:not(.post--deleted)')) applyOwnership(card, me);
    refreshCommentOwnership(me);
  });

  // Live events (DESIGN 6.5). Nothing here inserts a new post: that waits for the pill click.
  const offLive = [
    sse.on('post.created', ({ post }) => { if (post) pill.add(post); }),
    sse.on('post.updated', ({ post }) => {
      const card = post && cardOf(feed, post.id);
      if (card && !card.classList.contains('post--deleted')) updatePostCard(card, post);
    }),
    sse.on('post.deleted', ({ id }) => {
      pill.remove(id);
      const card = cardOf(feed, id);
      if (!card) return;
      const box = card.getBoundingClientRect();
      if (box.bottom < 0) {
        // Above the viewport: keep the height so what the user is reading does not jump.
        card.style.minHeight = `${box.height}px`;
        card.classList.add('post--deleted');
        card.removeAttribute('aria-labelledby');
        card.replaceChildren(h('p', { class: 'post__gone' }, DELETED_TEXT));
      } else {
        list.remove(id);
      }
    }),
    sse.on('like.changed', ({ post_id, like_count }) => setLikeCount(post_id, like_count)),
    sse.on('comment.created', ({ post_id, comment, comment_count }) => {
      if (comment) appendComment(post_id, comment);
      setCommentCount(post_id, comment_count);
    }),
    sse.on('comment.deleted', ({ post_id, comment_id, comment_count }) => {
      removeComment(post_id, comment_id);
      setCommentCount(post_id, comment_count);
    }),
    sse.on('resync', () => { list.reload(); pill.clear(); }),
  ];
  const offRail = mountRail(rail);

  return () => {
    mq.removeEventListener('change', mountForViewport);
    document.removeEventListener('mooban:compose', onCompose);
    composer.destroy();
    discardDraft();
    offMe();
    for (const off of offLive) off();
    ctrl.abort();
    list.destroy();
    offRail();
  };
}
