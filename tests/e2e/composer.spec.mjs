import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, createUser, signedInPage } from './fixtures.mjs';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const cards = (page) => page.locator('[data-testid=post-card]');

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

// Fresh user per test keeps the per-user write rate limit out of the way.
async function openFeed(page) {
  const user = await createUser({ display_name: 'มินจู' });
  await signedInPage(page, user);
  await page.goto('/');
  await expect(page.getByTestId('feed')).toBeVisible();
  return user;
}

const isMobile = (page) => (page.viewportSize()?.width ?? 0) < 720;

// Mobile: the compact bar opens a full-screen dialog. Desktop: the composer is already inline.
async function openComposer(page) {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function apiPost(page, user, data) {
  const res = await page.request.post('/api/posts', {
    headers: { Authorization: `Bearer ${user.token}` },
    data,
  });
  expect(res.status()).toBe(201);
  return res.json();
}

test('counter warns above 260, posting puts the card on top and clears the form', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  const text = 'ก่'.repeat(131);
  await page.getByTestId('composer-input').fill(text);
  const count = page.getByTestId('composer-count');
  await expect(count).toHaveText('262 / 280');
  await expect(count).toHaveClass(/composer__count--warn/);

  await page.getByTestId('composer-submit').click();
  await expect(cards(page).first().locator('.post__body')).toHaveText(text);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (!isMobile(page)) {
    await expect(page.getByTestId('composer-input')).toHaveValue('');
    await expect(count).toHaveText('0 / 280');
    await expect(page.getByTestId('composer-submit')).toBeDisabled();
  }
});

test('counter turns error at 280; 281 code points (text or emoji) disables posting, 280 emoji is allowed', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  const input = page.getByTestId('composer-input');
  const count = page.getByTestId('composer-count');
  const submit = page.getByTestId('composer-submit');

  await input.fill('ก'.repeat(280));
  await expect(count).toHaveText('280 / 280');
  await expect(count).toHaveClass(/composer__count--err/);
  await expect(submit).toBeEnabled();

  await input.fill('ก'.repeat(281));
  await expect(count).toHaveText('281 / 280');
  await expect(submit).toBeDisabled();

  await input.fill('😀'.repeat(281));
  await expect(count).toHaveText('281 / 280');
  await expect(submit).toBeDisabled();

  await input.fill('😀'.repeat(280));
  await expect(count).toHaveText('280 / 280');
  await expect(submit).toBeEnabled();
});

test('whitespace-only text without an image keeps posting disabled; trimmed length is counted', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  const input = page.getByTestId('composer-input');
  await input.fill(['   ', '　', ' '].join('\n'));
  await expect(page.getByTestId('composer-count')).toHaveText('0 / 280');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await input.fill('  ก  ');
  await expect(page.getByTestId('composer-count')).toHaveText('1 / 280');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
});

test('double click on โพสต์ while /api/me is slow sends exactly one POST', async ({ page }) => {
  await page.route(/\/api\/me$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.fallback();
  });
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/posts$/.test(r.url())) posts.push(r.url()); });
  const user = await createUser({ display_name: 'มินจู' });
  await signedInPage(page, user);
  await page.goto('/');
  await openComposer(page);
  await page.getByTestId('composer-input').fill('กดสองที');
  await page.getByTestId('composer-submit').dblclick();
  await expect(cards(page).first().locator('.post__body')).toHaveText('กดสองที');
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1);
});

test('desktop: crossing 720px keeps the draft text and its uploaded image', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only');
  await openFeed(page);
  const deletes = [];
  page.on('request', (r) => { if (r.method() === 'DELETE' && r.url().includes('/api/images/')) deletes.push(r.url()); });
  await page.getByTestId('composer-input').fill('ร่างข้ามจอ');
  await page.getByTestId('composer-attach').setInputFiles(path.join(FIX, 'test-1mp.jpg'));
  await expect(page.getByTestId('composer-preview').locator('img')).toBeVisible();

  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue('ร่างข้ามจอ');
  await expect(page.getByTestId('composer-preview').locator('img')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toHaveValue('ร่างข้ามจอ');
  await expect(page.getByTestId('composer-preview').locator('img')).toBeVisible();
  expect(deletes).toEqual([]);
});

test('attaching an image previews the thumb and the post card shows the image', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await page.getByTestId('composer-attach').setInputFiles(path.join(FIX, 'test-1mp.jpg'));
  const preview = page.getByTestId('composer-preview');
  await expect(preview.locator('img')).toBeVisible();
  await expect(preview).toContainText('test-1mp.jpg');
  await expect(preview).toContainText('จะถูกย่อให้อัตโนมัติ');

  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await page.getByTestId('composer-submit').click();
  await expect(cards(page).first().locator('.post__img img')).toBeVisible();
});

test('removing an attached image deletes it and clears the preview', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  await page.getByTestId('composer-attach').setInputFiles(path.join(FIX, 'test-1mp.jpg'));
  await expect(page.getByTestId('composer-preview').locator('img')).toBeVisible();
  const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/api\/images\/\d+$/.test(r.url()));
  await page.getByTestId('composer-remove-image').click();
  expect((await del).status()).toBe(204);
  await expect(page.getByTestId('composer-preview')).toBeHidden();
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
});

test('a fake image shows the unsupported-type alert', async ({ page }) => {
  await openFeed(page);
  await openComposer(page);
  await page.getByTestId('composer-attach').setInputFiles(path.join(FIX, 'test-fake.jpg'));
  await expect(page.getByRole('alert').filter({ hasText: 'รองรับเฉพาะ JPEG, PNG และ WebP' })).toBeVisible();
  await expect(page.getByTestId('composer-preview')).toBeHidden();
});

test('a 422 from POST /api/posts shows fields.body and keeps the typed text', async ({ page }) => {
  await openFeed(page);
  await page.route(/\/api\/posts$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'validation_failed', fields: { body: 'ยาวเกิน 280 ตัวอักษร' } }),
    });
  });
  await openComposer(page);
  await page.getByTestId('composer-input').fill('ข้อความของฉัน');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'ยาวเกิน 280 ตัวอักษร' })).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue('ข้อความของฉัน');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
});

test('mobile: compact bar opens a full-screen dialog on the same path and asks before discarding', async ({ page }) => {
  test.skip(!isMobile(page), 'mobile only');
  await openFeed(page);
  await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  // empty: cancel closes straight away
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'วันนี้มีอะไรในหมู่บ้าน' }).click();
  await page.getByTestId('composer-input').fill('ร่างที่ยังไม่โพสต์');
  await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก' }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'ทิ้งโพสต์นี้?' });
  await expect(confirm).toBeVisible();

  await confirm.getByRole('button', { name: 'แก้ต่อ' }).click();
  await expect(page.getByTestId('composer-input')).toHaveValue('ร่างที่ยังไม่โพสต์');
  await expect(page.getByTestId('composer-input')).toBeFocused();

  await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก' }).click();
  await page.getByRole('dialog').filter({ hasText: 'ทิ้งโพสต์นี้?' }).getByRole('button', { name: 'ทิ้ง' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('desktop: sidenav button reads โพสต์ on the feed and focuses the composer, โพสต์ใหม่ elsewhere', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only');
  await openFeed(page);
  const btn = page.getByTestId('new-post');
  await expect(btn).toHaveText('โพสต์');
  await btn.click();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  expect(new URL(page.url()).pathname).toBe('/');

  await page.getByRole('navigation', { name: 'เมนูหลัก' }).first().getByRole('link', { name: 'แกลเลอรี' }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(btn).toHaveText('โพสต์ใหม่');
  await btn.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(btn).toHaveText('โพสต์');
});

test('own post: edit text in place, cancel keeps the old text, delete asks first', async ({ page }) => {
  const me = await openFeed(page);
  const post = await apiPost(page, me, { body: 'ต้นฉบับ' });
  await page.reload();
  const card = page.locator(`[data-testid=post-card][data-id="${post.id}"]`);
  await expect(card).toBeVisible();
  const trigger = card.getByRole('button', { name: 'ตัวเลือกโพสต์' });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // keyboard: arrows move, Esc closes and returns focus to the trigger
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = card.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['แก้ไขโพสต์', 'ลบโพสต์']);
  await expect(menu.getByRole('menuitem', { name: 'แก้ไขโพสต์' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'ลบโพสต์' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'แก้ไขโพสต์' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // click outside closes
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.locator('h1').first().click({ force: true });
  await expect(menu).toHaveCount(0);

  // edit, then cancel
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'แก้ไขโพสต์' }).click();
  const input = card.getByTestId('post-edit-input');
  await expect(input).toHaveValue('ต้นฉบับ');
  await input.fill('ไม่เอาแล้ว');
  await card.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(card.locator('.post__body')).toHaveText('ต้นฉบับ');

  // edit and save
  await trigger.click();
  await card.getByRole('menuitem', { name: 'แก้ไขโพสต์' }).click();
  await card.getByTestId('post-edit-input').fill('แก้แล้วจ้า');
  await card.getByRole('button', { name: 'บันทึก' }).click();
  await expect(card.locator('.post__body')).toHaveText('แก้แล้วจ้า');
  await expect(card.getByTestId('post-edit-input')).toHaveCount(0);

  // delete: cancel first, then confirm
  await trigger.click();
  await card.getByRole('menuitem', { name: 'ลบโพสต์' }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'ลบโพสต์นี้และรูปของมัน?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(card).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await card.getByRole('menuitem', { name: 'ลบโพสต์' }).click();
  await page.getByRole('dialog').filter({ hasText: 'ลบโพสต์นี้และรูปของมัน?' }).getByRole('button', { name: 'ลบ' }).click();
  await expect(card).toHaveCount(0);
});

test('other people’s posts have no options button', async ({ page }) => {
  const me = await openFeed(page);
  const other = await createUser({ display_name: 'คนอื่น' });
  const mine = await apiPost(page, me, { body: 'ของฉัน' });
  const theirs = await apiPost(page, other, { body: 'ของคนอื่น' });
  await page.reload();
  const own = page.locator(`[data-testid=post-card][data-id="${mine.id}"]`);
  const foreign = page.locator(`[data-testid=post-card][data-id="${theirs.id}"]`);
  await expect(own.getByRole('button', { name: 'ตัวเลือกโพสต์' })).toBeVisible();
  await expect(foreign).toBeVisible();
  await expect(foreign.getByRole('button', { name: 'ตัวเลือกโพสต์' })).toHaveCount(0);
});

test('emptying an image-less post disables save', async ({ page }) => {
  const me = await openFeed(page);
  const post = await apiPost(page, me, { body: 'จะลบทั้งหมด' });
  await page.reload();
  const card = page.locator(`[data-testid=post-card][data-id="${post.id}"]`);
  await card.getByRole('button', { name: 'ตัวเลือกโพสต์' }).click();
  await card.getByRole('menuitem', { name: 'แก้ไขโพสต์' }).click();
  await card.getByTestId('post-edit-input').fill('');
  await expect(card.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
});
