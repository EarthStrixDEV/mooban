import { h } from '../dom.js';
import { api } from '../api.js';
import { getToken, state, on } from '../store.js';
import { renderPostCard } from '../ui/post-card.js';
import { infiniteList } from '../ui/infinite.js';
import { mountRail } from '../ui/rail.js';

const PAGE = 20;
// A returning user's first page waits briefly for /api/me so own posts and liked_by_me are right
// without a second fetch; the 'me' listener below covers the slower case and fresh signups.
const ME_WAIT_MS = 1000;

export async function mount(main, rail) {
  const ctrl = new AbortController();
  let resolveMe = null;
  const meReady = getToken() && !state.me
    ? new Promise((res) => { resolveMe = res; })
    : null;
  const meTimer = meReady ? setTimeout(() => resolveMe(), ME_WAIT_MS) : null;
  let fetchedAnonymously = false;

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
      if (cursor === null && meReady) await meReady;
      if (cursor === null) fetchedAnonymously = !state.me;
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (cursor !== null) q.set('before', cursor);
      const res = await api('GET', `/api/posts?${q}`, { signal: ctrl.signal });
      return { items: res.data, next: res.next_before ?? null };
    },
  });

  const offMe = on('me', () => {
    resolveMe?.();
    if (fetchedAnonymously && state.me) list.reload();
  });
  const offRail = mountRail(rail);

  return () => {
    clearTimeout(meTimer);
    offMe();
    ctrl.abort();
    list.destroy();
    offRail();
  };
}
