import { fileURLToPath } from 'node:url';
import { test, expect, signedInPage } from './fixtures.mjs';

const TOKEN = process.env.E2E_TEST_TOKEN ?? 'dev-test-token-0123456789abcd';
const FIXTURE = (name) => fileURLToPath(new URL('../fixtures/' + name, import.meta.url));
const isMobile = (page) => (page.viewportSize()?.width ?? 0) < 720;
const tid = (page, id) => page.getByTestId(id);

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

async function open(page, { token = true, signedIn = true } = {}) {
  if (signedIn) await signedInPage(page);
  await page.goto('/test');
  await expect(page.getByRole('heading', { level: 1, name: 'ทดสอบระบบ' })).toBeVisible();
  if (token) await tid(page, 'test-token').fill(TOKEN);
}

test('heading, numbered cards, token field is a password input kept out of storage and URL', async ({ page }) => {
  await open(page);
  for (const n of ['1. อัปโหลดรูป', '2. ความหน่วง Realtime (SSE)', '3. WebSocket RTT', '4. Bandwidth', '5. Caching', '6. API Request / Load test', '7. ข้อมูล seed']) {
    await expect(page.getByRole('heading', { level: 2, name: n })).toBeVisible();
  }
  await expect(tid(page, 'test-token')).toHaveAttribute('type', 'password');
  const stored = await page.evaluate((t) => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href]).includes(t), TOKEN);
  expect(stored).toBe(false);
  if (isMobile(page)) {
    await expect(page.locator('.topbar h1')).toHaveText('ทดสอบระบบ');
    await expect(page.locator('.bottomnav')).toBeHidden();
  } else {
    await expect(page.getByText('ตรวจการประมวลผลรูป การอัปเดตสด และ WebSocket บนโฮสต์นี้')).toBeVisible();
    await expect(page.getByText('หรือลากรูปมาวางที่นี่')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('upload shows processing_ms, format, sizes, savings and can delete the test image', async ({ page }) => {
  await open(page);
  await tid(page, 'test-upload-file').setInputFiles(FIXTURE('test-1mp.jpg'));
  const res = tid(page, 'test-upload-result');
  await expect(res).toContainText(/processing_ms/);
  await expect(res).toContainText(/\d+ ms/);
  await expect(res).toContainText(/image\/(webp|jpeg)/);
  const text = await res.textContent();
  if (text.includes('image/webp')) {
    await expect(res).toContainText(/ประหยัดจาก WebP/);
    expect(text).toMatch(/\d+\.\d%/);
  } else {
    await expect(res).not.toContainText('ประหยัดจาก WebP');
  }
  if (!isMobile(page)) {
    await expect(page.getByRole('columnheader', { name: 'ประหยัด' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'test-1mp.jpg' })).toBeVisible();
  }
  const del = tid(page, 'test-upload-delete');
  await expect(del).toBeEnabled();
  await del.click();
  await expect(del).toBeDisabled();
});

test('realtime: 10 rounds give median, p95, mean and 0 dropped; chart has a text equivalent', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-sse', 'open');
  const start = tid(page, 'test-sse-start');
  await expect(start).toHaveText('วัด latency 10 ครั้ง');
  await expect(start).toBeEnabled();
  await start.click();
  const stats = tid(page, 'test-sse-stats');
  await expect(stats).toBeVisible({ timeout: 45_000 });
  await expect(stats).toContainText('มัธยฐาน');
  await expect(stats).toContainText('p95');
  await expect(stats).toContainText('เฉลี่ย');
  await expect(stats.getByText('ตกหล่น').locator('xpath=following-sibling::dd')).toContainText(/^0/);
  const chart = page.locator('svg.chart--line');
  await expect(chart).toHaveAttribute('role', 'img');
  await expect(chart).toHaveAttribute('aria-label', /^กราฟความหน่วง 10 ครั้ง มัธยฐาน \d+ ms p95 \d+ ms$/);
  await page.getByText('ดูค่าดิบ').first().click();
  await expect(page.locator('.chart-raw li')).toHaveCount(10);
  await expect(tid(page, 'test-sse-log')).toContainText('test.ping');
});

test('realtime without a token: 403 message and no result', async ({ page }) => {
  await open(page, { token: false });
  await expect(page.locator('html')).toHaveAttribute('data-sse', 'open');
  await tid(page, 'test-sse-start').click();
  await expect(page.getByTestId('test-sse-start').locator('xpath=ancestor::section')).toContainText('Test token ไม่ถูกต้อง');
  await expect(tid(page, 'test-sse-stats')).toBeHidden();
});

test('websocket card says the stack has no WebSocket (apache/nginx)', async ({ page }) => {
  test.skip(['node', 'python'].includes(process.env.E2E_STACK ?? ''), 'apache/nginx only: no WebSocket');
  await open(page);
  const status = tid(page, 'test-ws-status');
  await expect(status).toHaveText(/stack นี้ไม่รองรับ WebSocket/);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(tid(page, 'test-ws-ping')).toBeHidden();
  await expect(tid(page, 'test-ws-disconnect')).toBeHidden();
});

test('bandwidth: no token gives the 403 message; with a token download 1 MB gives a row', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, { token: false });
  await tid(page, 'test-bw-down-1').click();
  const bw = tid(page, 'test-bw-down-1').locator('xpath=ancestor::section');
  await expect(bw).toContainText('Test token ไม่ถูกต้อง');
  await expect(bw).toContainText('403 forbidden');

  await tid(page, 'test-token').fill('wrong-token');
  await tid(page, 'test-bw-down-1').click();
  await expect(bw).toContainText('Test token ไม่ถูกต้อง');

  await tid(page, 'test-token').fill(TOKEN);
  await tid(page, 'test-bw-down-1').click();
  const row = tid(page, 'test-bw-result').getByRole('row', { name: /Download 1 MB/ });
  await expect(row).toBeVisible({ timeout: 40_000 });
  await expect(row).toContainText(/\d+\.\d/);
  await expect(bw).not.toContainText('Test token ไม่ถูกต้อง');
});

test('caching: browser cache and conditional request checks report results', async ({ page }) => {
  await open(page);
  await tid(page, 'test-cache-run-browser').click();
  const browser = tid(page, 'test-cache-browser');
  await expect(browser).toContainText('ETag');
  await expect(browser).toContainText(/ผ่าน|ไม่ผ่าน|ข้อมูล/);
  await tid(page, 'test-cache-run-conditional').click();
  await expect(tid(page, 'test-cache-conditional')).toContainText('304');
  await tid(page, 'test-cache-run-servertime').click();
  await expect(tid(page, 'test-cache-servertime')).toContainText('unix_ms');
  await tid(page, 'test-cache-run-appcache').click();
  const app = tid(page, 'test-cache-appcache');
  await expect(app).toContainText('4. GET /api/stats', { timeout: 20_000 });
  await expect(app).toContainText('✓ ผ่าน');
  await tid(page, 'test-cache-run-stats').click();
  await expect(tid(page, 'test-cache-stats')).toContainText('hit');
  await tid(page, 'test-cache-clear').click();
  await expect(tid(page, 'test-cache-stats')).toContainText('hit');
});

test('load test: 20 x /api/ping, concurrency 5 -> 20 succeed', async ({ page }) => {
  await open(page);
  await tid(page, 'test-load-endpoint').selectOption('/api/ping');
  await tid(page, 'test-load-total').fill('20');
  await tid(page, 'test-load-conc').fill('5');
  await tid(page, 'test-load-start').click();
  const res = tid(page, 'test-load-result');
  await expect(res).toBeVisible();
  await expect(res.getByText('สำเร็จ', { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('20 / 20');
  for (const k of ['เฉลี่ย', 'มัธยฐาน', 'p95', 'สูงสุด', 'request/วินาที']) await expect(res).toContainText(k);
});

test('load test validates its inputs', async ({ page }) => {
  await open(page);
  await tid(page, 'test-load-total').fill('5000');
  await tid(page, 'test-load-start').click();
  await expect(page.getByText(/จำนวน request ต้องอยู่ระหว่าง 1–1000/)).toBeVisible();
  await expect(tid(page, 'test-load-result')).toBeHidden();
});

test('ping and echo blocks show latency, db_ms and the echoed fields', async ({ page }) => {
  await open(page);
  await tid(page, 'test-ping-run').click();
  await expect(tid(page, 'test-ping-result')).toContainText('db_ms');
  await expect(tid(page, 'test-ping-result')).toContainText(/\d+\.\d ms/);
  await tid(page, 'test-echo-run').click();
  await expect(tid(page, 'test-echo-result')).toContainText('client_ip');
  await expect(tid(page, 'test-echo-result')).toContainText('protocol');
});

test('seed round trip: seed small, check orphans, delete seed', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await tid(page, 'test-seed-users').fill('2');
  await tid(page, 'test-seed-posts').fill('4');
  await tid(page, 'test-seed-images').fill('1');
  await tid(page, 'test-seed-reset').check();
  await tid(page, 'test-seed-run').click();
  const out = tid(page, 'test-seed-result');
  await expect(out).toContainText('duration_ms');
  await expect(out.getByText('ผู้ใช้ (users)').locator('xpath=following-sibling::dd')).toHaveText('2');
  await expect(out.getByText('โพสต์ (posts)').locator('xpath=following-sibling::dd')).toHaveText('4');
  await tid(page, 'test-orphans-run').click();
  await expect(out).toContainText('orphan_dirs');
  await expect(out.getByText('โฟลเดอร์ค้าง (orphan_dirs)').locator('xpath=following-sibling::dd')).toHaveText('0');
  await tid(page, 'test-seed-delete').click();
  await expect(out).toContainText('deleted_users');
  await expect(out.getByText('ผู้ใช้ที่ลบ (deleted_users)').locator('xpath=following-sibling::dd')).toHaveText('2');
});

test('seed without a token shows the 403 message', async ({ page }) => {
  await open(page, { token: false });
  await tid(page, 'test-orphans-run').click();
  await expect(tid(page, 'test-orphans-run').locator('xpath=ancestor::section')).toContainText('Test token ไม่ถูกต้อง');
});

test('app-level cache: waiting 11 s expires the cache (MISS)', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await page.getByRole('button', { name: 'รอ 11 วินาทีแล้วตรวจอีกครั้ง' }).click();
  await expect(tid(page, 'test-cache-appcache-wait')).toContainText('✓ ผ่าน', { timeout: 30_000 });
});

test('load test: every non-network response counts toward latency, 2xx counts as success', async ({ page }) => {
  await open(page);
  let i = 0;
  await page.route('**/api/limited', (route) => {
    const k = i % 5;
    i += 1;
    if (k === 0) return route.abort();
    const ok = k === 1 || k === 3;
    return route.fulfill({
      status: ok ? 200 : 429, contentType: 'application/json', headers: { 'Server-Timing': 'app;dur=5' }, body: ok ? '{"ok":true}' : '{"error":"rate_limited"}',
    });
  });
  await tid(page, 'test-load-endpoint').selectOption('/api/limited');
  await tid(page, 'test-load-total').fill('15');
  await tid(page, 'test-load-conc').fill('1');
  await tid(page, 'test-load-start').click();
  const res = tid(page, 'test-load-result');
  await expect(res).toBeVisible();
  await expect(res).toHaveAttribute('data-samples', '12'); // 15 sent - 3 network failures
  await expect(res.getByText('สำเร็จ', { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('6 / 15');
  await expect(res).toContainText('429 × 6');
  await expect(res).toContainText('network × 3');
  await expect(res.getByText('Server-Timing (app) เฉลี่ย').locator('xpath=following-sibling::dd')).toHaveText('5.0 ms');
});

test('leaving the page mid-measurement stops cleanly (no errors, no late toast)', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-sse', 'open');
  await tid(page, 'test-sse-start').click();
  await tid(page, 'test-load-total').fill('1000');
  await tid(page, 'test-load-endpoint').selectOption('/api/slow?ms=200');
  await tid(page, 'test-load-start').click();
  await page.waitForTimeout(500);
  await page.goto('/gallery');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

// Node/Python only: the WebSocket card connects and reports RTT. Run with E2E_STACK=node|python.
test('websocket card connects and shows RTT after pings (node/python)', async ({ page }) => {
  test.skip(!['node', 'python'].includes(process.env.E2E_STACK ?? ''), 'needs a stack with WebSocket');
  await open(page);
  const status = tid(page, 'test-ws-status');
  await tid(page, 'test-ws-connect').click();
  await expect(status).toHaveText('เชื่อมต่อแล้ว');
  await tid(page, 'test-ws-ping').click();
  await expect(tid(page, 'test-ws-rtt')).toContainText(/RTT ล่าสุด \d+ ms · เฉลี่ย \d+ ms จาก 20 ครั้ง/, { timeout: 15_000 });
  await tid(page, 'test-ws-disconnect').click();
  await expect(status).toHaveText('ยังไม่เชื่อมต่อ');
});
