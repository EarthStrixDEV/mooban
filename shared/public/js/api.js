import { getToken } from './store.js';

export class ApiError extends Error {
  constructor(status, code, fields = {}, retryAfter = null) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export async function api(method, path, { json, form, auth = true, headers, signal } = {}) {
  const h = { ...(headers || {}) };
  const token = auth ? getToken() : null;
  if (token) h.Authorization = `Bearer ${token}`;
  const init = { method, headers: h };
  if (signal) init.signal = signal;
  if (form !== undefined) {
    init.body = form;
  } else if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }

  if (res.status === 204) return null;

  let body = null;
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  if (text) { try { body = JSON.parse(text); } catch { body = null; } }

  if (!res.ok) {
    const hdr = Number(res.headers.get('Retry-After'));
    const retryAfter = body && Number.isFinite(body.retry_after) ? body.retry_after
      : res.headers.get('Retry-After') !== null && Number.isFinite(hdr) ? hdr : null;
    throw new ApiError(
      res.status,
      (body && body.error) || `http_${res.status}`,
      (body && body.fields) || {},
      retryAfter,
    );
  }
  return body;
}
