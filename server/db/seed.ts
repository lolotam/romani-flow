import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.js';
import { createAdmin, findAdminByEmail } from '../repositories/adminUsers.js';
import { ensureSetting, getSetting, setSetting, SETTING_DEFINITIONS } from '../repositories/settings.js';

/**
 * First-boot seed.
 *
 * The import is guarded by a permanent `system.seed_version` marker rather than
 * by row counts: deleting every row must never bring the old data back, and a
 * partially populated database must never be silently merged with the seed.
 *
 * The marker is also written when a database is found that already has data.
 * Without it, erasing that data would let the next boot import the seed and
 * resurrect what the administrator deliberately removed.
 *
 * Admin accounts are handled separately and are never overwritten.
 */

const TABLES = ['companies', 'ministries', 'document_types', 'positions', 'employees', 'documents'];

export const SEED_VERSION = '1';
const SEED_MARKER_KEY = 'system.seed_version';

export interface SeedOptions {
  seedFile: string;
  adminEmails: string[];
  /** Null when ADMIN_SEED_PASSWORD is not set: no account is created then. */
  adminPassword: string | null;
}

export interface SeedResult {
  imported: Record<string, number>;
  adminsCreated: string[];
  adminsSkipped: string[];
  seedApplied: boolean;
  seedSkippedReason?: string;
  adminSeedSkippedReason?: string;
}

function countRows(db: Db, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as { total: number };
  return row.total;
}

/** The display name is derived from the local part of the email address. */
function displayNameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? email).replace(/\d+$/, '');
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Inserts a row while preserving its historical identity.
 *
 * The generic CRUD path always stamps `created_at` and `updated_at` with the
 * current time, which would rewrite the history of the imported records. Rows
 * that carry their own timestamps keep them; rows that were exported without
 * them get the import time, because the schema requires the column.
 */
function insertPreservingHistory(
  db: Db,
  table: string,
  row: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const columns = Object.keys(row).filter((key) => key !== 'metadata');
  if (columns.length === 0) return;

  // The exported catalogue rows are not required to carry the audit columns.
  const created = (row.created_at ?? row.updated_at ?? fallbackTimestamp) as string;
  const updated = (row.updated_at ?? created) as string;

  const values = new Map<string, string | number | null>();
  for (const column of columns) {
    const value = row[column];
    if (value === null || value === undefined) {
      values.set(column, null);
    } else if (typeof value === 'boolean') {
      values.set(column, value ? 1 : 0);
    } else if (typeof value === 'object') {
      values.set(column, JSON.stringify(value));
    } else {
      values.set(column, value as string | number);
    }
  }
  values.set('created_at', created);
  values.set('updated_at', updated);

  db.prepare(
    `INSERT INTO "${table}" (${[...values.keys()].map((column) => `"${column}"`).join(', ')}) VALUES (${[...values.keys()].map(() => '?').join(', ')})`,
  ).run(...values.values());
}

/**
 * Prepares an exported row for the new schema.
 *
 * The exported documents point at files that lived in the dead Supabase
 * storage. The bucket starts empty, so the path is cleared while the original
 * file name is kept — the administrator still sees which file the record was
 * created from, and no download can point at a file that does not exist.
 */
function prepareRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  if (table !== 'documents') return row;

  const { file_path: _filePath, ...rest } = row;
  return { ...rest, file_path: null };
}

export async function seedDatabase(db: Db, options: SeedOptions): Promise<SeedResult> {
  const result: SeedResult = {
    imported: {},
    adminsCreated: [],
    adminsSkipped: [],
    seedApplied: false,
  };

  for (const table of TABLES) result.imported[table] = 0;

  const marker = getSetting(db, SEED_MARKER_KEY);

  if (marker === SEED_VERSION) {
    result.seedSkippedReason = 'already imported';
  } else if (TABLES.some((table) => countRows(db, table) > 0)) {
    // The database already holds data that was never seeded. Record that
    // decision so the seed can never run against it later — not even after the
    // administrator erases the data.
    setSetting(db, SEED_MARKER_KEY, SEED_VERSION);
    result.seedSkippedReason =
      'the database already contained data — the seed was disabled for this database';
    console.warn(`[seed] ${result.seedSkippedReason}.`);
  } else if (!fs.existsSync(options.seedFile)) {
    result.seedSkippedReason = `seed file not found at ${options.seedFile}`;
    console.warn(`[seed] ${result.seedSkippedReason} — starting with an empty database.`);
  } else {
    const payload = JSON.parse(fs.readFileSync(options.seedFile, 'utf8')) as Record<
      string,
      Record<string, unknown>[]
    >;

    db.exec('BEGIN');
    try {
      const importTime = new Date().toISOString();

      for (const table of TABLES) {
        const rows = payload[table];
        if (!Array.isArray(rows)) continue;

        for (const row of rows) {
          // A single bad row aborts the whole import. Swallowing it would
          // commit an incomplete dataset behind a "seeded" marker.
          insertPreservingHistory(db, table, prepareRow(table, row), importTime);
          result.imported[table] += 1;
        }
      }

      // The marker is written inside the same transaction as the data, so the
      // two can never disagree.
      setSetting(db, SEED_MARKER_KEY, SEED_VERSION);
      db.exec('COMMIT');
      result.seedApplied = true;
    } catch (error) {
      db.exec('ROLLBACK');
      result.seedSkippedReason = 'the import failed and was rolled back';
      console.error('[seed] the import was rolled back:', error);
      throw error;
    }
  }

  // Settings defaults.
  for (const definition of SETTING_DEFINITIONS) {
    ensureSetting(db, definition.key);
  }

  // Admin accounts — never overwritten once they exist. The password comes only
  // from the environment; without it (or without any e-mail) nothing is created.
  const adminPassword = options.adminPassword;
  if (options.adminEmails.length === 0 || !adminPassword) {
    result.adminSeedSkippedReason =
      'ADMIN_SEED_EMAILS and ADMIN_SEED_PASSWORD are not both set; no administrator was created';
    return result;
  }

  for (const email of options.adminEmails) {
    if (findAdminByEmail(db, email)) {
      result.adminsSkipped.push(email);
      continue;
    }

    await createAdmin(db, {
      email,
      name: displayNameFromEmail(email),
      password: adminPassword,
      role: 'admin',
    });
    result.adminsCreated.push(email);
  }

  return result;
}

/** Default location of the seed file, relative to the project root. */
export function defaultSeedFile(projectRoot: string): string {
  return path.join(projectRoot, 'data', 'seed.json');
}
