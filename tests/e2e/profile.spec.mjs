import { readFileSync } from 'node:fs';
import { test, expect, createUser, signedInPage, resetRateLimits } from './fixtures.mjs';

const SAMPLE = readFileSync(new URL('../../shared/public/sample.jpg', import.meta.url));

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const isMobile = (page) => (page.viewportSize()?.width ?? 0) < 720;
const lb = (page) => page.getByTestId('lightbox');
const posts = (page) => page.getByTestId('post-card');
const photos = (page) => page.getByTestId('profile-photo');
const activePanel = (page) => page.locator('[data-testid=profile-panel]:not([hidden])');

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

async function addPost(page, user, body, image_id) {
  const res = await page.request.post('/api/posts', { headers: auth(user), data: image_id ? { body, image_id } : { body } });
  expect(res.status()).toBe(201);
  return res.json();
}

async function addImage(page, user) {
  const res = await page.request.post('/api/images', {
    headers: auth(user),
    multipart: { file: { name: 'sample.jpg', mimeType: 'image/jpeg', buffer: SAMPLE } },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

// A fresh author with `n` text posts, of which the first `withImages` carry an image.
async function author(page, { n = 2, withImages = 1, display_name = 'สมหญิง ใจดี' } = {}) {
  await resetRateLimits();
  const user = await createUser({ display_name });
  const made = [];
  for (let i = 0; i < n; i += 1) {
    const image = i < withImages ? await addImage(page, user) : null;
    made.push(await addPost(page, user, `โพสต์ที่ ${i + 1} ของ ${user.handle}`, image?.id));
  }
  return { user, made };
}

test('header, title and counts match the API; no edit button, bio, likes stat or village card', async ({ page }) => {
  const { user } = await author(page, { n: 3, withImages: 2 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  await expect(page).toHaveTitle(`@${user.handle} · Mooban`);

  const api = await (await page.request.get(`/api/users/${user.handle}`)).json();
  expect(api.post_count).toBe(3);
  expect(api.image_count).toBe(2);

  const header = page.getByTestId('profile-header');
  await expect(header).toBeVisible();
  const counts = page.getByTestId('profile-counts');
  await expect(counts).toContainText('โพสต์');
  await expect(counts).toContainText('รูป');
  await expect(counts.locator('dd')).toHaveText([String(api.post_count), String(api.image_count)]);
  await expect(counts.locator('dt')).toHaveText(['โพสต์', 'รูป']);
  await expect(header).toContainText('เข้าหมู่บ้านเมื่อ');

  await expect(page.getByText('แก้โปรไฟล์')).toHaveCount(0);
  await expect(page.getByText('ถูกใจ', { exact: true })).toHaveCount(0);
  await expect(page.getByText('คนในหมู่บ้าน')).toHaveCount(0);
  await expect(page.getByText('ออนไลน์ตอนนี้')).toHaveCount(0);

  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(user.display_name);
  if (isMobile(page)) {
    await expect(page.locator('.topbar h1')).toHaveText(user.display_name);
    await expect(page.locator('.topbar .wordmark')).toBeHidden();
    await expect(page.locator('.profile__banner')).toBeHidden();
    await expect(counts.locator('dd')).toHaveCount(2);
    await expect(page.locator('.profile__handle')).toBeHidden();
  } else {
    await expect(page.locator('main h1')).toHaveText(user.display_name);
    await expect(page.locator('.profile__banner')).toBeVisible();
    await expect(page.locator('.profile__banner')).toHaveAttribute('aria-hidden', 'true');
    await expect(header).toContainText(`@${user.handle} · เข้าหมู่บ้านเมื่อ`);
  }
});

test('mobile: back button (44x44) and the name as h1 in the top bar; desktop: banner + 88px avatar', async ({ page }) => {
  const { user } = await author(page, { n: 1, withImages: 0 });
  await signedInPage(page);
  await page.goto('/');
  await page.goto(`/u/${user.handle}`);
  await expect(page.getByTestId('profile-header')).toBeVisible();
  const avatar = page.locator('.profile__avatar');
  const box = await avatar.boundingBox();
  if (isMobile(page)) {
    const back = page.getByRole('button', { name: 'ย้อนกลับ' });
    await expect(back).toBeVisible();
    const b = await back.boundingBox();
    expect(Math.round(b.width)).toBe(44);
    expect(Math.round(b.height)).toBe(44);
    await expect(page.locator('.topbar').getByRole('heading', { level: 1 })).toHaveText(user.display_name);
    expect(Math.round(box.width)).toBe(72);
    await back.click();
    await expect(page).toHaveURL(/\/$/);
  } else {
    expect(Math.round(box.width)).toBe(88);
    await expect(page.locator('.profile__banner')).toHaveCSS('height', '140px');
  }
});

test('mobile back button falls back to the feed when there is no in-app history', async ({ page }) => {
  test.skip(!isMobile(page), 'the top bar only exists on mobile');
  const { user } = await author(page, { n: 1, withImages: 0 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  await expect(page.getByTestId('profile-header')).toBeVisible();
  await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('tablist: roles, aria wiring, roving tabindex, arrows / Home / End with automatic activation', async ({ page }) => {
  const { user } = await author(page, { n: 2, withImages: 1 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);

  const list = page.getByRole('tablist', { name: 'เนื้อหาโปรไฟล์' });
  await expect(list).toBeVisible();
  const tabPosts = page.getByTestId('profile-tab-posts');
  const tabPhotos = page.getByTestId('profile-tab-photos');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(tabPosts).toHaveAttribute('aria-selected', 'true');
  await expect(tabPhotos).toHaveAttribute('aria-selected', 'false');
  await expect(tabPosts).toHaveAttribute('tabindex', '0');
  await expect(tabPhotos).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('tab', { name: 'โพสต์' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^รูป/ })).toBeVisible();

  for (const tab of [tabPosts, tabPhotos]) {
    const controls = await tab.getAttribute('aria-controls');
    const id = await tab.getAttribute('id');
    await expect(page.locator(`#${controls}`)).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator(`#${controls}`)).toHaveAttribute('aria-labelledby', id);
  }
  await expect(activePanel(page)).toHaveCount(1);
  await expect(posts(page).first()).toBeVisible();
  // The photos panel has not been rendered yet.
  await expect(photos(page)).toHaveCount(0);

  await tabPosts.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabPhotos).toHaveAttribute('aria-selected', 'true');
  await expect(tabPhotos).toBeFocused();
  await expect(tabPosts).toHaveAttribute('aria-selected', 'false');
  await expect(tabPosts).toHaveAttribute('tabindex', '-1');
  await expect(tabPhotos).toHaveAttribute('tabindex', '0');
  await expect(photos(page)).toHaveCount(1);
  await expect(posts(page).first()).toBeHidden();

  await page.keyboard.press('ArrowRight'); // wraps
  await expect(tabPosts).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabPhotos).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabPosts).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); // wraps back
  await expect(tabPhotos).toHaveAttribute('aria-selected', 'true');

  // Panels are kept: going back does not render the posts again.
  await tabPosts.click();
  await expect(posts(page)).toHaveCount(2);
});

test('selected tab: 3px brand underline and ink 600; count in the tab label on desktop only', async ({ page }) => {
  const { user } = await author(page, { n: 2, withImages: 2 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  const tabPosts = page.getByTestId('profile-tab-posts');
  const tabPhotos = page.getByTestId('profile-tab-photos');
  await expect(tabPosts).toHaveCSS('border-bottom-width', '3px');
  await expect(tabPosts).toHaveCSS('font-weight', '600');
  await expect(tabPhotos).toHaveCSS('font-weight', '500');
  await expect(tabPhotos).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
  const h = (await tabPosts.boundingBox()).height;
  expect(Math.round(h)).toBe(isMobile(page) ? 48 : 52);
  if (isMobile(page)) await expect(tabPhotos).toHaveAccessibleName('รูป');
  else await expect(tabPhotos).toHaveAccessibleName('รูป 2');
});

test('posts tab: own profile has the ⋯ menu, someone else\'s does not; mobile cards are compact', async ({ page }) => {
  const { user, made } = await author(page, { n: 2, withImages: 0 });
  const viewer = await createUser({ display_name: 'คนดู' });

  // Someone else's profile.
  await signedInPage(page, viewer);
  await page.goto(`/u/${user.handle}`);
  await expect(posts(page)).toHaveCount(2);
  await expect(page.getByTestId('post-menu')).toHaveCount(0);
  if (isMobile(page)) {
    await expect(posts(page).first().getByTestId('post-stats')).toHaveText('ถูกใจ 0 · ความคิดเห็น 0');
    await expect(page.getByTestId('like-btn')).toHaveCount(0);
    await expect(posts(page).first().locator('time')).toBeVisible();
    await expect(posts(page).first().locator('.avatar')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('like-btn')).toHaveCount(2);
    await expect(page.getByTestId('comment-toggle')).toHaveCount(2);
  }

  // Own profile (same page, signed in as the author): a menu on each post.
  await page.close();
  const own = await page.context().newPage();
  await own.addInitScript((t) => { try { localStorage.setItem('mb_token', t); } catch { /* blocked */ } }, user.token);
  await own.goto(`/u/${user.handle}`);
  await expect(own.getByTestId('post-card')).toHaveCount(2);
  await expect(own.getByTestId('post-menu')).toHaveCount(2);
  await expect(own.locator('.profile__avatar')).toHaveClass(/avatar--me/);
  await expect(own.locator(`[data-testid=post-card][data-id="${made[0].id}"]`)).toBeVisible();
  await own.close();
});

test('own profile: deleting a post through the menu updates the post count', async ({ page }) => {
  const { user } = await author(page, { n: 2, withImages: 0 });
  await signedInPage(page, user);
  await page.goto(`/u/${user.handle}`);
  await expect(posts(page)).toHaveCount(2);
  const dd = page.getByTestId('profile-counts').locator('dd').first();
  await expect(dd).toHaveText('2');
  await posts(page).first().getByTestId('post-menu').click();
  await page.getByTestId('post-menu-delete').click();
  await page.getByRole('button', { name: 'ลบ', exact: true }).click();
  await expect(posts(page)).toHaveCount(1);
  await expect(dd).toHaveText('1');
});

test('empty states: "ยังไม่มีโพสต์" and "ยังไม่มีรูป"', async ({ page }) => {
  await resetRateLimits();
  const user = await createUser({ display_name: 'ว่างเปล่า' });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  await expect(page.getByText('ยังไม่มีโพสต์')).toBeVisible();
  await expect(page.getByTestId('profile-counts').locator('dd')).toHaveText(['0', '0']);
  await page.getByTestId('profile-tab-photos').click();
  await expect(page.getByText('ยังไม่มีรูป')).toBeVisible();
});

test('photos tab: square grid (3 columns mobile / 4 desktop), tile opens the lightbox, Esc returns focus', async ({ page }) => {
  const { user } = await author(page, { n: 5, withImages: 5 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  await page.getByTestId('profile-tab-photos').click();
  await expect(photos(page)).toHaveCount(5);

  const boxes = await photos(page).evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
  }));
  for (const b of boxes) expect(Math.abs(b.w - b.h)).toBeLessThanOrEqual(1);
  const cols = new Set(boxes.map((b) => b.x)).size;
  expect(cols).toBe(isMobile(page) ? 3 : 4);

  const first = photos(page).first();
  await first.click();
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-close')).toBeFocused();
  await expect(page.locator('.lightbox__count')).toHaveText('1 / 5');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lightbox__count')).toHaveText('2 / 5');
  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect(first).toBeFocused();
});

test('own profile: deleting an image in the lightbox removes the tile and lowers both counts', async ({ page }) => {
  const { user } = await author(page, { n: 2, withImages: 2 });
  await signedInPage(page, user);
  await page.goto(`/u/${user.handle}`);
  const dds = page.getByTestId('profile-counts').locator('dd');
  await expect(dds).toHaveText(['2', '2']);
  await page.getByTestId('profile-tab-photos').click();
  await expect(photos(page)).toHaveCount(2);
  const id = await photos(page).first().getAttribute('data-id');

  await photos(page).first().click();
  await expect(lb(page)).toBeVisible();
  const del = page.getByTestId('lightbox-delete');
  await del.click();
  await expect(del).toHaveText('ยืนยันลบ');
  await del.click();
  await expect(page.locator(`[data-testid=profile-photo][data-id="${id}"]`)).toHaveCount(0);
  await expect(dds.nth(1)).toHaveText('1');
  await expect(photos(page)).toHaveCount(1);
  if (!isMobile(page)) await expect(page.getByTestId('profile-tab-photos')).toHaveAccessibleName('รูป 1');

  await page.keyboard.press('Escape');
  await expect(lb(page)).toHaveCount(0);
  await expect(photos(page).first()).toBeFocused();
  // The post that carried the deleted image kept its text.
  await page.getByTestId('profile-tab-posts').click();
  await expect(posts(page)).toHaveCount(2);
});

test('someone else\'s photo has no owner tools in the lightbox', async ({ page }) => {
  const { user } = await author(page, { n: 1, withImages: 1 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  await page.getByTestId('profile-tab-photos').click();
  await photos(page).first().click();
  await expect(lb(page)).toBeVisible();
  await expect(page.getByTestId('lightbox-delete')).toHaveCount(0);
});

test('unknown user: "ไม่พบผู้ใช้นี้" with a link back to the feed', async ({ page }) => {
  await signedInPage(page);
  await page.goto('/u/nobody_here_zz');
  await expect(page).toHaveTitle('ไม่พบผู้ใช้นี้ · Mooban');
  await expect(page.getByRole('heading', { level: 1, name: 'ไม่พบผู้ใช้นี้' })).toBeVisible();
  await expect(page.getByTestId('profile-header')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await page.getByRole('link', { name: 'กลับไปฟีด' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('server error: "โหลดโปรไฟล์ไม่สำเร็จ" and retry loads the profile', async ({ page }) => {
  const { user } = await author(page, { n: 1, withImages: 0 });
  await signedInPage(page);
  let fail = true;
  await page.route(`**/api/users/${user.handle}`, async (route) => {
    if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' });
    else await route.continue();
  });
  await page.goto(`/u/${user.handle}`);
  await expect(page.getByRole('heading', { level: 1, name: 'โหลดโปรไฟล์ไม่สำเร็จ' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByTestId('profile-header')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(user.display_name);
  await expect(page).toHaveTitle(`@${user.handle} · Mooban`);
});

test('desktop rail: live status card and a link to /test; no village card', async ({ page }) => {
  test.skip(isMobile(page), 'the rail is desktop only');
  const { user } = await author(page, { n: 1, withImages: 0 });
  await signedInPage(page);
  await page.goto(`/u/${user.handle}`);
  const rail = page.locator('.rail');
  await expect(rail.getByRole('heading', { name: 'สถานะฟีดสด' })).toBeVisible();
  await expect(rail.getByRole('status')).toContainText('เชื่อมต่อแล้ว');
  await expect(rail.getByText('ภาพล่าสุด')).toHaveCount(0);
  await rail.getByRole('link', { name: 'ไปหน้าทดสอบระบบ' }).click();
  await expect(page).toHaveURL(/\/test$/);
});

test('navigating from one profile to another remounts it', async ({ page }) => {
  const a = await author(page, { n: 1, withImages: 0, display_name: 'คนแรก' });
  const b = await author(page, { n: 1, withImages: 0, display_name: 'คนที่สอง' });
  await signedInPage(page);
  await page.goto(`/u/${a.user.handle}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('คนแรก');
  await page.evaluate(async (path) => { const { navigate } = await import('/js/router.js'); await navigate(path); }, `/u/${b.user.handle}`);
  await expect(page).toHaveTitle(`@${b.user.handle} · Mooban`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('คนที่สอง');
  await expect(posts(page)).toHaveCount(1);
  await expect(posts(page).first()).toContainText(b.user.handle);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('a profile link on a post card opens that profile; the bottom nav "โปรไฟล์" points at mine', async ({ page }) => {
  const { user } = await author(page, { n: 1, withImages: 0, display_name: 'เจ้าของโพสต์' });
  const me = await createUser({ display_name: 'ฉันเอง' });
  await signedInPage(page, me);
  await page.goto('/');
  await page.locator(`[data-testid=post-card][data-author="${user.handle}"] .post__name a`).first().click();
  await expect(page).toHaveURL(new RegExp(`/u/${user.handle}$`));
  await expect(page.getByTestId('profile-header')).toBeVisible();
  const nav = isMobile(page) ? page.locator('.bottomnav') : page.locator('.sidenav');
  await expect(nav.locator('[data-nav=profile]')).toHaveAttribute('href', `/u/${me.handle}`);
  await expect(nav.locator('[data-nav=profile]')).not.toHaveAttribute('aria-current', 'page');
  await page.goto(`/u/${me.handle}`);
  await expect(nav.locator('[data-nav=profile]')).toHaveAttribute('aria-current', 'page');
});
