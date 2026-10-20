import { h } from '../dom.js';

// Placeholder shaped like a post card (DESIGN 4.8).
export function skeletonCard() {
  return h('div', {
    class: 'post post--skeleton',
    'data-testid': 'skeleton',
    role: 'status',
    'aria-label': 'กำลังโหลดโพสต์เพิ่ม',
  },
  h('div', { class: 'post__head' },
    h('span', { class: 'sk sk--avatar' }),
    h('div', { class: 'post__who' },
      h('span', { class: 'sk sk--name' }),
      h('span', { class: 'sk sk--meta' }))),
  h('span', { class: 'sk sk--line' }),
  h('span', { class: 'sk sk--line sk--short' }));
}
