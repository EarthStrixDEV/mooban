const KEY = 'mb_token';
let memToken = null;

export function getToken() {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v;
  } catch { /* fall back to memory */ }
  return memToken;
}

export function setToken(t) {
  memToken = t;
  try { localStorage.setItem(KEY, t); } catch { /* memory only */ }
}

export function clearToken() {
  memToken = null;
  try { localStorage.removeItem(KEY); } catch { /* memory only */ }
}

export const state = { me: null };

const listeners = new Map();

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}

export function emit(evt, data) {
  for (const fn of [...(listeners.get(evt) ?? [])]) fn(data);
}
