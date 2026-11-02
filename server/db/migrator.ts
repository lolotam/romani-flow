import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './connection.js';

/**
 * Minimal, ordered SQL migration runner.
 *
 * Migrations live in `server/db/migrations` as `<version>_<name>.sql` files and are
 * applied in filename order. Applied versions are recorded in `schema_migrations`,
 * so running the server repeatedly is safe.
 */

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
}

function listMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) return [];

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((file) => {
      const separator = file.indexOf('_');
      const version = separator === -1 ? file : file.slice(0, separator);
      const name = separator === -1 ? file : file.slice(separator + 1).replace(/\.sql$/, '');
      return {
        version,
        name,
        file,
        sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
      };
    });
}

export function runMigrations(db: Db, migrationsDir: string): MigrationResult {
  db.exec(MIGRATIONS_TABLE);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => String((row as { version: string }).version)),
  );

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of listMigrationFiles(migrationsDir)) {
    if (applied.has(migration.version)) {
      result.skipped.push(migration.file);
      continue;
    }

    // A migration must be atomic: either the whole file applies, or none of it.
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      result.applied.push(migration.file);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration "${migration.file}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
