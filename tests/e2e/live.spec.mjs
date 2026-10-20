import { test, expect, createUser, signedInPage } from './fixtures.mjs';

const card = (page, id) => page.locator(`[data-testid=post-card][data-id="${id}"]`);
const likeBtn = (page, id) => card(page, id).getByTestId('like-btn');
const toggle = (page, id) => card(page, id).getByTestId('comment-toggle');
const pill = (page) => page.getByTestId('live-pill');
const isMobile = (page) => (page.viewportSize()?.width ?? 0) < 720;
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

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

async function makePost(page, user, body) {
  const res = await page.request.post('/api/posts', { headers: auth(user), data: { body } });
  expect(res.status()).toBe(201);
  return res.json();
}

// A = viewer in the browser, B = actor through the API with its own token.
async function open(page, { posts = 1 } = {}) {
  const a = await createUser({ display_name: 'มินจู' });
  const b = await createUser({ display_name: 'บี' });
  const seeded = [];
  for (let i = 0; i < posts; i += 1) seeded.push(await makePost(page, b, `seed-${i}-${b.handle}`));
  await signedInPage(page, a);
  await page.goto('/');
  await expect(card(page, seeded.at(-1).id)).toBeVisible();
  // Events written before the stream opens are never replayed, so wait for it.
  await expect(page.locator('html[data-sse="open"]')).toHaveCount(1, { timeout: 10_000 });
  return { a, b, seeded };
}

test('new posts raise the pill without moving the feed; clicking merges them on top, newest first', async ({ page }) => {
  const { b, seeded } = await open(page);
  const first = card(page, seeded[0].id);
  const before = (await first.boundingBox()).y;
  await expect(page.locator('.live-pill-wrap[aria-live="polite"]')).toHaveCount(1);
  await expect(pill(page)).toHaveCount(0);

  const p1 = await makePost(page, b, `live-1-${b.handle}`);
  await expect(pill(page)).toHaveText('มีโพสต์ใหม่ 1 รายการ', { timeout: 3000 });
  const p2 = await makePost(page, b, `live-2-${b.handle}`);
  await expect(pill(page)).toHaveText('มีโพสต์ใหม่ 2 รายการ', { timeout: 3000 });
  expect((await first.boundingBox()).y).toBe(before);
  await expect(card(page, p1.id)).toHaveCount(0);

  await pill(page).click();
  await expect(pill(page)).toHaveCount(0);
  const ids = await page.locator('[data-testid=post-card]').evaluateAll((els) => els.slice(0, 3).map((e) => e.dataset.id));
  expect(ids).toEqual([String(p2.id), String(p1.id), String(seeded[0].id)]);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('my own post never raises the pill', async ({ page }) => {
  await open(page);
  if (isMobile(page)) await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
  const text = `mine-${Date.now()}`;
  await page.getByTestId('composer-input').fill(text);
  await page.getByTestId('composer-submit').click();
  await expect(page.locator('[data-testid=post-card]', { hasText: text })).toHaveCount(1);
  await page.waitForTimeout(2500); // longer than the server poll, so the echo has arrived
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator('[data-testid=post-card]', { hasText: text })).toHaveCount(1);
});

test('likes and comments from another user update counts live; aria-pressed stays', async ({ page }) => {
  const { seeded } = await open(page);
  const id = seeded[0].id;
  const c = await createUser({ display_name: 'ซี' });
  await expect(likeBtn(page, id)).toHaveAttribute('aria-pressed', 'false');

  expect((await page.request.put(`/api/posts/${id}/like`, { headers: auth(c) })).status()).toBe(200);
  await expect(likeBtn(page, id)).toHaveAttribute('aria-label', 'ถูกใจ 1', { timeout: 3000 });
  await expect(likeBtn(page, id)).toHaveAttribute('aria-pressed', 'false');

  await toggle(page, id).click();
  const thread = page.locator(`#thread-${id}`);
  await expect(thread.locator('.thread__status')).toHaveText('');
  const cm = await page.request.post(`/api/posts/${id}/comments`, { headers: auth(c), data: { body: 'จากซี' } });
  expect(cm.status()).toBe(201);
  const comment = await cm.json();
  await expect(toggle(page, id)).toHaveAttribute('aria-label', 'ความคิดเห็น 1', { timeout: 3000 });
  await expect(thread.locator('.comment', { hasText: 'จากซี' })).toHaveCount(1);
  await expect(thread.locator('.comment__del')).toHaveCount(0);

  const del = await page.request.delete(`/api/comments/${comment.id}`, { headers: auth(c) });
  expect(del.status()).toBeLessThan(300);
  await expect(toggle(page, id)).toHaveAttribute('aria-label', 'ความคิดเห็น 0', { timeout: 3000 });
  await expect(thread.locator('.comment')).toHaveCount(0);

  expect((await page.request.delete(`/api/posts/${id}/like`, { headers: auth(c) })).status()).toBe(200);
  await expect(likeBtn(page, id)).toHaveAttribute('aria-label', 'ถูกใจ 0', { timeout: 3000 });
});

test('a post deleted by someone else disappears from the feed', async ({ page }) => {
  const { b, seeded } = await open(page, { posts: 2 });
  const [gone, kept] = [seeded[1], seeded[0]];
  await expect(card(page, gone.id)).toBeVisible();
  const res = await page.request.delete(`/api/posts/${gone.id}`, { headers: auth(b) });
  expect(res.status()).toBeLessThan(300);
  await expect(card(page, gone.id)).toHaveCount(0, { timeout: 3000 });
  await expect(card(page, kept.id)).toBeVisible();
});

test('a post deleted above the viewport leaves a same-height placeholder so nothing jumps', async ({ page }) => {
  const { b, seeded } = await open(page, { posts: 6 });
  const topId = seeded.at(-1).id; // newest = first card
  const top = card(page, topId);
  const next = card(page, seeded.at(-2).id);
  await top.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY + 40));
  expect(await top.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);
  const height = await top.evaluate((el) => el.getBoundingClientRect().height);
  const nextY = (await next.boundingBox()).y;

  const res = await page.request.delete(`/api/posts/${topId}`, { headers: auth(b) });
  expect(res.status()).toBeLessThan(300);
  await expect(top).toContainText('โพสต์นี้ถูกลบแล้ว', { timeout: 3000 });
  expect(Math.abs((await top.evaluate((el) => el.getBoundingClientRect().height)) - height)).toBeLessThan(1);
  expect((await next.boundingBox()).y).toBeCloseTo(nextY, 0);
});

test('post.updated changes the card in place', async ({ page }) => {
  const { b, seeded } = await open(page);
  const id = seeded[0].id;
  const res = await page.request.put(`/api/posts/${id}`, { headers: auth(b), data: { body: 'แก้แล้วจากอีกเครื่อง' } });
  expect(res.status()).toBeLessThan(300);
  await expect(card(page, id).locator('.post__body')).toHaveText('แก้แล้วจากอีกเครื่อง', { timeout: 3000 });
});

test('429 on /api/stream shows the blocked message and does not hammer the endpoint', async ({ page }) => {
  let streamRequests = 0;
  await page.route('**/api/stream', (route) => {
    streamRequests += 1;
    return route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '30' },
      body: '{"error":"rate_limited"}',
    });
  });
  await signedInPage(page, await createUser());
  await page.goto('/');
  await expect(page.locator('html[data-sse="blocked"]')).toHaveCount(1, { timeout: 5000 });
  if (!isMobile(page)) {
    await expect(page.locator('#live-status [role=status]')).toHaveText('เชื่อมต่อสดไม่ได้ (มีการเชื่อมต่อมากเกินไป)');
  }
  await page.waitForTimeout(10_000);
  expect(streamRequests).toBeGreaterThan(0);
  expect(streamRequests).toBeLessThanOrEqual(5);
});

test('rail shows the connected state (desktop)', async ({ page }) => {
  test.skip(isMobile(page), 'the rail only exists on desktop');
  await open(page);
  await expect(page.locator('#live-status [role=status]')).toContainText('เชื่อมต่อแล้ว');
});

test('a stream reopened after the tab was hidden catches up on posts made during the gap', async ({ page }) => {
  await page.addInitScript(() => { window.__MB_HIDDEN_MS = 300; });
  const { b } = await open(page);
  const setHidden = (hidden) => page.evaluate((v) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

  await makePost(page, b, `before-${b.handle}`);
  await expect(pill(page)).toHaveText('มีโพสต์ใหม่ 1 รายการ', { timeout: 3000 });
  await setHidden(true);
  await page.waitForTimeout(600); // past the (test) threshold: the stream is closed now
  await makePost(page, b, `gap-${b.handle}`);
  await setHidden(false);
  await expect(pill(page)).toHaveText('มีโพสต์ใหม่ 2 รายการ', { timeout: 6000 });
});

test('mobile: the pill stays in view while scrolled down and nothing moves', async ({ page }) => {
  test.skip(!isMobile(page), 'mobile layout only');
  const { b, seeded } = await open(page, { posts: 14 });
  await page.evaluate(() => window.scrollTo(0, 1500));
  const probe = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid=post-card]')].find((c) => c.getBoundingClientRect().top > 0);
    return el.dataset.id;
  });
  const before = (await card(page, probe).boundingBox()).y;
  await makePost(page, b, `scrolled-${b.handle}`);
  await expect(pill(page)).toBeInViewport({ timeout: 3000 });
  expect((await card(page, probe).boundingBox()).y).toBe(before);
});
