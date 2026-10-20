import { h } from '../dom.js';
import { state } from '../store.js';
import { timeAgo, avatarColor, firstGrapheme } from '../util.js';
import { syncPostMenu } from './post-menu.js';

// Post card (DESIGN 4.4). Like/comment buttons go into .post__actions (Task 17); the owner menu
// (ui/post-menu.js) is mounted into .post__menu-slot by applyOwnership.
export function renderPostCard(post, { me = state.me, compact = false } = {}) {
  const { author, image } = post;
  const nameId = `p${post.id}-name`;

  const el = h('article', {
    class: `post${compact ? ' post--compact' : ''}`,
    'data-testid': 'post-card',
    'data-author': author.handle,
    'data-id': post.id,
    'aria-labelledby': nameId,
  },
  h('header', { class: 'post__head' },
    h('span', { class: 'avatar', 'aria-hidden': 'true' },
      firstGrapheme(author.display_name)),
    h('div', { class: 'post__who' },
      h('p', { id: nameId, class: 'post__name' },
        h('a', { href: `/u/${encodeURIComponent(author.handle)}` }, author.display_name)),
      h('p', { class: 'meta' },
        h('span', { class: 'post__handle' }, `@${author.handle}`),
        ' · ',
        h('time', { datetime: post.created_at }, timeAgo(post.created_at)))),
    h('div', { class: 'post__menu-slot' })),
  h('p', { class: 'post__body' }),
  h('div', { class: 'post__actions' }));

  applyOwnership(el, me);
  if (image) el.querySelector('.post__actions').before(renderImage(post, image));
  updatePostCard(el, post);
  return el;
}

// Own vs other styling depends on `me`, which can arrive after the card was rendered.
export function applyOwnership(el, me = state.me) {
  const handle = el.dataset.author;
  const own = !!me && handle === me.handle;
  el.classList.toggle('post--own', own);
  const av = el.querySelector('.avatar');
  av.className = `avatar ${own ? 'avatar--me' : `avatar--${avatarColor(handle)}`}`;
  syncPostMenu(el, own);
}

function renderImage(post, image) {
  const alt = image.alt || `รูปจาก @${post.author.handle}`;
  const img = h('img', {
    src: image.display_url,
    alt,
    width: image.width,
    height: image.height,
    loading: 'lazy',
    decoding: 'async',
  });
  img.style.aspectRatio = `${image.width} / ${image.height}`;
  const open = h('button', { type: 'button', class: 'post__img-open', 'aria-label': `เปิดรูป ${alt}` }, img);
  open.addEventListener('click', () => {
    open.dispatchEvent(new CustomEvent('mooban:open-image', { bubbles: true, detail: { image, post } }));
  });
  return h('figure', { class: 'post__img' }, open);
}

// Replaces text and counts in place; the image and author never change on update.
export function updatePostCard(el, post) {
  const body = el.querySelector('.post__body');
  body.textContent = post.body ?? '';
  body.hidden = !post.body;
  el.dataset.likeCount = post.like_count ?? 0;
  el.dataset.commentCount = post.comment_count ?? 0;
  for (const [kind, n] of [['like', post.like_count], ['comment', post.comment_count]]) {
    for (const c of el.querySelectorAll(`[data-count="${kind}"]`)) c.textContent = String(n ?? 0);
  }
}
