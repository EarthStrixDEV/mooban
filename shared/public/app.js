import { startRouter, navigate } from './js/router.js';
import { state, getToken, clearToken, on } from './js/store.js';
import { api } from './js/api.js';
import { openSignup } from './js/ui/signup.js';

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
let currentRoute = { name: '', params: {} };
let seq = 0;
let renders = 0;

function profileHref() {
  const handle = state.me?.handle;
  return handle ? `/u/${encodeURIComponent(handle)}` : null;
}

// Keeps aria-current and the "โปรไฟล์" links in step with the route and the signed-in user.
export function syncNav(route = currentRoute) {
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
  currentRoute = route;
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

// Links that need an account (the "โปรไฟล์" tab while signed out) open signup instead of navigating.
document.addEventListener('click', async (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[data-requires-user]') : null;
  if (!a || state.me) return;
  e.preventDefault();
  if (await openSignup({ reason: 'write' }) && state.me) navigate(profileHref());
}, true);

on('me', () => syncNav());

// Resolves once state.me is known. A rejected token is dropped; network errors keep it for later.
async function loadMe() {
  if (!getToken()) return;
  try {
    state.me = await api('GET', '/api/me');
    syncNav();
  } catch (err) {
    if (err && err.status === 401) clearToken();
  }
}

const firstRender = startRouter(render).catch(() => {});
await Promise.all([firstRender, loadMe()]);
if (!state.me) openSignup({ reason: 'first' });
