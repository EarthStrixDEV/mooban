// Client router. matchRoute is pure; window/document are only touched inside functions.

const PROFILE_RE = /^\/u\/([^/]+)$/;

export function matchRoute(path) {
  if (path === '/') return { name: 'feed', params: {} };
  if (path === '/gallery') return { name: 'gallery', params: {} };
  if (path === '/test') return { name: 'test', params: {} };
  const m = PROFILE_RE.exec(path);
  if (m) {
    let handle = m[1];
    try { handle = decodeURIComponent(handle); } catch { /* keep raw */ }
    return { name: 'profile', params: { handle } };
  }
  return { name: 'notfound', params: {} };
}

let renderFn = null;
let lastKey = null;

function currentRoute() {
  return matchRoute(window.location.pathname);
}

function run() {
  lastKey = window.location.pathname + window.location.search;
  if (renderFn) return Promise.resolve(renderFn(currentRoute()));
  return Promise.resolve();
}

export function navigate(path, { replace = false } = {}) {
  const next = new URL(path, window.location.origin);
  const same = next.pathname + next.search === window.location.pathname + window.location.search;
  // An open lightbox owns the current entry; replacing it keeps Back from landing on a dead duplicate.
  const overLightbox = !!window.history.state?.lbk;
  if (replace || same || overLightbox) window.history.replaceState(null, '', next.pathname + next.search + next.hash);
  else window.history.pushState(null, '', next.pathname + next.search + next.hash);
  return run();
}

// Paths served by the backend rather than the SPA.
const BACKEND_PREFIXES = ['/api/', '/media/'];

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href^="/"]') : null;
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('//')) return;
  if (a.hasAttribute('download')) return;
  const target = a.getAttribute('target');
  if (target && target !== '_self') return;
  if (a.origin !== window.location.origin) return;
  if (BACKEND_PREFIXES.some((p) => a.pathname.startsWith(p))) return;
  e.preventDefault();
  navigate(a.pathname + a.search + a.hash);
}

export function startRouter(render) {
  renderFn = render;
  document.addEventListener('click', onClick);
  // Fragment-only or same-path history entries (skip link, lightbox) must not remount the view.
  window.addEventListener('popstate', () => {
    if (window.location.pathname + window.location.search !== lastKey) run();
  });
  return run();
}
