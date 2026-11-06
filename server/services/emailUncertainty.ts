import type { Db } from '../db/connection.js';
import { emailIdentity } from './emailAddress.js';

const validRecipient = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** Only identities that can match the writer's tuple format can suppress an exact item. */
function validIdentity(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const tuple = JSON.parse(value);
    return Array.isArray(tuple) && tuple.length === 4 && ['employee', 'document'].includes(tuple[0])
      && typeof tuple[1] === 'string' && tuple[1].trim().length > 0
      && typeof tuple[2] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tuple[2])
      && new Date(tuple[2] + 'T00:00:00Z').toISOString().slice(0, 10) === tuple[2]
      && [0, 1, 7, 15, 30, 90].includes(tuple[3]);
  } catch { return false; }
}

/** Legacy interrupted reports lack item identities: block their recipients until reviewed. */
export function uncertainEmailIdentities(db: Db): Set<string> {
  const identities = new Set<string>();
  const rows = db.prepare("SELECT id,recipients,details FROM email_log WHERE kind='expiry_report' AND status IN ('sending','unknown') AND trigger_source='cron'").all() as { id: string; recipients: string; details: string | null }[];
  for (const row of rows) {
    db.prepare("UPDATE email_log SET status='unknown' WHERE id=? AND status='sending'").run(row.id);
    let details: { recipients?: unknown; identities?: unknown; employees?: unknown; documents?: unknown } = {};
    try { details = JSON.parse(row.details ?? '{}') ?? {}; } catch { /* Treat damaged legacy details as uncertain. */ }
    if (Array.isArray(details.recipients) && details.recipients.length > 0
      && details.recipients.every(validRecipient)
      && details.recipients.join(', ') === row.recipients
      && Array.isArray(details.identities) && details.identities.length > 0 && details.identities.every(validIdentity)
      && Number.isInteger(details.employees) && Number.isInteger(details.documents)
      && Number(details.employees) >= 0 && Number(details.documents) >= 0
      && new Set(details.identities.map(identity => JSON.stringify(JSON.parse(identity)))).size === details.identities.length
      && details.identities.filter(identity => JSON.parse(identity)[0] === 'employee').length === details.employees
      && details.identities.filter(identity => JSON.parse(identity)[0] === 'document').length === details.documents) {
      for (const recipient of details.recipients) for (const identity of details.identities) {
        if (typeof recipient === 'string' && typeof identity === 'string') identities.add(JSON.stringify([emailIdentity(recipient), JSON.stringify(JSON.parse(identity))]));
      }
      continue;
    }
    // Old audits joined addresses with comma-space, which is ambiguous inside quotes.
    // Such rows block globally rather than guessing a different mailbox.
    const raw = String(row.recipients ?? '');
    const split = raw.split(', ');
    const recipients = !raw.includes('"') && split.every(validRecipient) ? split.map(emailIdentity) : [];
    for (const recipient of recipients.length ? recipients : ['*']) identities.add(JSON.stringify([recipient, '*']));
  }
  return identities;
}
