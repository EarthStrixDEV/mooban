import { test, expect, request as pwRequest } from '@playwright/test';
import { createUser, signedInPage } from './fixtures.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:8081';
const TEST_TOKEN = { 'X-Test-Token': 'dev-test-token-0123456789abcd' };

// The shared dev DB also holds posts from other suites, so exact counts (20 / 40 / 45) are checked
// against the seeded posts only: seedFeed() serves them through the same /api/posts contract.
let seedPosts = [];

test.beforeAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  const seeded = await api.post('/api/test/seed?users=2&posts=45&images=5&reset=1', { headers: TEST_TOKEN });
  expect(seeded.ok()).toBeTruthy();
  seedPosts = [];
  for (const handle of ['seed_001', 'seed_002']) {
    const res = await api.get(`/api/posts?user=${handle}&limit=50`);
    seedPosts.push(...(await res.json()).data);
  }
  seedPosts.sort((a, b) => b.id - a.id);
  expect(seedPosts).toHaveLength(45);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  await api.delete('/api/test/seed', { headers: TEST_TOKEN });
  await api.dispose();
});

let problems;
test.beforeEach(async ({ page }) => {
  await signedInPage(page);
  problems = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

async function seedFeed(page, { delay = 0 } = {}) {
  let first = true;
  await page.route(/\/api\/posts(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get('limit') || 20);
    const before = url.searchParams.get('before');
    if (first && delay) await new Promise((r) => setTimeout(r, delay));
    first = false;
    const rest = before ? seedPosts.filter((p) => p.id < Number(before)) : seedPosts;
    const data = rest.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, next_before: rest.length > limit ? data.at(-1).id : null }),
    });
  });
}

const cards = (page) => page.locator('[data-testid=post-card]');
const scrollToEnd = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

async function scrollUntil(page, n) {
  await expect.poll(async () => {
    await scrollToEnd(page);
    return cards(page).count();
  }, { timeout: 15_000 }).toBe(n);
}

test('first load shows skeletons then 20 cards, scrolls to 40 then everything', async ({ page }) => {
  await seedFeed(page, { delay: 700 });
  await page.goto('/');
  const sk = page.locator('[data-testid=skeleton]');
  await expect(sk).toHaveCount(3);
  await expect(sk.first()).toHaveAttribute('role', 'status');
  await expect(sk.first()).toHaveAttribute('aria-label', 'กำลังโหลดโพสต์เพิ่ม');
  await expect(cards(page)).toHaveCount(20);
  await expect(sk).toHaveCount(0);

  await scrollUntil(page, 40);
  await scrollUntil(page, 45);
  await expect(page.getByText('ดูครบทุกโพสต์แล้ว')).toBeVisible();
  const ids = await cards(page).evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test('card with an image reserves its box and is lazy with alt', async ({ page }) => {
  await seedFeed(page);
  await page.goto('/');
  await scrollUntil(page, 45);
  const img = page.locator('[data-testid=post-card] img').first();
  await expect(img).toHaveCount(1);
  for (const a of ['width', 'height']) {
    expect(Number(await img.getAttribute(a))).toBeGreaterThan(0);
  }
  await expect(img).toHaveAttribute('loading', 'lazy');
  await expect(img).toHaveAttribute('decoding', 'async');
  expect((await img.getAttribute('alt')).length).toBeGreaterThan(0);
  expect(await img.evaluate((e) => e.style.aspectRatio)).not.toBe('');
  const open = page.locator('.post__img-open').first();
  await expect(open).toHaveAttribute('aria-label', /^เปิดรูป /);
});

test('card header links to the author and shows time', async ({ page }) => {
  await page.goto('/');
  const card = cards(page).first();
  await expect(card).toBeVisible();
  const handle = (await card.locator('.post__handle').textContent()).replace('@', '');
  await expect(card.locator('.post__name a')).toHaveAttribute('href', `/u/${handle}`);
  expect(await card.locator('time').getAttribute('datetime')).toBeTruthy();
  await expect(card.locator('.avatar')).toHaveAttribute('aria-hidden', 'true');
  await expect(card.locator('.post__actions')).toHaveCount(1);
  await expect(card.locator('.post__menu-slot')).toHaveCount(1);
});

test('empty feed shows the empty message', async ({ page }) => {
  await page.route(/\/api\/posts(\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], next_before: null }),
  }));
  await page.goto('/');
  await expect(page.getByText('ยังไม่มีโพสต์ในหมู่บ้าน เป็นคนแรกที่โพสต์เลย')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-testid=skeleton]')).toHaveCount(0);
});

test('server error shows retry that recovers', async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/posts(\?|$)/, (route) => {
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'server_error' }),
      });
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('โหลดโพสต์ไม่สำเร็จ')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(cards(page)).toHaveCount(20);
  await expect(page.getByText('โหลดโพสต์ไม่สำเร็จ')).toHaveCount(0);
});

test('later page error appears at the end and retry continues', async ({ page }) => {
  let fail = false;
  await page.route(/\/api\/posts\?.*before=/, (route) => {
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'server_error' }),
      });
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(cards(page)).toHaveCount(20);
  fail = true;
  await scrollToEnd(page);
  await expect(page.getByText('โหลดโพสต์ไม่สำเร็จ')).toBeVisible();
  await expect(cards(page)).toHaveCount(20);
  fail = false;
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await scrollUntil(page, 40);
});

test('post body renders as text, never as HTML', async ({ page }) => {
  const user = await createUser();
  const payload = '<img src=x onerror=alert(1)>';
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${user.token}` } });
  const created = await api.post('/api/posts', { data: { body: payload } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    let dialogs = 0;
    page.on('dialog', async (d) => { dialogs += 1; await d.dismiss(); });
    await page.goto('/');
    const card = page.locator(`[data-testid=post-card][data-id="${id}"]`);
    await expect(card.locator('.post__body')).toHaveText(payload);
    await expect(card.locator('.post__body img')).toHaveCount(0);
    await expect(card.locator('img')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toBe(0);
  } finally {
    await api.delete(`/api/posts/${id}`);
    await api.dispose();
  }
});

test('long text wraps without horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(cards(page).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('desktop rail shows latest images and live status', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'rail is desktop only');
  await page.goto('/');
  const rail = page.locator('.rail');
  await expect(rail.getByRole('heading', { name: 'ภาพล่าสุด' })).toBeVisible();
  await expect(rail.getByRole('link', { name: 'ดูทั้งหมด' })).toHaveAttribute('href', '/gallery');
  const tiles = rail.locator('a[aria-label^="เปิดรูป"]');
  await expect(tiles.first()).toBeVisible();
  const n = await tiles.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(6);
  await expect(tiles.first()).toHaveAttribute('href', '/gallery');
  await expect(rail.locator('#live-status')).toContainText('สถานะฟีดสด');
  await expect(rail.locator('#live-status')).toContainText('กำลังเชื่อมต่อ…');
  await expect(rail).not.toContainText('ออนไลน์ตอนนี้');
});

test('rail hides the image card when there are no images', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'rail is desktop only');
  await page.route(/\/api\/images(\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], next_before: null }),
  }));
  await page.goto('/');
  await expect(page.locator('#live-status')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ภาพล่าสุด' })).toHaveCount(0);
});

test('mobile feed has a composer slot and no rail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile only');
  await page.goto('/');
  await expect(page.locator('#composer-slot')).toHaveCount(1);
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.topbar__gallery')).toBeVisible();
});

test('own post uses the brandsoft avatar after /api/me resolves', async ({ page }) => {
  const user = await createUser();
  await page.addInitScript((t) => { localStorage.setItem('mb_token', t); }, user.token);
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${user.token}` } });
  const { id } = await (await api.post('/api/posts', { data: { body: 'โพสต์ของฉัน' } })).json();
  try {
    await page.goto('/');
    const card = page.locator(`[data-testid=post-card][data-id="${id}"]`);
    await expect(card.locator('.avatar')).toHaveClass(/avatar--me/);
    await expect(card.locator('.avatar')).toHaveText(Array.from(user.display_name)[0]);
  } finally {
    await api.delete(`/api/posts/${id}`);
    await api.dispose();
  }
});
