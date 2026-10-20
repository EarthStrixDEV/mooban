import { h } from '../dom.js';

export async function mount(main) {
  main.append(h('h1', { tabindex: '-1' }, 'ทดสอบระบบ'));
  return () => {};
}
