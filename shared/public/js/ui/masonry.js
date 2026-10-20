// JS masonry (DESIGN 4.9): one <ul> per column, each image goes into the column with the smallest
// cumulative height (sum of h/w). CSS `columns` is avoided because loading more would move old tiles.
import { h } from '../dom.js';
import { imageLabel } from '../util.js';

/**
 * masonry(container, cols, { onOpen(image, button) })
 *   -> { add(images), remove(id), update(image), reset(), setCols(n), get count }
 * Nodes are moved, never re-created, when the column count changes.
 */
export function masonry(container, cols, { onOpen } = {}) {
  let columns = [];
  let heights = [];
  const items = []; // {image, li, col}

  function build(n) {
    columns = Array.from({ length: n }, () => h('ul', { class: 'masonry__col' }));
    heights = new Array(n).fill(0);
    container.replaceChildren(...columns);
  }

  function shortest() {
    let at = 0;
    for (let c = 1; c < heights.length; c += 1) if (heights[c] < heights[at]) at = c;
    return at;
  }

  function place(item) {
    const c = shortest();
    item.col = c;
    heights[c] += item.image.height / item.image.width;
    columns[c].append(item.li);
  }

  function tile(image) {
    const label = imageLabel(image);
    const li = h('li', { class: 'tile', 'data-testid': 'gallery-tile', 'data-id': image.id },
      h('button', { type: 'button', class: 'tile__open', 'aria-label': `เปิดรูป ${label}` }),
      h('img', {
        src: image.thumb_url,
        width: image.width,
        height: image.height,
        alt: label,
        loading: 'lazy',
        decoding: 'async',
      }),
      h('span', { class: 'tile__badge', 'aria-hidden': 'true' }, `@${image.author?.handle ?? ''}`));
    li.style.aspectRatio = `${image.width} / ${image.height}`;
    li.querySelector('.tile__open').addEventListener('click', (e) => onOpen?.(image, e.currentTarget));
    return li;
  }

  build(cols);

  return {
    add(images) {
      for (const image of images) {
        const item = { image, li: tile(image), col: 0 };
        items.push(item);
        place(item);
      }
    },
    remove(id) {
      const at = items.findIndex((x) => String(x.image.id) === String(id));
      if (at < 0) return;
      const [item] = items.splice(at, 1);
      heights[item.col] -= item.image.height / item.image.width;
      item.li.remove();
    },
    // The label feeds the button, the img alt and nothing else, so a saved alt only touches those.
    update(image) {
      const item = items.find((x) => String(x.image.id) === String(image.id));
      if (!item) return;
      item.image = image;
      const label = imageLabel(image);
      item.li.querySelector('.tile__open').setAttribute('aria-label', `เปิดรูป ${label}`);
      item.li.querySelector('img').setAttribute('alt', label);
    },
    reset() {
      items.length = 0;
      build(columns.length);
    },
    // Redistributes everything from scratch, in the original order. Focus stays on the same tile.
    setCols(n) {
      if (n === columns.length) return;
      const focused = container.contains(document.activeElement) ? document.activeElement : null;
      build(n);
      for (const item of items) place(item);
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    },
    get count() { return items.length; },
  };
}
