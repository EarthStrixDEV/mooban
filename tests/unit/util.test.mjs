import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codePointLength, timeAgo, joinedLabel, avatarColor, firstGrapheme,
  formatBytes, median, percentile, imageLabel,
} from '../../shared/public/js/util.js';

test('codePointLength trims then counts code points', () => {
  assert.equal(codePointLength('  ก่😀  '), 3);
  assert.equal(codePointLength('\uFEFF\u3000ab\u00A0'), 2);
  assert.equal(codePointLength('\u200Bab'), 3); // U+200B is not trimmed
  assert.equal(codePointLength(''), 0);
});

test('timeAgo', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  assert.equal(timeAgo('2026-10-20T09:59:30Z', { now }), 'เมื่อครู่');
  assert.equal(timeAgo('2026-10-20T09:42:00Z', { now }), '18 นาที');
  assert.equal(timeAgo('2026-10-20T07:00:00Z', { now, long: true }), '3 ชม. ที่แล้ว');
  assert.equal(timeAgo('2026-10-19T09:00:00Z', { now }), 'เมื่อวาน');
  assert.equal(timeAgo('2026-10-19T09:00:00Z', { now, long: true }), 'เมื่อวาน');
  assert.equal(timeAgo('2026-10-20T09:59:30Z', { now, long: true }), 'เมื่อครู่');
  assert.equal(timeAgo('2026-10-15T10:00:00Z', { now }), '5 วัน');
  assert.equal(timeAgo('2026-10-15T10:00:00Z', { now, long: true }), '5 วัน ที่แล้ว');
  assert.equal(timeAgo('2026-10-20T10:00:30Z', { now }), 'เมื่อครู่'); // future clamps
});

test('joinedLabel', () => {
  const s = joinedLabel('2026-10-20T09:00:00Z');
  assert.match(s, /^เข้าหมู่บ้านเมื่อ .+ 2569$/);
  assert.ok(!s.includes('พ.ศ.'));
  assert.ok(!/\s{2,}/.test(s));
});

test('avatarColor', () => {
  assert.equal(avatarColor('a'), 97 % 4);
  assert.equal(avatarColor('ab'), (97 + 98) % 4);
  assert.equal(avatarColor('😀'), 0x1F600 % 4);
  for (const h of ['x', 'mali', 'ป้าหน่อย', '']) {
    assert.ok([0, 1, 2, 3].includes(avatarColor(h)));
  }
});

test('firstGrapheme', () => {
  assert.equal(firstGrapheme('ป้าหน่อย'), 'ป้');
  assert.equal(firstGrapheme('😀x'), '😀');
  assert.equal(firstGrapheme(''), '');
});

test('formatBytes', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(186400), '182 KB');
  assert.equal(formatBytes(2621440), '2.5 MB');
});

test('median and percentile', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const xs = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 0.95), 10);
  assert.equal(percentile(xs, 0.5), 5);
  assert.deepEqual(xs, [5, 1, 4, 2, 3, 6, 7, 8, 9, 10]); // no mutation
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test('imageLabel prefers alt, falls back to the author handle', () => {
  assert.equal(imageLabel({ alt: 'แมว' }, 'mint'), 'แมว');
  assert.equal(imageLabel({ alt: '' }, 'mint'), 'รูปจาก @mint');
  assert.equal(imageLabel({ alt: null, author: { handle: 'ploy' } }), 'รูปจาก @ploy');
  assert.equal(imageLabel({}), 'รูปจาก @');
});
