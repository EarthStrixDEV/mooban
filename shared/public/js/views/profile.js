// Profile page (DESIGN 4.11, 5.5): header, "โพสต์" / "รูป" tablist, live status rail.
// Hidden in v1 by decision: bio, "แก้โปรไฟล์", likes stat, "คนในหมู่บ้าน" card.
import { h } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state, on } from '../store.js';
import { joinedLabel, firstGrapheme, avatarColor, imageLabel } from '../util.js';
import {
  renderPostCard, applyOwnership, updatePostCard, setCardImageAlt, removeCardImage, setCardCounts,
} from '../ui/post-card.js';
import { openLightbox, imageFromPost } from '../ui/lightbox.js';
import { infiniteList } from '../ui/infinite.js';
import { mountRail } from '../ui/rail.js';
import { tabs } from '../ui/tabs.js';
import { sse } from '../sse.js';
import { setLikeCount } from '../ui/like-button.js';
import { appendComment, removeComment, setCommentCount, refreshCommentOwnership } from '../ui/comments.js';

const SITE = 'Mooban';
const MOBILE = '(max-width: 719.98px)';
const POST_PAGE = 20;
const PHOTO_PAGE = 40;
const PLACEHOLDERS = 6;

export async function mount(main, rail, params) {
  const ctrl = new AbortController();
  const mq = window.matchMedia(MOBILE);
  const topbar = document.querySelector('.topbar');

  let user = null;
  let phase = 'loading'; // loading | ready | notfound | error
  let titleSlot = null;
  let avatar = null;
  let tabsApi = null;
  let postsList = null;
  let postsPanel = null;
  let photosList = null;
  let photosPanel = null;
  let postsDd = null;
  let photosDd = null;
  let photosN = null;

  // One h1 for the page: in the top bar on mobile (DESIGN 3.2), in the header on desktop.
  const h1 = h('h1', { tabindex: '-1' }, `@${params.handle}`);
  const root = h('div', { class: 'profile' });
  main.append(root);

  const isOwn = () => !!user && !!state.me && state.me.handle === user.handle;
  const cardOf = (id) => postsPanel?.querySelector(`.post[data-id="${CSS.escape(String(id))}"]`) ?? null;
  const tileOf = (id) => photosPanel?.querySelector(`.photo-tile[data-id="${CSS.escape(String(id))}"]`) ?? null;

  function place() {
    const hadFocus = document.activeElement === h1;
    // Mobile follows the board: the bar title is the @handle and the name sits in the header (R25).
    if (phase === 'ready') h1.textContent = mq.matches ? `@${user.handle}` : user.display_name;
    if (phase === 'ready' && mq.matches) {
      if (h1.parentElement !== topbar) topbar.insertBefore(h1, topbar.querySelector('.topbar__gallery'));
    } else if (titleSlot && h1.parentElement !== titleSlot) {
      titleSlot.append(h1);
    }
    if (hadFocus) h1.focus({ preventScroll: true });
  }

  function paintCounts() {
    if (!user) return;
    postsDd.textContent = String(user.post_count);
    photosDd.textContent = String(user.image_count);
    photosN.textContent = ` ${user.image_count}`;
  }

  // ---------- loading / error ----------
  function showLoading() {
    const refocus = root.contains(document.activeElement);
    phase = 'loading';
    h1.textContent = `@${params.handle}`;
    titleSlot = h('div', { class: 'profile__title-slot' });
    root.replaceChildren(titleSlot, h('div', { class: 'sk profile__skel', role: 'status', 'aria-label': 'กำลังโหลดโปรไฟล์' }));
    place();
    if (refocus) h1.focus({ preventScroll: true });
  }

  function showProblem() {
    const notFound = phase === 'notfound';
    const refocus = root.contains(document.activeElement);
    h1.textContent = notFound ? 'ไม่พบผู้ใช้นี้' : 'โหลดโปรไฟล์ไม่สำเร็จ';
    if (notFound) document.title = `ไม่พบผู้ใช้นี้ · ${SITE}`;
    titleSlot = h('div', { class: 'profile__title-slot' });
    root.replaceChildren(h('section', { class: 'card card--empty' },
      titleSlot,
      notFound
        ? h('a', { class: 'btn btn--primary', href: '/' }, 'กลับไปฟีด')
        : h('button', { type: 'button', class: 'btn btn--primary', onclick: load }, 'ลองอีกครั้ง')));
    place();
    if (refocus) h1.focus({ preventScroll: true });
  }

  async function load() {
    showLoading();
    try {
      user = await api('GET', `/api/users/${encodeURIComponent(params.handle)}`, { signal: ctrl.signal });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      phase = err instanceof ApiError && err.status === 404 ? 'notfound' : 'error';
      showProblem();
      return;
    }
    if (ctrl.signal.aborted) return;
    phase = 'ready';
    showReady();
  }

  // ---------- header + tabs ----------
  const avatarClass = () => (isOwn() ? 'avatar--me' : `avatar--${avatarColor(user.handle)}`);

  function showReady() {
    const refocus = root.contains(document.activeElement);
    document.title = `@${user.handle} · ${SITE}`;
    titleSlot = h('div', { class: 'profile__title-slot' });
    avatar = h('span', { class: `avatar profile__avatar ${avatarClass()}`, 'aria-hidden': 'true' },
      firstGrapheme(user.display_name));
    postsDd = h('dd', { 'data-testid': 'profile-count-posts' });
    photosDd = h('dd', { 'data-testid': 'profile-count-photos' });
    photosN = h('span', { class: 'tab__n' });

    const header = h('section', { class: 'profile__head', 'data-testid': 'profile-header', 'aria-label': 'ข้อมูลโปรไฟล์' },
      h('div', { class: 'profile__banner', 'aria-hidden': 'true' }),
      h('div', { class: 'profile__id' },
        avatar,
        h('div', { class: 'profile__who' },
          titleSlot,
          h('p', { class: 'profile__name', 'data-testid': 'profile-name' }, user.display_name),
          h('p', { class: 'profile__meta' },
            h('span', { class: 'profile__handle' }, `@${user.handle} · `),
            joinedLabel(user.created_at)))),
      h('dl', { class: 'profile__stats', 'data-testid': 'profile-counts' },
        h('div', { class: 'profile__stat' }, h('dt', null, 'โพสต์'), postsDd),
        h('div', { class: 'profile__stat' }, h('dt', null, 'รูป'), photosDd)));

    const tabsHost = h('div', { class: 'profile__tabs' });
    root.replaceChildren(header, tabsHost);
    place();
    paintCounts();
    tabsApi = tabs(tabsHost, [
      { id: 'posts', label: 'โพสต์', testid: 'profile-tab-posts', panelTestid: 'profile-panel', render: renderPosts },
      { id: 'photos', label: ['รูป', photosN], testid: 'profile-tab-photos', panelTestid: 'profile-panel', render: renderPhotos },
    ]);
    if (refocus) h1.focus({ preventScroll: true });
  }

  // ---------- posts tab ----------
  function buildPosts() {
    postsList?.destroy();
    const compact = mq.matches;
    postsList = infiniteList({
      container: postsPanel,
      emptyText: 'ยังไม่มีโพสต์',
      idOf: (post) => post.id,
      render: (post) => renderPostCard(post, { me: state.me, compact, bare: !compact }),
      async load(cursor) {
        const q = new URLSearchParams({ user: user.handle, limit: String(POST_PAGE) });
        if (cursor !== null) q.set('before', cursor);
        const res = await api('GET', `/api/posts?${q}`, { signal: ctrl.signal });
        return { items: res.data, next: res.next_before ?? null };
      },
    });
  }

  function renderPosts(panel) {
    postsPanel = panel;
    panel.addEventListener('mooban:post-deleted', (e) => postDeleted(e.detail.id));
    panel.addEventListener('mooban:open-image', openPostImage);
    buildPosts();
  }

  function postDeleted(id) {
    const post = postsList?.getItem(id);
    postsList?.remove(id);
    user.post_count = Math.max(0, user.post_count - 1);
    if (post?.image) {
      user.image_count = Math.max(0, user.image_count - 1);
      photosList?.remove(post.image.id);
    }
    paintCounts();
  }

  // A post image opens the lightbox on the images of the loaded posts, starting at the clicked one.
  function openPostImage(e) {
    const { image, post } = e.detail;
    const withImage = postsList.items.filter((p) => p.image);
    const images = withImage.map(imageFromPost);
    const postOf = new Map(withImage.map((p) => [p.image.id, p.id]));
    let index = images.findIndex((x) => x.id === image.id);
    if (index < 0) { images.splice(0, images.length, imageFromPost({ ...post, image })); index = 0; }
    openLightbox(images, index, {
      returnFocus: e.target instanceof Element ? e.target.closest('.post__img-open') : null,
      returnFocusFor(shown) {
        const card = shown ? cardOf(postOf.get(shown.id) ?? post.id) : null;
        return card?.querySelector('.post__img-open') ?? card?.querySelector('[data-testid="like-btn"]') ?? tabsApi.tab('posts');
      },
      onDeleted: imageDeleted,
      onAltSaved: altSaved,
    });
  }

  // ---------- photos tab ----------
  function photoTile(image) {
    const label = imageLabel(image, user.handle);
    const btn = h('button', {
      type: 'button', class: 'photo-tile', 'data-testid': 'profile-photo', 'data-id': image.id, 'aria-label': `เปิดรูป ${label}`,
    }, h('img', { src: image.thumb_url, width: image.width, height: image.height, alt: '', loading: 'lazy', decoding: 'async' }));
    btn.addEventListener('click', () => openPhotos(image, btn));
    return btn;
  }

  function renderPhotos(panel) {
    photosPanel = panel;
    panel.classList.add('profile-photos');
    photosList = infiniteList({
      container: panel,
      emptyText: 'ยังไม่มีรูป',
      endText: '',
      errorText: 'โหลดรูปไม่สำเร็จ',
      idOf: (image) => image.id,
      render: photoTile,
      // renderTail asks up to three times in a row on the first load; only the first call draws.
      skeleton() {
        if (photosList?.items.length) return h('div', { class: 'sk profile-photos__more', role: 'status', 'aria-label': 'กำลังโหลดรูปเพิ่ม' });
        if (panel.querySelector('.profile-ph')) return document.createComment('');
        return h('div', { class: 'profile-ph', role: 'status', 'aria-label': 'กำลังโหลดรูป' },
          Array.from({ length: PLACEHOLDERS }, () => h('span', { class: 'sk profile-ph__tile' })));
      },
      async load(cursor) {
        const q = new URLSearchParams({ user: user.handle, limit: String(PHOTO_PAGE) });
        if (cursor !== null) q.set('before', cursor);
        const res = await api('GET', `/api/images?${q}`, { signal: ctrl.signal });
        return { items: res.data, next: res.next_before ?? null };
      },
    });
  }

  function openPhotos(image, button) {
    const images = photosList.items;
    openLightbox(images, Math.max(0, images.findIndex((x) => x.id === image.id)), {
      total: images.length,
      returnFocus: button,
      // The clicked tile disappears when its image is deleted: land on the tile now shown, else the first one, else the tab.
      returnFocusFor: (shown) => (shown && tileOf(shown.id)) || photosPanel.querySelector('.photo-tile') || tabsApi.tab('photos'),
      onDeleted: imageDeleted,
      onAltSaved: altSaved,
    });
  }

  // ---------- changes made from a lightbox (either tab) ----------
  function imageDeleted(id) {
    photosList?.remove(id);
    user.image_count = Math.max(0, user.image_count - 1);
    paintCounts();
    for (const post of postsList?.items.filter((p) => p.image?.id === id) ?? []) {
      post.image = null;
      const card = cardOf(post.id);
      if (card) removeCardImage(card);
    }
  }

  function altSaved(updated) {
    const item = photosList?.getItem(updated.id);
    if (item) item.alt = updated.alt;
    const tile = tileOf(updated.id);
    if (tile) tile.setAttribute('aria-label', `เปิดรูป ${imageLabel({ alt: updated.alt }, user.handle)}`);
    for (const post of postsList?.items.filter((p) => p.image?.id === updated.id) ?? []) {
      post.image.alt = updated.alt;
      const card = cardOf(post.id);
      if (card) setCardImageAlt(card, updated.alt);
    }
  }

  // ---------- reactive bits ----------
  const onBreakpoint = () => {
    place();
    // Intentional: switching between compact and full cards rebuilds the list, so page 1 is fetched again.
    if (postsPanel) buildPosts(); // compact cards on mobile, full cards on desktop
  };
  mq.addEventListener('change', onBreakpoint);

  const offMe = on('me', (me) => {
    if (avatar) avatar.className = `avatar profile__avatar ${avatarClass()}`;
    for (const card of postsPanel?.querySelectorAll('.post[data-author]') ?? []) applyOwnership(card, me);
    refreshCommentOwnership(me);
  });

  const offLive = [
    sse.on('post.updated', ({ post }) => {
      const card = post && cardOf(post.id);
      if (card) updatePostCard(card, post);
    }),
    sse.on('post.deleted', ({ id }) => { if (postsList?.getItem(id)) postDeleted(id); }),
    sse.on('like.changed', ({ post_id, like_count }) => {
      setLikeCount(post_id, like_count);
      const card = cardOf(post_id);
      if (card?.classList.contains('post--compact')) setCardCounts(card, { like: like_count });
    }),
    sse.on('comment.created', ({ post_id, comment, comment_count }) => {
      if (comment) appendComment(post_id, comment);
      setCommentCount(post_id, comment_count);
      const card = cardOf(post_id);
      if (card?.classList.contains('post--compact')) setCardCounts(card, { comment: comment_count });
    }),
    sse.on('comment.deleted', ({ post_id, comment_id, comment_count }) => {
      removeComment(post_id, comment_id);
      setCommentCount(post_id, comment_count);
      const card = cardOf(post_id);
      if (card?.classList.contains('post--compact')) setCardCounts(card, { comment: comment_count });
    }),
    sse.on('resync', () => { postsList?.reload(); photosList?.reload(); }),
  ];

  // Desktop rail: only the live status card, plus a way to the test page.
  const offRail = mountRail(rail, { images: false });
  rail.querySelector('#live-status')?.append(h('a', { class: 'rail-card__more', href: '/test' }, 'ไปหน้าทดสอบระบบ'));

  load();

  return () => {
    ctrl.abort();
    mq.removeEventListener('change', onBreakpoint);
    offMe();
    for (const off of offLive) off();
    postsList?.destroy();
    photosList?.destroy();
    offRail();
    if (h1.parentElement === topbar) h1.remove();
  };
}
