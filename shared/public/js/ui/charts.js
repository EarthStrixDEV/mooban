// SVG charts for /test (DESIGN 4.13). Colours come from CSS classes (.chart__*), never inline.
// Every chart is role="img" with a summary label; `rawValues` is its text equivalent.
import { h } from '../dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 320;
const PAD = 8;

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function root(height, label, cls) {
  return svgEl('svg', {
    viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label, class: cls, preserveAspectRatio: 'none',
  });
}

const r1 = (n) => Math.round(n * 10) / 10;

export function lineChart({ values, p50, p95, label }) {
  const H = 140;
  const svg = root(H, label, 'chart chart--line');
  const refs = [p50, p95].filter((v) => Number.isFinite(v));
  const max = Math.max(1, ...values, ...refs);
  const y = (v) => r1(PAD + (1 - v / max) * (H - 2 * PAD));
  const x = (i) => r1(values.length < 2 ? W / 2 : PAD + (i / (values.length - 1)) * (W - 2 * PAD));

  if (Number.isFinite(p95)) {
    svg.append(svgEl('line', { class: 'chart__p95', x1: PAD, x2: W - PAD, y1: y(p95), y2: y(p95), 'stroke-dasharray': '6 4' }));
  }
  if (Number.isFinite(p50)) {
    svg.append(svgEl('line', { class: 'chart__p50', x1: PAD, x2: W - PAD, y1: y(p50), y2: y(p50), 'stroke-dasharray': '2 4' }));
  }
  const d = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  svg.append(svgEl('path', { class: 'chart__line', d }));
  return svg;
}

export function barChart({ values, label }) {
  const H = 120;
  const svg = root(H, label, 'chart chart--bars');
  const max = Math.max(1, ...values);
  const slot = (W - 2 * PAD) / Math.max(1, values.length);
  const bw = r1(slot * 0.7);
  values.forEach((v, i) => {
    const bh = r1(Math.max(2, (v / max) * (H - 2 * PAD)));
    svg.append(svgEl('rect', {
      class: i === values.length - 1 ? 'chart__bar chart__bar--latest' : 'chart__bar',
      x: r1(PAD + i * slot + (slot - bw) / 2), y: r1(H - PAD - bh), width: bw, height: bh, rx: 2,
    }));
  });
  return svg;
}

/** Text equivalent of a chart: <details> "ดูค่าดิบ" listing every value. */
export function rawValues(values, unit = 'ms') {
  return h('details', { class: 'chart-raw' },
    h('summary', null, 'ดูค่าดิบ'),
    h('ol', null, values.map((v) => h('li', null, `${v} ${unit}`))));
}
