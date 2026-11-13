import { randomBytes } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { atomic } from '../notifications/whatsapp/repository.js';
import { createWorkspace } from '../repositories/workspaces.js';
import type { Identity } from './types.js';

export interface WorkspaceLink {
  id: string;
  name: string;
  clerk_org_id: string | null;
  legacy_claim_email: string | null;
  suspended_at: string | null;
}

type WorkspaceIdentity = Pick<Identity, 'userId' | 'orgId' | 'orgRole' | 'orgName' | 'email' | 'emailVerified' | 'profileFresh'> & { orgId: string };

function isWorkspaceOwner(identity: WorkspaceIdentity): boolean {
  return identity.orgRole === 'org:owner' || identity.orgRole === 'owner';
}

function linkedWorkspace(db: Db, orgId: string): WorkspaceLink | null {
  return (db.prepare('SELECT * FROM workspaces WHERE clerk_org_id = ?').get(orgId) as WorkspaceLink | undefined) ?? null;
}

/**
 * Hands the unsaved work of the legacy administrator to the claiming account.
 *
 * The drafts and the remembered form defaults belong to the account that wrote
 * them. The legacy administrator and the claiming Clerk user are the same
 * person, so the rows move to the local user id of the claim. Both tables are
 * keyed by workspace, user and context, so a row that already exists for the
 * new account is a conflict: the newer row wins and the older one is dropped.
 */
function handOverOwnership(db: Db, workspaceId: string, fromUserId: string, toUserId: string): void {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;
  for (const [table, context] of [['document_drafts', 'scope'], ['form_defaults', 'form_key']] as const) {
    const rows = db.prepare(
      `SELECT "${context}" AS context, updated_at FROM "${table}" WHERE workspace_id = ? AND user_id = ?`,
    ).all(workspaceId, fromUserId) as Array<{ context: string; updated_at: string }>;
    for (const row of rows) {
      const existing = db.prepare(
        `SELECT updated_at FROM "${table}" WHERE workspace_id = ? AND user_id = ? AND "${context}" = ?`,
      ).get(workspaceId, toUserId, row.context) as { updated_at: string } | undefined;
      if (!existing) {
        db.prepare(
          `UPDATE "${table}" SET user_id = ? WHERE workspace_id = ? AND user_id = ? AND "${context}" = ?`,
        ).run(toUserId, workspaceId, fromUserId, row.context);
        continue;
      }
      // The newer row is kept; the older one is the one that is dropped.
      if (existing.updated_at >= row.updated_at) {
        db.prepare(`DELETE FROM "${table}" WHERE workspace_id = ? AND user_id = ? AND "${context}" = ?`)
          .run(workspaceId, fromUserId, row.context);
        continue;
      }
      db.prepare(`DELETE FROM "${table}" WHERE workspace_id = ? AND user_id = ? AND "${context}" = ?`)
        .run(workspaceId, toUserId, row.context);
      db.prepare(`UPDATE "${table}" SET user_id = ? WHERE workspace_id = ? AND user_id = ? AND "${context}" = ?`)
        .run(toUserId, workspaceId, fromUserId, row.context);
    }
  }
}

function claimLegacyWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink | null {
  // A stale email must not be trusted to take ownership of the legacy workspace.
  if (identity.profileFresh === false) return null;
  const email = identity.email?.trim().toLowerCase();
  if (!email || !identity.emailVerified || !isWorkspaceOwner(identity)) return null;

  return atomic(db, () => {
    const candidate = db.prepare(`
      SELECT * FROM workspaces
      WHERE clerk_org_id IS NULL AND lower(trim(legacy_claim_email)) = ?
      ORDER BY created_at LIMIT 1
    `).get(email) as WorkspaceLink | undefined;
    if (!candidate) return null;
    const now = new Date().toISOString();
    const claimed = db.prepare(`
      UPDATE workspaces SET clerk_org_id = ?, legacy_claim_email = NULL, updated_at = ?
      WHERE id = ? AND clerk_org_id IS NULL
    `).run(identity.orgId, now, candidate.id);
    if (claimed.changes !== 1) return null;

    // The unsaved work of the legacy administrator moves to the claiming account.
    const legacyAccount = db.prepare(
      'SELECT id FROM admin_users WHERE workspace_id = ? AND lower(trim(email)) = ?',
    ).get(candidate.id, email) as { id: string } | undefined;
    const localUser = db.prepare('SELECT id FROM users WHERE clerk_user_id = ?').get(identity.userId) as
      | { id: string }
      | undefined;
    if (legacyAccount && localUser) handOverOwnership(db, candidate.id, legacyAccount.id, localUser.id);

    return linkedWorkspace(db, identity.orgId);
  });
}

function provisionWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink {
  const name = identity.orgName?.trim().slice(0, 120) || 'Workspace';
  const id = `ws_${randomBytes(18).toString('base64url')}`;
  createWorkspace(db, { id, name, clerkOrgId: identity.orgId });
  return linkedWorkspace(db, identity.orgId)!;
}

/** Maps a verified organization to its workspace, claiming legacy data or provisioning JIT. */
export function resolveWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink | null {
  const linked = linkedWorkspace(db, identity.orgId);
  if (linked) return linked;
  // Stale profile: do not claim and do not provision. The caller asks the user to retry.
  if (identity.profileFresh === false) return null;
  if (!isWorkspaceOwner(identity)) return null;
  try {
    return claimLegacyWorkspace(db, identity) ?? provisionWorkspace(db, identity);
  } catch (error) {
    // The unique organization link means a concurrent first request already
    // claimed or provisioned this organization; use the row it wrote.
    const raced = linkedWorkspace(db, identity.orgId);
    if (raced) return raced;
    throw error;
  }
}

/** Organization webhooks only rename an existing link; sign-in owns claiming and provisioning. */
export function syncOrganization(db: Db, input: { id: string; name?: string }): void {
  const existing = linkedWorkspace(db, input.id);
  if (!existing) return;
  const name = input.name?.trim().slice(0, 120) || existing.name;
  db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), existing.id);
}

/** Suspension preserves every tenant row and file for a later operator decision. */
export function suspendOrganization(db: Db, orgId: string): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE workspaces SET suspended_at = ?, updated_at = ? WHERE clerk_org_id = ?').run(now, now, orgId);
}
