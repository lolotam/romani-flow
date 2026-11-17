import type { Db } from '../db/connection.js';
import type { Scope } from './base.js';
import { RepositoryError } from './base.js';
import { atomic } from '../notifications/whatsapp/repository.js';
import { LEGACY_WORKSPACE_ID } from './workspaces.js';

export interface MemberSmtpInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  senderAddress: string;
  senderName: string | null;
}
export interface MemberSmtpRecord extends MemberSmtpInput {
  workspaceId: string;
  accountId: string;
  passwordCiphertext: string;
  lastTestedAt: string | null;
  lastTestStatus: 'succeeded' | 'failed' | null;
  lastTestErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PublicMemberSmtp {
  configured: boolean;
  hasPassword: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  username: string | null;
  senderAddress: string | null;
  senderName: string | null;
  lastTestedAt: string | null;
  lastTestStatus: 'succeeded' | 'failed' | null;
  lastTestErrorCode: string | null;
}
export interface EligibleMember {
  accountId: string;
  displayName: string;
  email: string;
  hasCompleteSmtp: boolean;
}

/** The account that acts for a request, or null when the request has no account. */
export function scopeAccountId(scope: Scope): string | null {
  return scope.accountId ?? null;
}

function mapRow(row: Record<string, unknown> | undefined): MemberSmtpRecord | null {
  if (!row) return null;
  return {
    workspaceId: String(row.workspace_id), accountId: String(row.account_id), host: String(row.host),
    port: Number(row.port), secure: row.secure === 1, username: String(row.username),
    passwordCiphertext: String(row.password_ciphertext), senderAddress: String(row.sender_address),
    senderName: row.sender_name === null ? null : String(row.sender_name),
    lastTestedAt: row.last_tested_at === null ? null : String(row.last_tested_at),
    lastTestStatus: row.last_test_status === null ? null : row.last_test_status as 'succeeded' | 'failed',
    lastTestErrorCode: row.last_test_error_code === null ? null : String(row.last_test_error_code),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function getMemberSmtp(db: Db, scope: Scope): MemberSmtpRecord | null {
  const accountId = scopeAccountId(scope);
  if (!accountId) return null;
  return mapRow(db.prepare('SELECT * FROM member_smtp_settings WHERE workspace_id=? AND account_id=?')
    .get(scope.workspaceId, accountId) as Record<string, unknown> | undefined);
}

export function publicMemberSmtp(db: Db, scope: Scope): PublicMemberSmtp {
  const row = getMemberSmtp(db, scope);
  if (!row) return {
    configured: false, hasPassword: false, host: null, port: null, secure: null,
    username: null, senderAddress: null, senderName: null,
    lastTestedAt: null, lastTestStatus: null, lastTestErrorCode: null,
  };
  return {
    configured: true, hasPassword: row.passwordCiphertext.length > 0,
    host: row.host, port: row.port, secure: row.secure, username: row.username,
    senderAddress: row.senderAddress, senderName: row.senderName,
    lastTestedAt: row.lastTestedAt, lastTestStatus: row.lastTestStatus,
    lastTestErrorCode: row.lastTestErrorCode,
  };
}

export function saveMemberSmtp(db: Db, scope: Scope, input: MemberSmtpInput, newCiphertext: string | null): void {
  const accountId = scopeAccountId(scope);
  if (!accountId) {
    throw new RepositoryError('This account has no local identity yet.', 'identity_not_provisioned', 409);
  }
  const existing = getMemberSmtp(db, scope);
  const passwordCiphertext = newCiphertext || existing?.passwordCiphertext || '';
  if (!passwordCiphertext) throw new RepositoryError('An SMTP password is required before saving.', 'password_required', 400);
  // The row is bound to an account of the workspace. An account that does not
  // exist cannot own a configuration, and the foreign key would fail the insert
  // with an opaque driver error instead of a safe answer.
  if (!db.prepare('SELECT id FROM admin_users WHERE id=? AND workspace_id=?').get(accountId, scope.workspaceId)) {
    throw new RepositoryError('This account has no local identity yet.', 'identity_not_provisioned', 409);
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO member_smtp_settings
    (workspace_id,account_id,host,port,secure,username,password_ciphertext,sender_address,sender_name,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(workspace_id,account_id) DO UPDATE SET
      host=excluded.host,port=excluded.port,secure=excluded.secure,username=excluded.username,
      password_ciphertext=excluded.password_ciphertext,sender_address=excluded.sender_address,
      sender_name=excluded.sender_name,last_tested_at=NULL,last_test_status=NULL,
      last_test_error_code=NULL,updated_at=excluded.updated_at`)
    .run(scope.workspaceId, accountId, input.host, input.port, input.secure ? 1 : 0,
      input.username, passwordCiphertext, input.senderAddress, input.senderName, now, now);
}

export function recordMemberSmtpTest(db: Db, scope: Scope, status: 'succeeded' | 'failed', errorCode: string | null): void {
  const accountId = scopeAccountId(scope);
  if (!accountId) return;
  const now = new Date().toISOString();
  db.prepare(`UPDATE member_smtp_settings SET last_tested_at=?,last_test_status=?,last_test_error_code=?,updated_at=?
    WHERE workspace_id=? AND account_id=?`)
    .run(now, status, errorCode, now, scope.workspaceId, accountId);
}

export function deleteMemberSmtp(db: Db, scope: Scope): boolean {
  const accountId = scopeAccountId(scope);
  if (!accountId) return false;
  return atomic(db, () => {
    db.prepare('UPDATE workspaces SET notification_sender_account_id=NULL WHERE id=? AND notification_sender_account_id=?')
      .run(scope.workspaceId, accountId);
    return db.prepare('DELETE FROM member_smtp_settings WHERE workspace_id=? AND account_id=?')
      .run(scope.workspaceId, accountId).changes > 0;
  });
}

export function notificationSenderAccountId(db: Db, workspaceId: string): string | null {
  const row = db.prepare('SELECT notification_sender_account_id FROM workspaces WHERE id=?').get(workspaceId) as
    | { notification_sender_account_id: string | null } | undefined;
  return row?.notification_sender_account_id ?? null;
}

export function setNotificationSender(db: Db, workspaceId: string, accountId: string | null): void {
  atomic(db, () => {
    db.prepare('UPDATE workspaces SET notification_sender_account_id=?,updated_at=? WHERE id=?')
      .run(accountId, new Date().toISOString(), workspaceId);
    // The platform relay of the environment is retired only when the workspace
    // has a relay of its own. Naming a sender that has no relay of its own
    // would otherwise leave the workspace without any way to send.
    if (workspaceId === LEGACY_WORKSPACE_ID && accountId && memberHasCompleteSmtp(db, workspaceId, accountId)) {
      db.prepare(`INSERT INTO workspace_settings(workspace_id,key,value,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(workspaceId, 'email.legacy_environment_smtp_retired', 'true', new Date().toISOString());
    }
  });
}

export function legacyEnvironmentSmtpRetired(db: Db, workspaceId: string): boolean {
  const row = db.prepare("SELECT value FROM workspace_settings WHERE workspace_id=? AND key='email.legacy_environment_smtp_retired'")
    .get(workspaceId) as { value: unknown } | undefined;
  return row?.value === true || row?.value === 'true';
}

/** The accounts of the workspace that may own a relay or send its reminders. */
export function listEligibleMembers(db: Db, workspaceId: string): EligibleMember[] {
  return (db.prepare(`SELECT a.id,a.name,a.email,
      EXISTS(SELECT 1 FROM member_smtp_settings s
        WHERE s.workspace_id=? AND s.account_id=a.id AND s.password_ciphertext!='') AS complete
    FROM admin_users a WHERE a.workspace_id=? AND a.is_active=1
    ORDER BY a.name,a.id`).all(workspaceId, workspaceId) as Array<Record<string, unknown>>)
    .map(row => ({
      accountId: String(row.id), displayName: String(row.name ?? row.email ?? row.id),
      email: String(row.email ?? ''), hasCompleteSmtp: row.complete === 1,
    }));
}

export function memberHasCompleteSmtp(db: Db, workspaceId: string, accountId: string): boolean {
  return db.prepare("SELECT 1 FROM member_smtp_settings WHERE workspace_id=? AND account_id=? AND password_ciphertext!=''")
    .get(workspaceId, accountId) !== undefined;
}
