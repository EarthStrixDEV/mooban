import { h } from '../dom.js';
import { api } from '../api.js';
import { getToken, state, on } from '../store.js';
import { renderPostCard, applyOwnership } from '../ui/post-card.js';
import { infiniteList } from '../ui/infinite.js';
import { mountRail } from '../ui/rail.js';

const PAGE = 20;

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

  // The feed never waits for /api/me: api() sends the stored token, so liked_by_me is right already.
  const offMe = on('me', (me) => {
    if (!me || !fetchedWithToken) list.reload();
    else for (const card of feed.querySelectorAll('.post[data-author]')) applyOwnership(card, me);
  });
  const offRail = mountRail(rail);

  return () => {
    offMe();
    ctrl.abort();
    list.destroy();
    offRail();
  };
}
