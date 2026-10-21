import { h } from '../dom.js';
import { state } from '../store.js';
import { timeAgo, avatarColor, firstGrapheme, imageLabel } from '../util.js';
import { syncPostMenu } from './post-menu.js';
import { likeButton, setLikeCount } from './like-button.js';
import { commentsToggle, setCommentCount } from './comments.js';

// Post card (DESIGN 4.4). Like/comment buttons (like-button.js, comments.js) live in .post__actions
// with the thread section after it; the owner menu (ui/post-menu.js) is mounted into .post__menu-slot by applyOwnership.
export function renderPostCard(post, { me = state.me, compact = false, bare = false } = {}) {
  const { author, image } = post;
  const nameId = `p${post.id}-name`;

  // On a profile the author is already known, so the header is just the time.
  // Compact (mobile) also swaps the buttons for a counts line; bare (desktop) keeps the full buttons.
  const head = compact || bare
    ? h('header', { class: 'post__head' },
      h('div', { class: 'post__who' },
        h('p', { id: nameId, class: 'sr-only' }, author.display_name),
        h('p', { class: 'meta' }, h('time', { datetime: post.created_at }, timeAgo(post.created_at)))),
      h('div', { class: 'post__menu-slot' }))
    : h('header', { class: 'post__head' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' },
        firstGrapheme(author.display_name)),
      h('div', { class: 'post__who' },
        h('p', { id: nameId, class: 'post__name' },
          h('a', { href: `/u/${encodeURIComponent(author.handle)}` }, author.display_name)),
        h('p', { class: 'meta' },
          h('span', { class: 'post__handle' }, `@${author.handle}`),
          ' · ',
          h('time', { datetime: post.created_at }, timeAgo(post.created_at)))),
      h('div', { class: 'post__menu-slot' }));

  const el = h('article', {
    class: `post${compact ? ' post--compact' : ''}${bare ? ' post--bare' : ''}`,
    'data-testid': 'post-card',
    'data-author': author.handle,
    'data-id': post.id,
    'aria-labelledby': nameId,
  },
  head,
  h('p', { class: 'post__body' }),
  compact ? h('p', { class: 'post__stats', 'data-testid': 'post-stats' }) : h('div', { class: 'post__actions' }));

  if (!compact) {
    const { button, thread } = commentsToggle(post);
    el.querySelector('.post__actions').append(likeButton(post), button);
    el.append(thread);
  }

  applyOwnership(el, me);
  if (image && !compact) el.querySelector('.post__actions').before(renderImage(post, image));
  updatePostCard(el, post);
  return el;
}

// Own vs other styling depends on `me`, which can arrive after the card was rendered.
export function applyOwnership(el, me = state.me) {
  const handle = el.dataset.author;
  const own = !!me && handle === me.handle;
  el.classList.toggle('post--own', own);
  const av = el.querySelector('.avatar');
  if (av) av.className = `avatar ${own ? 'avatar--me' : `avatar--${avatarColor(handle)}`}`;
  syncPostMenu(el, own);
}

function renderImage(post, image) {
  const alt = imageLabel(image, post.author.handle);
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

// The lightbox can edit an alt or delete the image after the card was drawn.
export function setCardImageAlt(el, alt) {
  const label = imageLabel({ alt }, el.dataset.author);
  el.querySelector('.post__img-open')?.setAttribute('aria-label', `เปิดรูป ${label}`);
  el.querySelector('.post__img img')?.setAttribute('alt', label);
}

export function removeCardImage(el) {
  el.querySelector('.post__img')?.remove();
}

// Replaces text and counts in place; the image and author never change on update.
export function updatePostCard(el, post) {
  const body = el.querySelector('.post__body');
  body.textContent = post.body ?? '';
  body.hidden = !post.body;
  el.dataset.likeCount = post.like_count ?? 0;
  el.dataset.commentCount = post.comment_count ?? 0;
  setLikeCount(el, post.like_count ?? 0);
  setCommentCount(el.querySelector('[data-testid="comment-toggle"]') ?? el, post.comment_count ?? 0);
  paintStats(el);
}

// Compact cards show the counts as text instead of buttons.
function paintStats(el) {
  const stats = el.querySelector('.post__stats');
  if (stats) stats.textContent = `ถูกใจ ${el.dataset.likeCount ?? 0} · ความคิดเห็น ${el.dataset.commentCount ?? 0}`;
}

export function setCardCounts(el, { like, comment } = {}) {
  if (like !== undefined) el.dataset.likeCount = like;
  if (comment !== undefined) el.dataset.commentCount = comment;
  paintStats(el);
}
