import { test } from 'node:test';
import assert from 'node:assert/strict';

// Tiny DOM stub: charts.js only needs createElementNS / setAttribute / append.
globalThis.document = {
  createElementNS(ns, tag) {
    return {
      ns, tag, attrs: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] ?? null; },
      append(...cs) { this.children.push(...cs); },
      appendChild(c) { this.children.push(c); return c; },
    };
  },
};
const { lineChart, barChart } = await import('../../shared/public/js/ui/charts.js');

const all = (el, tag, out = []) => {
  if (el.tag === tag) out.push(el);
  el.children.forEach((c) => all(c, tag, out));
  return out;
};

test('lineChart: svg[role=img] with label, one path, two dashed lines', () => {
  const svg = lineChart({ values: [12, 30, 18, 25], p50: 21.5, p95: 30, label: 'กราฟความหน่วง 4 ครั้ง' });
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.attrs.role, 'img');
  assert.equal(svg.attrs['aria-label'], 'กราฟความหน่วง 4 ครั้ง');
  assert.equal(all(svg, 'path').length, 1);
  const dashed = all(svg, 'line').filter((l) => l.attrs['stroke-dasharray']);
  assert.equal(dashed.length, 2);
  assert.notEqual(all(svg, 'path')[0].attrs.d, '');
});

test('lineChart: path has one point per value and stays inside the viewBox', () => {
  const svg = lineChart({ values: [5, 50, 5], p50: 5, p95: 50, label: 'x' });
  const d = all(svg, 'path')[0].attrs.d;
  const pts = d.match(/[ML]\s*[\d.]+[ ,][\d.]+/g);
  assert.equal(pts.length, 3);
  const [, , w, hgt] = svg.attrs.viewBox.split(' ').map(Number);
  for (const p of pts) {
    const [x, y] = p.slice(1).trim().split(/[ ,]/).map(Number);
    assert.ok(x >= 0 && x <= w && y >= 0 && y <= hgt, p);
  }
});

test('lineChart: reference lines are skipped when not finite; a single value still draws', () => {
  const svg = lineChart({ values: [10], p50: NaN, p95: undefined, label: 'one' });
  assert.equal(all(svg, 'line').filter((l) => l.attrs['stroke-dasharray']).length, 0);
  assert.equal(all(svg, 'path').length, 1);
});

test('barChart: one rect per value, only the last is the latest bar', () => {
  const svg = barChart({ values: [10, 20, 15], label: 'RTT 3 ครั้ง' });
  assert.equal(svg.attrs.role, 'img');
  assert.equal(svg.attrs['aria-label'], 'RTT 3 ครั้ง');
  const rects = all(svg, 'rect');
  assert.equal(rects.length, 3);
  assert.deepEqual(rects.map((r) => r.attrs.class.includes('chart__bar--latest')), [false, false, true]);
  // the tallest value has the tallest bar
  const hs = rects.map((r) => Number(r.attrs.height));
  assert.ok(hs[1] > hs[2] && hs[2] > hs[0]);
});
