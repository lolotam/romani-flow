import type { Db } from '../db/connection.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';

export function getWorkspaceInstance(db: Db, workspaceId: string, defaultInstance: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) return defaultInstance || 'romani';
  const row = db.prepare('SELECT instance_name FROM workspace_whatsapp_instances WHERE workspace_id = ?').get(workspaceId) as { instance_name: string } | undefined;
  if (row) return row.instance_name;
  const instance = `rf_${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO workspace_whatsapp_instances (workspace_id, instance_name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(workspaceId, instance, now, now);
  return instance;
}
