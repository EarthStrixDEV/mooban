import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/** Drop the cached /api/stats payload after a successful write. */
export async function invalidate() {
  try {
    await fs.unlink(path.join(config.CACHE_DIR, 'stats.json'));
  } catch {
    // absent or unwritable: nothing cached to drop
  }
}
