// Tabs (DESIGN 4.11, 7.5): tablist with roving tabindex, automatic activation, panels rendered lazily.
import { h } from '../dom.js';

/**
 * tabs(root, [{id, label, testid, panelTestid, render(panel)}], {label})
 * `label` is a string or DOM nodes. A panel is rendered the first time its tab is selected and kept afterwards.
 * Returns {select(id), tab(id), panel(id)}; the first item is selected on creation.
 */
export function tabs(root, items, { label = 'เนื้อหาโปรไฟล์' } = {}) {
  const rendered = new Set();
  const tabEls = new Map();
  const panelEls = new Map();

  const list = h('div', { class: 'tablist', role: 'tablist', 'aria-label': label });
  for (const it of items) {
    const tab = h('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      id: `tab-${it.id}`,
      'aria-selected': 'false',
      'aria-controls': `panel-${it.id}`,
      tabindex: '-1',
      'data-testid': it.testid,
    }, it.label);
    tab.addEventListener('click', () => select(it.id));
    const panel = h('div', {
      class: 'tabpanel',
      role: 'tabpanel',
      id: `panel-${it.id}`,
      'aria-labelledby': `tab-${it.id}`,
      tabindex: '0',
      'data-testid': it.panelTestid,
      hidden: true,
    });
    tabEls.set(it.id, tab);
    panelEls.set(it.id, panel);
    list.append(tab);
  }

  function select(id, { focus = false } = {}) {
    for (const it of items) {
      const on = it.id === id;
      const tab = tabEls.get(it.id);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panelEls.get(it.id).hidden = !on;
      if (on && !rendered.has(it.id)) {
        rendered.add(it.id);
        it.render(panelEls.get(it.id));
      }
    }
    if (focus) tabEls.get(id).focus();
  }

  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; // Alt+Left is the browser's Back
    const at = items.findIndex((it) => tabEls.get(it.id) === document.activeElement);
    if (at < 0) return;
    const n = items.length;
    let to;
    if (e.key === 'ArrowRight') to = (at + 1) % n;
    else if (e.key === 'ArrowLeft') to = (at - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else return;
    e.preventDefault();
    select(items[to].id, { focus: true });
  });

  root.append(list, ...panelEls.values());
  select(items[0].id);
  return { select, tab: (id) => tabEls.get(id), panel: (id) => panelEls.get(id) };
}
