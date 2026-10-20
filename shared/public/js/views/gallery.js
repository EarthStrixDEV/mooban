import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { infiniteList } from '../ui/infinite.js';
import { masonry } from '../ui/masonry.js';
import { openLightbox } from '../ui/lightbox.js';
import { requireUser } from '../ui/signup.js';

const PAGE = 40;
const PLACEHOLDERS = 8;
// Same breakpoints as the layout: 2 columns below 720, 3 up to 1099, 4 from 1100.
const WIDE = '(min-width: 1100px)';
const MID = '(min-width: 720px)';

export async function mount(main) {
  const ctrl = new AbortController();
  const mqWide = window.matchMedia(WIDE);
  const mqMid = window.matchMedia(MID);
  const colsNow = () => (mqWide.matches ? 4 : mqMid.matches ? 3 : 2);

  let mode = 'latest';
  let total = null;
  let view = null; // {list, m, box}

  const sub = h('p', { class: 'gallery__sub' });
  const paintTotal = () => { sub.textContent = total === null ? '' : `รูปจากทุกคนในหมู่บ้าน ${total} รูป`; };

  const latestBtn = h('button', {
    type: 'button', class: 'sort-chip', 'aria-pressed': 'true', 'data-testid': 'gallery-sort-latest',
    onclick: () => choose('latest'),
  }, 'ล่าสุด');
  const mineBtn = h('button', {
    type: 'button', class: 'sort-chip', 'aria-pressed': 'false', 'data-testid': 'gallery-sort-mine',
    onclick: () => choose('mine'),
  }, 'ของฉัน');
  const host = h('div', { class: 'gallery__host' });

  main.append(
    h('div', { class: 'gallery__head' },
      h('div', null, h('h1', { tabindex: '-1' }, 'แกลเลอรี'), sub),
      h('div', { role: 'group', 'aria-label': 'เรียงรูป', class: 'gallery__sort' }, latestBtn, mineBtn)),
    host,
  );

  api('GET', '/api/stats', { auth: false, signal: ctrl.signal })
    .then((stats) => { total = Number(stats.images) || 0; paintTotal(); })
    .catch(() => { /* the subtitle stays empty rather than showing a made-up number */ });

  function build() {
    view?.list.destroy();
    host.replaceChildren();
    const box = h('div', { class: 'gallery__box' });
    host.append(box);
    const mine = mode === 'mine';
    let m = null;

    const list = infiniteList({
      container: box,
      idOf: (image) => image.id,
      emptyText: mine
        ? 'คุณยังไม่ได้อัปโหลดรูป'
        : ['ยังไม่มีรูปในหมู่บ้าน', h('br'), 'แนบรูปกับโพสต์เพื่อเริ่มต้น'],
      endText: '',
      errorText: 'โหลดรูปไม่สำเร็จ',
      // The masonry owns the tiles; the list only paginates and keeps the loaded images in order.
      render(image) {
        m.add([image]);
        return document.createComment('');
      },
      // renderTail asks up to three times in a row on the first load; only the first call draws.
      skeleton() {
        if (m && m.count > 0) return h('div', { class: 'sk gallery__more', role: 'status', 'aria-label': 'กำลังโหลดรูปเพิ่ม' });
        if (box.querySelector('.gallery__ph')) return document.createComment('');
        return h('div', { class: 'gallery__ph', role: 'status', 'aria-label': 'กำลังโหลดรูป' },
          Array.from({ length: PLACEHOLDERS }, () => h('span', { class: 'sk gallery__ph-tile' })));
      },
      async load(cursor) {
        const q = new URLSearchParams({ limit: String(PAGE) });
        if (cursor !== null) q.set('before', cursor);
        if (mine) q.set('user', state.me.handle);
        const res = await api('GET', `/api/images?${q}`, { signal: ctrl.signal });
        return { items: res.data, next: res.next_before ?? null };
      },
    });

    const grid = box.querySelector('.list__items');
    grid.classList.add('masonry');
    grid.setAttribute('data-testid', 'gallery-grid');
    m = masonry(grid, colsNow(), {
      onOpen(image, button) {
        const images = list.items;
        openLightbox(images, Math.max(0, images.findIndex((x) => x.id === image.id)), {
          total: images.length,
          returnFocus: button,
          onDeleted(id) {
            m.remove(id);
            list.remove(id);
            if (total !== null) { total = Math.max(0, total - 1); paintTotal(); }
          },
          onAltSaved(updated) {
            const item = list.getItem(updated.id);
            if (item) Object.assign(item, updated);
            m.update(item ?? updated);
          },
        });
      },
    });
    view = { list, m };
  }

  async function choose(next) {
    if (next === mode) return;
    if (next === 'mine' && !(await requireUser())) return;
    mode = next;
    latestBtn.setAttribute('aria-pressed', String(mode === 'latest'));
    mineBtn.setAttribute('aria-pressed', String(mode === 'mine'));
    build();
  }

  const onBreakpoint = () => view?.m.setCols(colsNow());
  mqWide.addEventListener('change', onBreakpoint);
  mqMid.addEventListener('change', onBreakpoint);

  build();

  return () => {
    ctrl.abort();
    mqWide.removeEventListener('change', onBreakpoint);
    mqMid.removeEventListener('change', onBreakpoint);
    view?.list.destroy();
  };
}
