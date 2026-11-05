import type { Db } from '../db/connection.js';
import { insertRow, RepositoryError, type Row } from '../repositories/base.js';

/** Resolve a custom ministry inside the caller's document transaction. */
export function resolveDocumentEntity(db: Db, fields: Row): void {
  const name = typeof fields.entity_name === 'string' ? fields.entity_name.trim() : '';
  delete fields.entity_name;
  if (fields.ministry_id !== 'other') return;
  if (!name || name.length > 100) throw new RepositoryError('Invalid custom entity name.', 'invalid_entity', 400);
  // Create or find custom ministry for "Other"
  const existing = db.prepare('SELECT id FROM ministries WHERE name_ar=?').get(name);
  // Always reference the id returned by the server.
  fields.ministry_id = existing?.id ?? insertRow(db, 'ministries', { name, name_ar: name }).id;
}
