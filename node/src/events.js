import { encode } from './json.js';

/**
 * Insert an event on the transaction's connection. Call it as the LAST statement
 * before COMMIT. Every 100th event id marks the connection so withTx purges old
 * events after the commit.
 */
export async function emit(conn, type, data) {
  const [res] = await conn.execute('INSERT INTO events (type, payload) VALUES (?, ?)', [type, encode(data)]);
  const id = Number(res.insertId);
  if (id % 100 === 0) conn.mbCleanup = true;
  return id;
}
