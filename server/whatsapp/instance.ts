import { randomBytes } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';
import { getNumber, setSetting, PLATFORM } from '../repositories/settings.js';

export interface WorkspaceWhatsAppRecord {
  instanceName: string;
  apiKey: string;
  pairingPendingUntil: number;
}

export function getWorkspaceWhatsAppRecord(
  db: Db,
  workspaceId: string,
  defaultInstance: string,
  defaultApiKey = '',
): WorkspaceWhatsAppRecord {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    const row = db
      .prepare('SELECT instance_name, api_key, pairing_pending_until FROM workspace_whatsapp_instances WHERE workspace_id = ?')
      .get(workspaceId) as { instance_name: string; api_key: string; pairing_pending_until: number } | undefined;
    return {
      instanceName: defaultInstance === 'romani-fixture' ? 'romani-fixture' : (row?.instance_name || defaultInstance || 'romani'),
      apiKey: row?.api_key || defaultApiKey,
      pairingPendingUntil: row?.pairing_pending_until ?? 0,
    };
  }

  const row = db
    .prepare('SELECT instance_name, api_key, pairing_pending_until FROM workspace_whatsapp_instances WHERE workspace_id = ?')
    .get(workspaceId) as { instance_name: string; api_key: string; pairing_pending_until: number } | undefined;

  if (row) {
    return {
      instanceName: row.instance_name,
      apiKey: row.api_key || defaultApiKey,
      pairingPendingUntil: row.pairing_pending_until ?? 0,
    };
  }

  const instance = `rf_${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const apiKey = randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO workspace_whatsapp_instances (workspace_id, instance_name, api_key, pairing_pending_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(workspaceId, instance, apiKey, 0, now, now);

  return {
    instanceName: instance,
    apiKey,
    pairingPendingUntil: 0,
  };
}

export function getWorkspaceInstance(db: Db, workspaceId: string, defaultInstance: string, defaultApiKey = ''): string {
  return getWorkspaceWhatsAppRecord(db, workspaceId, defaultInstance, defaultApiKey).instanceName;
}

export function getWorkspaceApiKey(db: Db, workspaceId: string, defaultApiKey = ''): string {
  return getWorkspaceWhatsAppRecord(db, workspaceId, '', defaultApiKey).apiKey;
}

export function getPairingPendingUntil(db: Db, workspaceId: string): number {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    const legacy = getNumber(db, PLATFORM, 'system.whatsapp_pairing_pending_until', 0);
    if (legacy > 0) return legacy;
  }
  const row = db
    .prepare('SELECT pairing_pending_until FROM workspace_whatsapp_instances WHERE workspace_id = ?')
    .get(workspaceId) as { pairing_pending_until: number } | undefined;
  return row?.pairing_pending_until ?? 0;
}

export function setPairingPendingUntil(db: Db, workspaceId: string, until: number): void {
  const now = new Date().toISOString();
  getWorkspaceWhatsAppRecord(db, workspaceId, '');
  db.prepare(
    'UPDATE workspace_whatsapp_instances SET pairing_pending_until = ?, updated_at = ? WHERE workspace_id = ?',
  ).run(until, now, workspaceId);
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    setSetting(db, PLATFORM, 'system.whatsapp_pairing_pending_until', until);
  }
}
