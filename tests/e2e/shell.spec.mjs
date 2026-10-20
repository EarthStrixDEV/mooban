import { test, expect } from '@playwright/test';

let problems;
test.beforeEach(({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

const isMobile = (testInfo) => testInfo.project.name === 'mobile';

test('direct /gallery sets title and aria-current', async ({ page }, testInfo) => {
  await page.goto('/gallery');
  await expect(page).toHaveTitle('แกลเลอรี · Mooban');
  const nav = isMobile(testInfo) ? '.bottomnav' : '.sidenav';
  await expect(page.locator(`${nav} a[data-nav="gallery"]`)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator(`${nav} a[data-nav="feed"]`)).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#main h1')).toHaveText('แกลเลอรี');
});

test('internal link click does not reload and announces', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle('ฟีด · Mooban');
  await expect(page.locator('#route-announcer')).toHaveText('');
  await page.evaluate(() => { window.__boot = 'kept'; });
  const nav = isMobile(testInfo) ? '.bottomnav' : '.sidenav';
  await page.locator(`${nav} a[data-nav="gallery"]`).click();
  await expect(page).toHaveTitle('แกลเลอรี · Mooban');
  await expect(page).toHaveURL(/\/gallery$/);
  expect(await page.evaluate(() => window.__boot)).toBe('kept');
  await expect(page.locator('#route-announcer')).toHaveText('แกลเลอรี · Mooban');
  await expect(page.locator('#main h1')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveTitle('ฟีด · Mooban');
  expect(await page.evaluate(() => window.__boot)).toBe('kept');
});

test('unknown path shows 404', async ({ page }) => {
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'ไม่พบหน้านี้' })).toBeVisible();
  await expect(page).toHaveTitle('ไม่พบหน้านี้ · Mooban');
  await expect(page.getByRole('link', { name: 'กลับไปฟีด' })).toBeVisible();
});

test('profile route title', async ({ page }) => {
  await page.goto('/u/Earth_1');
  await expect(page).toHaveTitle('@Earth_1 · Mooban');
  await expect(page.locator('#main h1')).toHaveText('@Earth_1');
});

test('no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const p of ['/', '/gallery', '/test', '/nope']) {
    await page.goto(p);
    await expect(page.locator('#main h1')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});

test('nav visibility per viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#main h1')).toBeAttached();
  if (isMobile(testInfo)) {
    await expect(page.locator('.bottomnav')).toBeVisible();
    await expect(page.locator('.sidenav')).toBeHidden();
    await expect(page.locator('.rail')).toBeHidden();
    await expect(page.locator('.topbar .wordmark')).toBeVisible();
    const box = await page.locator('.bottomnav').boundingBox();
    expect(box.height).toBe(72);
    await page.goto('/test');
    await expect(page.locator('.bottomnav')).toBeHidden();
  } else {
    await expect(page.locator('.sidenav')).toBeVisible();
    await expect(page.locator('.bottomnav')).toBeHidden();
    await expect(page.locator('.rail')).toBeVisible();
    expect((await page.locator('.sidenav').boundingBox()).width).toBe(220);
    expect((await page.locator('#main').boundingBox()).width).toBe(600);
    expect((await page.locator('.rail').boundingBox()).width).toBe(300);
    await page.goto('/test');
    await expect(page.locator('.rail')).toBeHidden();
    await expect(page.locator('.sidenav a[data-nav="test"]')).toHaveAttribute('aria-current', 'page');
  }
});

test('mid breakpoint 800px: sidenav, no rail', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'desktop project only');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await expect(page.locator('.sidenav')).toBeVisible();
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.bottomnav')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
});

test('skip link targets main and is visible on focus', async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('link', { name: 'ข้ามไปที่เนื้อหา' });
  await expect(skip).toHaveAttribute('href', '#main');
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeGreaterThan(40);
});

test('profile link has data-requires-user when no user', async ({ page }, testInfo) => {
  await page.goto('/');
  const nav = isMobile(testInfo) ? '.bottomnav' : '.sidenav';
  const link = page.locator(`${nav} a[data-requires-user]`);
  await expect(link).toHaveAttribute('href', '/');
  await expect(link).toContainText('โปรไฟล์');
});

test('skip link does not remount the view and focuses main', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main h1')).toBeAttached();
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.id = 'sentinel';
    document.getElementById('main').append(s);
  });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.locator('#sentinel')).toHaveCount(1);
});

test('ctrl/meta-click on a nav link is left to the browser', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'desktop project only');
  await page.goto('/');
  await page.evaluate(() => {
    window.__pushes = 0;
    const orig = history.pushState.bind(history);
    history.pushState = (...a) => { window.__pushes++; return orig(...a); };
    document.addEventListener('click', (e) => e.preventDefault());
  });
  await page.locator('.sidenav a[data-nav="gallery"]').click({ modifiers: ['Control'] });
  await page.locator('.sidenav a[data-nav="gallery"]').click({ modifiers: ['Meta'] });
  expect(await page.evaluate(() => window.__pushes)).toBe(0);
  await expect(page).toHaveURL(/\/$/);
});
