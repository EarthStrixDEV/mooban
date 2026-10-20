import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { api, db, createUser, resetRateLimits, fixture, mediaExec, BASE, STACK } from './helpers.mjs';

// mediaExec needs the compose service; the Apache stack is the one with a docroot media dir.
if (!process.env.SERVICE && STACK === 'apache') process.env.SERVICE = 'apache';
const MEDIA_DIR_IN_CONTAINER = process.env.MEDIA_DIR_IN_CONTAINER ?? '/var/www/site/public_html/media';
const PHP_SRC_IN_CONTAINER = process.env.PHP_SRC_IN_CONTAINER ?? '/var/www/site/src';

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const URL_RE = /^\/media\/[0-9a-f]{16}\/(thumb|display)\.(webp|jpg)$/;
const IMAGE_KEYS = ['alt', 'author', 'bytes_display', 'bytes_thumb', 'created_at', 'display_url',
  'format', 'height', 'id', 'thumb_url', 'width'];

/** Images this file created through the API; removed in after() so the 500/stack quota stays free. */
const created = [];

before(async () => { await resetRateLimits(); });

after(async () => {
  await resetRateLimits();
  for (const { token, id } of created) {
    await api('DELETE', `/api/images/${id}`, { token }).catch(() => {});
  }
});

function formFor(name, alt) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(fixture(name))]), name);
  if (alt !== undefined) form.append('alt', alt);
  return form;
}

async function upload(u, name, alt) {
  const r = await api('POST', '/api/images', { token: u.token, form: formFor(name, alt) });
  if (r.status === 201) created.push({ token: u.token, id: r.json.id });
  return r;
}

async function fetchBytes(url) {
  const res = await fetch(BASE + url);
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

async function mediaEntries() {
  const out = await mediaExec(['ls', '-A', MEDIA_DIR_IN_CONTAINER]);
  return out.split('\n').map(s => s.trim()).filter(Boolean).sort();
}

test('I1 1mp and 12mp upload: sizes, formats, url shapes, processing_ms', async () => {
  const u = await createUser();
  for (const name of ['test-1mp.jpg', 'test-12mp.jpg']) {
    const r = await upload(u, name);
    assert.equal(r.status, 201, `${name}: ${r.text}`);
    const img = r.json;
    assert.deepEqual(Object.keys(img).sort(), [...IMAGE_KEYS, 'processing_ms'].sort());
    assert.ok(['webp', 'jpeg'].includes(img.format));
    assert.match(img.thumb_url, /^\/media\/[0-9a-f]{16}\/thumb\.(webp|jpg)$/);
    assert.match(img.display_url, /^\/media\/[0-9a-f]{16}\/display\.(webp|jpg)$/);
    assert.equal(img.alt, null);
    assert.match(img.created_at, ISO);
    assert.deepEqual(img.author, { handle: u.handle, display_name: u.handle });
    assert.ok(Number.isInteger(img.processing_ms) && img.processing_ms >= 0);
    if (name === 'test-12mp.jpg') assert.ok(img.processing_ms < 10000, `processing_ms ${img.processing_ms}`);

    const disp = await fetchBytes(img.display_url);
    const thumb = await fetchBytes(img.thumb_url);
    assert.equal(disp.res.status, 200);
    assert.equal(thumb.res.status, 200);
    const dm = await sharp(disp.buf).metadata();
    const tm = await sharp(thumb.buf).metadata();
    assert.ok(Math.max(dm.width, dm.height) <= 1080);
    assert.ok(tm.width <= 320);
    assert.equal(dm.width, img.width);
    assert.equal(dm.height, img.height);
    assert.equal(dm.format, img.format);
    assert.equal(disp.buf.length, img.bytes_display);
    assert.equal(thumb.buf.length, img.bytes_thumb);
    // thumb keeps the display aspect ratio (within rounding)
    assert.ok(Math.abs(tm.width / tm.height - dm.width / dm.height) < 0.02);
  }
});

test('I1b 24mp (exactly at the pixel ceiling) is accepted', async () => {
  const u = await createUser();
  const r = await upload(u, 'test-24mp.jpg');
  assert.equal(r.status, 201, r.text);
  assert.ok(Math.max(r.json.width, r.json.height) <= 1080);
});

test('I2 EXIF orientation applied and metadata stripped', async () => {
  const u = await createUser();
  const r = await upload(u, 'test-exif.jpg');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.width, 810);
  assert.equal(r.json.height, 1080);
  const { buf } = await fetchBytes(r.json.display_url);
  const m = await sharp(buf).metadata();
  assert.equal(m.width, 810);
  assert.equal(m.height, 1080);
  assert.equal(m.exif, undefined);
  const t = await sharp((await fetchBytes(r.json.thumb_url)).buf).metadata();
  assert.equal(t.exif, undefined);
});

test('I2b all 8 EXIF orientations come out upright (compared with sharp auto-orient)', async () => {
  // 120x80 picture, quadrants red / green / blue / yellow, tagged with each orientation
  const W = 120, H = 80;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const left = x < W / 2, top = y < H / 2;
      const c = top ? (left ? [255, 0, 0] : [0, 255, 0]) : (left ? [0, 0, 255] : [255, 255, 0]);
      raw.set(c, (y * W + x) * 3);
    }
  }
  for (let o = 1; o <= 8; o++) {
    const jpg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 95 }).withMetadata({ orientation: o }).toBuffer();
    assert.equal((await sharp(jpg).metadata()).orientation, o);
    const expected = await sharp(jpg).rotate().raw().toBuffer({ resolveWithObject: true });

    const u = await createUser();
    const form = new FormData();
    form.append('file', new Blob([jpg]), `o${o}.jpg`);
    const r = await api('POST', '/api/images', { token: u.token, form });
    assert.equal(r.status, 201, `orientation ${o}: ${r.text}`);
    created.push({ token: u.token, id: r.json.id });
    assert.equal(r.json.width, expected.info.width, `orientation ${o} width`);
    assert.equal(r.json.height, expected.info.height, `orientation ${o} height`);
    const got = await sharp((await fetchBytes(r.json.display_url)).buf).raw().toBuffer({ resolveWithObject: true });
    const w = got.info.width, h = got.info.height, ch = got.info.channels;
    for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const x = Math.floor(w * fx), y = Math.floor(h * fy);
      for (let k = 0; k < 3; k++) {
        const a = got.data[(y * w + x) * ch + k];
        const b = expected.data[(y * w + x) * expected.info.channels + k];
        assert.ok(Math.abs(a - b) < 60, `orientation ${o} at (${fx},${fy}) channel ${k}: ${a} vs ${b}`);
      }
    }
  }
});

test('I3 PNG with alpha: kept as webp alpha, or flattened on white for jpeg', async () => {
  const u = await createUser();
  const r = await upload(u, 'test-alpha.png');
  assert.equal(r.status, 201, r.text);
  const { buf } = await fetchBytes(r.json.display_url);
  const m = await sharp(buf).metadata();
  if (r.json.format === 'webp') {
    assert.equal(m.format, 'webp');
    assert.equal(m.hasAlpha, true);
  } else {
    assert.equal(r.json.format, 'jpeg');
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([data[0], data[1], data[2]], [255, 255, 255]);
  }
});

test('I3b JPEG fallback (WebP disabled): .jpg files, flattened on white, format jpeg', { skip: STACK !== 'apache' }, async () => {
  const code = `
    require '${PHP_SRC_IN_CONTAINER}/bootstrap.php';
    $im = imagecreatetruecolor(100, 80); imagealphablending($im, false); imagesavealpha($im, true);
    imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
    imagefilledrectangle($im, 40, 30, 60, 50, imagecolorallocate($im, 255, 0, 0));
    $tmp = tempnam(sys_get_temp_dir(), 'fb'); imagepng($im, $tmp);
    Images::$forceJpeg = true;
    $r = Images::process($tmp, filesize($tmp));
    $dir = rtrim(Config::get('MEDIA_DIR'), '/') . '/' . $r['media_key'];
    $d = imagecreatefromjpeg($dir . '/display.jpg'); $c = imagecolorat($d, 0, 0);
    $mid = imagecolorat($d, 50, 40);
    echo json_encode($r + ['files' => array_values(array_diff(scandir($dir), ['.', '..'])),
      'corner' => [($c >> 16) & 255, ($c >> 8) & 255, $c & 255],
      'mid' => [($mid >> 16) & 255, ($mid >> 8) & 255, $mid & 255],
      'perm' => substr(sprintf('%o', fileperms($dir . '/display.jpg')), -4),
      'dirperm' => substr(sprintf('%o', fileperms($dir)), -4)]);
    Media::removeDir($r['media_key']); unlink($tmp);`;
  const out = JSON.parse(await mediaExec(['php', '-r', code]));
  assert.equal(out.format, 'jpeg');
  assert.deepEqual(out.files.sort(), ['display.jpg', 'thumb.jpg']);
  assert.deepEqual(out.corner, [255, 255, 255]);
  assert.ok(out.mid[0] > 200 && out.mid[1] < 60 && out.mid[2] < 60, `mid ${out.mid}`);
  assert.equal(out.width, 100);
  assert.equal(out.height, 80);
  assert.equal(out.perm, '0644');
  assert.equal(out.dirperm, '0755');
});

test('I4 rejected uploads: 422 pixels, 413 size, 415 magic, 422 invalid; nothing left on disk', { skip: !process.env.SERVICE }, async () => {
  const u = await createUser();
  const before = await mediaEntries();
  const cases = [
    ['test-25mp.jpg', 422, 'image_too_many_pixels'],
    ['test-11mb.jpg', 413, 'payload_too_large'],
    ['test-fake.jpg', 415, 'unsupported_media_type'],
    ['test-corrupt.png', 422, 'image_invalid'],
  ];
  for (const [name, status, code] of cases) {
    const r = await upload(u, name);
    assert.equal(r.status, status, `${name}: ${r.text}`);
    assert.equal(r.json.error, code, name);
  }
  const after = await mediaEntries();
  assert.deepEqual(after, before);
  assert.ok(!after.some(e => e.startsWith('.tmp-')));
});

test('I4b body over post_max_size (PHP discards it) is still 413; JSON POST is not', async () => {
  const u = await createUser();
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(13 * 1024 * 1024, 1)]), 'big.jpg');
  const r = await api('POST', '/api/images', { token: u.token, form });
  assert.equal(r.status, 413, r.text);
  assert.equal(r.json.error, 'payload_too_large');
  // not multipart -> the file field is simply missing
  const j = await api('POST', '/api/images', { token: u.token, body: { a: 1 } });
  assert.equal(j.status, 422);
  assert.equal(j.json.fields.file, 'ต้องแนบไฟล์');
});

test('upload check order: 401, 422 missing file, 422 alt, 429', async () => {
  const noAuth = await api('POST', '/api/images', { form: formFor('test-1mp.jpg') });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.error, 'unauthorized');

  const u = await createUser();
  const noFile = new FormData();
  noFile.append('alt', 'x');
  const r1 = await api('POST', '/api/images', { token: u.token, form: noFile });
  assert.equal(r1.status, 422);
  assert.equal(r1.json.error, 'validation_failed');
  assert.deepEqual(r1.json.fields, { file: 'ต้องแนบไฟล์' });

  const longAlt = await api('POST', '/api/images', { token: u.token, form: formFor('test-1mp.jpg', 'ก'.repeat(201)) });
  assert.equal(longAlt.status, 422);
  assert.deepEqual(longAlt.json.fields, { alt: 'ยาวเกิน 200 ตัวอักษร' });

  // magic bytes (415) are checked before alt (422)
  const both = await api('POST', '/api/images', { token: u.token, form: formFor('test-fake.jpg', 'ก'.repeat(201)) });
  assert.equal(both.status, 415);

  // fresh user: 10 uploads per minute are allowed (each rejected here with 415), the 11th is limited
  const rl = await createUser();
  let last;
  for (let i = 0; i < 11; i++) last = await api('POST', '/api/images', { token: rl.token, form: formFor('test-fake.jpg') });
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
  assert.ok(last.headers.get('retry-after'));
});

test('alt on upload is trimmed; blank becomes null', async () => {
  const u = await createUser();
  const a = await upload(u, 'test-1mp.jpg', '  แมวบนหลังคา  ');
  assert.equal(a.status, 201, a.text);
  assert.equal(a.json.alt, 'แมวบนหลังคา');
  const b = await upload(u, 'test-1mp.jpg', '   ');
  assert.equal(b.status, 201, b.text);
  assert.equal(b.json.alt, null);
});

test('I5 delete image removes files and row; deleting a post removes its image', async () => {
  const u = await createUser();
  const r = await upload(u, 'test-1mp.jpg');
  assert.equal(r.status, 201);
  assert.equal((await fetch(BASE + r.json.thumb_url)).status, 200);

  const post = await api('POST', '/api/posts', { token: u.token, body: { body: 'มีรูป', image_id: r.json.id } });
  assert.equal(post.status, 201, post.text);
  assert.equal(post.json.image.id, r.json.id);

  const del = await api('DELETE', `/api/images/${r.json.id}`, { token: u.token });
  assert.equal(del.status, 204);
  assert.equal((await fetch(BASE + r.json.thumb_url)).status, 404);
  assert.equal((await fetch(BASE + r.json.display_url)).status, 404);
  const again = await api('DELETE', `/api/images/${r.json.id}`, { token: u.token });
  assert.equal(again.status, 404);
  const still = await api('GET', `/api/posts/${post.json.id}`);
  assert.equal(still.status, 200);
  assert.equal(still.json.image, null);

  const r2 = await upload(u, 'test-1mp.jpg');
  const post2 = await api('POST', '/api/posts', { token: u.token, body: { body: '', image_id: r2.json.id } });
  assert.equal(post2.status, 201);
  const delPost = await api('DELETE', `/api/posts/${post2.json.id}`, { token: u.token });
  assert.equal(delPost.status, 204);
  assert.equal((await fetch(BASE + r2.json.display_url)).status, 404);
  const c = await db();
  try {
    const [rows] = await c.execute('SELECT id FROM images WHERE id = ?', [r2.json.id]);
    assert.equal(rows.length, 0);
  } finally {
    await c.end();
  }
});

test('I6 media is served with immutable cache headers, nosniff, and answers 304', async () => {
  const u = await createUser();
  const r = await upload(u, 'test-1mp.jpg');
  assert.equal(r.status, 201);
  const res = await fetch(BASE + r.json.thumb_url);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-type') ?? '', /^image\/(webp|jpeg)/);
  const etag = res.headers.get('etag');
  const lm = res.headers.get('last-modified');
  assert.ok(etag || lm, 'needs ETag or Last-Modified');
  if (etag) {
    const c = await fetch(BASE + r.json.thumb_url, { headers: { 'If-None-Match': etag } });
    assert.equal(c.status, 304);
    await c.arrayBuffer();
  }
  if (lm) {
    const c = await fetch(BASE + r.json.thumb_url, { headers: { 'If-Modified-Since': lm } });
    assert.equal(c.status, 304);
    await c.arrayBuffer();
  }
  // no directory listing
  const dir = await fetch(BASE + r.json.thumb_url.replace(/[^/]+$/, ''));
  await dir.arrayBuffer();
  assert.ok([403, 404].includes(dir.status), `dir listing status ${dir.status}`);
});

test('F4 post image_id: must be yours, single-use, body may be empty, shape has no author', async () => {
  const a = await createUser();
  const b = await createUser();
  const img = await upload(a, 'test-1mp.jpg', 'alt a');
  assert.equal(img.status, 201);

  const other = await api('POST', '/api/posts', { token: b.token, body: { body: 'x', image_id: img.json.id } });
  assert.equal(other.status, 422);
  assert.equal(other.json.error, 'validation_failed');
  assert.equal(other.json.fields.image_id, 'ไม่พบรูปนี้');

  const missing = await api('POST', '/api/posts', { token: a.token, body: { body: 'x', image_id: 2147483000 } });
  assert.equal(missing.status, 422);
  assert.equal(missing.json.fields.image_id, 'ไม่พบรูปนี้');
  const wrongType = await api('POST', '/api/posts', { token: a.token, body: { body: 'x', image_id: 'abc' } });
  assert.equal(wrongType.status, 422);
  assert.equal(wrongType.json.fields.image_id, 'ไม่พบรูปนี้');

  const ok = await api('POST', '/api/posts', { token: a.token, body: { body: '', image_id: img.json.id } });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual(Object.keys(ok.json.image).sort(),
    ['alt', 'display_url', 'height', 'id', 'thumb_url', 'width']);
  assert.equal(ok.json.image.id, img.json.id);
  assert.equal(ok.json.image.alt, 'alt a');
  assert.equal(ok.json.image.thumb_url, img.json.thumb_url);
  assert.equal(ok.json.image.width, img.json.width);
  assert.equal(ok.json.body, '');

  const twice = await api('POST', '/api/posts', { token: a.token, body: { body: 'again', image_id: img.json.id } });
  assert.equal(twice.status, 422);
  assert.equal(twice.json.fields.image_id, 'รูปนี้ถูกใช้กับโพสต์อื่นแล้ว');

  // PUT ignores image_id and keeps the attached image
  const img2 = await upload(a, 'test-1mp.jpg');
  const put = await api('PUT', `/api/posts/${ok.json.id}`, { token: a.token, body: { body: 'edited', image_id: img2.json.id } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.image.id, img.json.id);
  assert.equal(put.json.body, 'edited');

  // null image_id behaves like absent
  const nul = await api('POST', '/api/posts', { token: a.token, body: { body: 'plain', image_id: null } });
  assert.equal(nul.status, 201);
  assert.equal(nul.json.image, null);
  const empty = await api('POST', '/api/posts', { token: a.token, body: { body: '', image_id: null } });
  assert.equal(empty.status, 422);
  assert.equal(empty.json.fields.body, 'ต้องมีข้อความหรือรูป');
});

test('F8 PATCH alt: set, clear, too long, owner only, order of checks', async () => {
  const a = await createUser();
  const b = await createUser();
  const img = await upload(a, 'test-1mp.jpg');
  const id = img.json.id;

  const noAuth = await api('PATCH', `/api/images/${id}`, { body: { alt: 'x' } });
  assert.equal(noAuth.status, 401);
  const missing = await api('PATCH', '/api/images/2147483000', { token: a.token, body: { alt: 'x' } });
  assert.equal(missing.status, 404);
  const padded = await api('PATCH', '/api/images/007', { token: a.token, body: { alt: 'x' } });
  assert.equal(padded.status, 404);
  const forbidden = await api('PATCH', `/api/images/${id}`, { token: b.token, body: { alt: 'x' } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.error, 'not_owner');
  const forbiddenDel = await api('DELETE', `/api/images/${id}`, { token: b.token });
  assert.equal(forbiddenDel.status, 403);
  assert.equal(forbiddenDel.json.error, 'not_owner');
  const delMissing = await api('DELETE', '/api/images/2147483000', { token: b.token });
  assert.equal(delMissing.status, 404);

  const bad = await api('PATCH', `/api/images/${id}`, { token: a.token, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_json');

  const set = await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: '  แมวบนหลังคา ' } });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(Object.keys(set.json).sort(), IMAGE_KEYS);
  assert.equal(set.json.alt, 'แมวบนหลังคา');
  assert.deepEqual(set.json.author, { handle: a.handle, display_name: a.handle });
  assert.equal(set.json.thumb_url, img.json.thumb_url);

  const clear = await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: '' } });
  assert.equal(clear.status, 200);
  assert.equal(clear.json.alt, null);
  await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: 'again' } });
  const nul = await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: null } });
  assert.equal(nul.status, 200);
  assert.equal(nul.json.alt, null);

  const edge = await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: 'ก'.repeat(200) } });
  assert.equal(edge.status, 200);
  const long = await api('PATCH', `/api/images/${id}`, { token: a.token, body: { alt: 'ก'.repeat(201) } });
  assert.equal(long.status, 422);
  assert.equal(long.json.error, 'validation_failed');
  assert.deepEqual(long.json.fields, { alt: 'ยาวเกิน 200 ตัวอักษร' });
});

test('GET /api/images: newest first, user filter, pagination, bad params', async () => {
  const a = await createUser();
  const b = await createUser();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await upload(a, 'test-1mp.jpg')).json.id);
  const other = await upload(b, 'test-1mp.jpg');

  const all = await api('GET', `/api/images?user=${a.handle.toUpperCase()}`);
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.data.map(i => i.id), [...ids].reverse());
  assert.equal(all.json.next_before, null);
  for (const i of all.json.data) {
    assert.deepEqual(Object.keys(i).sort(), IMAGE_KEYS);
    assert.equal(i.author.handle, a.handle);
  }

  const p1 = await api('GET', `/api/images?user=${a.handle}&limit=2`);
  assert.deepEqual(p1.json.data.map(i => i.id), [ids[2], ids[1]]);
  assert.equal(p1.json.next_before, ids[1]);
  const p2 = await api('GET', `/api/images?user=${a.handle}&limit=2&before=${p1.json.next_before}`);
  assert.deepEqual(p2.json.data.map(i => i.id), [ids[0]]);
  assert.equal(p2.json.next_before, null);

  const mixed = await api('GET', '/api/images?limit=100');
  assert.equal(mixed.status, 200);
  assert.ok(mixed.json.data.length >= 4);
  const sorted = mixed.json.data.map(i => i.id);
  assert.deepEqual(sorted, [...sorted].sort((x, y) => y - x));
  assert.equal(mixed.json.data[0].id >= other.json.id, true);

  const nobody = await api('GET', '/api/images?user=nosuchuser1');
  assert.deepEqual(nobody.json, { data: [], next_before: null });

  for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=0', 'before=-1', 'before=1.5']) {
    const r = await api('GET', `/api/images?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, 'bad_params', q);
  }
});

async function insertFakeImages(userId, n) {
  const rows = Array.from({ length: n }, () => [userId, randomBytes(8).toString('hex'), 10, 10, 'webp', 1, 1]);
  const c = await db();
  try {
    await c.query('INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb) VALUES ?', [rows]);
  } finally {
    await c.end();
  }
}

async function deleteImagesOf(userIds) {
  const c = await db();
  try {
    await c.query('DELETE FROM images WHERE user_id IN (?)', [userIds]);
  } finally {
    await c.end();
  }
}

test('quota: 100 per user -> 422 quota_reached before any processing', async () => {
  const u = await createUser();
  await insertFakeImages(u.id, 100);
  try {
    const entriesBefore = process.env.SERVICE ? await mediaEntries() : null;
    const r = await upload(u, 'test-1mp.jpg');
    assert.equal(r.status, 422, r.text);
    assert.equal(r.json.error, 'quota_reached');
    // quota beats a missing file / bad file: it is checked first
    const noFile = await api('POST', '/api/images', { token: u.token, form: new FormData() });
    assert.equal(noFile.status, 422);
    assert.equal(noFile.json.error, 'quota_reached');
    if (entriesBefore) assert.deepEqual(await mediaEntries(), entriesBefore);
  } finally {
    await deleteImagesOf([u.id]);
  }
});

async function nonSeedTotal() {
  const c = await db();
  try {
    const [rows] = await c.query(
      "SELECT COUNT(*) AS n FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle NOT LIKE 'seed\\_%'");
    return Number(rows[0].n);
  } finally {
    await c.end();
  }
}

test('quota: 500 per stack counts non-seed users only', async (t) => {
  const total = await nonSeedTotal();
  if (total > 300) { t.skip(`stack already holds ${total} non-seed images`); return; }

  // 5 seed users x 100 images: must NOT count towards the 500
  const seeds = [];
  for (let i = 0; i < 5; i++) seeds.push(await createUser({ handle: 'seed_' + randomBytes(5).toString('hex') }));
  for (const s of seeds) await insertFakeImages(s.id, 100);
  const u = await createUser();
  try {
    const ok = await upload(u, 'test-1mp.jpg');
    assert.equal(ok.status, 201, ok.text);
  } finally {
    await deleteImagesOf(seeds.map(s => s.id));
  }

  // 5 ordinary users x 100 images: stack is full (>= 500)
  const fillers = [];
  for (let i = 0; i < 5; i++) fillers.push(await createUser());
  const needed = 500 - (await nonSeedTotal());
  try {
    let left = needed;
    for (const f of fillers) {
      const n = Math.min(100, left);
      if (n > 0) await insertFakeImages(f.id, n);
      left -= n;
    }
    assert.ok(left <= 0, 'could not fill the stack quota in the test');
    const fresh = await createUser();
    const r = await upload(fresh, 'test-1mp.jpg');
    assert.equal(r.status, 422, r.text);
    assert.equal(r.json.error, 'quota_reached');
  } finally {
    await deleteImagesOf(fillers.map(f => f.id));
  }
});
