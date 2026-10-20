// DESIGN 8.3 acceptance checks: tap targets, contrast (light + dark), 360 px, CLS, CSP,
// reduced motion and keyboard order. Runs on mobile, desktop, desktop-dark and mobile-360.
// Keyboard Esc/focus-trap behaviour is covered by signup/gallery/composer specs and not repeated here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request as pwRequest } from '@playwright/test';
import { test, expect, createUser, signedInPage, resetRateLimits } from './fixtures.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:8081';
const TEST_TOKEN = { 'X-Test-Token': 'dev-test-token-0123456789abcd' };
const SAMPLE = readFileSync(fileURLToPath(new URL('../../shared/public/sample.jpg', import.meta.url)));
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

// One viewer for the whole file. He owns the newest post (with an image), so the feed top, the
// gallery's first tile and his profile show owner-only controls (menu, lightbox tools) next to
// seeded content. Created once and removed afterwards: the stack caps uploads at 500 images.
let me;
let myImage;

test.beforeAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  const seeded = await api.post('/api/test/seed?users=2&posts=45&images=5&reset=1', { headers: TEST_TOKEN });
  expect(seeded.ok()).toBeTruthy();
  await resetRateLimits();
  me = await createUser({ display_name: 'มินจู' });
  const up = await api.post('/api/images', {
    headers: auth(me), multipart: { file: { name: 'sample.jpg', mimeType: 'image/jpeg', buffer: SAMPLE }, alt: 'รูปทดสอบ' },
  });
  expect(up.status()).toBe(201);
  myImage = await up.json();
  const post = await api.post('/api/posts', { headers: auth(me), data: { body: `acceptance-${me.handle}`, image_id: myImage.id } });
  expect(post.status()).toBe(201);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  if (myImage) await api.delete(`/api/images/${myImage.id}`, { headers: auth(me) });
  await api.delete('/api/test/seed', { headers: TEST_TOKEN });
  await api.dispose();
});

const ROUTES = [
  { path: '/', ready: (p) => expect(p.getByTestId('post-card').first()).toBeVisible() },
  { path: '/gallery', ready: (p) => expect(p.getByTestId('gallery-tile').first()).toBeVisible() },
  { path: '/u/seed_001', ready: (p) => expect(p.getByTestId('profile-header')).toBeVisible() },
  { path: '/u/:me', ready: (p) => expect(p.getByTestId('profile-header')).toBeVisible() },
  { path: '/test', ready: (p) => expect(p.locator('h1')).toBeVisible() },
  { path: '/nope', ready: (p) => expect(p.locator('h1')).toBeVisible() },
];

async function setup(page) {
  await signedInPage(page, me);
  return me;
}

async function visit(page, route, me) {
  await page.goto(route.path.replace(':me', me.handle));
  await route.ready(page);
  await expect(page.locator('.sk')).toHaveCount(0, { timeout: 10_000 });
}

const isNarrow = (page) => (page.viewportSize()?.width ?? 0) < 720;
const projectIs = (testInfo, ...names) => names.includes(testInfo.project.name);

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// In-page scanners (serialised into the browser, so they must be self-contained).

function scanTargets(rootSel) {
  const SEL = 'a, button, input:not([type=hidden]), select, textarea, [role=tab]';
  const root = rootSel ? document.querySelector(rootSel) : document;
  const describe = (el) => {
    const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30);
    const tid = el.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${el.type && el.tagName === 'INPUT' ? `[${el.type}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}${tid ? `[testid=${tid}]` : ''} "${text}"`;
  };
  const bad = [];
  let seen = 0;
  for (const el of root.querySelectorAll(SEL)) {
    if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Skip link: parked off-screen until focused; measured in the keyboard test.
    if (el.classList.contains('skip-link') && r.bottom <= 0) continue;
    // Exclusion: visually hidden file input (1 px clip). Its <label> is the target and is measured below.
    if (el.tagName === 'INPUT' && el.type === 'file' && (r.width <= 2 || r.height <= 2)) {
      const labels = [...(el.labels ?? [])].filter((l) => l.checkVisibility({ checkVisibilityCSS: true }));
      const ok = labels.some((l) => { const lr = l.getBoundingClientRect(); return lr.width >= 44 && lr.height >= 44; });
      if (!ok) bad.push({ el: `${describe(el)} (no visible 44x44 label)`, w: r.width, h: r.height });
      continue;
    }
    seen += 1;
    if (r.width < 43.99 || r.height < 43.99) bad.push({ el: describe(el), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 });
  }
  return { seen, bad };
}

function scanContrast(rootSel) {
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  // Backdrop colour behind `el`: composite the rgba layers up the parent chain until an opaque one.
  // Returns null when an image/gradient sits in between (text on media: not measurable here).
  const backdrop = (el) => {
    const layers = [];
    let opaque = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) { opaque = true; break; }
    }
    let base = opaque ? layers.pop() : (matchMedia('(prefers-color-scheme: dark)').matches ? [18, 18, 18, 1] : [255, 255, 255, 1]);
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    return base;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const describe = (el) => {
    const tid = el.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}${tid ? `[testid=${tid}]` : ''}`;
  };

  const root = rootSel ? document.querySelector(rootSel) : document.body;
  const fails = [];
  let scanned = 0;
  let skippedMedia = 0;

  const measure = (el, fg, text, cs) => {
    const bg = backdrop(el);
    if (!bg) { skippedMedia += 1; return; }
    const o = opacityOf(el);
    const fgc = over([fg[0], fg[1], fg[2], fg[3] * o], bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(fgc, bg);
    scanned += 1;
    if (got < need) {
      fails.push({
        el: describe(el), text: text.slice(0, 40), ratio: Math.round(got * 100) / 100, need,
        fg: `rgb(${fgc.slice(0, 3).map(Math.round)})`, bg: `rgb(${bg.slice(0, 3).map(Math.round)})`, size, weight: cs.fontWeight,
      });
    }
  };

  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    if (el.closest('svg, script, style, template')) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom <= 0 && el.closest('.skip-link')) continue; // parked skip link
    if (r.width <= 1 || r.height <= 1) continue; // visually-hidden text
    if (el.matches(':disabled') || el.closest('fieldset:disabled')) continue; // WCAG exception
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (own) measure(el, rgba(cs.color), own, cs);
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.getAttribute('placeholder') && !el.value) {
      const ph = getComputedStyle(el, '::placeholder');
      measure(el, rgba(ph.color), `placeholder:${el.getAttribute('placeholder')}`, ph);
    }
  }
  return { scanned, skippedMedia, fails };
}

// Fonts ready and every finite animation/transition done: a colour read mid-fade is not a verdict.
const settle = async (page) => {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
};

// ---------------------------------------------------------------------------------------------
// Tap targets

for (const route of ROUTES) {
  test(`tap targets >= 44x44 on ${route.path}`, async ({ page }) => {
    const me = await setup(page);
    await visit(page, route, me);
    await settle(page);
    const { seen, bad } = await page.evaluate(scanTargets, null);
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
}

test('tap targets: skip link when focused', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByTestId('post-card').first()).toBeVisible();
  await page.keyboard.press('Tab');
  const link = page.locator('.skip-link');
  await expect(link).toBeFocused();
  const b = await link.boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.y).toBeGreaterThanOrEqual(0);
});

test.describe('overlays', () => {
  test('signup dialog: targets, contrast, no overflow', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByTestId('signup-dialog')).toBeVisible();
    await page.getByTestId('signup-handle').fill('taken_probe_zz');
    await page.getByTestId('signup-dialog').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const { seen, bad } = await page.evaluate(scanTargets, '[data-testid=signup-dialog]');
    expect(seen).toBeGreaterThan(3);
    expect(bad).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (projectIs(testInfo, 'desktop', 'desktop-dark')) {
      const c = await page.evaluate(scanContrast, '[data-testid=signup-dialog]');
      expect(c.scanned).toBeGreaterThan(5);
      expect(c.fails).toEqual([]);
    }
  });

  test('signup dialog: taken-name state (chips, error text) meets targets and contrast', async ({ page }, testInfo) => {
    const taken = await createUser();
    await page.goto('/');
    await page.getByTestId('signup-handle').fill(taken.handle);
    await expect(page.getByTestId('signup-suggest').getByRole('button').first()).toBeVisible();
    const { bad } = await page.evaluate(scanTargets, '[data-testid=signup-dialog]');
    expect(bad).toEqual([]);
    if (projectIs(testInfo, 'desktop', 'desktop-dark')) {
      const c = await page.evaluate(scanContrast, '[data-testid=signup-dialog]');
      expect(c.fails).toEqual([]);
    }
  });

  test('composer overlay (narrow screens)', async ({ page }) => {
    test.skip(!isNarrow(page), 'composer overlay exists below 720 px only');
    await setup(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
    const dlg = page.locator('[role=dialog]');
    await expect(dlg).toBeVisible();
    await page.getByTestId('composer-input').fill('x'.repeat(265));
    await dlg.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const { seen, bad } = await page.evaluate(scanTargets, '[role=dialog]');
    expect(seen).toBeGreaterThan(2);
    expect(bad).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('lightbox: targets and contrast (owner tools included)', async ({ page }, testInfo) => {
    await setup(page);
    await page.goto('/gallery');
    await page.getByTestId('gallery-tile').first().locator('.tile__open').click();
    const lb = page.getByTestId('lightbox');
    await expect(lb).toBeVisible();
    await expect(page.getByTestId('lightbox-alt-input')).toBeVisible();
    await lb.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const { seen, bad } = await page.evaluate(scanTargets, '[data-testid=lightbox]');
    expect(seen).toBeGreaterThan(2);
    expect(bad).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (projectIs(testInfo, 'desktop', 'desktop-dark')) {
      const c = await page.evaluate(scanContrast, '[data-testid=lightbox]');
      expect(c.fails).toEqual([]);
    }
  });

  test('post menu and delete confirm: targets and contrast', async ({ page }, testInfo) => {
    await setup(page);
    await page.goto('/');
    const card = page.getByTestId('post-card').first();
    await expect(card).toBeVisible();
    await card.getByTestId('post-menu').click();
    await expect(card.getByRole('menu')).toBeVisible();
    let r = await page.evaluate(scanTargets, '.postmenu');
    expect(r.seen).toBeGreaterThan(2);
    expect(r.bad).toEqual([]);
    if (projectIs(testInfo, 'desktop', 'desktop-dark')) {
      const c = await page.evaluate(scanContrast, '.postmenu');
      expect(c.fails).toEqual([]);
    }
    await card.getByRole('menuitem', { name: /ลบ/ }).click();
    const confirm = page.getByTestId('confirm-dialog');
    await expect(confirm).toBeVisible();
    await confirm.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    r = await page.evaluate(scanTargets, '[data-testid=confirm-dialog]');
    expect(r.bad).toEqual([]);
    if (projectIs(testInfo, 'desktop', 'desktop-dark')) {
      const c = await page.evaluate(scanContrast, '[data-testid=confirm-dialog]');
      expect(c.fails).toEqual([]);
    }
    await page.getByTestId('confirm-cancel').click();
  });
});

// ---------------------------------------------------------------------------------------------
// Contrast (light on `desktop`, dark on `desktop-dark`)

for (const route of ROUTES) {
  test(`contrast >= 4.5 (3 for large text) on ${route.path}`, async ({ page }, testInfo) => {
    test.skip(!projectIs(testInfo, 'desktop', 'desktop-dark'), 'measured in light (desktop) and dark (desktop-dark)');
    const me = await setup(page);
    await visit(page, route, me);
    await settle(page);
    const scheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    expect(scheme).toBe(testInfo.project.name === 'desktop-dark');
    const { scanned, fails } = await page.evaluate(scanContrast, null);
    expect(scanned).toBeGreaterThan(5);
    expect(fails).toEqual([]);
  });
}

test('contrast: composer counter (warn, error), liked card, open comments', async ({ page }, testInfo) => {
  test.skip(!projectIs(testInfo, 'desktop', 'desktop-dark'), 'measured in light (desktop) and dark (desktop-dark)');
  await setup(page);
  await page.goto('/');
  const input = page.getByTestId('composer-input');
  await expect(input).toBeVisible();
  for (const n of [265, 280, 290]) {
    await input.fill('x'.repeat(n));
    await expect(page.getByTestId('composer-count')).toBeVisible();
    await settle(page);
    const c = await page.evaluate(scanContrast, '[data-testid=composer]');
    expect(c.fails, `composer at ${n} chars`).toEqual([]);
  }
  const card = page.getByTestId('post-card').nth(1);
  await card.getByTestId('like-btn').click();
  await expect(card.getByTestId('like-btn')).toHaveAttribute('aria-pressed', 'true');
  await card.getByTestId('comment-toggle').click();
  await expect(card.locator('.thread')).toBeVisible();
  await settle(page);
  const c = await page.evaluate(scanContrast, '[data-testid=post-card]:nth-of-type(2)');
  expect(c.fails).toEqual([]);
  await card.getByTestId('like-btn').click();
});

test('contrast: hover states of nav, buttons, chips and links', async ({ page }, testInfo) => {
  test.skip(!projectIs(testInfo, 'desktop', 'desktop-dark'), 'hover needs a pointer: desktop, light and dark');
  await setup(page);
  const hovered = async (sel) => {
    await page.locator(sel).first().hover();
    await settle(page);
    const c = await page.evaluate(scanContrast, sel);
    expect(c.scanned, sel).toBeGreaterThan(0);
    expect(c.fails, `hover ${sel}`).toEqual([]);
  };
  await page.goto('/');
  await expect(page.getByTestId('post-card').first()).toBeVisible();
  for (const sel of ['.sidenav a[data-nav=gallery]', '.sidenav a[data-nav=test]', '.sidenav__post', '[data-testid=like-btn]', '[data-testid=comment-toggle]', '.post__name a']) await hovered(sel);
  await page.goto('/gallery');
  await expect(page.getByTestId('gallery-tile').first()).toBeVisible();
  for (const sel of ['[data-testid=gallery-sort-latest]', '[data-testid=gallery-sort-mine]', '[data-testid=gallery-tile]']) await hovered(sel);
  await page.goto('/u/seed_001');
  await expect(page.getByTestId('profile-header')).toBeVisible();
  await hovered('[role=tab]:not([aria-selected=true])');
});

test('contrast: live pill and toast', async ({ page }, testInfo) => {
  test.skip(!projectIs(testInfo, 'desktop', 'desktop-dark'), 'measured in light (desktop) and dark (desktop-dark)');
  await setup(page);
  const other = await createUser();
  await page.goto('/');
  await expect(page.getByTestId('post-card').first()).toBeVisible();
  await expect(page.locator('html[data-sse="open"]')).toHaveCount(1, { timeout: 10_000 });
  await page.request.post('/api/posts', { headers: auth(other), data: { body: `pill-${other.handle}` } });
  await expect(page.getByTestId('live-pill')).toBeVisible({ timeout: 5000 });
  await page.evaluate(async () => {
    const { toast } = await import('/js/ui/toast.js');
    toast('บันทึกแล้ว');
    toast('มีบางอย่างผิดพลาด', { error: true });
  });
  await expect(page.getByTestId('toast')).toHaveCount(2);
  await settle(page); // let the entrance fade finish: mid-fade opacity would read as low contrast
  for (const sel of ['[data-testid=live-pill]', '[data-testid=toast]']) {
    const c = await page.evaluate(scanContrast, sel);
    expect(c.fails).toEqual([]);
  }
});

// ---------------------------------------------------------------------------------------------
// No horizontal scroll (the 360 floor is the mobile-360 project; the check is cheap everywhere)

for (const route of ROUTES) {
  test(`no horizontal scroll on ${route.path}`, async ({ page }) => {
    const me = await setup(page);
    await visit(page, route, me);
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth,
    }));
    expect(m.scroll).toBeLessThanOrEqual(m.inner);
    expect(m.body).toBeLessThanOrEqual(m.inner);
  });
}

// ---------------------------------------------------------------------------------------------
// CSP + page errors on every route

for (const route of ROUTES) {
  test(`no CSP violations or page errors on ${route.path}`, async ({ page }) => {
    const me = await setup(page);
    await visit(page, route, me);
    await page.waitForTimeout(400);
    // afterEach asserts the collected `problems` stay empty.
  });
}

test('no CSP violations or page errors when signed out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('signup-dialog')).toBeVisible();
  await page.waitForTimeout(400);
});

// ---------------------------------------------------------------------------------------------
// CLS

test('CLS < 0.02 while loading the feed, loading page 2 and receiving 2 SSE posts', async ({ page }) => {
  await setup(page);
  const other = await createUser();
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      window.__clsObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      });
      window.__clsObs.observe({ type: 'layout-shift', buffered: true });
    } catch { /* unsupported */ }
  });
  await page.goto('/');
  const cards = page.getByTestId('post-card');
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('html[data-sse="open"]')).toHaveCount(1, { timeout: 10_000 });

  // Page 2 (infinite scroll): scroll to the bottom until more than one page of cards exists.
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    return cards.count();
  }, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(20);
  await expect(page.locator('.sk')).toHaveCount(0, { timeout: 10_000 });

  // Two SSE posts: the pill appears and updates its text, nothing may move.
  await page.request.post('/api/posts', { headers: auth(other), data: { body: `cls-1-${other.handle}` } });
  await expect(page.getByTestId('live-pill')).toHaveText('มีโพสต์ใหม่ 1 รายการ', { timeout: 5000 });
  await page.request.post('/api/posts', { headers: auth(other), data: { body: `cls-2-${other.handle}` } });
  await expect(page.getByTestId('live-pill')).toHaveText('มีโพสต์ใหม่ 2 รายการ', { timeout: 5000 });
  await page.waitForTimeout(300);

  const cls = await page.evaluate(() => {
    window.__clsObs?.takeRecords().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; });
    return window.__cls;
  });
  expect(cls).toBeLessThan(0.02);
});

// ---------------------------------------------------------------------------------------------
// First-visit signup background (DESIGN 4.12)

test('signup opens over 3 skeleton cards while the feed is still loading; background is inert', async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/\/api\/posts(\?|$)/, async (route) => { await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.getByTestId('signup-dialog')).toBeVisible();
  await expect(page.getByTestId('skeleton')).toHaveCount(3);
  await expect(page.locator('#main')).toHaveJSProperty('inert', true);
  release();
  await expect(page.getByTestId('post-card').first()).toBeAttached();
  await expect(page.getByTestId('skeleton')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Mobile live pill vs. top bar (item: never cover the wordmark or the gallery button)

test('live pill never covers the wordmark or the gallery icon (narrow screens)', async ({ page }) => {
  test.skip(!isNarrow(page), 'top bar exists below 720 px only');
  await setup(page);
  const other = await createUser();
  await page.goto('/');
  await expect(page.getByTestId('post-card').first()).toBeVisible();
  await expect(page.locator('html[data-sse="open"]')).toHaveCount(1, { timeout: 10_000 });
  await page.request.post('/api/posts', { headers: auth(other), data: { body: `pillpos-${other.handle}` } });
  const pill = page.getByTestId('live-pill');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: `test-results/screens/pill-${page.viewportSize().width}.png` });
  const pb = await pill.boundingBox();
  for (const sel of ['.topbar .wordmark', '.topbar__gallery']) {
    const b = await page.locator(sel).boundingBox();
    const overlap = pb.x < b.x + b.width && pb.x + pb.width > b.x && pb.y < b.y + b.height && pb.y + pb.height > b.y;
    expect(overlap, `${sel} overlapped by the pill`).toBe(false);
  }
  // Scrolled down the top bar is gone; the pill stays reachable and inside the viewport.
  await page.evaluate(() => window.scrollTo(0, 1200));
  const after = await pill.boundingBox();
  expect(after.y).toBeGreaterThanOrEqual(0);
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.x + after.width).toBeLessThanOrEqual(page.viewportSize().width);
});

// ---------------------------------------------------------------------------------------------
// Keyboard

test('Tab from the top reaches the first post like button (desktop)', async ({ page }, testInfo) => {
  test.skip(!projectIs(testInfo, 'desktop', 'desktop-dark'), 'desktop tab order');
  await setup(page);
  await page.goto('/');
  const first = page.getByTestId('post-card').first();
  await expect(first).toBeVisible();
  let reached = false;
  const trail = [];
  for (let i = 0; i < 40 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      return { testid: a?.getAttribute('data-testid') ?? '', label: a?.getAttribute('aria-label') ?? a?.textContent?.trim().slice(0, 20) ?? '', inFirst: !!a?.closest('[data-testid=post-card]') && a.closest('[data-testid=post-card]') === document.querySelector('[data-testid=post-card]') };
    });
    trail.push(info.testid || info.label);
    reached = info.testid === 'like-btn' && info.inFirst;
  }
  expect(reached, `tab trail: ${trail.join(' > ')}`).toBe(true);
  // Focus ring is visible: the outline is drawn (non-zero width) on the focused control.
  const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

// ---------------------------------------------------------------------------------------------
// Reduced motion

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('skeletons do not animate and nothing transitions', async ({ page }) => {
    await setup(page);
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(/\/api\/posts(\?|$)/, async (route) => { await gate; await route.continue(); });
    await page.goto('/');
    await expect(page.getByTestId('skeleton').first()).toBeVisible();

    const ms = (list) => list.split(',').map((s) => {
      const v = s.trim();
      return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
    });
    const readSkeleton = () => page.evaluate(() => [...document.querySelectorAll('.sk, [data-testid=skeleton]')].map((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, duration: cs.animationDuration };
    }));
    const sks = await readSkeleton();
    expect(sks.length).toBeGreaterThan(3);
    for (const s of sks) {
      const quiet = s.name === 'none' || ms(s.duration).every((d) => d <= 0.0100001);
      expect(quiet, `skeleton animation ${s.name} ${s.duration}`).toBe(true);
    }
    release();
    await expect(page.getByTestId('post-card').first()).toBeVisible();

    const loud = await page.evaluate(() => {
      const toMs = (list) => list.split(',').map((s) => { const v = s.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; });
      const out = [];
      for (const el of document.querySelectorAll('button, a, input, textarea, select, [role=tab], .btn, .icon-btn, *')) {
        const cs = getComputedStyle(el);
        if (toMs(cs.transitionDuration).some((d) => d > 0.0100001)) out.push(`${el.tagName}.${el.className} transition ${cs.transitionDuration}`);
        if (cs.animationName !== 'none' && toMs(cs.animationDuration).some((d) => d > 0.0100001)) out.push(`${el.tagName}.${el.className} animation ${cs.animationName} ${cs.animationDuration}`);
      }
      return [...new Set(out)].slice(0, 20);
    });
    expect(loud).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  });
});
