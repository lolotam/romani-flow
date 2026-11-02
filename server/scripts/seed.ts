import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { closeDatabase, openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrator.js';
import { defaultSeedFile, seedDatabase } from '../db/seed.js';

/**
 * Applies migrations and seeds the reference data and admin accounts.
 *
 *   npm run db:seed
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

const config = loadConfig();
const db = openDatabase(config.dbPath);

try {
  runMigrations(db, path.join(projectRoot, 'server', 'db', 'migrations'));

  const result = await seedDatabase(db, {
    seedFile: defaultSeedFile(projectRoot),
    adminEmails: config.adminSeedEmails,
    adminPassword: config.adminSeedPassword,
  });

  for (const [table, count] of Object.entries(result.imported)) {
    if (count > 0) console.log(`Imported ${count} ${table} row(s).`);
  }

  if (result.adminsCreated.length > 0) {
    console.log(`Created admin account(s): ${result.adminsCreated.join(', ')}`);
  }
  if (result.adminSeedSkippedReason) {
    console.log(`No administrator was created: ${result.adminSeedSkippedReason}.`);
  }
  if (result.adminsSkipped.length > 0) {
    console.log(`Admin account(s) already present: ${result.adminsSkipped.join(', ')}`);
  }
} finally {
  closeDatabase(db);
}
