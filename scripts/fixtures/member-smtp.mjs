import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { runMigrations } from '../../server/db/migrator.ts';
import { createWorkspace } from '../../server/repositories/workspaces.ts';

export const LEGACY = { workspaceId: 'ws_legacy' };
export const B = { workspaceId: 'ws_b' };
/** The account that owns a relay in the legacy workspace. */
export const MEMBER = 'member-admin';
/** Another account of the same workspace, without a relay of its own. */
export const OTHER = 'other-admin';
/** The account of the second workspace. */
export const TENANT_B = 'admin-b';
/** A key the credential encryption accepts: 32 bytes in base64url. */
export const APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');
const T = '2026-01-01T00:00:00.000Z';

/**
 * A migrated database with two accounts of the legacy workspace and one account
 * of a second workspace.
 *
 * The accounts are plain rows: the relay tests never sign in, they ask the
 * repository for the configuration of an account.
 */
export function memberSmtpDatabase(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON;');
  runMigrations(db, path.resolve('server/db/migrations'));
  createWorkspace(db, { id: B.workspaceId, name: 'Tenant B' });
  for (const [workspaceId, id, email] of [
    [LEGACY.workspaceId, MEMBER, 'member@example.invalid'],
    [LEGACY.workspaceId, OTHER, 'other@example.invalid'],
    [B.workspaceId, TENANT_B, 'admin-b@example.invalid'],
  ]) {
    db.prepare(`INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(workspaceId, id, email, email, 'admin', 'not-a-login-fixture', T, T);
  }
  return { db, close: () => db.close() };
}
