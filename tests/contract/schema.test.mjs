import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './helpers.mjs';

test('schema has 8 tables utf8mb4 InnoDB', async () => {
  const c = await db();
  try {
    const [rows] = await c.query(
      "SELECT table_name, engine, table_collation FROM information_schema.tables WHERE table_schema = DATABASE()");
    assert.deepEqual(rows.map(r => r.TABLE_NAME ?? r.table_name).sort(),
      ['comments','events','images','likes','posts','rate_limits','streams','users']);
    for (const r of rows) {
      assert.equal(r.ENGINE ?? r.engine, 'InnoDB');
      assert.match(r.TABLE_COLLATION ?? r.table_collation, /^utf8mb4/);
    }
  } finally {
    await c.end();
  }
});
