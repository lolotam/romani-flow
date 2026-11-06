import type { Db } from '../db/connection.js';
import { emailIdentity } from './emailAddress.js';

/** Legacy interrupted reports lack item identities: block their recipients until reviewed. */
export function uncertainEmailIdentities(db: Db): Set<string> {
  const identities = new Set<string>();
  const rows = db.prepare("SELECT id,recipients,details FROM email_log WHERE kind='expiry_report' AND status IN ('sending','unknown') AND trigger_source='cron'").all() as { id: string; recipients: string; details: string | null }[];
  for (const row of rows) {
    let details: { recipients?: unknown; identities?: unknown } = {};
    try { details = JSON.parse(row.details ?? '{}') ?? {}; } catch { /* Treat damaged legacy details as uncertain. */ }
    if (Array.isArray(details.recipients) && Array.isArray(details.identities)) {
      for (const recipient of details.recipients) for (const identity of details.identities) {
        if (typeof recipient === 'string' && typeof identity === 'string') identities.add(JSON.stringify([emailIdentity(recipient), identity]));
      }
      continue;
    }
    const recipients = String(row.recipients ?? '').split(',').map(emailIdentity).filter(Boolean);
    for (const recipient of recipients.length ? recipients : ['*']) identities.add(JSON.stringify([recipient, '*']));
    db.prepare("UPDATE email_log SET status='unknown' WHERE id=? AND status='sending'").run(row.id);
  }
  return identities;
}
