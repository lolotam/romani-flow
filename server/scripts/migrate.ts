import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { closeDatabase, openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrator.js';

/**
 * Applies pending migrations without starting the server.
 *
 *   npm run db:migrate
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const config = loadConfig();
const db = openDatabase(config.dbPath);

try {
  const result = runMigrations(db, path.join(projectRoot, 'server', 'db', 'migrations'));

  if (result.applied.length > 0) {
    console.log(`Applied ${result.applied.length} migration(s):`);
    for (const file of result.applied) console.log(`  + ${file}`);
  } else {
    console.log('The database schema is already up to date.');
  }

  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} already-applied migration(s).`);
  }
} finally {
  closeDatabase(db);
}
