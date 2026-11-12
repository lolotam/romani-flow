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

type WorkspaceIdentity = Pick<Identity, 'orgId' | 'orgRole' | 'orgName' | 'email' | 'emailVerified'> & { orgId: string };

function linkedWorkspace(db: Db, orgId: string): WorkspaceLink | null {
  return (db.prepare('SELECT * FROM workspaces WHERE clerk_org_id = ?').get(orgId) as WorkspaceLink | undefined) ?? null;
}

function claimLegacyWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink | null {
  const email = identity.email?.trim().toLowerCase();
  if (!email || !identity.emailVerified || identity.orgRole !== 'org:owner') return null;

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
    return claimed.changes === 1 ? linkedWorkspace(db, identity.orgId) : null;
  });
}

function provisionWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink {
  const name = identity.orgName?.trim().slice(0, 120) || 'Workspace';
  const id = `ws_${randomBytes(18).toString('base64url')}`;
  createWorkspace(db, { id, name, clerkOrgId: identity.orgId });
  return linkedWorkspace(db, identity.orgId)!;
}

/** Maps a verified organization to its workspace, claiming legacy data or provisioning JIT. */
export function resolveWorkspace(db: Db, identity: WorkspaceIdentity): WorkspaceLink {
  const linked = linkedWorkspace(db, identity.orgId);
  if (linked) return linked;
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
