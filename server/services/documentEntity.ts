import type { Db } from '../db/connection.js';
import { insertRow, RepositoryError, type Row, type Scope } from '../repositories/base.js';

/** Resolve a custom ministry inside the caller's document transaction. */
export function resolveDocumentEntity(db: Db, scope: Scope, fields: Row): void {
  const name = typeof fields.entity_name === 'string' ? fields.entity_name.trim() : '';
  delete fields.entity_name;
  if (fields.ministry_id !== 'other') return;
  if (!name || name.length > 100) throw new RepositoryError('Invalid custom entity name.', 'invalid_entity', 400);
  // Reuse a custom ministry of this workspace only; another workspace's list is invisible.
  const existing = db.prepare('SELECT id FROM ministries WHERE name_ar=? AND workspace_id=?').get(name, scope.workspaceId);
  // Always reference the id returned by the server.
  fields.ministry_id = existing?.id ?? insertRow(db, scope, 'ministries', { name, name_ar: name }).id;
}
