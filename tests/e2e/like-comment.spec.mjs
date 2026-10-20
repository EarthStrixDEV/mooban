import { test, expect } from '@playwright/test';
import { createUser, signedInPage } from './fixtures.mjs';

const card = (page, id) => page.locator(`[data-testid=post-card][data-id="${id}"]`);
const likeBtn = (page, id) => card(page, id).getByTestId('like-btn');
const toggle = (page, id) => card(page, id).getByTestId('comment-toggle');

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

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

// Fresh author + viewer per test keeps the per-user write rate limit out of the way.
async function setup(page, { signedIn = true } = {}) {
  const author = await createUser({ display_name: 'ผู้เขียน' });
  const viewer = await createUser({ display_name: 'มินจู' });
  const res = await page.request.post('/api/posts', { headers: auth(author), data: { body: `like-${author.handle}` } });
  expect(res.status()).toBe(201);
  const post = await res.json();
  if (signedIn) await signedInPage(page, viewer);
  await page.goto('/');
  await expect(card(page, post.id)).toBeVisible();
  return { author, viewer, post };
}

test('like flips at once, before the response, and survives a reload', async ({ page }) => {
  let released = false;
  await page.route('**/api/posts/*/like', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    released = true;
    await route.continue();
  });
  const { post } = await setup(page);
  const btn = likeBtn(page, post.id);
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 0');

  await btn.click();
  expect(released).toBe(false);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 1');
  await expect(btn.locator('.count')).toHaveText('1');
  expect(released).toBe(false);

  await expect.poll(() => released).toBe(true);
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 1');
  await page.reload();
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-pressed', 'true');
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-label', 'ถูกใจ 1');

  // Unlike goes through DELETE and sticks too.
  await likeBtn(page, post.id).click();
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-label', 'ถูกใจ 0');
  await page.waitForResponse((r) => r.url().includes('/like') && r.request().method() === 'DELETE');
  await page.reload();
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-pressed', 'false');
});

test('three fast clicks settle on liked with at most two requests', async ({ page }) => {
  const sent = [];
  await page.route('**/api/posts/*/like', async (route) => {
    sent.push(route.request().method());
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  const { post, viewer } = await setup(page);
  const btn = likeBtn(page, post.id);
  await btn.click();
  await btn.click();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 1');
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  expect(sent.length).toBeLessThanOrEqual(2);
  expect(sent.at(-1)).toBe('PUT');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 1');

  const server = await (await page.request.get(`/api/posts/${post.id}`, { headers: auth(viewer) })).json();
  expect(server.liked_by_me).toBe(true);
  expect(server.like_count).toBe(1);
});

test('two clicks (like then unlike) end unliked on the server', async ({ page }) => {
  const sent = [];
  await page.route('**/api/posts/*/like', async (route) => {
    sent.push(route.request().method());
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  const { post, viewer } = await setup(page);
  const btn = likeBtn(page, post.id);
  await btn.click();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(900);
  expect(sent.length).toBeLessThanOrEqual(2);
  const server = await (await page.request.get(`/api/posts/${post.id}`, { headers: auth(viewer) })).json();
  expect(server.liked_by_me).toBe(false);
  expect(server.like_count).toBe(0);
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 0');
});

test('a failing like reverts state and count and shows a toast', async ({ page }) => {
  await page.route('**/api/posts/*/like', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: '{"error":"internal"}',
  }));
  const { post } = await setup(page);
  const btn = likeBtn(page, post.id);
  await btn.click();
  await expect(page.getByTestId('toast').filter({ hasText: 'ถูกใจไม่สำเร็จ ลองอีกครั้ง' })).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 0');
  await expect(btn.locator('.count')).toHaveText('0');
});

test('Space on the like button toggles it', async ({ page }) => {
  const { post } = await setup(page);
  const btn = likeBtn(page, post.id);
  await btn.focus();
  await page.keyboard.press('Space');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'ถูกใจ 1');
  await page.keyboard.press('Space');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('liking without a user opens signup and does not toggle', async ({ page }) => {
  let hits = 0;
  await page.route('**/api/posts/*/like', (route) => { hits += 1; return route.continue(); });
  const { post } = await setup(page, { signedIn: false });
  // First visit auto-opens the sheet; dismiss it to read the feed.
  const dlg = page.getByTestId('signup-dialog');
  if (await dlg.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  }
  await likeBtn(page, post.id).click();
  await expect(dlg).toBeVisible();
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeBtn(page, post.id)).toHaveAttribute('aria-label', 'ถูกใจ 0');
  expect(hits).toBe(0);
});

test('comments: expand, add, count follows, delete own', async ({ page }) => {
  const { post } = await setup(page);
  const btn = toggle(page, post.id);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(btn).toHaveAttribute('aria-controls', `thread-${post.id}`);
  await expect(btn).toHaveAttribute('aria-label', 'ความคิดเห็น 0');
  await expect(page.locator(`#thread-${post.id}`)).toBeHidden();

  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const thread = page.locator(`#thread-${post.id}`);
  await expect(thread).toBeVisible();

  const input = thread.getByLabel('เขียนความคิดเห็น');
  await input.fill('ภาพสวยมาก');
  await input.press('Enter');
  const item = thread.locator('.comment', { hasText: 'ภาพสวยมาก' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('มินจู');
  await expect(btn).toHaveAttribute('aria-label', 'ความคิดเห็น 1');
  await expect(input).toHaveValue('');

  await item.getByRole('button', { name: 'ลบ' }).click();
  await expect(thread.locator('.comment')).toHaveCount(0);
  await expect(btn).toHaveAttribute('aria-label', 'ความคิดเห็น 0');

  // Collapse hides, keeps state.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(thread).toBeHidden();
});

test('comments: others have no delete button, 422 and empty are shown under the input, load more', async ({ page }) => {
  const author = await createUser({ display_name: 'ผู้เขียน' });
  const other = await createUser({ display_name: 'คนอื่น' });
  const viewer = await createUser({ display_name: 'มินจู' });
  const pr = await page.request.post('/api/posts', { headers: auth(author), data: { body: 'thread host' } });
  const post = await pr.json();
  for (let i = 1; i <= 22; i += 1) {
    const r = await page.request.post(`/api/posts/${post.id}/comments`, {
      headers: auth(i % 2 ? author : other), data: { body: `c${i}` },
    });
    expect(r.status()).toBe(201);
  }
  await signedInPage(page, viewer);
  await page.goto('/');
  await toggle(page, post.id).click();
  const thread = page.locator(`#thread-${post.id}`);
  await expect(thread.locator('.comment')).toHaveCount(20);
  await expect(thread.locator('.comment').first()).toContainText('c1');
  await expect(thread.getByRole('button', { name: 'ลบ' })).toHaveCount(0);

  await thread.getByRole('button', { name: 'ดูความคิดเห็นเพิ่มเติม' }).click();
  await expect(thread.locator('.comment')).toHaveCount(22);
  await expect(thread.locator('.comment').last()).toContainText('c22');
  await expect(thread.getByRole('button', { name: 'ดูความคิดเห็นเพิ่มเติม' })).toHaveCount(0);

  // 281 characters: rejected, message under the input, nothing sent.
  const input = thread.getByLabel('เขียนความคิดเห็น');
  await input.fill('ก'.repeat(281));
  await thread.getByRole('button', { name: 'ส่ง' }).click();
  await expect(thread.getByRole('alert')).toHaveText('ต้องยาว 1–280 ตัวอักษร');
  await expect(thread.locator('.comment')).toHaveCount(22);
  await input.fill('   ');
  await thread.getByRole('button', { name: 'ส่ง' }).click();
  await expect(thread.getByRole('alert')).toHaveText('ต้องยาว 1–280 ตัวอักษร');
});
