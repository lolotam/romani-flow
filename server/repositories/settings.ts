import type { Db } from '../db/connection.js';
import { createId } from './base.js';

/**
 * Key/value application settings.
 *
 * Values are stored as JSON so booleans, numbers and string arrays survive a
 * round trip. Secrets are never stored here — SMTP credentials live in the
 * environment only.
 */

export type SettingValue = string | number | boolean | string[] | null;

export interface SettingDefinition {
  key: string;
  type: 'boolean' | 'number' | 'string' | 'string[]';
  defaultValue: SettingValue;
  /** Settings that must never be written through the public API. */
  secret?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
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
];

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

export function getSetting(db: Db, key: string): SettingValue {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;

  if (row) {
    const parsed = parseStored(row.value);
    if (parsed !== null && parsed !== undefined) return parsed as SettingValue;
  }

  const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
  return definition ? definition.defaultValue : null;
}

export function getBoolean(db: Db, key: string): boolean {
  const value = getSetting(db, key);
  return value === true || value === 'true';
}

export function getNumber(db: Db, key: string, fallback: number): number {
  const value = getSetting(db, key);
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getString(db: Db, key: string, fallback = ''): string {
  const value = getSetting(db, key);
  return typeof value === 'string' ? value : fallback;
}

export function getStringList(db: Db, key: string): string[] {
  const value = getSetting(db, key);
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
export function getRawList(db: Db, key: string): unknown[] {
  const value = getSetting(db, key);
  return Array.isArray(value) ? value : [];
}

export function setSetting(db: Db, key: string, value: SettingValue): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), now);
}

export function setSettings(db: Db, values: Record<string, SettingValue>): void {
  for (const [key, value] of Object.entries(values)) {
    setSetting(db, key, value);
  }
}

/** Every known setting with its current value, for the Settings screen. */
export function readAllSettings(db: Db): Record<string, SettingValue> {
  const result: Record<string, SettingValue> = {};
  for (const definition of SETTING_DEFINITIONS) {
    result[definition.key] = getSetting(db, definition.key);
  }
  return result;
}

/** Ensures a row exists for a known setting (used by the seed). */
export function ensureSetting(db: Db, key: string): void {
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (exists) return;
  const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
  setSetting(db, key, definition ? definition.defaultValue : null);
}

export function newSettingId(): string {
  return createId();
}
