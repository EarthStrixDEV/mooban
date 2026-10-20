import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASS,
  database: config.DB_NAME,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  connectionLimit: 5,
  waitForConnections: true,
});

// Every new connection runs in UTC. Commands on a connection are queued in order,
// so this always runs before the first query handed out on it.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) conn.destroy();
  });
});

/**
 * Run fn(conn) inside one transaction on a dedicated connection.
 * Throwing rolls back. Never call pool.* inside fn (pool size is 5; use conn).
 * If an event with id % 100 === 0 was emitted, old events are purged after COMMIT.
 */
export async function withTx(fn) {
  const conn = await pool.getConnection();
  conn.mbCleanup = false;
  let broken = false;
  try {
    await conn.beginTransaction();
    let result;
    try {
      result = await fn(conn);
      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        broken = true;
      }
      throw e;
    }
    if (conn.mbCleanup) {
      try {
        await conn.execute('DELETE FROM events WHERE created_at < NOW(3) - INTERVAL 1 HOUR');
      } catch (e) {
        console.error('mooban: event cleanup failed:', e.code ?? e.name);
      }
    }
    return result;
  } finally {
    conn.mbCleanup = false;
    if (broken) conn.destroy();
    else conn.release();
  }
}
