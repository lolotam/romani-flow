import type { Db } from '../db/connection.js';
import type { Scope } from '../repositories/base.js';

/**
 * The email log.
 *
 * Every send attempt is recorded, so the operator can see what was sent, when
 * it was sent and why it failed. The row is written **before** the message
 * leaves the server: a crash between the SMTP handshake and the final update
 * leaves a `sending` row behind — an "unknown" outcome that is visible,
 * rather than a silent gap.
 */

export type TriggerSource = 'cron' | 'manual';

export interface EmailLogDraft {
  kind: string;
  recipients: string[];
  subject: string;
  error?: string;
  attachmentCount?: number;
  attachmentBytes?: number;
  triggerSource?: TriggerSource;
  details?: unknown;
}

/** A log entry that also carries its final status. */
export interface EmailLogEntry extends EmailLogDraft {
  status: string;
}

function insert(db: Db, scope: Scope, entry: EmailLogEntry, status: string): string {
  const id = globalThis.crypto.randomUUID();

  db.prepare(
    `INSERT INTO email_log
       (id, workspace_id, kind, recipients, subject, status, error, attachment_count, attachment_bytes, trigger_source, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope.workspaceId,
    entry.kind,
    entry.recipients.join(', '),
    entry.subject,
    status,
    entry.error ?? null,
    entry.attachmentCount ?? 0,
    entry.attachmentBytes ?? 0,
    entry.triggerSource ?? null,
    entry.details ? JSON.stringify(entry.details) : null,
    new Date().toISOString(),
  );

  return id;
}

/**
 * Opens a send attempt.
 *
 * The row is written before the message is handed to SMTP, so a crash can never
 * hide the attempt.
 */
export function startEmailAttempt(db: Db, scope: Scope, entry: EmailLogDraft): string {
  return insert(db, scope, { ...entry, status: 'sending' }, 'sending');
}

/** Completes a send attempt with its final outcome. */
export function finishEmailAttempt(
  db: Db,
  scope: Scope,
  logId: string,
  outcome: { status: string; error?: string; details?: unknown },
): void {
  db.prepare('UPDATE email_log SET status = ?, error = ?, details = COALESCE(?, details) WHERE id = ? AND workspace_id = ?').run(
    outcome.status,
    outcome.error ?? null,
    outcome.details === undefined ? null : JSON.stringify(outcome.details),
    logId,
    scope.workspaceId,
  );
}

/** Records an attempt that never reached SMTP. */
export function writeEmailLog(db: Db, scope: Scope, entry: EmailLogEntry): void {
  insert(db, scope, entry, entry.status);
}
