import { h } from '../dom.js';

export async function mount(main, rail, params) {
  main.append(h('h1', { tabindex: '-1' }, `@${params.handle}`));
  return () => {};
}
