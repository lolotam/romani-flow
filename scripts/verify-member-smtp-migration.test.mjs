import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/db/migrator.ts';
import { createWorkspace } from '../server/repositories/workspaces.ts';

const migrationsDir = path.resolve('server/db/migrations');
const T = '2026-01-01T00:00:00.000Z';

/**
 * Migration 013: the relay of one member and the member that sends the reminders
 * of a workspace.
 *
 * The database is the last line of defence: even a handler that forgets the
 * workspace of the account must not store a relay of another workspace, and the
 * identity of a stored relay must never change under it.
 */

/** A migrated database with two workspaces and one account in each of them. */
function databaseWithTwoWorkspaces() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  runMigrations(db, migrationsDir);
  createWorkspace(db, { id: 'ws_b', name: 'Tenant B' });
  db.prepare("INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_legacy','legacy-admin','legacy@example.invalid','Legacy','admin','x',?,?)").run(T, T);
  db.prepare("INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_b','b-admin','b@example.invalid','Tenant B','admin','x',?,?)").run(T, T);
  return db;
}

/** Stores a relay row directly, so the trigger is tested without the repository. */
function insertRelay(db, workspaceId, accountId) {
  db.prepare(`INSERT INTO member_smtp_settings
    (workspace_id,account_id,host,port,secure,username,password_ciphertext,sender_address,sender_name,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(workspaceId, accountId, 'smtp.example.invalid', 587, 0, 'user', 'cipher', 'member@example.invalid', null, T, T);
}

test('the applied migrations end with the native auth and the member relay migration', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  const result = runMigrations(db, migrationsDir);
  assert.deepEqual(result.applied.slice(-2), ['012_native_auth_multitenant.sql', '013_member_smtp_settings.sql']);

  const columns = db.prepare('PRAGMA table_info(member_smtp_settings)').all().map(column => column.name);
  assert.deepEqual(columns, ['workspace_id', 'account_id', 'host', 'port', 'secure', 'username', 'password_ciphertext',
    'sender_address', 'sender_name', 'last_tested_at', 'last_test_status', 'last_test_error_code', 'created_at', 'updated_at']);
  assert.ok(db.prepare('PRAGMA table_info(workspaces)').all().some(column => column.name === 'notification_sender_account_id'),
    'the workspace names the member that sends its reminders');
  db.close();
});

test('a relay of an account of another workspace is refused', () => {
  const db = databaseWithTwoWorkspaces();
  assert.throws(() => insertRelay(db, 'ws_b', 'legacy-admin'), /member_smtp_account_not_in_workspace/);
  assert.throws(() => insertRelay(db, 'ws_legacy', 'b-admin'), /member_smtp_account_not_in_workspace/);
  assert.equal(db.prepare('SELECT count(*) n FROM member_smtp_settings').get().n, 0, 'no relay of a foreign account is stored');
  db.close();
});

test('the designated sender must be an account of the same workspace', () => {
  const db = databaseWithTwoWorkspaces();
  assert.throws(
    () => db.prepare('UPDATE workspaces SET notification_sender_account_id=? WHERE id=?').run('b-admin', 'ws_legacy'),
    /notification_sender_not_in_workspace/,
  );
  assert.equal(db.prepare('SELECT notification_sender_account_id FROM workspaces WHERE id=?').get('ws_legacy').notification_sender_account_id, null);

  db.prepare('UPDATE workspaces SET notification_sender_account_id=? WHERE id=?').run('legacy-admin', 'ws_legacy');
  assert.equal(db.prepare('SELECT notification_sender_account_id FROM workspaces WHERE id=?').get('ws_legacy').notification_sender_account_id, 'legacy-admin');
  db.close();
});

test('the identity of a member relay is immutable', () => {
  const db = databaseWithTwoWorkspaces();
  insertRelay(db, 'ws_legacy', 'legacy-admin');
  assert.throws(
    () => db.prepare('UPDATE member_smtp_settings SET account_id=? WHERE workspace_id=? AND account_id=?').run('b-admin', 'ws_legacy', 'legacy-admin'),
    /immutable_member_smtp_identity/,
  );
  assert.throws(
    () => db.prepare('UPDATE member_smtp_settings SET workspace_id=? WHERE workspace_id=? AND account_id=?').run('ws_b', 'ws_legacy', 'legacy-admin'),
    /immutable_member_smtp_identity/,
  );
  assert.equal(db.prepare('SELECT account_id FROM member_smtp_settings').get().account_id, 'legacy-admin');
  db.close();
});

test('running the migrator again is a no-op', () => {
  const db = databaseWithTwoWorkspaces();
  const second = runMigrations(db, migrationsDir);
  assert.deepEqual(second.applied, [], 'no migration is applied twice');
  assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n >= 13, true);
  db.close();
});

test('deleting the account removes its relay and clears the designated sender', () => {
  const db = databaseWithTwoWorkspaces();
  insertRelay(db, 'ws_legacy', 'legacy-admin');
  db.prepare('UPDATE workspaces SET notification_sender_account_id=? WHERE id=?').run('legacy-admin', 'ws_legacy');

  db.prepare('DELETE FROM admin_users WHERE id=?').run('legacy-admin');

  assert.equal(db.prepare('SELECT count(*) n FROM member_smtp_settings').get().n, 0, 'the relay of a deleted account is gone');
  assert.equal(db.prepare('SELECT notification_sender_account_id FROM workspaces WHERE id=?').get('ws_legacy').notification_sender_account_id, null,
    'a deleted account cannot stay the designated sender');
  db.close();
});
