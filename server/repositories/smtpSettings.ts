import type { Db } from '../db/connection.js';

export interface WorkspaceSmtp {
  workspace_id?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  updated_at?: string;
}

export function getWorkspaceSmtp(db: Db, workspaceId: string): WorkspaceSmtp | null {
  const row = db.prepare(
    'SELECT workspace_id, host, port, secure, user, pass, from_address AS "from", updated_at FROM workspace_smtp_settings WHERE workspace_id = ?'
  ).get(workspaceId) as { workspace_id: string; host: string; port: number; secure: number; user: string; pass: string; from: string; updated_at: string } | undefined;

  if (!row) return null;
  return {
    workspace_id: row.workspace_id,
    host: row.host,
    port: row.port,
    secure: Boolean(row.secure),
    user: row.user,
    pass: row.pass,
    from: row.from,
    updated_at: row.updated_at,
  };
}

export function upsertWorkspaceSmtp(db: Db, workspaceId: string, input: Omit<WorkspaceSmtp, 'workspace_id' | 'updated_at'>): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workspace_smtp_settings (workspace_id, host, port, secure, user, pass, from_address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      host = excluded.host,
      port = excluded.port,
      secure = excluded.secure,
      user = excluded.user,
      pass = excluded.pass,
      from_address = excluded.from_address,
      updated_at = excluded.updated_at
  `).run(
    workspaceId,
    input.host.trim(),
    input.port,
    input.secure ? 1 : 0,
    input.user.trim(),
    input.pass,
    input.from.trim(),
    now,
    now,
  );
}

export function deleteWorkspaceSmtp(db: Db, workspaceId: string): void {
  db.prepare('DELETE FROM workspace_smtp_settings WHERE workspace_id = ?').run(workspaceId);
}
