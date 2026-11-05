import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/connection.js';
import { RepositoryError } from '../../repositories/base.js';
import type { ReminderCandidate, ReminderJob, SendOutcome } from './contracts.js';
import { reminderIdentity, isManualRetryFailure, isSafeUnsentFailure, isValidReminderText, MANUAL_RETRY_FAILURE_CODES } from './contracts.js';
import { normalizeWhatsAppPhone } from './phone.js';
import type { DestinationReplacement } from './destinations.js';

const FIELDS = ['instance', 'item_type', 'item_id', 'expiry_date', 'bucket', 'recipient', 'recipient_label', 'audience', 'item_name', 'owner_name', 'text'] as const;
const SNAPSHOT = ['recipient_label', 'audience', 'item_name', 'owner_name', 'text'] as const;

/** Date-independent lookup for prepared work at the previous destination. */
function replacementKey(item: ReminderCandidate): string {
  return JSON.stringify([item.instance, item.item_type, item.item_id, item.recipient]);
}

/** Savepoints also compose with an enclosing document/employee mutation transaction. */
export function atomic<T>(db: Db, action: () => T): T {
  const name = `wa_${randomUUID().replaceAll('-', '')}`;
  db.exec(`SAVEPOINT ${name}`);
  try { const result = action(); db.exec(`RELEASE ${name}`); return result; }
  catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
}

export class ReminderStore {
  constructor(readonly db: Db, readonly instance: string, readonly clock: () => Date = () => new Date()) {}

  reconcile(candidates: ReminderCandidate[], replacements: DestinationReplacement[] = []): void {
    const jobs = this.db.prepare("SELECT * FROM whatsapp_jobs WHERE instance=? AND state IN ('pending','retryable_failed','permanent_failed')").all(this.instance) as unknown as ReminderJob[];
    this.reconcileJobs(jobs, candidates, replacements);
  }

  reconcileClaim(id: string, candidates: ReminderCandidate[]): void {
    const jobs = this.db.prepare("SELECT * FROM whatsapp_jobs WHERE id=? AND instance=? AND state IN ('pending','retryable_failed')")
      .all(id, this.instance) as unknown as ReminderJob[];
    this.reconcileJobs(jobs, candidates, []);
  }

  private reconcileJobs(jobs: ReminderJob[], candidates: ReminderCandidate[], replacements: DestinationReplacement[]): void {
    const current = new Map(candidates.map(candidate => [reminderIdentity(candidate), candidate]));
    const replaceable = new Set(jobs.filter(job => job.state !== 'permanent_failed' || isSafeUnsentFailure(job.error_code)).map(replacementKey));
    for (const job of jobs) {
      const candidate = current.get(reminderIdentity(job));
      if (!candidate) this.db.prepare("UPDATE whatsapp_jobs SET state='cancelled',error_code='no_longer_eligible',updated_at=? WHERE id=?").run(this.clock().toISOString(), job.id);
      else if (SNAPSHOT.some(key => job[key] !== candidate[key])) this.db.prepare(`UPDATE whatsapp_jobs SET ${SNAPSHOT.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=?`)
        .run(...SNAPSHOT.map(key => candidate[key]), this.clock().toISOString(), job.id);
    }
    // Match prepared work by source item and old destination, even after a date/bucket change.
    this.admit(replacements.filter(pair => replaceable.has(replacementKey(pair.previous))).map(pair => pair.current));
  }

  enqueue(candidates: ReminderCandidate[]): number {
    return atomic(this.db, () => {
      this.reconcile(candidates);
      return this.admit(candidates);
    });
  }

  private admit(candidates: ReminderCandidate[]): number {
    if (!candidates.length) return 0;
    let inserted = 0, deferred = 0;
    const queued = this.queueSize();
    const now = this.clock().toISOString();
    const identityExists = this.db.prepare(`SELECT 1 FROM whatsapp_jobs WHERE instance=? AND item_type=? AND item_id=?
      AND expiry_date=? AND bucket=? AND recipient=? AND state!='cancelled'`);
    const insert = this.db.prepare(`INSERT INTO whatsapp_jobs
      (id,${FIELDS.join(',')},next_attempt_at,created_at,updated_at) VALUES (${Array(15).fill('?').join(',')})
      ON CONFLICT(instance,item_type,item_id,expiry_date,bucket,recipient) WHERE state!='cancelled' DO NOTHING`);
    for (const candidate of candidates) {
      if (candidate.instance !== this.instance) throw new Error('Reminder instance mismatch');
      if (queued + inserted >= 2000) {
        const existing = identityExists.get(candidate.instance, candidate.item_type, candidate.item_id, candidate.expiry_date, candidate.bucket, candidate.recipient);
        if (!existing) deferred += 1;
        continue;
      }
      inserted += Number(insert.run(randomUUID(), ...FIELDS.map(key => candidate[key]), now, now, now).changes);
    }
    if (deferred) console.warn(`[whatsapp] queue capacity reached; ${deferred} eligible jobs deferred until the next selection`);
    return inserted;
  }

  queueSize(): number {
    return Number(this.db.prepare("SELECT count(*) total FROM whatsapp_jobs WHERE instance=? AND state IN ('pending','retryable_failed','sending')").get(this.instance)!.total);
  }

  due(limit = 10): ReminderJob[] {
    return this.db.prepare(`SELECT * FROM whatsapp_jobs WHERE instance=? AND state IN ('pending','retryable_failed')
      AND attempt_count<4 AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?`).all(this.instance, this.clock().toISOString(), limit) as unknown as ReminderJob[];
  }

  claim(id: string): { job: ReminderJob; attemptId: string } | null {
    return atomic(this.db, () => {
      const now = this.clock().toISOString();
      const changed = this.db.prepare(`UPDATE whatsapp_jobs SET state='sending',attempt_count=attempt_count+1,updated_at=?
        WHERE id=? AND instance=? AND state IN ('pending','retryable_failed') AND attempt_count<4 AND next_attempt_at<=?`)
        .run(now, id, this.instance, now).changes;
      if (!changed) return null;
      const job = this.db.prepare('SELECT * FROM whatsapp_jobs WHERE id=?').get(id) as unknown as ReminderJob;
      const attemptId = randomUUID();
      this.db.prepare(`INSERT INTO whatsapp_attempts(id,job_id,attempt,recipient,recipient_label,audience,item_name,owner_name,expiry_date,text,state,started_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'sending',?)`).run(attemptId, id, job.attempt_count, job.recipient, job.recipient_label, job.audience, job.item_name, job.owner_name, job.expiry_date, job.text, now);
      return { job, attemptId };
    });
  }

  finish(job: ReminderJob, attemptId: string, outcome: SendOutcome): void {
    atomic(this.db, () => {
      const now = this.clock();
      const state = outcome.kind === 'retryable_failed' && job.attempt_count >= 4 ? 'permanent_failed' : outcome.kind;
      const code = outcome.kind === 'provider_accepted' ? null : outcome.code;
      const messageId = outcome.kind === 'provider_accepted' ? outcome.messageId : null;
      const delay = outcome.kind === 'retryable_failed' ? Math.max([300, 900, 3600][job.attempt_count - 1] ?? 3600, outcome.retryAfterSeconds ?? 0) : 0;
      this.db.prepare('UPDATE whatsapp_attempts SET state=?,error_code=?,provider_message_id=?,finished_at=? WHERE id=? AND state=?')
        .run(state, code, messageId, now.toISOString(), attemptId, 'sending');
      this.db.prepare(`UPDATE whatsapp_jobs SET state=?,error_code=?,provider_message_id=?,next_attempt_at=?,updated_at=? WHERE id=? AND state='sending'`)
        .run(state, code, messageId, new Date(now.getTime() + delay * 1000).toISOString(), now.toISOString(), job.id);
    });
  }

  recover(): void {
    if (!this.instance) return;
    atomic(this.db, () => {
      const now = this.clock().toISOString();
      this.db.prepare("UPDATE whatsapp_attempts SET state='unknown',error_code='interrupted_restart',finished_at=? WHERE state='sending' AND job_id IN (SELECT id FROM whatsapp_jobs WHERE instance=?)").run(now, this.instance);
      this.db.prepare("UPDATE whatsapp_jobs SET state='unknown',error_code='interrupted_restart',updated_at=? WHERE state='sending' AND instance=?").run(now, this.instance);
    });
  }

  retry(id: string): void {
    const job = this.db.prepare('SELECT state,error_code,text,recipient FROM whatsapp_jobs WHERE id=? AND instance=?').get(id, this.instance);
    if (job && (!isValidReminderText(job.text) || normalizeWhatsAppPhone(job.recipient) !== job.recipient)) {
      throw new RepositoryError('Correct the reminder text or destination before retrying.', 'invalid_retry', 409);
    }
    if (job?.state === 'permanent_failed' && isManualRetryFailure(job.error_code) &&
        this.queueSize() >= 2000) {
      throw new RepositoryError('The reminder queue is full.', 'whatsapp_queue_full', 409);
    }
    const changed = this.db.prepare(`UPDATE whatsapp_jobs SET state='pending',next_attempt_at=?,updated_at=?
      WHERE id=? AND instance=? AND (state='retryable_failed' OR (state='permanent_failed' AND error_code IN (${MANUAL_RETRY_FAILURE_CODES.map(() => '?').join(',')})))
      AND attempt_count<4`).run(this.clock().toISOString(), this.clock().toISOString(), id, this.instance, ...MANUAL_RETRY_FAILURE_CODES).changes;
    if (!changed) throw new RepositoryError('This reminder cannot be retried.', 'retry_forbidden', 409);
  }

  saveRecipient(input: Record<string, unknown>, id?: string): string {
    if (Object.keys(input).some(key => !['label', 'phone', 'enabled'].includes(key))) throw new RepositoryError('Invalid recipient field.', 'invalid_recipient', 400);
    if ('enabled' in input && typeof input.enabled !== 'boolean') throw new RepositoryError('Enabled must be boolean.', 'invalid_recipient', 400);
    const previous = id ? this.db.prepare('SELECT * FROM whatsapp_recipients WHERE id=?').get(id) : undefined;
    if (id && !previous) throw new RepositoryError('Recipient not found.', 'not_found', 404);
    const merged: Record<string, unknown> = { enabled: false, ...previous, ...input };
    const label = typeof merged.label === 'string' ? merged.label.trim() : '';
    const phone = normalizeWhatsAppPhone(merged.phone);
    if (!label || label.length > 100 || !phone || ![true, false, 0, 1].includes(merged.enabled as boolean)) throw new RepositoryError('A label, international phone and boolean enabled are required.', 'invalid_recipient', 400);
    const resultId = id ?? randomUUID(), now = this.clock().toISOString();
    try {
      if (id) this.db.prepare('UPDATE whatsapp_recipients SET label=?,phone=?,enabled=?,updated_at=? WHERE id=?').run(label, phone, Number(merged.enabled), now, id);
      else this.db.prepare('INSERT INTO whatsapp_recipients VALUES(?,?,?,?,?,?)').run(resultId, label, phone, Number(merged.enabled), now, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: whatsapp_recipients.phone')) throw new RepositoryError('This number already exists.', 'duplicate_recipient', 409);
      throw error;
    }
    return resultId;
  }
}
