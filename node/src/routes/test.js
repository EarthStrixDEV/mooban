import { randomBytes } from 'node:crypto';
import { withTx } from '../db.js';
import * as events from '../events.js';
import { HttpError, parseObject, parseQuery, readRaw, route, sendJson } from '../http.js';
import * as seed from '../seed.js';
import * as guard from '../testguard.js';
import * as v from '../validate.js';

const NONCE_MSG = 'ต้องยาว 1–64 ตัวอักษร';

async function emit(req, res) {
  guard.require(req);

  let nonce = null;
  const raw = await readRaw(req);
  if (raw.length > 0) {
    const body = parseObject(raw);
    if (Object.hasOwn(body, 'nonce')) {
      nonce = body.nonce; // opaque (R16): not trimmed
      if (typeof nonce !== 'string' || v.len(nonce) < 1 || v.len(nonce) > 64) {
        throw new HttpError(422, 'validation_failed', { fields: { nonce: NONCE_MSG } });
      }
    }
  }
  if (nonce === null) nonce = randomBytes(8).toString('hex');

  // The event is the only write; withTx purges old events after the commit when id % 100 === 0.
  const eventId = await withTx((conn) => events.emit(conn, 'test.ping', { nonce }));
  sendJson(res, 200, { event_id: eventId, nonce });
}

/** Integer query param in [min, max]; absent -> default; anything else -> 400 bad_params. */
function intParam(q, name, def, min, max) {
  if (!(name in q)) return def;
  const val = q[name];
  if (typeof val !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(val) || Number(val) < min || Number(val) > max) {
    throw new HttpError(400, 'bad_params');
  }
  return Number(val);
}

async function seedRun(req, res) {
  guard.require(req);
  const q = parseQuery(req);
  const users = intParam(q, 'users', 20, 1, 100);
  const posts = intParam(q, 'posts', 500, 0, 5000);
  const images = intParam(q, 'images', 30, 0, 200);
  const reset = intParam(q, 'reset', 0, 0, 1);
  if (images > posts) throw new HttpError(400, 'bad_params'); // R17: checked on the effective values
  if (reset === 1) await seed.wipe();
  sendJson(res, 200, await seed.run(users, posts, images));
}

async function seedWipe(req, res) {
  guard.require(req);
  sendJson(res, 200, await seed.wipe());
}

async function orphans(req, res) {
  guard.require(req);
  sendJson(res, 200, await seed.orphans());
}

export function register() {
  route('POST', '/api/test/emit', emit);
  route('POST', '/api/test/seed', seedRun);
  route('DELETE', '/api/test/seed', seedWipe);
  route('GET', '/api/test/orphans', orphans);
}
