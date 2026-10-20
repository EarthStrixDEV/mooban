import { config } from '../config.js';
import { pool } from '../db.js';
import { parseQuery, route, sendJson } from '../http.js';

export function register() {
  route('GET', '/api/ping', async (req, res) => {
    const body = { pong: true, stack: config.APP_STACK, unix_ms: Date.now() };
    if (parseQuery(req).db === '1') {
      const t = process.hrtime.bigint();
      await pool.query('SELECT 1');
      body.db_ms = Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;
    }
    sendJson(res, 200, body);
  });
}
