import { startRouter, navigate } from './js/router.js';
import { state } from './js/store.js';

const SITE = 'Mooban';

const VIEWS = {
  feed: () => import('./js/views/feed.js'),
  gallery: () => import('./js/views/gallery.js'),
  profile: () => import('./js/views/profile.js'),
  test: () => import('./js/views/test.js'),
  notfound: () => import('./js/views/notfound.js'),
};

const TITLES = {
  feed: () => 'ฟีด',
  gallery: () => 'แกลเลอรี',
  profile: (p) => `@${p.handle}`,
  test: () => 'ทดสอบระบบ',
  notfound: () => 'ไม่พบหน้านี้',
};

const main = document.getElementById('main');
const rail = document.querySelector('.rail');
const announcer = document.getElementById('route-announcer');

let cleanup = null;
let seq = 0;
let renders = 0;

function profileHref() {
  const handle = state.me?.handle;
  return handle ? `/u/${encodeURIComponent(handle)}` : null;
}

// Keeps aria-current and the "โปรไฟล์" links in step with the route and the signed-in user.
export function syncNav(route) {
  const me = state.me?.handle;
  let current = null;
  if (route.name === 'feed' || route.name === 'gallery' || route.name === 'test') current = route.name;
  else if (route.name === 'profile' && me && route.params.handle.toLowerCase() === me.toLowerCase()) current = 'profile';

  const href = profileHref();
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    if (a.dataset.nav === 'profile') {
      if (href) { a.setAttribute('href', href); a.removeAttribute('data-requires-user'); }
      else { a.setAttribute('href', '/'); a.setAttribute('data-requires-user', ''); }
    }
  }
}

async function render(route) {
  const mine = ++seq;
  const first = renders++ === 0;

  if (cleanup) {
    try { cleanup(); } catch { /* a failing cleanup must not block navigation */ }
    cleanup = null;
  }
  main.replaceChildren();
  rail.replaceChildren();
  document.body.dataset.route = route.name;

  const title = `${TITLES[route.name](route.params)} · ${SITE}`;
  document.title = title;
  syncNav(route);

  const mod = await VIEWS[route.name]();
  if (mine !== seq) return;
  const undo = await mod.mount(main, rail, route.params);
  if (mine !== seq) {
    if (typeof undo === 'function') undo();
    return;
  }
  cleanup = typeof undo === 'function' ? undo : null;

  if (!first) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
    announcer.textContent = title;
  }
}

document.querySelector('[data-back]')?.addEventListener('click', () => {
  if (renders > 1) window.history.back();
  else navigate('/');
});

startRouter(render);
