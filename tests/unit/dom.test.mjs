import { test } from 'node:test';
import assert from 'node:assert/strict';

const created = [];
globalThis.document = {
  createElement(tag) {
    const el = {
      tag, attrs: {}, listeners: {}, children: [], style: {}, dataset: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, fn) { this.listeners[t] = fn; },
      appendChild(c) { this.children.push(c); return c; },
      set innerHTML(v) { throw new Error('innerHTML must not be used'); },
    };
    created.push(el);
    return el;
  },
  createTextNode(t) { return { text: t }; },
};
const { h } = await import('../../shared/public/js/dom.js');

test('string on* is never set as an attribute', () => {
  const el = h('a', { onclick: 'alert(1)', onerror: 'x' });
  assert.equal(el.attrs.onclick, undefined);
  assert.equal(el.attrs.onerror, undefined);
  assert.deepEqual(el.listeners, {});
});

test('function on* registers a listener', () => {
  const fn = () => {};
  const el = h('button', { onClick: fn });
  assert.equal(el.listeners.click, fn);
  assert.equal(el.attrs.onClick, undefined);
});

test('string child becomes text node', () => {
  const el = h('p', null, '<b>x</b>');
  assert.deepEqual(el.children, [{ text: '<b>x</b>' }]);
});

test('style object via CSSOM, string style ignored', () => {
  const a = h('div', { style: { aspectRatio: '4 / 3' } });
  assert.equal(a.style.aspectRatio, '4 / 3');
  assert.equal(a.attrs.style, undefined);
  const b = h('div', { style: 'color:red' });
  assert.equal(b.attrs.style, undefined);
  assert.deepEqual(b.style, {});
});
