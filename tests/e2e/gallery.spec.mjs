import { readFileSync } from 'node:fs';
import { request as pwRequest } from '@playwright/test';
import { test, expect, createUser, signedInPage, resetRateLimits } from './fixtures.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:8081';
const TEST_TOKEN = { 'X-Test-Token': 'dev-test-token-0123456789abcd' };
const SAMPLE = readFileSync(new URL('../../shared/public/sample.jpg', import.meta.url));

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const isMobile = (page) => (page.viewportSize()?.width ?? 0) < 720;
const tiles = (page) => page.getByTestId('gallery-tile');
const tile = (page, id) => page.locator(`[data-testid=gallery-tile][data-id="${id}"]`);
const lb = (page) => page.getByTestId('lightbox');
const toast = (page, text) => page.getByTestId('toast').filter({ hasText: text });

// 60 seeded images (2 users) make sure the first page is full and a second page exists.
test.beforeAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  const seeded = await api.post('/api/test/seed?users=2&posts=60&images=60&reset=1', { headers: TEST_TOKEN });
  expect(seeded.ok()).toBeTruthy();
  await api.dispose();
});

test.afterAll(async () => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  await api.delete('/api/test/seed', { headers: TEST_TOKEN });
  await api.dispose();
});

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

async function upload(page, user, alt) {
  const multipart = { file: { name: 'sample.jpg', mimeType: 'image/jpeg', buffer: SAMPLE } };
  if (alt) multipart.alt = alt;
  const res = await page.request.post('/api/images', { headers: auth(user), multipart });
  expect(res.status()).toBe(201);
  return res.json();
}

async function ownImages(page, n = 2) {
  await resetRateLimits();
  const me = await createUser({ display_name: 'มินจู' });
  const images = [];
  for (let i = 0; i < n; i += 1) images.push(await upload(page, me, i === 0 ? '' : `รูปเดิม ${i}`));
  await signedInPage(page, me);
  return { me, images };
}

test('masonry: 4 columns on desktop / 2 on mobile, space reserved before load, tiles stay in their column', async ({ page }) => {
  await signedInPage(page);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/\/media\/[^/]+\/thumb\./, async (route) => { await gate; await route.continue(); });
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeAttached();

  await expect(page.locator('[data-testid=gallery-grid] > ul')).toHaveCount(isMobile(page) ? 2 : 4);
  const reserved = await tiles(page).evaluateAll((els) => els.map((li) => ({
    ratio: getComputedStyle(li).aspectRatio,
    height: li.getBoundingClientRect().height,
  })));
  expect(reserved).toHaveLength(40);
  for (const r of reserved) {
    expect(r.ratio).not.toBe('auto');
    expect(r.height).toBeGreaterThan(0);
  }
  release();

  const columnOf = () => tiles(page).evaluateAll((els) => Object.fromEntries(
    els.map((li) => [li.dataset.id, [...li.parentElement.parentElement.children].indexOf(li.parentElement)])));
  const before = await columnOf();
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    return tiles(page).count();
  }).toBeGreaterThan(40);
  const after = await columnOf();
  for (const [id, col] of Object.entries(before)) expect(after[id]).toBe(col);
});

test('lightbox: focus on close, arrows, Esc restores focus, Back closes it and keeps /gallery', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  const n = await tiles(page).count();
  const first = tiles(page).first();
  const id = await first.getAttribute('data-id');
  await page.locator('[data-testid=gallery-grid]').evaluate((el) => { el.dataset.mark = 'kept'; });

  await first.locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await expect(lb(page)).toHaveAttribute('role', 'dialog');
  await expect(lb(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('lightbox-close')).toBeFocused();
  const count = page.locator('.lightbox__count');
  await expect(count).toHaveText(`1 / ${n}`);
  await page.keyboard.press('ArrowRight');
  await expect(count).toHaveText(`2 / ${n}`);
  await page.getByTestId('lightbox-prev').click();
  await expect(count).toHaveText(`1 / ${n}`);

  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect(tile(page, id).locator('.tile__open')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.history.state)).toBeNull();

  await first.locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.state?.lb ?? null)).not.toBeNull();
  await page.goBack();
  await expect(lb(page)).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/gallery');
  await expect(page.locator('[data-testid=gallery-grid]')).toHaveAttribute('data-mark', 'kept');
  await expect(tiles(page)).toHaveCount(n);
});

test('lightbox layout: dark full screen with swipe on mobile, 980x640 dialog on desktop', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  const n = await tiles(page).count();
  await tiles(page).first().locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();

  if (isMobile(page)) {
    await expect(lb(page)).toHaveClass(/lightbox--dark/);
    await expect(lb(page)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    const hint = page.locator('.lightbox__hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('บีบนิ้วเพื่อซูม · ปัดซ้าย-ขวาเพื่อเปลี่ยนรูป');
    await expect(hint).toBeHidden({ timeout: 5000 });
    await expect(page.locator('.lightbox__img')).toHaveCSS('touch-action', 'pinch-zoom');

    const stage = page.locator('.lightbox__stage');
    const swipe = async (from, to) => {
      const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true };
      await stage.dispatchEvent('pointerdown', { ...init, clientX: from, clientY: 300 });
      await stage.dispatchEvent('pointerup', { ...init, clientX: to, clientY: 305 });
    };
    await swipe(300, 200);
    await expect(page.locator('.lightbox__count')).toHaveText(`2 / ${n}`);
    await swipe(200, 230); // 30 px is below the threshold
    await expect(page.locator('.lightbox__count')).toHaveText(`2 / ${n}`);
    await swipe(100, 220);
    await expect(page.locator('.lightbox__count')).toHaveText(`1 / ${n}`);

    // The hint is shown on the first open of the session only.
    await page.keyboard.press('Escape');
    await tiles(page).first().locator('.tile__open').click();
    await expect(lb(page)).toBeVisible();
    await expect(page.locator('.lightbox__hint')).toBeHidden();
  } else {
    await expect(lb(page)).not.toHaveClass(/lightbox--dark/);
    const box = await page.locator('.lightbox__frame').boundingBox();
    expect(Math.round(box.width)).toBe(980);
    expect(Math.round(box.height)).toBe(640);
    await expect(page.locator('#lb-title')).toBeVisible();
    await expect(page.locator('.lightbox__dims')).toContainText(' × ');
    await expect(page.locator('.lightbox__dims')).toContainText(' KB');
  }
});

test('own image: edit alt, two-step delete; images of others have no owner tools', async ({ page }) => {
  const { me, images } = await ownImages(page, 2);
  const [plain, described] = images; // described is newer
  await page.goto('/gallery');
  const sub = page.locator('.gallery__sub');
  await expect(sub).toHaveText(/^รูปจากทุกคนในหมู่บ้าน \d+ รูป$/);
  const total = Number((await sub.innerText()).match(/\d+/)[0]);

  await tile(page, described.id).locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-alt-input')).toHaveValue('รูปเดิม 1');
  await page.getByTestId('lightbox-alt-input').fill('แมวนอนหน้าบ้าน');
  await page.getByTestId('lightbox-alt-save').click();
  await expect(toast(page, 'บันทึกคำอธิบายแล้ว')).toBeVisible();
  await expect(tile(page, described.id).locator('.tile__open')).toHaveAttribute('aria-label', 'เปิดรูป แมวนอนหน้าบ้าน');
  await expect(tile(page, described.id).locator('img')).toHaveAttribute('alt', 'แมวนอนหน้าบ้าน');
  if (!isMobile(page)) await expect(page.locator('#lb-title')).toHaveText('แมวนอนหน้าบ้าน');
  const saved = await (await page.request.get(`/api/images?user=${me.handle}`)).json();
  expect(saved.data.find((i) => i.id === described.id).alt).toBe('แมวนอนหน้าบ้าน');

  // First click arms the button for 4 s, then it goes back.
  const del = page.getByTestId('lightbox-delete');
  await expect(del).toHaveText('ลบรูป');
  await del.click();
  await expect(del).toHaveText('ยืนยันลบ');
  await expect(del).toHaveText('ลบรูป', { timeout: 6000 });

  await del.click();
  await expect(del).toHaveText('ยืนยันลบ');
  await del.click();
  await expect(tile(page, described.id)).toHaveCount(0);
  await expect(sub).toHaveText(`รูปจากทุกคนในหมู่บ้าน ${total - 1} รูป`);
  // The lightbox moved on to the next image (the other own one).
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-alt-input')).toBeVisible();
  expect((await page.request.get(`/api/images?user=${me.handle}`).then((r) => r.json())).data.map((i) => i.id)).toEqual([plain.id]);

  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);

  // Someone else's image: no owner tools at all.
  await tiles(page).filter({ hasText: '@seed_' }).first().locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-delete')).toHaveCount(0);
  await expect(page.getByTestId('lightbox-alt-input')).toHaveCount(0);
  await expect(page.getByTestId('lightbox-alt-save')).toHaveCount(0);
});

test('alt validation error from the server is shown under the field', async ({ page }) => {
  const { images } = await ownImages(page, 1);
  await page.goto('/gallery');
  await tile(page, images[0].id).locator('.tile__open').click();
  await page.getByTestId('lightbox-alt-input').fill('ก'.repeat(201));
  await page.getByTestId('lightbox-alt-save').click();
  await expect(page.locator('#lb-alt-err')).toHaveText('ยาวเกิน 200 ตัวอักษร');
  await expect(toast(page, 'บันทึกคำอธิบายแล้ว')).toHaveCount(0);
});

test('"ของฉัน" keeps only my images, there is no "ถูกใจมากสุด" chip', async ({ page }) => {
  const { me, images } = await ownImages(page, 2);
  await page.goto('/gallery');
  const group = page.getByRole('group', { name: 'เรียงรูป' });
  await expect(group.getByRole('button')).toHaveText(['ล่าสุด', 'ของฉัน']);
  await expect(page.getByText('ถูกใจมากสุด')).toHaveCount(0);
  await expect(page.getByTestId('gallery-sort-latest')).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, images[0].id)).toBeVisible();

  await page.getByTestId('gallery-sort-mine').click();
  await expect(page.getByTestId('gallery-sort-mine')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gallery-sort-latest')).toHaveAttribute('aria-pressed', 'false');
  await expect(tiles(page)).toHaveCount(2);
  const badges = await page.locator('.tile__badge').allInnerTexts();
  expect(badges).toEqual([`@${me.handle}`, `@${me.handle}`]);

  await page.getByTestId('gallery-sort-latest').click();
  await expect.poll(() => tiles(page).count()).toBeGreaterThan(2);
});

test('empty states and first-load placeholder', async ({ page }) => {
  await resetRateLimits();
  const me = await createUser({ display_name: 'ไม่มีรูป' });
  await signedInPage(page, me);
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  await page.getByTestId('gallery-sort-mine').click();
  await expect(page.getByText('คุณยังไม่ได้อัปโหลดรูป')).toBeVisible();

  // Whole village empty, with a slow first response to see the placeholder.
  await page.route(/\/api\/images(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_before: null }) });
  });
  await page.getByTestId('gallery-sort-latest').click();
  const ph = page.getByRole('status', { name: 'กำลังโหลดรูป' });
  await expect(ph).toHaveCount(1);
  await expect(ph.locator('> *')).toHaveCount(8);
  await expect(page.getByText('ยังไม่มีรูปในหมู่บ้าน')).toBeVisible();
  await expect(page.getByText('แนบรูปกับโพสต์เพื่อเริ่มต้น')).toBeVisible();
});

test('feed: clicking a post image opens the lightbox and Esc returns focus', async ({ page }) => {
  const { me, images } = await ownImages(page, 1);
  const res = await page.request.post('/api/posts', { headers: auth(me), data: { body: `img-${me.handle}`, image_id: images[0].id } });
  expect(res.status()).toBe(201);
  const post = await res.json();
  await page.goto('/');
  const open = page.locator(`[data-testid=post-card][data-id="${post.id}"] .post__img-open`);
  await open.click();
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-close')).toBeFocused();
  await expect(page.getByTestId('lightbox-alt-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('every open dialog closes when the route changes', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  await page.evaluate(async () => {
    const { openDialog } = await import('/js/ui/dialog.js');
    const el = document.createElement('div');
    el.id = 'probe';
    el.textContent = 'probe';
    window.__probeClosed = false;
    openDialog(el, { onClose: () => { window.__probeClosed = true; } });
  });
  await expect(page.locator('#probe')).toHaveCount(1);
  await page.evaluate(async () => {
    const { navigate } = await import('/js/router.js');
    await navigate('/test');
  });
  await expect(page.locator('#probe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__probeClosed)).toBe(true);
});

const focusInMain = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a !== document.body && !!a?.closest('main');
});

async function deleteOpenImage(page) {
  const del = page.getByTestId('lightbox-delete');
  await del.click();
  await expect(del).toHaveText('ยืนยันลบ');
  await del.click();
}

test('gallery: after deleting the open image, Esc leaves focus on a tile inside main, never on body', async ({ page }) => {
  const { images } = await ownImages(page, 2);
  await page.goto('/gallery');
  await tile(page, images[1].id).locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await deleteOpenImage(page);
  await expect(tile(page, images[1].id)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect.poll(() => focusInMain(page)).toBe(true);
  // The image on screen when it closed (the other own one) gets the focus.
  await expect(tile(page, images[0].id).locator('.tile__open')).toBeFocused();
});

test('gallery: deleting the only image of "ของฉัน" still lands focus inside main', async ({ page }) => {
  const { images } = await ownImages(page, 1);
  await page.goto('/gallery');
  await page.getByTestId('gallery-sort-mine').click();
  await tile(page, images[0].id).locator('.tile__open').click();
  await deleteOpenImage(page);
  await expect(lb(page)).toHaveCount(0); // the last image closes the lightbox itself
  await expect.poll(() => focusInMain(page)).toBe(true);
});

test('feed: after deleting the open image, Esc leaves focus inside main, never on body', async ({ page }) => {
  const { me, images } = await ownImages(page, 1);
  const res = await page.request.post('/api/posts', { headers: auth(me), data: { body: `del-${me.handle}`, image_id: images[0].id } });
  expect(res.status()).toBe(201);
  const post = await res.json();
  await page.goto('/');
  const card = page.locator(`[data-testid=post-card][data-id="${post.id}"]`);
  await card.locator('.post__img-open').click();
  await expect(lb(page)).toBeVisible();
  await deleteOpenImage(page);
  await expect(card.locator('.post__img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect.poll(() => focusInMain(page)).toBe(true);
});

test('route change from an open lightbox replaces its history entry: Back goes to /gallery with no lightbox', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/gallery');
  await tiles(page).first().locator('.tile__open').click();
  await expect(lb(page)).toBeVisible();
  await page.evaluate(async () => {
    const { navigate } = await import('/js/router.js');
    await navigate('/test');
  });
  await expect(lb(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/test$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(lb(page)).toHaveCount(0);
  await expect(tiles(page).first()).toBeVisible();
});

test('closeAllDialogs leaves a dialog that is not dismissible right now; it closes once it is', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  await page.evaluate(async () => {
    const { openDialog } = await import('/js/ui/dialog.js');
    const el = document.createElement('div');
    el.id = 'busy';
    el.textContent = 'busy';
    window.__locked = true;
    openDialog(el, { dismissible: () => !window.__locked });
  });
  await page.evaluate(async () => { const { navigate } = await import('/js/router.js'); await navigate('/test'); });
  await expect(page.locator('#busy')).toHaveCount(1);
  await page.evaluate(async () => {
    window.__locked = false;
    const { navigate } = await import('/js/router.js');
    await navigate('/gallery');
  });
  await expect(page.locator('#busy')).toHaveCount(0);
});

test('"ของฉัน" falls back to "ล่าสุด" when the user disappears before the next page loads', async ({ page }) => {
  const { me } = await ownImages(page, 1);
  const mineImages = await (await page.request.get(`/api/images?user=${me.handle}`)).json();
  await page.route(/\/api\/images\?.*user=/, async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mineImages.data, next_before: 'more' }) });
  });
  await page.goto('/gallery');
  await expect(tiles(page).first()).toBeVisible();
  await page.getByTestId('gallery-sort-mine').click();
  await page.evaluate(async () => { const { state } = await import('/js/store.js'); state.me = null; });
  await expect(page.getByTestId('gallery-sort-latest')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gallery-sort-mine')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => tiles(page).count()).toBeGreaterThan(1);
});
