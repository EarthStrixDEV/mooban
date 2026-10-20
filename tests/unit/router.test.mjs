import { test } from 'node:test';
import assert from 'node:assert/strict';

const { matchRoute } = await import('../../shared/public/js/router.js');

test('static routes', () => {
  assert.deepEqual(matchRoute('/'), { name: 'feed', params: {} });
  assert.deepEqual(matchRoute('/gallery'), { name: 'gallery', params: {} });
  assert.deepEqual(matchRoute('/test'), { name: 'test', params: {} });
});

test('profile route captures handle', () => {
  assert.deepEqual(matchRoute('/u/Earth_1'), { name: 'profile', params: { handle: 'Earth_1' } });
});

test('unknown paths are notfound', () => {
  assert.equal(matchRoute('/x').name, 'notfound');
  assert.equal(matchRoute('/u/').name, 'notfound');
  assert.equal(matchRoute('/u/a/b').name, 'notfound');
  assert.equal(matchRoute('').name, 'notfound');
});

test('trailing slash does not match', () => {
  assert.equal(matchRoute('/gallery/').name, 'notfound');
  assert.equal(matchRoute('/test/').name, 'notfound');
  assert.equal(matchRoute('/u/earth/').name, 'notfound');
});
