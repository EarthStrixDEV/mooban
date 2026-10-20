// /test: system-test page (DESIGN 5.7, 6.8). The operator's tool for measuring the host.
import { h } from '../dom.js';
import { mountUploadCard } from '../test/upload-card.js';
import { mountRealtimeCard } from '../test/realtime-card.js';
import { mountWsCard } from '../test/ws-card.js';
import { mountBandwidthCard, mountCachingCard } from '../test/tools-cards.js';
import { mountApiCard, mountSeedCard } from '../test/api-cards.js';
import { getTestToken, setTestToken } from '../test/common.js';

const MOBILE = '(max-width: 719.98px)';

export async function mount(main) {
  const mq = window.matchMedia(MOBILE);
  const topbar = document.querySelector('.topbar');

  // One h1: in the top bar (next to back) on mobile, in the page header on desktop (DESIGN 3.2).
  const h1 = h('h1', { tabindex: '-1' }, 'ทดสอบระบบ');
  const slot = h('div', { class: 'thead__title' });
  function place() {
    const hadFocus = document.activeElement === h1;
    if (mq.matches) {
      if (h1.parentElement !== topbar) topbar.insertBefore(h1, topbar.querySelector('.topbar__gallery'));
    } else if (h1.parentElement !== slot) {
      slot.append(h1);
    }
    if (hadFocus) h1.focus({ preventScroll: true });
  }

  const token = h('input', {
    id: 'test-token', class: 'tfield__input', type: 'password', autocomplete: 'off', spellcheck: 'false',
    value: getTestToken(), 'data-testid': 'test-token',
    oninput: (e) => setTestToken(e.target.value),
  });
  const tokenCard = h('section', { class: 'card tcard tcard--full', 'aria-labelledby': 'test-token-label' },
    h('div', { class: 'tfield' },
      h('label', { id: 'test-token-label', class: 'tfield__label', for: 'test-token' }, 'Test token'),
      token,
      h('p', { class: 'tcard__sub' }, 'ใช้กับเครื่องมือที่ต้องมี X-Test-Token (emit, download/upload, slow, seed, ล้าง cache) เก็บไว้ในหน่วยความจำของหน้านี้เท่านั้น หายเมื่อรีเฟรช')));

  const cards = [
    mountUploadCard(), mountRealtimeCard(), mountWsCard(),
    mountBandwidthCard(), mountCachingCard(), mountApiCard(), mountSeedCard(),
  ];

  main.append(
    h('div', { class: 'test' },
      h('header', { class: 'thead' }, slot,
        h('p', { class: 'thead__desc only-wide' }, 'ตรวจการประมวลผลรูป การอัปเดตสด และ WebSocket บนโฮสต์นี้')),
      h('div', { class: 'test__grid' }, tokenCard, cards.map((c) => c.root))));

  place();
  mq.addEventListener('change', place);

  return () => {
    mq.removeEventListener('change', place);
    cards.forEach((c) => c.destroy());
    if (h1.parentElement === topbar) h1.remove();
  };
}
