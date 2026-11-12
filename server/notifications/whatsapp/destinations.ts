import type { Db } from '../../db/connection.js';
import type { Scope } from '../../repositories/base.js';
import { sameReminderItem, type ReminderCandidate } from './contracts.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { optedPhoneCounts } from './employeePolicy.js';

interface Destination { phone: string | null; candidates: ReminderCandidate[] }
export type DestinationSnapshot = Map<string, Destination>;
export interface DestinationReplacement { previous: ReminderCandidate; current: ReminderCandidate }

/** Source IDs distinguish a changed number from a newly added audience. */
export function snapshotDestinations(db: Db, tenant: Scope, candidates: ReminderCandidate[]): DestinationSnapshot {
  const ws = tenant.workspaceId;
  const sources: DestinationSnapshot = new Map();
  const managers = new Map<string, string>();
  for (const row of db.prepare('SELECT id,phone FROM whatsapp_recipients WHERE workspace_id=?').all(ws)) {
    const source = `management:${row.id}`;
    sources.set(source, { phone: String(row.phone), candidates: [] });
    managers.set(String(row.phone), source);
  }
  const employees = db.prepare('SELECT id,mobile_no,is_active,whatsapp_notifications_enabled FROM employees WHERE workspace_id=?').all(ws);
  const counts = optedPhoneCounts(employees);
  const eligible = new Set<string>();
  for (const row of employees) {
    sources.set(`employee:${row.id}`, { phone: normalizeWhatsAppPhone(row.mobile_no), candidates: [] });
    const phone = normalizeWhatsAppPhone(row.mobile_no);
    if (row.is_active === 1 && row.whatsapp_notifications_enabled === 1 && phone && counts.get(phone) === 1) eligible.add(`employee:${row.id}`);
  }
  const owners = new Map(db.prepare('SELECT id,employee_id FROM documents WHERE workspace_id=?').all(ws).map(row => [String(row.id), String(row.employee_id)]));
  for (const candidate of candidates) {
    const source = candidate.audience === 'management' ? managers.get(candidate.recipient)
      : `employee:${candidate.item_type === 'employee_residency' ? candidate.item_id : owners.get(candidate.item_id)}`;
    if (source) sources.get(source)?.candidates.push(candidate);
    const employeeSource = `employee:${candidate.item_type === 'employee_residency' ? candidate.item_id : owners.get(candidate.item_id)}`;
    if (candidate.audience === 'management' && eligible.has(employeeSource) && sources.get(employeeSource)?.phone === candidate.recipient) {
      sources.get(employeeSource)!.candidates.push(candidate);
    }
  }
  return sources;
}

export function changedDestinations(before: DestinationSnapshot, after: DestinationSnapshot): DestinationReplacement[] {
  const replacements: DestinationReplacement[] = [];
  for (const [source, current] of after) {
    const previous = before.get(source);
    if (!previous?.phone || !current.phone || previous.phone === current.phone) continue;
    for (const candidate of current.candidates) {
      const original = previous.candidates.find(old => sameReminderItem(old, candidate));
      if (original) replacements.push({ previous: original, current: candidate });
    }
  }
  return replacements;
}
