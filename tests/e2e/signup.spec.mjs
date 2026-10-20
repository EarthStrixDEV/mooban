import { test, expect, createUser, resetRateLimits, signedInPage, uniqueHandle } from './fixtures.mjs';

let problems;
test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await resetRateLimits();
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

const isMobile = (testInfo) => testInfo.project.name === 'mobile';
const nav = (testInfo) => (isMobile(testInfo) ? '.bottomnav' : '.sidenav');
const dialog = (page) => page.getByTestId('signup-dialog');

async function fillValid(page, handle = uniqueHandle()) {
  await page.getByTestId('signup-handle').fill(handle);
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await page.getByTestId('signup-display-name').fill('ทดสอบ ระบบ');
  return handle;
}

test('first visit opens the dialog; rules, availability and submit', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAttribute('role', 'dialog');
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('heading', { name: 'เข้าหมู่บ้านครั้งแรก' })).toBeVisible();
  await expect(page.getByTestId('signup-handle')).toBeFocused();
  await expect(page.getByTestId('signup-submit')).toBeDisabled();
  await expect(page.locator('#main')).toHaveJSProperty('inert', true);

  await page.getByTestId('signup-handle').fill('AB');
  await expect(page.getByTestId('signup-handle')).toHaveValue('ab');
  const lengthRule = page.locator('#handle-rules li', { hasText: 'ยาว 3–20 ตัวอักษร' });
  const charRule = page.locator('#handle-rules li', { hasText: 'ใช้ได้เฉพาะ a-z, 0-9 และ _' });
  await expect(lengthRule).toHaveAttribute('data-state', 'fail');
  await expect(charRule).toHaveAttribute('data-state', 'pass');
  await expect(page.getByTestId('signup-handle')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('signup-submit')).toBeDisabled();

  await page.getByTestId('signup-handle').fill('a-b');
  await expect(charRule).toHaveAttribute('data-state', 'fail');

  const handle = uniqueHandle();
  await page.getByTestId('signup-handle').fill(handle);
  await expect(page.getByTestId('signup-msg')).toHaveText('กำลังตรวจสอบ…');
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await expect(lengthRule).toHaveAttribute('data-state', 'pass');
  await expect(charRule).toHaveAttribute('data-state', 'pass');
  await expect(page.getByTestId('signup-submit')).toBeDisabled();

  await page.getByTestId('signup-display-name').fill('   ');
  await expect(page.getByTestId('signup-submit')).toBeDisabled();
  await page.getByTestId('signup-display-name').fill('  น้องมู  ');
  await expect(page.getByTestId('signup-submit')).toBeEnabled();
  await page.getByTestId('signup-submit').click();

  await expect(dialog(page)).toBeHidden();
  const token = await page.evaluate(() => localStorage.getItem('mb_token'));
  expect(token).toHaveLength(64);
  await expect(page.locator('#main')).toHaveJSProperty('inert', false);
  const link = page.locator(`${nav(testInfo)} a[data-nav="profile"]`);
  await expect(link).toHaveAttribute('href', `/u/${handle}`);
  await expect(link).not.toHaveAttribute('data-requires-user', '');

  const me = await page.evaluate(async (t) => (await fetch('/api/me', { headers: { Authorization: `Bearer ${t}` } })).json(), token);
  expect(me.handle).toBe(handle);
  expect(me.display_name).toBe('น้องมู');
});

test('taken handle: message, aria-invalid, suggestions fill the field', async ({ page }) => {
  const taken = await createUser({ handle: uniqueHandle('t').slice(0, 14) });
  await page.goto('/');
  await page.getByTestId('signup-handle').fill(taken.handle.toUpperCase());
  await expect(page.getByTestId('signup-handle')).toHaveValue(taken.handle);
  const msg = page.getByTestId('signup-msg');
  await expect(msg).toHaveText('ชื่อนี้มีคนใช้แล้ว ลองชื่อด้านล่างแทนได้เลย');
  await expect(msg).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('signup-handle')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('signup-submit')).toBeDisabled();

  const chips = page.getByTestId('signup-suggest').getByRole('button');
  await expect(chips).toHaveText([`@${taken.handle}_2`, `@${taken.handle}99`, `@${taken.handle}_th`]);
  const box = await chips.first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);

  await chips.nth(1).click();
  await expect(page.getByTestId('signup-handle')).toHaveValue(`${taken.handle}99`);
  await expect(msg).toHaveText('ชื่อนี้ใช้ได้');
  await expect(page.getByTestId('signup-handle')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('signup-suggest').getByRole('button')).toHaveCount(0);
});

test('suggestions skip names that are taken and stay within 20 chars', async ({ page }) => {
  const base = uniqueHandle('s').slice(0, 17);
  await createUser({ handle: base });
  await createUser({ handle: `${base}_2` });
  await page.goto('/');
  await page.getByTestId('signup-handle').fill(base);
  const chips = page.getByTestId('signup-suggest').getByRole('button');
  await expect(chips).toHaveText([`@${base}99`, `@${base}_th`]);

  const long = uniqueHandle('l');
  expect(long).toHaveLength(20);
  await createUser({ handle: long });
  await page.getByTestId('signup-handle').fill(long);
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้มีคนใช้แล้ว ลองชื่อด้านล่างแทนได้เลย');
  await expect(chips.first()).toBeVisible();
  for (const t of await chips.allTextContents()) expect(t.length - 1).toBeLessThanOrEqual(20);
});

test('rapid typing: only the latest check updates the message', async ({ page }) => {
  const taken = await createUser({ handle: uniqueHandle('r') });
  const free = uniqueHandle('f');
  await page.route(`**/api/users/${taken.handle}`, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto('/');
  await page.getByTestId('signup-handle').fill(taken.handle);
  await page.waitForTimeout(600);
  await page.getByTestId('signup-handle').fill(free);
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await expect(page.getByTestId('signup-suggest').getByRole('button')).toHaveCount(0);
});

test('"ดูเฉยๆ ก่อน" closes the dialog and the feed is readable', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ดูเฉยๆ ก่อน' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#main')).toHaveJSProperty('inert', false);
  await expect(page.locator('#main h1')).toBeAttached();
  expect(await page.evaluate(() => localStorage.getItem('mb_token'))).toBeNull();
  await page.locator(`${nav(testInfo)} a[data-nav="gallery"]`).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(dialog(page)).toBeHidden();
});

test('signup still works when localStorage.setItem throws', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function setItem() { throw new DOMException('blocked', 'QuotaExceededError'); };
  });
  await page.goto('/');
  const handle = await fillValid(page);
  await page.getByTestId('signup-submit').click();
  await expect(dialog(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mb_token'))).toBeNull();
  const link = page.locator(`${nav(testInfo)} a[data-nav="profile"]`);
  await expect(link).toHaveAttribute('href', `/u/${handle}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
  await expect(dialog(page)).toBeHidden();
});

test('focus stays inside the dialog; Esc closes it for the first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('signup-handle')).toBeFocused();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="signup-dialog"]'));
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 9; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
  await page.getByTestId('signup-handle').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await inside()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#main')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => document.body.classList.contains('scroll-locked'))).toBe(false);
});

test('Enter in the form submits when ready', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  await page.getByTestId('signup-display-name').press('Enter');
  await expect(dialog(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('mb_token'))).toHaveLength(64);
});

test('profile link without a user opens signup (write); Esc restores focus; signing up navigates', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ดูเฉยๆ ก่อน' }).click();
  const link = page.locator(`${nav(testInfo)} a[data-nav="profile"]`);
  await link.click();
  await expect(dialog(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'ดูเฉยๆ ก่อน' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(link).toBeFocused();
  await expect(page).toHaveURL(/\/$/);

  await link.click();
  const handle = await fillValid(page);
  await page.getByTestId('signup-submit').click();
  await expect(dialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
});

test('server errors: 429 toast, 422 field messages, 409 taken, 500 toast', async ({ page }) => {
  await page.goto('/');
  const handle = await fillValid(page);

  const reply = (status, body, headers = {}) => page.route('**/api/users', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });

  await reply(429, { error: 'rate_limited', retry_after: 37 }, { 'Retry-After': '37' });
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('toast')).toHaveText(/ทำรายการเร็วเกินไป ลองใหม่ในอีก 37 วินาที/);
  await expect(page.getByTestId('toast')).toHaveAttribute('role', 'alert');
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('signup-submit')).toBeEnabled();
  await page.getByTestId('toast').getByRole('button', { name: 'ปิด' }).click();

  await page.unroute('**/api/users');
  await reply(422, { error: 'validation_failed', fields: { handle: 'ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _', display_name: 'ต้องยาว 1–50 ตัวอักษร' } });
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-msg')).toHaveText('ต้องยาว 3–20 ตัวอักษร ใช้ได้เฉพาะ a-z, 0-9 และ _');
  await expect(page.locator('#display-name-msg')).toHaveText('ต้องยาว 1–50 ตัวอักษร');
  await expect(page.getByTestId('signup-display-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('signup-display-name').fill('ใหม่');
  await expect(page.locator('#display-name-msg')).toHaveText('');

  await page.getByTestId('signup-handle').fill(`${handle}x`.slice(0, 20));
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await page.unroute('**/api/users');
  await reply(409, { error: 'handle_taken' });
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้มีคนใช้แล้ว ลองชื่อด้านล่างแทนได้เลย');
  await expect(page.getByTestId('signup-handle')).toHaveAttribute('aria-invalid', 'true');

  await page.unroute('**/api/users');
  await reply(500, { error: 'server_error' });
  await page.getByTestId('signup-handle').fill(uniqueHandle());
  await expect(page.getByTestId('signup-msg')).toHaveText('ชื่อนี้ใช้ได้');
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('toast')).toHaveText(/มีบางอย่างผิดพลาด ลองอีกครั้ง/);
});

test('submit is disabled while the request is in flight', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  let posts = 0;
  await page.route('**/api/users', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await new Promise((r) => setTimeout(r, 800));
    }
    await route.continue();
  });
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-submit')).toBeDisabled();
  await expect(page.getByTestId('signup-handle')).toBeDisabled();
  await expect(page.getByTestId('signup-display-name')).toBeDisabled();
  await expect(dialog(page)).toBeHidden();
  expect(posts).toBe(1);
});

test('during a slow POST: Esc and scrim do not close, inputs disabled; error re-enables', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/users', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error' }) });
  });
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-handle')).toBeDisabled();
  await expect(page.getByTestId('signup-display-name')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);
  await expect(dialog(page)).toBeVisible();
  release();
  await expect(page.getByTestId('toast')).toHaveText(/มีบางอย่างผิดพลาด ลองอีกครั้ง/);
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('signup-handle')).toBeEnabled();
  await expect(page.getByTestId('signup-display-name')).toBeEnabled();
  await expect(page.getByTestId('signup-submit')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});

test('token present but /api/me returns 500: no signup, toast, token kept', async ({ page }) => {
  const user = await createUser();
  await page.addInitScript((t) => localStorage.setItem('mb_token', t), user.token);
  await page.route('**/api/me', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' }));
  await page.goto('/');
  await expect(page.getByTestId('toast')).toHaveText(/มีบางอย่างผิดพลาด ลองอีกครั้ง/);
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mb_token'))).toBe(user.token);
});

test('boot with a valid token emits "me"', async ({ page }) => {
  const user = await signedInPage(page);
  await page.route('**/api/me', async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const handle = await page.evaluate(async () => {
    const { on, state } = await import('/js/store.js');
    if (state.me) throw new Error('me already set');
    return new Promise((r) => on('me', (u) => r(u.handle)));
  });
  expect(handle).toBe(user.handle);
});

test('stale token: /api/me 401 clears it and opens signup', async ({ page }) => {
  const stale = 'a'.repeat(64);
  await page.addInitScript((t) => localStorage.setItem('mb_token', t), stale);
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mb_token'))).toBeNull();
});

test('signed-in boot: no dialog, profile link points at me', async ({ page }, testInfo) => {
  const user = await signedInPage(page);
  await page.goto('/');
  await expect(page.locator(`${nav(testInfo)} a[data-nav="profile"]`)).toHaveAttribute('href', `/u/${user.handle}`);
  await expect(dialog(page)).toHaveCount(0);
});

test('layout: bottom sheet on mobile, centered dialog on desktop', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const vp = page.viewportSize();
  const box = await dialog(page).boundingBox();
  const radius = await dialog(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  if (isMobile(testInfo)) {
    expect(box.width).toBe(vp.width);
    expect(Math.round(box.y + box.height)).toBe(vp.height);
    expect(radius).toBe('28px');
  } else {
    expect(box.width).toBeLessThanOrEqual(440);
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2);
    expect(radius).toBe('24px');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
  const submit = await page.getByTestId('signup-submit').boundingBox();
  expect(submit.height).toBe(56);
});

test.describe('toast', () => {
  const show = (page, msg, opts) => page.evaluate(async ([m, o]) => {
    const { toast } = await import('/js/ui/toast.js');
    toast(m, o);
  }, [msg, opts]);

  test.beforeEach(async ({ page }) => {
    await signedInPage(page);
    await page.clock.install();
    await page.goto('/');
    await expect(page.locator('#main h1')).toBeAttached();
    // install() alone lets the fake clock tick with real time, so a slow expect() poll could push a
    // toast past its 4 s. Pause it: from here time moves only through clock.runFor().
    await page.clock.pauseAt(new Date(Date.now() + 1000));
  });

  test('roles, close button and auto-hide (4 s, errors 6 s)', async ({ page }) => {
    await show(page, 'บันทึกแล้ว');
    const t = page.getByTestId('toast');
    await expect(t).toHaveText(/บันทึกแล้ว/);
    await expect(t).toHaveAttribute('role', 'status');
    const close = t.getByRole('button', { name: 'ปิด' });
    const b = await close.boundingBox();
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await page.clock.runFor(3900);
    await expect(t).toBeVisible();
    await page.clock.runFor(200);
    await expect(t).toHaveCount(0);

    await show(page, 'พัง', { error: true });
    await expect(t).toHaveAttribute('role', 'alert');
    await page.clock.runFor(4500);
    await expect(t).toBeVisible();
    await page.clock.runFor(1600);
    await expect(t).toHaveCount(0);

    await show(page, 'ปิดเอง');
    await close.click();
    await expect(t).toHaveCount(0);
  });

  test('pauses while hovered or focused; keeps at most 3', async ({ page }) => {
    await show(page, 'หนึ่ง');
    const t = page.getByTestId('toast');
    await t.hover();
    await page.clock.runFor(10000);
    await expect(t).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(4100);
    await expect(t).toHaveCount(0);

    await show(page, 'หนึ่ง');
    await t.getByRole('button', { name: 'ปิด' }).focus();
    await page.clock.runFor(10000);
    await expect(t).toBeVisible();
    await t.getByRole('button', { name: 'ปิด' }).click();

    for (const m of ['A', 'B', 'C', 'D']) await show(page, m);
    await expect(t).toHaveCount(3);
    await expect(t.first()).toHaveText(/B/);
    await expect(t.last()).toHaveText(/D/);
  });
});
