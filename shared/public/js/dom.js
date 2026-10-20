// DOM helpers. `document` is only touched inside functions.

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach((c) => append(el, c)); return; }
  el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) {
      if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style') {
      if (typeof v === 'object') Object.assign(el.style, v);
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  children.forEach((c) => append(el, c));
  return el;
}

export function icon(id, { size = 20, stroke } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  if (stroke !== undefined) svg.setAttribute('stroke-width', String(stroke));
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}
