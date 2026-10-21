import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { createUser, resetRateLimits, BASE } from './helpers.mjs';

// Node-only, host mode: needs to see the server's os.tmpdir(). Set NODE_TMPDIR_HOST to that directory.
const TMP = process.env.NODE_TMPDIR_HOST;
const skip = !(process.env.STACK === 'node' && TMP);

const leftovers = () => fs.readdirSync(TMP).filter(n => n.startsWith('mooban-up-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rawUpload(token, { chunkBytes, declared, abort }) {
  const { port, hostname } = new URL(BASE);
  const bnd = 'ABORTBND';
  const head = `--${bnd}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n\xFF\xD8\xFF`;
  return new Promise((resolve) => {
    const sock = net.connect(Number(port), hostname, () => {
      sock.write(`POST /api/images HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\n` +
        `Content-Type: multipart/form-data; boundary=${bnd}\r\n` +
        (declared ? `Content-Length: ${declared}\r\n` : 'Transfer-Encoding: chunked\r\n') + '\r\n', 'latin1');
      const body = Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(chunkBytes, 1)]);
      sock.write(declared ? body : `${body.length.toString(16)}\r\n`);
      if (!declared) sock.write(Buffer.concat([body, Buffer.from('\r\n')]));
      if (abort) setTimeout(() => { sock.destroy(); resolve(''); }, 300);
    });
    let out = '';
    sock.on('data', c => { out += c; });
    sock.on('error', () => {});
    sock.on('close', () => resolve(out));
  });
}

test('client aborting mid-upload leaves no temp dir behind', { skip }, async () => {
  await resetRateLimits();
  const u = await createUser();
  const before = leftovers().length;
  for (let i = 0; i < 3; i++) await rawUpload(u.token, { chunkBytes: 1024 * 1024, declared: 5 * 1024 * 1024, abort: true });
  await sleep(1000);
  assert.equal(leftovers().length, before);
});

test('chunked body over 12 MB: 413 and no temp dir left', { skip }, async () => {
  await resetRateLimits();
  const u = await createUser();
  const before = leftovers().length;
  const out = await rawUpload(u.token, { chunkBytes: 13 * 1024 * 1024, declared: 0, abort: false });
  assert.match(out, /^HTTP\/1\.1 413 /);
  await sleep(1000);
  assert.equal(leftovers().length, before);
});
