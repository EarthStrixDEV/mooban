import { h } from '../dom.js';
import { skeletonCard } from './skeleton.js';

// Cursor-paginated list with a sentinel + IntersectionObserver (DESIGN 6.4).
// load(cursor) -> Promise<{items, next}>; next === null/undefined means the end.
export function infiniteList({
  container,
  load,
  render,
  idOf,
  emptyText,
  endText = 'ดูครบทุกโพสต์แล้ว',
  errorText = 'โหลดโพสต์ไม่สำเร็จ',
  skeleton = skeletonCard,
}) {
  const itemsEl = h('div', { class: 'list__items' });
  const tail = h('div', { class: 'list__tail' });
  const sentinel = h('div', { class: 'list__sentinel', 'aria-hidden': 'true' });
  container.append(itemsEl, tail, sentinel);

  let entries = []; // {id, item, node}
  const seen = new Set();
  let cursor = null;
  let done = false;
  let failed = false;
  let loading = false;
  let firstLoad = true;
  let destroyed = false;
  let gen = 0;

  const observer = new IntersectionObserver((hits) => {
    if (hits.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '600px 0px' });

  function renderTail() {
    tail.replaceChildren();
    if (loading) {
      for (let i = 0; i < (firstLoad ? 3 : 1); i += 1) tail.append(skeleton());
    } else if (failed) {
      tail.append(h('div', { class: 'card card--empty' },
        h('p', { role: 'alert' }, errorText),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: retry }, 'ลองอีกครั้ง')));
    } else if (done) {
      tail.append(entries.length
        ? h('p', { class: 'list__end' }, endText)
        : h('div', { class: 'card card--empty' }, h('p', null, emptyText)));
    }
  }

  // Re-observing makes the observer report the current state, so a sentinel that is still
  // inside the margin after an append triggers the next page.
  function watch() {
    observer.unobserve(sentinel);
    if (!done && !failed && !destroyed) observer.observe(sentinel);
  }

  async function loadMore() {
    if (loading || done || failed || destroyed) return;
    const mine = gen;
    loading = true;
    renderTail();
    try {
      const res = await load(cursor);
      if (mine !== gen) return;
      for (const item of res.items) {
        const id = String(idOf(item));
        if (seen.has(id)) continue;
        seen.add(id);
        const node = render(item);
        entries.push({ id, item, node });
        itemsEl.append(node);
      }
      const next = res.next ?? null;
      done = next === null || next === cursor;
      cursor = next;
      firstLoad = false;
    } catch {
      if (mine !== gen) return;
      failed = true;
    } finally {
      if (mine === gen) {
        loading = false;
        renderTail();
        watch();
      }
    }
  }

  function retry() {
    failed = false;
    loadMore();
  }

  function prepend(list) {
    const fresh = [];
    for (const x of Array.isArray(list) ? list : [list]) {
      const isNode = x instanceof Node;
      const id = String(isNode ? x.dataset.id : idOf(x));
      if (seen.has(id)) continue;
      seen.add(id);
      fresh.push({ id, item: isNode ? null : x, node: isNode ? x : render(x) });
    }
    if (!fresh.length) return;
    entries = [...fresh, ...entries];
    itemsEl.prepend(...fresh.map((e) => e.node));
    renderTail();
  }

  function remove(id) {
    const key = String(id);
    const at = entries.findIndex((e) => e.id === key);
    if (at < 0) return;
    entries[at].node.remove();
    entries.splice(at, 1);
    seen.delete(key);
    renderTail();
  }

  function reload() {
    if (destroyed) return;
    gen += 1;
    entries = [];
    seen.clear();
    itemsEl.replaceChildren();
    cursor = null;
    done = false;
    failed = false;
    loading = false;
    firstLoad = true;
    loadMore();
  }

  function destroy() {
    destroyed = true;
    gen += 1;
    observer.disconnect();
    itemsEl.remove();
    tail.remove();
    sentinel.remove();
  }

  loadMore();

  return {
    prepend,
    remove,
    reload,
    destroy,
    getItem: (id) => entries.find((e) => e.id === String(id))?.item ?? null,
    // Loaded items in display order (nodes prepended without an item are skipped).
    get items() { return entries.map((e) => e.item).filter((i) => i !== null); },
  };
}
