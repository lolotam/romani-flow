import type { Db } from '../db/connection.js';
import { seedStarterCatalog } from '../db/starterCatalog.js';
import { atomic } from '../notifications/whatsapp/repository.js';
import { ensureWorkspaceDefaults } from './settings.js';

/**
 * Workspaces are the isolation boundary between users (spec 2026-11-12).
 *
 * Migration 010 moved every existing row into the legacy workspace, which the
 * Romani account claims after the Clerk switch.
 */
export const LEGACY_WORKSPACE_ID = 'ws_legacy';

export interface Workspace {
  id: string;
  name: string;
}

export function listWorkspaceIds(db: Db): string[] {
  return (db.prepare('SELECT id FROM workspaces WHERE suspended_at IS NULL ORDER BY created_at').all() as Array<{ id: string }>)
    .map((row) => row.id);
}

/**
 * Whether a workspace is suspended.
 *
 * A suspended workspace keeps every row and file, but it sends nothing: no
 * expiry report and no WhatsApp message leave it until an operator lifts the
 * suspension.
 */
export function isWorkspaceSuspended(db: Db, workspaceId: string): boolean {
  const row = db.prepare('SELECT suspended_at FROM workspaces WHERE id = ?').get(workspaceId) as
    | { suspended_at: string | null }
    | undefined;
  return Boolean(row?.suspended_at);
}

/**
 * Points the legacy workspace at the address that may claim it.
 *
 * The address comes from the environment, so it is written once at boot and
 * never logged. A workspace that is already linked to an organization keeps its
 * link: the claim belongs to the owner who already took it.
 */
export function applyLegacyClaimEmail(db: Db, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const now = new Date().toISOString();
  const written = db.prepare(
    `UPDATE workspaces SET legacy_claim_email = ?, updated_at = ?
     WHERE id = ? AND clerk_org_id IS NULL AND legacy_claim_email IS NULL`,
  ).run(normalized, now, LEGACY_WORKSPACE_ID);
  return written.changes === 1;
}

/** Creates a workspace with its default settings and the generic starter catalog, all or nothing. */
export function createWorkspace(db: Db, input: { id: string; name: string; clerkOrgId?: string }): Workspace {
  const now = new Date().toISOString();
  const scope = { workspaceId: input.id };
  atomic(db, () => {
    db.prepare('INSERT INTO workspaces (id, name, clerk_org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.id, input.name, input.clerkOrgId ?? null, now, now);
    ensureWorkspaceDefaults(db, scope);
    seedStarterCatalog(db, scope);
  });
  return { id: input.id, name: input.name };
}
