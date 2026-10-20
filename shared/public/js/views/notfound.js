import { h } from '../dom.js';

export async function mount(main) {
  main.append(
    h('section', { class: 'card card--empty' },
      h('h1', { tabindex: '-1' }, 'ไม่พบหน้านี้'),
      h('a', { class: 'btn btn--primary', href: '/' }, 'กลับไปฟีด'),
    ),
  );
  return () => {};
}
