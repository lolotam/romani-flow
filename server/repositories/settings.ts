import type { Db } from '../db/connection.js';
import { createId, type Scope } from './base.js';

/**
 * Key/value application settings.
 *
 * Values are stored as JSON so booleans, numbers and string arrays survive a
 * round trip. Secrets are never stored here — SMTP credentials live in the
 * environment only.
 *
 * A setting is either a *tenant* setting, stored per workspace in
 * `workspace_settings`, or a *platform* setting, stored once in `settings`.
 * A tenant setting can only be read or written for a workspace scope; a
 * platform setting can be read by anyone but only written with `PLATFORM`.
 */

export type SettingValue = string | number | boolean | string[] | null;

/** The scope of a platform setting write: the scheduler, the seed, the erase locks. */
export const PLATFORM = Object.freeze({ platform: true as const });
export type SettingScope = Scope | typeof PLATFORM;

export interface SettingDefinition {
  key: string;
  type: 'boolean' | 'number' | 'string' | 'string[]';
  defaultValue: SettingValue;
  /** Settings that must never be written through the public API. */
  secret?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  { key: 'whatsapp.enabled', type: 'boolean', defaultValue: false },
  { key: 'whatsapp.language', type: 'string', defaultValue: 'ar' },
  { key: 'email.enabled', type: 'boolean', defaultValue: true },
  { key: 'email.recipients', type: 'string[]', defaultValue: [] },
  { key: 'email.cc', type: 'string[]', defaultValue: [] },
  { key: 'email.from_name', type: 'string', defaultValue: 'ROMANI Flow' },
  { key: 'email.language', type: 'string', defaultValue: 'ar' },
  { key: 'email.notification_intervals', type: 'string[]', defaultValue: ['90', '30', '15', '7', '1'] },
  { key: 'email.last_sent_at', type: 'string', defaultValue: '' },
  { key: 'email.last_result', type: 'string', defaultValue: '' },
  { key: 'expiry_warning_days', type: 'number', defaultValue: 30 },
  { key: 'cron.enabled', type: 'boolean', defaultValue: true },
  { key: 'cron.schedule', type: 'string', defaultValue: '0 8 * * *' },
  { key: 'cron.days', type: 'number', defaultValue: 30 },
  { key: 'cron.include_employees', type: 'boolean', defaultValue: true },
  { key: 'cron.include_documents', type: 'boolean', defaultValue: true },
  { key: 'cron.last_run_at', type: 'string', defaultValue: '' },
  { key: 'cron.last_run_result', type: 'string', defaultValue: '' },
  { key: 'cron.last_run_date', type: 'string', defaultValue: '' },
  { key: 'reminders.dismissed', type: 'string[]', defaultValue: [] },
  { key: 'reminders.pinned', type: 'string[]', defaultValue: [] },
  { key: 'ai_extraction.enabled', type: 'boolean', defaultValue: false },
  { key: 'ai_extraction.provider', type: 'string', defaultValue: '' },
  { key: 'ai_extraction.model', type: 'string', defaultValue: '' },
];

/**
 * Settings that belong to one workspace. This list must equal the keys that
 * migration 010 moved into `workspace_settings`; a test compares the two.
 */
export const TENANT_SETTING_KEYS: ReadonlySet<string> = new Set([
  'email.enabled', 'email.recipients', 'email.cc', 'email.from_name', 'email.language',
  'email.notification_intervals', 'email.last_sent_at', 'email.last_result',
  'expiry_warning_days', 'cron.enabled', 'cron.days', 'cron.include_employees',
  'cron.include_documents', 'cron.last_run_at', 'cron.last_run_result', 'cron.last_run_date',
  'reminders.dismissed', 'reminders.pinned',
  'ai_extraction.enabled', 'ai_extraction.provider', 'ai_extraction.model',
  'whatsapp.enabled', 'whatsapp.language', 'whatsapp.last_enqueue_date',
  'document_drafts.epoch',
]);

export function isTenantSetting(key: string): boolean {
  return TENANT_SETTING_KEYS.has(key);
}

function isWorkspace(scope: SettingScope): scope is Scope {
  return 'workspaceId' in scope;
}

/** A programming error, not a user error: the caller used the wrong scope for the key. */
function requireWorkspace(scope: SettingScope, key: string): Scope {
  if (!isWorkspace(scope)) throw new Error(`tenant_setting_requires_workspace: ${key}`);
  return scope;
}

const SECRET_PREFIXES = ['smtp.', 'secret.', 'password', 'jwt'];

export function isSecretSetting(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readStored(db: Db, scope: SettingScope, key: string): string | undefined {
  if (isTenantSetting(key)) {
    const row = db
      .prepare('SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?')
      .get(requireWorkspace(scope, key).workspaceId, key) as { value: string | null } | undefined;
    return row?.value ?? undefined;
  }
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function getSetting(db: Db, scope: SettingScope, key: string): SettingValue {
  const raw = readStored(db, scope, key);
  if (raw !== undefined) {
    const parsed = parseStored(raw);
    if (parsed !== null && parsed !== undefined) return parsed as SettingValue;
  }

  const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
  return definition ? definition.defaultValue : null;
}

export function getBoolean(db: Db, scope: SettingScope, key: string): boolean {
  const value = getSetting(db, scope, key);
  return value === true || value === 'true';
}

export function getNumber(db: Db, scope: SettingScope, key: string, fallback: number): number {
  const value = getSetting(db, scope, key);
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getString(db: Db, scope: SettingScope, key: string, fallback = ''): string {
  const value = getSetting(db, scope, key);
  return typeof value === 'string' ? value : fallback;
}

export function getStringList(db: Db, scope: SettingScope, key: string): string[] {
  const value = getSetting(db, scope, key);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** Raw list value, keeping numbers — used by the notification intervals. */
export function getRawList(db: Db, scope: SettingScope, key: string): unknown[] {
  const value = getSetting(db, scope, key);
  return Array.isArray(value) ? value : [];
}

export function setSetting(db: Db, scope: SettingScope, key: string, value: SettingValue): void {
  const now = new Date().toISOString();
  if (isTenantSetting(key)) {
    db.prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(requireWorkspace(scope, key).workspaceId, key, JSON.stringify(value), now);
    return;
  }
  if (isWorkspace(scope)) throw new Error(`platform_setting_requires_platform_scope: ${key}`);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
}

export function setSettings(db: Db, scope: SettingScope, values: Record<string, SettingValue>): void {
  for (const [key, value] of Object.entries(values)) {
    setSetting(db, scope, key, value);
  }
}

/** Every known setting with its current value for one workspace, for the Settings screen. */
export function readAllSettings(db: Db, scope: Scope): Record<string, SettingValue> {
  const result: Record<string, SettingValue> = {};
  for (const definition of SETTING_DEFINITIONS) {
    result[definition.key] = getSetting(db, scope, definition.key);
  }
  return result;
}

/** Ensures a stored value exists for a known setting (used by the seed). */
export function ensureSetting(db: Db, scope: SettingScope, key: string): void {
  if (readStored(db, scope, key) !== undefined) return;
  const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
  setSetting(db, scope, key, definition ? definition.defaultValue : null);
}

export function newSettingId(): string {
  return createId();
}
