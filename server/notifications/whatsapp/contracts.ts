import type { PairingStatus } from '../../whatsapp/pairingClient.js';

export type SendOutcome =
  | { kind: 'provider_accepted'; messageId: string }
  | { kind: 'retryable_failed'; code: string; retryAfterSeconds?: number }
  | { kind: 'permanent_failed'; code: string }
  | { kind: 'unknown'; code: string };
export interface WhatsAppTransport {
  status(): Promise<PairingStatus>;
  sendText(phone: string, text: string): Promise<SendOutcome>;
}
export interface ReminderCandidate {
  instance: string;
  item_type: 'document' | 'employee_residency';
  item_id: string;
  expiry_date: string;
  bucket: number;
  recipient: string;
  recipient_label: string;
  audience: 'management' | 'employee';
  item_name: string;
  owner_name: string;
  text: string;
}
export type JobState = 'pending' | 'sending' | 'provider_accepted' | 'retryable_failed' | 'permanent_failed' | 'unknown' | 'cancelled';
// Only pinned pre-handler authorization or local zero-fetch failures are safe to retry manually.
export const MANUAL_RETRY_FAILURE_CODES: readonly string[] = ['provider_unauthorized', 'invalid_text', 'whatsapp_not_configured'];
export function isSafeUnsentFailure(code: unknown): boolean {
  return code === 'invalid_number' || isManualRetryFailure(code);
}
export function isManualRetryFailure(code: unknown): boolean {
  return typeof code === 'string' && MANUAL_RETRY_FAILURE_CODES.includes(code);
}
export function isValidReminderText(text: unknown): text is string {
  return typeof text === 'string' && Boolean(text.trim()) && text.length <= 4096;
}
export interface ReminderJob extends ReminderCandidate {
  id: string;
  state: JobState;
  attempt_count: number;
  next_attempt_at: string;
  error_code: string | null;
}
export function reminderIdentity(item: ReminderCandidate): string {
  return JSON.stringify([item.instance, item.item_type, item.item_id, item.expiry_date, item.bucket, item.recipient]);
}
