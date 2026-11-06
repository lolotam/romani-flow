import type { Db } from '../db/connection.js';
import type { Row } from '../repositories/base.js';
import {
  getBoolean,
  getNumber,
  getRawList,
  getString,
  getStringList,
  setSetting,
} from '../repositories/settings.js';
import { daysUntil } from '../utils/dates.js';
import {
  finishEmailAttempt,
  startEmailAttempt,
  writeEmailLog,
  type TriggerSource,
} from './emailLog.js';
import { EXPIRED_BUCKET, parseIntervals, resolveBucket, type NotificationInterval } from './intervals.js';
import { MailError, type Mailer } from './mailer.js';
import { EmailDeadlineError, withinEmailDeadline } from './emailDeadline.js';
import { emailIdentity, emailIdentities } from './emailAddress.js';
import { uncertainEmailIdentities } from './emailUncertainty.js';
import {
  expiryReportHtml,
  expiryReportSubject,
  expiryReportText,
  type EmailLanguage,
  type ExpiringDocument,
  type ExpiringEmployee,
  type ExpiryReport,
} from './templates/index.js';

/**
 * Expiry reporting.
 *
 * Collects everything that is about to expire, renders it, sends it over SMTP and
 * records the attempt in `email_log`. Failures never propagate out of this module
 * as exceptions — they are logged and reported as a failed result.
 *
 * The administrator chooses which reminder thresholds are active (3 months,
 * 1 month, 15 days, 1 week, 1 day). Each item is notified once per threshold, and
 * `expiry_notifications` remembers what has already been sent.
 */

export interface ExpiryReportResult {
  sent: boolean;
  skipped?: string;
  error?: string;
  recipients: string[];
  itemCount: number;
}

interface EmployeeRow extends Row {
  id: string;
  name: string;
  company_id: string | null;
  residency_expiry_date: string | null;
}

interface DocumentRow extends Row {
  id: string;
  title: string;
  file_name: string | null;
  employee_id: string | null;
  company_id: string | null;
  document_type_id: string | null;
  ministry_id: string | null;
  issue_date: string | null;
  expiry_date: string | null;
}

function nameMap(db: Db, table: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of db.prepare(`SELECT id, name FROM "${table}"`).all() as Row[]) {
    map.set(String(row.id), String(row.name ?? ''));
  }
  return map;
}

/** The Arabic name of a catalogue entry, falling back to the English one. */
function arabicNameMap(db: Db, table: string): Map<string, string> {
  const map = new Map<string, string>();
  const rows = db.prepare(`SELECT id, name, name_ar FROM "${table}"`).all() as Row[];
  for (const row of rows) {
    const arabic = String(row.name_ar ?? '').trim();
    map.set(String(row.id), arabic.length > 0 ? arabic : String(row.name ?? ''));
  }
  return map;
}

export function collectExpiring(
  db: Db,
  options: {
    windowDays: number;
    includeEmployees: boolean;
    includeDocuments: boolean;
    intervals: NotificationInterval[];
    language?: EmailLanguage;
  },
): ExpiryReport {
  const employees: ExpiringEmployee[] = [];
  const documents: ExpiringDocument[] = [];
  const language = options.language ?? 'ar';

  // The Arabic report reads the Arabic catalogue names; the English report
  // keeps the English ones. Each catalogue row carries both.
  const useArabic = language === 'ar';
  const companies = useArabic ? arabicNameMap(db, 'companies') : nameMap(db, 'companies');
  const employeeNames = nameMap(db, 'employees');
  const documentTypes = useArabic
    ? arabicNameMap(db, 'document_types')
    : nameMap(db, 'document_types');
  const ministries = useArabic ? arabicNameMap(db, 'ministries') : nameMap(db, 'ministries');

  if (options.includeEmployees) {
    const rows = db
      .prepare(
        `SELECT id, name, company_id, residency_expiry_date
           FROM employees
          WHERE residency_expiry_date IS NOT NULL AND residency_expiry_date != ''`,
      )
      .all() as EmployeeRow[];

    for (const row of rows) {
      // The selected intervals alone decide the eligibility. A separate
      // look-ahead window would silently cancel the wider thresholds.
      const remaining = daysUntil(row.residency_expiry_date as string);
      const bucket = resolveBucket(remaining, options.intervals);
      if (bucket === null) continue;

      employees.push({
        id: row.id,
        name: row.name,
        companyName: row.company_id ? (companies.get(row.company_id) ?? '') : '',
        expiryDate: row.residency_expiry_date as string,
        daysRemaining: remaining,
        isExpired: remaining < 0,
        intervalDays: bucket,
      });
    }

    employees.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  if (options.includeDocuments) {
    const rows = db
      .prepare(
        `SELECT id, title, file_name, employee_id, company_id, document_type_id, ministry_id, issue_date, expiry_date
           FROM documents
          WHERE expiry_date IS NOT NULL AND expiry_date != ''`,
      )
      .all() as DocumentRow[];

    for (const row of rows) {
      const remaining = daysUntil(row.expiry_date as string);
      const bucket = resolveBucket(remaining, options.intervals);
      if (bucket === null) continue;

      documents.push({
        id: row.id,
        title: row.title,
        fileName: row.file_name,
        employeeName: row.employee_id ? (employeeNames.get(row.employee_id) ?? null) : null,
        companyName: row.company_id ? (companies.get(row.company_id) ?? null) : null,
        documentTypeName: row.document_type_id ? (documentTypes.get(row.document_type_id) ?? null) : null,
        ministryName: row.ministry_id ? (ministries.get(row.ministry_id) ?? null) : null,
        issueDate: row.issue_date,
        expiryDate: row.expiry_date as string,
        daysRemaining: remaining,
        isExpired: remaining < 0,
        intervalDays: bucket,
      });
    }

    documents.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  return {
    employees,
    documents,
    windowDays: options.windowDays,
    generatedAt: new Date(),
    language,
  };
}

/**
 * True when this item has already been notified for this threshold, expiry
 * date and recipient.
 *
 * The expiry date is part of the identity, so a renewed document starts a new
 * cycle instead of being blocked by the record of the previous one. The
 * recipient is part of it too, so a rejected recipient is retried on its own
 * while the recipients that accepted the message are not asked again.
 */
function alreadyNotified(
  db: Db,
  itemType: string,
  itemId: string,
  expiryDate: string,
  intervalDays: number,
  recipient: string,
  uncertainIdentities: Set<string>,
): boolean {
  if (uncertainIdentities.has(JSON.stringify(['*', '*'])) || uncertainIdentities.has(JSON.stringify([emailIdentity(recipient), '*']))) return true;
  if (uncertainIdentities.has(JSON.stringify([emailIdentity(recipient), JSON.stringify([itemType, itemId, expiryDate, intervalDays])]))) return true;
  const rows = db
    .prepare(
      `SELECT recipient FROM expiry_notifications
        WHERE item_type = ? AND item_id = ? AND expiry_date = ?
          AND interval_days = ?`,
    )
    .all(itemType, itemId, expiryDate, intervalDays) as { recipient: string }[];
  return rows.some(row => emailIdentity(row.recipient) === emailIdentity(recipient));
}

function recordNotification(
  db: Db,
  itemType: string,
  itemId: string,
  expiryDate: string,
  intervalDays: number,
  recipient: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO expiry_notifications
       (id, item_type, item_id, expiry_date, interval_days, recipient, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    globalThis.crypto.randomUUID(),
    itemType,
    itemId,
    expiryDate,
    intervalDays,
    recipient,
    new Date().toISOString(),
  );
}

/**
 * Records a send attempt.
 *
 * The row is written **before** the message leaves the server, so a crash
 * between the SMTP handshake and the final update leaves a `sending` row behind
 * — an "unknown" outcome that the operator can see, rather than a silent gap.
 */
export { finishEmailAttempt, startEmailAttempt, writeEmailLog } from './emailLog.js';
export type { TriggerSource } from './emailLog.js';

export async function sendExpiryReport(
  db: Db,
  mailer: Mailer,
  triggerSource: TriggerSource,
  options: { budgetMs?: number; minimumSendMs?: number } = {},
): Promise<ExpiryReportResult> {
  const deadline = performance.now() + Math.min(60_000, Math.max(1, options.budgetMs ?? 60_000));
  const enabled = getBoolean(db, 'email.enabled');
  const recipients = emailIdentities(getStringList(db, 'email.recipients'));
  const cc = emailIdentities(getStringList(db, 'email.cc'));
  const allRecipients = emailIdentities([...recipients, ...cc]);
  const windowDays = getNumber(db, 'cron.days', 30);
  const includeEmployees = getBoolean(db, 'cron.include_employees');
  const includeDocuments = getBoolean(db, 'cron.include_documents');
  const intervals = parseIntervals(getRawList(db, 'email.notification_intervals'));
  const language = (getString(db, 'email.language', 'ar') === 'en' ? 'en' : 'ar') as EmailLanguage;

  if (!enabled) {
    writeEmailLog(db, {
      kind: 'expiry_report',
      recipients: allRecipients,
      subject: 'Expiry report',
      status: 'skipped',
      error: 'Email notifications are disabled in the settings.',
      triggerSource,
    });
    return { sent: false, skipped: 'disabled', recipients: allRecipients, itemCount: 0 };
  }

  if (allRecipients.length === 0) {
    writeEmailLog(db, {
      kind: 'expiry_report',
      recipients: [],
      subject: 'Expiry report',
      status: 'skipped',
      error: 'No recipients are configured.',
      triggerSource,
    });
    return { sent: false, skipped: 'no_recipients', recipients, itemCount: 0 };
  }

  if (intervals.length === 0) {
    writeEmailLog(db, {
      kind: 'expiry_report',
      recipients: allRecipients,
      subject: 'Expiry report',
      status: 'skipped',
      error: 'No notification intervals are selected.',
      triggerSource,
    });
    return { sent: false, skipped: 'no_intervals', recipients: allRecipients, itemCount: 0 };
  }

  const report = collectExpiring(db, {
    windowDays,
    includeEmployees,
    includeDocuments,
    intervals,
    language,
  });
  report.language = language;

  // An automated run only includes the items that have not been notified for
  // this threshold, expiry date and recipient yet. A manual run always shows
  // the full picture and never consumes a notification.
  // Recipients only share a report when their pending item sets are identical.
  const groups = new Map<string, { report: ExpiryReport; to: string[]; cc: string[] }>();
  const uncertainIdentities = triggerSource === 'cron' ? uncertainEmailIdentities(db) : new Set<string>();
  for (const recipient of allRecipients) {
    const employees = report.employees.filter(item => triggerSource !== 'cron' || !alreadyNotified(db, 'employee', item.id, item.expiryDate, item.intervalDays, recipient, uncertainIdentities));
    const documents = report.documents.filter(item => triggerSource !== 'cron' || !alreadyNotified(db, 'document', item.id, item.expiryDate, item.intervalDays, recipient, uncertainIdentities));
    if (!employees.length && !documents.length) continue;
    const key = JSON.stringify([employees.map(item => [item.id, item.expiryDate, item.intervalDays]), documents.map(item => [item.id, item.expiryDate, item.intervalDays])]);
    let group = groups.get(key);
    if (!group) { group = { report: { ...report, employees, documents }, to: [], cc: [] }; groups.set(key, group); }
    (recipients.includes(recipient) ? group.to : group.cc).push(recipient);
  }
  if (!groups.size) {
    writeEmailLog(db, { kind: 'expiry_report', recipients: allRecipients, subject: expiryReportSubject(report), status: 'skipped', error: 'No items are due for this interval.', triggerSource });
    return { sent: false, skipped: 'nothing_due', recipients: allRecipients, itemCount: 0 };
  }
  const results: ExpiryReportResult[] = [];
  const items = new Set<string>();
  for (const group of groups.values()) {
    for (const item of group.report.employees) items.add('employee:' + item.id);
    for (const item of group.report.documents) items.add('document:' + item.id);
  }
  for (const group of groups.values()) {
    if (deadline - performance.now() < (options.minimumSendMs ?? 15_000)) {
      break;
    }
    for (const item of group.report.employees) items.add('employee:' + item.id);
    for (const item of group.report.documents) items.add('document:' + item.id);
    const result = await sendReportGroup(db, mailer, triggerSource, group.report, group.to, group.cc, intervals, deadline);
    results.push(result);
    // Never start another handoff after a transport error or expired wait.
    if (result.error) break;
  }
  const completedGroups = results.length;
  for (const group of [...groups.values()].slice(completedGroups)) {
    const deferred = { sent: false, error: 'Email group deferred before SMTP handoff.', recipients: [...group.to, ...group.cc], itemCount: group.report.employees.length + group.report.documents.length };
    writeEmailLog(db, { kind: 'expiry_report', recipients: deferred.recipients, subject: expiryReportSubject(group.report), status: 'deferred', error: deferred.error, triggerSource,
      details: { employees: group.report.employees.length, documents: group.report.documents.length } });
    results.push(deferred);
  }
  const sent = completedGroups === groups.size && results.every(result => result.sent);
  const error = results.find(result => result.error)?.error;
  setSetting(db, 'email.last_result', error ? 'failed: ' + error : sent ? 'sent' : 'partial');
  return { sent, ...(error ? { error } : {}), recipients: results.flatMap(result => result.recipients), itemCount: items.size };
}

async function sendReportGroup(db: Db, mailer: Mailer, triggerSource: TriggerSource, finalReport: ExpiryReport,
  targetRecipients: string[], targetCc: string[], intervals: NotificationInterval[], deadline: number): Promise<ExpiryReportResult> {
  const { employees, documents, windowDays } = finalReport;
  const subject = expiryReportSubject(finalReport);
  const itemCount = employees.length + documents.length;
  // The attempt is recorded before the message is handed to SMTP.
  const logId = startEmailAttempt(db, {
    kind: 'expiry_report',
    recipients: [...targetRecipients, ...targetCc],
    subject,
    triggerSource,
    details: {
      employees: employees.length,
      documents: documents.length,
      windowDays,
      intervals,
      recipients: [...targetRecipients, ...targetCc],
      identities: [...employees.map(item => JSON.stringify(['employee', item.id, item.expiryDate, item.intervalDays])),
        ...documents.map(item => JSON.stringify(['document', item.id, item.expiryDate, item.intervalDays]))],
    },
  });

  try {
    const result = await withinEmailDeadline(mailer.send({
      to: targetRecipients,
      cc: targetCc.length > 0 ? targetCc : undefined,
      subject,
      text: expiryReportText(finalReport),
      html: expiryReportHtml(finalReport),
    }), deadline - performance.now());

    // Only the recipients that accepted the message are marked as notified, so a
    // rejected recipient is retried on its own while the others are not.
    if (triggerSource === 'cron') {
      for (const recipient of result.accepted) {
        for (const employee of employees) {
          recordNotification(
            db,
            'employee',
            employee.id,
            employee.expiryDate,
            employee.intervalDays,
            recipient,
          );
        }
        for (const document of documents) {
          recordNotification(
            db,
            'document',
            document.id,
            document.expiryDate,
            document.intervalDays,
            recipient,
          );
        }
      }
    }

    const status = result.status === 'partial' ? 'partial' : 'sent';
    finishEmailAttempt(db, logId, {
      status,
      details: { employees: employees.length, documents: documents.length, windowDays, intervals,
        recipients: [...targetRecipients, ...targetCc],
        identities: [...employees.map(item => JSON.stringify(['employee', item.id, item.expiryDate, item.intervalDays])),
          ...documents.map(item => JSON.stringify(['document', item.id, item.expiryDate, item.intervalDays]))],
        messageId: result.messageId, accepted: result.accepted, rejected: result.rejected },
      error:
        result.rejected.length > 0
          ? `Rejected recipients: ${result.rejected.join(', ')}`
          : undefined,
    });

    setSetting(db, 'email.last_sent_at', new Date().toISOString());
    setSetting(db, 'email.last_result', status);

    return { sent: result.status === 'sent', recipients: [...targetRecipients, ...targetCc], itemCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    const uncertain = error instanceof EmailDeadlineError || (error instanceof MailError && error.code === 'send_failed');
    finishEmailAttempt(db, logId, { status: uncertain ? 'unknown' : 'failed', error: detail });

    setSetting(db, 'email.last_result', `failed: ${detail}`);

    return { sent: false, error: detail, recipients: [...targetRecipients, ...targetCc], itemCount };
  }
}

/** The last automatic run is remembered so a restart cannot double-send. */
export function shouldSkipAutomatedRun(db: Db): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return getString(db, 'cron.last_run_date') === today;
}

export function recordAutomatedRun(db: Db, result: string, completed = true): void {
  const now = new Date();
  setSetting(db, 'cron.last_run_at', now.toISOString());
  setSetting(db, 'cron.last_run_result', result);
  // The day is only marked as handled when the run completed, so a failed run
  // stays retryable on the next tick.
  if (completed) {
    setSetting(db, 'cron.last_run_date', now.toISOString().slice(0, 10));
  }
}

export { EXPIRED_BUCKET };
