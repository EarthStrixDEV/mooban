import { h } from '../dom.js';

// Live pill (DESIGN 4.7). `wrapper` is the always-present aria-live region; the button exists only
// while posts are pending. Nothing is inserted into the feed until the user clicks.
//   skip(post)    -> true for posts that must not count (already shown, or sent by this tab)
//   onFlush(list) -> receives the pending posts, newest first
export function livePill(wrapper, { skip = () => false, onFlush } = {}) {
  const pending = new Map(); // id -> post
  let button = null;

  function render() {
    if (!pending.size) {
      button?.remove();
      button = null;
      return;
    }
    const text = `มีโพสต์ใหม่ ${pending.size} รายการ`;
    if (!button) {
      button = h('button', { type: 'button', class: 'live-pill', 'data-testid': 'live-pill' }, text);
      button.addEventListener('click', flush);
      wrapper.append(button);
    } else {
      button.textContent = text;
    }
  }

  function flush() {
    const list = [...pending.values()].sort((a, b) => Number(b.id) - Number(a.id));
    pending.clear();
    render();
    onFlush?.(list);
  }

  return {
    add(post) {
      const id = String(post.id);
      if (pending.has(id) || skip(post)) return;
      pending.set(id, post);
      render();
    },
    remove(id) {
      if (pending.delete(String(id))) render();
    },
    clear() {
      pending.clear();
      render();
    },
    get size() { return pending.size; },
  };
}
