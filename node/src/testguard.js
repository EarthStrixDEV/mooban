import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './http.js';

const digest = (s) => createHash('sha256').update(s).digest();

/**
 * 403 {"error":"forbidden"} unless X-Test-Token equals TEST_TOKEN. Both values are hashed first so the
 * constant-time compare runs on equal-length buffers and the token length does not leak.
 */
export function require(req) {
  const expected = config.TEST_TOKEN;
  const given = req.headers['x-test-token'];
  if (expected === '' || typeof given !== 'string' || !timingSafeEqual(digest(expected), digest(given))) {
    throw new HttpError(403, 'forbidden');
  }
}
