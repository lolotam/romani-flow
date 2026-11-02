import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite connection management.
 *
 * Uses the built-in `node:sqlite` driver (Node 22.5+/24) so the project needs no
 * native compilation step in the Docker image.
 */

export type Db = DatabaseSync;

export function openDatabase(dbPath: string): Db {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true });

  const db = new DatabaseSync(dbPath);

  // WAL keeps readers from blocking the writer; foreign_keys makes the schema
  // actually enforce the relationships it declares.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');

  return db;
}

export function closeDatabase(db: Db): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // A checkpoint failure must never prevent shutdown.
  }
  db.close();
}
