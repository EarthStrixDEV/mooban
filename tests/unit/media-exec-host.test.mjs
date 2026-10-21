import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mediaExecHost } from '../contract/helpers.mjs';

function setup() {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'mexec-'));
  const env = { MEDIA_DIR_IN_CONTAINER: '/data/media', MEDIA_DIR_HOST: host };
  return { host, env };
}

test('ls -A lists host dir, mkdir creates, rm -rf removes every target', async () => {
  const { host, env } = setup();
  await mediaExecHost(['mkdir', '/data/media/a'], env);
  await mediaExecHost(['mkdir', '/data/media/.tmp-1'], env);
  await mediaExecHost(['mkdir', '/data/media/b'], env);
  assert.equal(await mediaExecHost(['ls', '-A', '/data/media'], env), '.tmp-1\na\nb\n');
  await mediaExecHost(['rm', '-rf', '/data/media/a', '/data/media/.tmp-1', '/data/media/b'], env);
  assert.deepEqual(fs.readdirSync(host), []);
  fs.rmSync(host, { recursive: true });
});

test('.. escapes and foreign prefixes are rejected', async () => {
  const { host, env } = setup();
  await assert.rejects(mediaExecHost(['rm', '-rf', '/data/media/../x'], env), /escapes/);
  await assert.rejects(mediaExecHost(['rm', '-rf', '/data/media/a/../../x'], env), /escapes/);
  await assert.rejects(mediaExecHost(['rm', '-rf', '/data/mediax'], env), /outside/);
  await assert.rejects(mediaExecHost(['rm', '-rf', '/etc'], env), /outside/);
  fs.rmSync(host, { recursive: true });
});

test('rm -r of the media root and an empty MEDIA_DIR_IN_CONTAINER are refused', async () => {
  const { host, env } = setup();
  await assert.rejects(mediaExecHost(['rm', '-rf', '/data/media'], env), /root/);
  await assert.rejects(mediaExecHost(['rm', '-rf', '/data/media/'], env), /outside|root/);
  await assert.rejects(mediaExecHost(['ls', '-A', '/x'], { ...env, MEDIA_DIR_IN_CONTAINER: '' }), /needs/);
  assert.ok(fs.existsSync(host));
  fs.rmSync(host, { recursive: true });
});
