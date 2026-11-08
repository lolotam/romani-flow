import { createHash } from 'node:crypto';
import type { Db } from '../db/connection.js';
import type { CatalogEntry, Catalogs } from '../contracts/documentExtraction.js';

/**
 * The server catalogs of the extraction pipeline.
 *
 * The document types and the ministries are the only vocabulary a provider
 * label may be matched against. They are read from the server, never from the
 * request, and their version is a hash of their normalized content so a
 * change of the catalogs invalidates every request that was built against the
 * previous version.
 */

/** Reads the catalog rows in a deterministic order. */
function readEntries(db: Db, table: 'document_types' | 'ministries'): CatalogEntry[] {
  const rows = db
    .prepare(`SELECT id, name, name_ar FROM ${table} ORDER BY id ASC`)
    .all() as unknown as CatalogEntry[];
  return rows.map(row => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    name_ar: String(row.name_ar ?? ''),
  }));
}

/** Normalizes the catalog content so the hash only changes with meaning. */
function normalize(entries: CatalogEntry[]): unknown {
  return entries.map(entry => ({
    id: entry.id,
    name: entry.name.normalize('NFC').trim(),
    name_ar: entry.name_ar.normalize('NFC').trim(),
  }));
}

/**
 * Reads the current catalogs and their version.
 *
 * The version is the SHA-256 of the normalized catalog content. It changes
 * whenever a type or a ministry is added, renamed or removed, and it never
 * changes for a request that repeats the same catalogs.
 */
export function readCatalogs(db: Db): Catalogs {
  const types = readEntries(db, 'document_types');
  const ministries = readEntries(db, 'ministries');
  const version = createHash('sha256')
    .update(JSON.stringify({ types: normalize(types), ministries: normalize(ministries) }))
    .digest('hex');
  return { types, ministries, version };
}
