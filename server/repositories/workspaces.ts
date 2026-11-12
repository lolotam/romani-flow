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
