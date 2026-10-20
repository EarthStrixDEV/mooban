import { h } from '../dom.js';
import { api } from '../api.js';

const WIDE = '(min-width: 1100px)';

// Desktop right rail (DESIGN 5.1.1): latest images + a live-status card Task 18 drives.
// No "ออนไลน์ตอนนี้" card: the API has no presence data.
export function mountRail(rail) {
  const ctrl = new AbortController();
  const mq = window.matchMedia(WIDE);

  const status = h('section', { id: 'live-status', class: 'rail-card', 'aria-labelledby': 'live-status-title' },
    h('h2', { id: 'live-status-title', class: 'rail-card__title' }, 'สถานะฟีดสด'),
    h('p', { class: 'rail-card__status', role: 'status' }, 'กำลังเชื่อมต่อ…'));
  rail.append(status);

  let started = false;
  async function loadImages() {
    if (started) return;
    started = true;
    let images;
    try {
      images = (await api('GET', '/api/images?limit=6', { signal: ctrl.signal })).data;
    } catch { return; }
    if (ctrl.signal.aborted || !images.length) return;
    const tiles = images.map((img) => {
      const label = img.alt || `รูปจาก @${img.author.handle}`;
      return h('li', null,
        h('a', { class: 'rail-grid__tile', href: '/gallery', 'aria-label': `เปิดรูป ${label}` },
          h('img', { src: img.thumb_url, alt: '', width: img.width, height: img.height, loading: 'lazy', decoding: 'async' })));
    });
    status.before(h('section', { class: 'rail-card', 'aria-labelledby': 'rail-latest-title' },
      h('div', { class: 'rail-card__head' },
        h('h2', { id: 'rail-latest-title', class: 'rail-card__title' }, 'ภาพล่าสุด'),
        h('a', { class: 'rail-card__more', href: '/gallery' }, 'ดูทั้งหมด')),
      h('ul', { class: 'rail-grid' }, tiles)));
  }

  // The rail is display:none below 1100px, so skip the request until it can be seen.
  const onChange = () => { if (mq.matches) loadImages(); };
  if (mq.matches) loadImages();
  else mq.addEventListener('change', onChange);

  return () => {
    ctrl.abort();
    mq.removeEventListener('change', onChange);
  };
}
