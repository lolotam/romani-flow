import path from 'node:path';
import { readPairingConfig, type PairingConfig } from './whatsapp/config.js';
import { readExtractionConfig, type ExtractionConfig } from './extraction/config.js';

/**
 * Central configuration for the API server.
 *
 * Every environment variable is read here exactly once and validated here exactly
 * once, so the rest of the server never touches `process.env` directly.
 */

export type NodeEnv = 'development' | 'production' | 'test';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Password comes from the environment only — it is never stored in the database. */
  pass: string | null;
  from: string;
}

export interface AppConfig {
  env: NodeEnv;
  port: number;
  dataDir: string;
  uploadsDir: string;
  dbPath: string;
  jwtSecret: string | null;
  jwtTtlSeconds: number;
  cookieName: string;
  smtp: SmtpConfig;
  whatsapp: PairingConfig;
  maxUploadBytes: number;
  maxEmailAttachmentBytes: number;
  /** The size of the encoded MIME message, which is larger than the raw files. */
  maxEmailMessageBytes: number;
  allowedFileTypes: string[];
  adminSeedEmails: string[];
  /** From ADMIN_SEED_PASSWORD only. There is deliberately no default value. */
  adminSeedPassword: string | null;
  cronEnabled: boolean;
  cronSchedule: string;
  /** Backend-only AI extraction settings. Disabled and unconfigured by default. */
  extraction: ExtractionConfig;
}

const MIN_ADMIN_PASSWORD_LENGTH = 12;

const DEFAULT_ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

function readString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function readOptionalString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

function readEnv(env: NodeJS.ProcessEnv): NodeEnv {
  const raw = readString(env, 'NODE_ENV', 'development');
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

/**
 * Reads the first env var that is present from a list of accepted names.
 *
 * The SMTP variables are already configured in the production environment under
 * names that cannot be verified from here, so every common alias is accepted.
 * The canonical `SMTP_*` name is always tried first.
 */
function readFirst(env: NodeJS.ProcessEnv, keys: string[], fallback: string): string {
  for (const key of keys) {
    const raw = env[key];
    if (raw !== undefined && raw.trim() !== '') return raw.trim();
  }
  return fallback;
}

function readFirstOptional(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const raw = env[key];
    if (raw !== undefined && raw.trim() !== '') return raw.trim();
  }
  return null;
}

function readFirstInt(env: NodeJS.ProcessEnv, keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readFirstBool(env: NodeJS.ProcessEnv, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') continue;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }
  return fallback;
}

const SMTP_HOST_KEYS = ['SMTP_HOST', 'MAIL_HOST', 'EMAIL_HOST'];
const SMTP_PORT_KEYS = ['SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT'];
const SMTP_SECURE_KEYS = ['SMTP_SECURE', 'MAIL_SECURE', 'EMAIL_SECURE'];
const SMTP_USER_KEYS = ['SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER', 'EMAIL_USER', 'EMAIL_USERNAME'];
const SMTP_PASS_KEYS = [
  'SMTP_PASS',
  'SMTP_PASSWORD',
  'MAIL_PASS',
  'MAIL_PASSWORD',
  'EMAIL_PASS',
  'EMAIL_PASSWORD',
];
const SMTP_FROM_KEYS = ['SMTP_FROM', 'MAIL_FROM', 'EMAIL_FROM', 'FROM_EMAIL', 'SMTP_FROM_ADDRESS'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readEnv(env);
  const dataDir = path.resolve(readString(env, 'DATA_DIR', path.join(process.cwd(), 'data')));
  const uploadsDir = path.resolve(readString(env, 'UPLOADS_DIR', path.join(dataDir, 'uploads')));
  const dbPath = path.resolve(readString(env, 'DB_PATH', path.join(dataDir, 'romani.db')));

  // No default sender. An entirely absent SMTP configuration disables mail.
  const smtpUser = readFirst(env, SMTP_USER_KEYS, '');
  const smtpFrom = readFirst(env, SMTP_FROM_KEYS, '');
  const smtpPass = readFirstOptional(env, SMTP_PASS_KEYS);

  return {
    env: nodeEnv,
    port: readInt(env, 'PORT', 3000),
    dataDir,
    uploadsDir,
    dbPath,
    jwtSecret: readOptionalString(env, 'JWT_SECRET'),
    jwtTtlSeconds: readInt(env, 'JWT_TTL_SECONDS', 12 * 60 * 60),
    cookieName: readString(env, 'SESSION_COOKIE_NAME', 'romani_session'),
    whatsapp: readPairingConfig(env),
    smtp: {
      host: readFirst(env, SMTP_HOST_KEYS, smtpUser || smtpPass || smtpFrom ? 'smtp.gmail.com' : ''),
      port: readFirstInt(env, SMTP_PORT_KEYS, 587),
      secure: readFirstBool(env, SMTP_SECURE_KEYS, false),
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    },
    maxUploadBytes: readInt(env, 'MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxEmailAttachmentBytes: readInt(env, 'MAX_EMAIL_ATTACHMENT_MB', 20) * 1024 * 1024,
    // Gmail rejects a message above 25 MB, and base64 encoding adds roughly a
    // third to the raw attachment size.
    maxEmailMessageBytes: readInt(env, 'MAX_EMAIL_MESSAGE_MB', 24) * 1024 * 1024,
    allowedFileTypes: readList(env, 'ALLOWED_FILE_TYPES', DEFAULT_ALLOWED_TYPES),
    adminSeedEmails: readList(env, 'ADMIN_SEED_EMAILS', []),
    adminSeedPassword: readOptionalString(env, 'ADMIN_SEED_PASSWORD'),
    cronEnabled: readBool(env, 'CRON_ENABLED', true),
    cronSchedule: readString(env, 'CRON_SCHEDULE', '0 8 * * *'),
    extraction: readExtractionConfig(env),
  };
}

/**
 * Fail fast on configuration that would be unsafe in production.
 * Called once during boot, before the HTTP server starts listening.
 */
export function validateConfig(config: AppConfig): void {
  const problems: string[] = [];
  if (config.smtp.host || config.smtp.user || config.smtp.pass || config.smtp.from) {
    for (const [key, value] of Object.entries({
      SMTP_USER: config.smtp.user,
      SMTP_PASS: config.smtp.pass,
      SMTP_FROM: config.smtp.from,
    })) {
      if (!value) problems.push(`${key} is required when SMTP is configured (no default).`);
    }
  }

  if (config.env === 'production' && !config.jwtSecret) {
    problems.push('JWT_SECRET is required in production (set it in the Dokploy environment).');
  }
  if (!config.jwtSecret && config.env !== 'production') {
    problems.push('JWT_SECRET is not set — sessions cannot be signed. Set it even in development.');
  }
  if (config.jwtSecret && config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long.');
  }
  if (!config.adminSeedEmails.every((email) => email.includes('@'))) {
    problems.push('ADMIN_SEED_EMAILS must be a comma-separated list of valid email addresses.');
  }
  if (config.adminSeedEmails.length > 0 && !config.adminSeedPassword) {
    problems.push('ADMIN_SEED_PASSWORD is required when ADMIN_SEED_EMAILS is set (there is no default password).');
  }
  if (config.adminSeedPassword && config.adminSeedPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_SEED_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

export function isSmtpConfigured(config: AppConfig): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from);
}
