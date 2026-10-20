import { h } from '../dom.js';
import { api } from '../api.js';
import { getToken, state, on } from '../store.js';
import { renderPostCard, applyOwnership } from '../ui/post-card.js';
import { infiniteList } from '../ui/infinite.js';
import { mountRail } from '../ui/rail.js';
import { mountComposer, openComposerOverlay, discardDraft } from '../ui/composer.js';

const PAGE = 20;
const DESKTOP = '(min-width: 720px)';

export async function mount(main, rail) {
  const ctrl = new AbortController();
  let fetchedWithToken = false;

  const feed = h('div', { class: 'feed', 'data-testid': 'feed' });
  main.append(
    h('h1', { tabindex: '-1' }, 'ฟีด'),
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
    else for (const card of feed.querySelectorAll('.post[data-author]')) applyOwnership(card, me);
  });
  const offRail = mountRail(rail);

  return () => {
    mq.removeEventListener('change', mountForViewport);
    document.removeEventListener('mooban:compose', onCompose);
    composer.destroy();
    discardDraft();
    offMe();
    ctrl.abort();
    list.destroy();
    offRail();
  };
}
