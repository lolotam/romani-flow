import type { Db } from '../db/connection.js';

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

export function createWorkspace(db: Db, input: { id: string; name: string }): Workspace {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(input.id, input.name, now, now);
  return { id: input.id, name: input.name };
}
