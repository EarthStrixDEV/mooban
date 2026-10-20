import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, db, createUser, resetRateLimits, fixture, mediaExec, BASE, STACK, TEST_TOKEN } from './helpers.mjs';

if (!process.env.SERVICE && STACK === 'apache') process.env.SERVICE = 'apache';
const MEDIA = process.env.MEDIA_DIR_IN_CONTAINER ?? '/var/www/site/public_html/media';
const T = { headers: { 'X-Test-Token': TEST_TOKEN } };
const needsDisk = { skip: !process.env.SERVICE };

const seed = (qs) => api('POST', `/api/test/seed${qs}`, T);
const orphans = () => api('GET', '/api/test/orphans', T);

async function scalar(sql, params = []) {
  const c = await db();
  try {
    const [rows] = await c.execute(sql, params);
    return Number(Object.values(rows[0])[0]);
  } finally {
    await c.end();
  }
}
const seedUsers = () => scalar("SELECT COUNT(*) FROM users WHERE handle LIKE 'seed\\_%'");
const maxEvent = () => scalar('SELECT COALESCE(MAX(id), 0) FROM events');

before(async () => { await resetRateLimits(); });
after(async () => {
  await api('DELETE', '/api/test/seed', T).catch(() => {});
  await resetRateLimits();
});

test('S0 seed tools need the test token', async () => {
  assert.equal((await api('POST', '/api/test/seed?users=1&posts=0&images=0')).status, 403);
  assert.equal((await api('DELETE', '/api/test/seed')).status, 403);
  assert.equal((await api('GET', '/api/test/orphans')).status, 403);
  assert.equal((await api('GET', '/api/test/orphans', { headers: { 'X-Test-Token': 'nope' } })).status, 403);
});

test('S1 bad params -> 400 bad_params', async () => {
  const bad = [
    '?users=0', '?users=101', '?users=-1', '?users=abc', '?users=', '?users=1.5', '?users=1e1',
    '?users=2&posts=5001&images=0', '?users=2&posts=-1&images=0',
    '?users=2&posts=10&images=201', '?users=2&posts=5&images=6',
    '?users=2&posts=5&images=1&reset=2', '?users=2&posts=5&images=1&reset=yes',
    '?users[]=2',
  ];
  for (const qs of bad) {
    const r = await seed(qs);
    assert.equal(r.status, 400, `${qs}: ${r.text}`);
    assert.deepEqual(r.json, { error: 'bad_params' }, qs);
  }
});

test('S2 seed 3 users / 45 posts / 5 images: counts, handles, no events, no orphans', needsDisk, async () => {
  const ev0 = await maxEvent();
  const r = await seed('?users=3&posts=45&images=5&reset=1');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ['duration_ms', 'images', 'posts', 'users']);
  assert.equal(r.json.users, 3);
  assert.equal(r.json.posts, 45);
  assert.equal(r.json.images, 5);
  assert.ok(Number.isInteger(r.json.duration_ms) && r.json.duration_ms >= 0);

  assert.equal(await seedUsers(), 3);
  assert.equal(await maxEvent(), ev0, 'seed must not create events');

  const c = await db();
  try {
    const [users] = await c.query("SELECT handle, display_name, token_hash FROM users WHERE handle LIKE 'seed\\_%' ORDER BY id");
    assert.deepEqual(users.map(u => u.handle), ['seed_001', 'seed_002', 'seed_003']);
    assert.deepEqual(users.map(u => u.display_name), ['Seed 001', 'Seed 002', 'Seed 003']);
    for (const u of users) assert.match(u.token_hash, /^[0-9a-f]{64}$/);

    const [posts] = await c.query(
      `SELECT p.id, p.body, p.image_id, p.like_count, p.comment_count, p.created_at, p.updated_at, u.handle
         FROM posts p JOIN users u ON u.id = p.user_id WHERE u.handle LIKE 'seed\\_%' ORDER BY p.id`);
    assert.equal(posts.length, 45);
    const texts = JSON.parse(readFileSync(new URL('../../shared/seed-texts.json', import.meta.url), 'utf8'));
    assert.equal(texts.length, 30);
    for (const p of posts) {
      assert.ok(texts.includes(p.body), `body not from seed-texts: ${p.body}`);
      assert.equal(p.like_count, 0);
      assert.equal(p.comment_count, 0);
    }
    // round-robin authors, oldest first, spread across the last 7 days
    assert.deepEqual(posts.slice(0, 6).map(p => p.handle),
      ['seed_001', 'seed_002', 'seed_003', 'seed_001', 'seed_002', 'seed_003']);
    for (let i = 1; i < posts.length; i++) assert.ok(posts[i].created_at >= posts[i - 1].created_at);
    const [[span]] = await c.query(
      `SELECT TIMESTAMPDIFF(HOUR, MIN(p.created_at), UTC_TIMESTAMP()) AS oldest_h,
              TIMESTAMPDIFF(HOUR, MAX(p.created_at), UTC_TIMESTAMP()) AS newest_h
         FROM posts p JOIN users u ON u.id = p.user_id WHERE u.handle LIKE 'seed\\_%'`);
    assert.ok(span.oldest_h >= 160 && span.oldest_h <= 169, `oldest ${span.oldest_h}h`);
    assert.ok(span.newest_h <= 6, `newest ${span.newest_h}h`);

    // images: the first 5 seeded posts carry them, owned by the post's author
    const withImg = posts.filter(p => p.image_id !== null);
    assert.equal(withImg.length, 5);
    assert.deepEqual(withImg.map(p => p.id), posts.slice(0, 5).map(p => p.id));
    const [imgs] = await c.query(
      `SELECT i.id, i.media_key, i.format, i.width, i.height, i.bytes_display, i.bytes_thumb, i.alt, u.handle
         FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE 'seed\\_%' ORDER BY i.id`);
    assert.equal(imgs.length, 5);
    assert.equal(new Set(imgs.map(i => i.media_key)).size, 5);
    for (const [idx, i] of imgs.entries()) {
      assert.match(i.media_key, /^[0-9a-f]{16}$/);
      assert.equal(i.handle, posts[idx].handle);
      assert.equal(i.id, posts[idx].image_id);
      assert.ok(i.bytes_display > 0 && i.bytes_thumb > 0);
    }
    const ext = imgs[0].format === 'webp' ? 'webp' : 'jpg';
    const get = await fetch(`${BASE}/media/${imgs[4].media_key}/thumb.${ext}`);
    assert.equal(get.status, 200);
    assert.ok((await get.arrayBuffer()).byteLength > 0);
  } finally {
    await c.end();
  }

  const o = await orphans();
  assert.equal(o.status, 200, o.text);
  assert.deepEqual(o.json, { orphan_dirs: 0, missing_files: 0 });
});

test('S3 F7 pagination across the seeded feed: no duplicates, ends with next_before null', async () => {
  const ids = [];
  const seedHandles = new Set();
  let before = null;
  let pages = 0;
  for (;;) {
    const r = await api('GET', `/api/posts?limit=20${before ? `&before=${before}` : ''}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.data.length <= 20);
    for (const p of r.json.data) {
      ids.push(p.id);
      if (p.author.handle.startsWith('seed_')) seedHandles.add(p.id);
    }
    pages++;
    assert.ok(pages < 1000, 'pagination did not terminate');
    if (r.json.next_before === null) break;
    assert.equal(r.json.data.length, 20, 'only the last page may be short');
    before = r.json.next_before;
  }
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids across pages');
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] < ids[i - 1], 'ids must descend');
  assert.ok(ids.length >= 45);
  assert.equal(seedHandles.size, 45, 'every seeded post must be reachable');
});

test('S4 orphan detection: stray key dir, ignored entries, missing file', needsDisk, async () => {
  const stray = `${MEDIA}/0123456789abcdef`;
  try {
    await mediaExec(['mkdir', stray]);
    assert.deepEqual((await orphans()).json, { orphan_dirs: 1, missing_files: 0 });
    // non-key entries are ignored
    await mediaExec(['mkdir', `${MEDIA}/.tmp-0123456789abcdee`]);
    await mediaExec(['mkdir', `${MEDIA}/not-a-key`]);
    assert.deepEqual((await orphans()).json, { orphan_dirs: 1, missing_files: 0 });
  } finally {
    await mediaExec(['rm', '-rf', stray, `${MEDIA}/.tmp-0123456789abcdee`, `${MEDIA}/not-a-key`]);
  }
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });

  // missing_files: remove one thumb of a seeded image
  const c = await db();
  let row;
  try {
    [[row]] = await c.query(
      "SELECT i.media_key, i.format FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE 'seed\\_%' ORDER BY i.id LIMIT 1");
  } finally {
    await c.end();
  }
  const file = `${MEDIA}/${row.media_key}/thumb.${row.format === 'webp' ? 'webp' : 'jpg'}`;
  await mediaExec(['rm', file]);
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 1 });
  // the broken seed images are removed by the reset in S5
});

test('S5 additive seed continues numbering; reset=1 starts over', needsDisk, async () => {
  const r = await seed('?users=2&posts=4&images=0');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ ...r.json, duration_ms: 0 }, { users: 2, posts: 4, images: 0, duration_ms: 0 });
  assert.equal(await seedUsers(), 5);
  const c = await db();
  try {
    const [rows] = await c.query("SELECT handle FROM users WHERE handle LIKE 'seed\\_%' ORDER BY id");
    assert.deepEqual(rows.map(x => x.handle), ['seed_001', 'seed_002', 'seed_003', 'seed_004', 'seed_005']);
  } finally {
    await c.end();
  }
  const r2 = await seed('?users=2&posts=0&images=0&reset=1');
  assert.equal(r2.status, 200, r2.text);
  assert.equal(await seedUsers(), 2);
  const c2 = await db();
  try {
    const [rows] = await c2.query("SELECT handle FROM users WHERE handle LIKE 'seed\\_%' ORDER BY id");
    assert.deepEqual(rows.map(x => x.handle), ['seed_001', 'seed_002']);
  } finally {
    await c2.end();
  }
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });
  // restore the S2 shape for the delete test
  assert.equal((await seed('?users=3&posts=45&images=5&reset=1')).status, 200);
});

test('S6 DELETE /api/test/seed removes users, posts, images and media dirs', needsDisk, async () => {
  const real = await createUser(); // a real user must survive
  const c = await db();
  let keys;
  try {
    [keys] = await c.query(
      "SELECT i.media_key FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE 'seed\\_%'");
  } finally {
    await c.end();
  }
  assert.equal(keys.length, 5);
  const r = await api('DELETE', '/api/test/seed', T);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { deleted_users: 3, deleted_posts: 45, deleted_images: 5 });
  assert.equal(await seedUsers(), 0);
  assert.equal(await scalar('SELECT COUNT(*) FROM users WHERE id = ?', [real.id]), 1);
  const listing = (await mediaExec(['ls', '-A', MEDIA])).split('\n').map(s => s.trim());
  for (const k of keys) assert.ok(!listing.includes(k.media_key), `${k.media_key} dir not removed`);
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });

  const again = await api('DELETE', '/api/test/seed', T);
  assert.deepEqual(again.json, { deleted_users: 0, deleted_posts: 0, deleted_images: 0 });
});

test('S7 seeded images are listed in the gallery with their seed author', needsDisk, async () => {
  // a seeded image is visible in the gallery with its seed author
  assert.equal((await seed('?users=1&posts=2&images=2&reset=1')).status, 200);
  const r = await api('GET', '/api/images?limit=5');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.some(i => i.author.handle === 'seed_001'));
  assert.equal((await api('DELETE', '/api/test/seed', T)).status, 200);
});

test('I5 full: delete image and delete post-with-image leave no orphans, urls 404', needsDisk, async () => {
  await resetRateLimits();
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });
  const u = await createUser();
  const upload = async () => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(fixture('test-1mp.jpg'))]), 'test-1mp.jpg');
    const r = await api('POST', '/api/images', { token: u.token, form });
    assert.equal(r.status, 201, r.text);
    return r.json;
  };

  // 1) delete an image directly
  const a = await upload();
  assert.equal((await fetch(BASE + a.display_url)).status, 200);
  assert.equal((await api('DELETE', `/api/images/${a.id}`, { token: u.token })).status, 204);
  assert.equal((await fetch(BASE + a.display_url)).status, 404);
  assert.equal((await fetch(BASE + a.thumb_url)).status, 404);
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });

  // 2) delete a post that carries an image
  const b = await upload();
  const p = await api('POST', '/api/posts', { token: u.token, body: { body: 'with image', image_id: b.id } });
  assert.equal(p.status, 201, p.text);
  assert.equal((await fetch(BASE + b.thumb_url)).status, 200);
  assert.equal((await api('DELETE', `/api/posts/${p.json.id}`, { token: u.token })).status, 204);
  assert.equal((await fetch(BASE + b.thumb_url)).status, 404);
  assert.equal((await fetch(BASE + b.display_url)).status, 404);
  assert.deepEqual((await orphans()).json, { orphan_dirs: 0, missing_files: 0 });
});
