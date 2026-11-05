import type { Db } from '../../db/connection.js';
import type { Row } from '../../repositories/base.js';
import { getBoolean, getRawList } from '../../repositories/settings.js';
import { parseIntervals, resolveBucket } from '../../services/intervals.js';
import { daysUntil, normalizeDate } from '../../utils/dates.js';
import type { ReminderCandidate } from './contracts.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { reminderText } from './templates.js';
import { optedPhoneCounts } from './employeePolicy.js';

/** A claim supplies its item/destination; daily selection omits that scope. */
export function selectReminders(db: Db, instance: string, now: Date, scope?: Pick<ReminderCandidate, 'item_type' | 'item_id' | 'recipient'>): ReminderCandidate[] {
  if (!getBoolean(db, 'whatsapp.enabled')) return [];
  const intervals = parseIntervals(getRawList(db, 'email.notification_intervals'));
  const documents = !getBoolean(db, 'cron.include_documents') ? [] : scope
    ? scope.item_type === 'document' ? db.prepare('SELECT id,title,expiry_date,employee_id,company_id FROM documents WHERE id=?').all(scope.item_id) as Row[] : []
    : db.prepare('SELECT id,title,expiry_date,employee_id,company_id FROM documents').all() as Row[];
  const employeeId = scope?.item_type === 'employee_residency' ? scope.item_id : documents[0]?.employee_id;
  const employeeRows = scope ? db.prepare('SELECT * FROM employees WHERE id=?').all(String(employeeId ?? '')) as Row[]
    : db.prepare('SELECT * FROM employees').all() as Row[];
  const employees = new Map(employeeRows.map(row => [String(row.id), row]));
  // Legacy formatting/collisions still need the opted-in phone projection, never full employee records.
  const needsCollisionCheck = scope && employeeRows.some(row => row.whatsapp_notifications_enabled === 1 && normalizeWhatsAppPhone(row.mobile_no) === scope.recipient);
  const phoneCounts = optedPhoneCounts(needsCollisionCheck ? db.prepare('SELECT mobile_no,whatsapp_notifications_enabled FROM employees WHERE whatsapp_notifications_enabled=1').all() as Row[] : employeeRows);
  const companyRows = scope ? db.prepare('SELECT id,name,name_ar FROM companies WHERE id=?').all(String(documents[0]?.company_id ?? '')) as Row[]
    : db.prepare('SELECT id,name,name_ar FROM companies').all() as Row[];
  const companies = new Map(companyRows.map(row => [String(row.id), String(row.name_ar || row.name)]));
  const managers = (scope ? db.prepare('SELECT label,phone FROM whatsapp_recipients WHERE enabled=1 AND phone=?').all(scope.recipient)
    : db.prepare('SELECT label,phone FROM whatsapp_recipients WHERE enabled=1').all()) as { label: string; phone: string }[];
  const candidates: ReminderCandidate[] = [];
  function add(type: ReminderCandidate['item_type'], id: string, name: string, expiry: unknown, employee?: Row, companyId?: unknown): void {
    const date = normalizeDate(expiry);
    if (!date || !name.trim()) return;
    const bucket = resolveBucket(daysUntil(date, now), intervals);
    if (bucket === null) return;
    const owner = employee ? String(employee.name ?? '').trim() : companies.get(String(companyId)) ?? '';
    if (!owner) return;
    const destinations = new Map<string, { label: string; audience: 'employee' | 'management' }>();
    if (employee?.is_active === 1 && employee.whatsapp_notifications_enabled === 1) {
      const phone = normalizeWhatsAppPhone(employee.mobile_no);
      if (phone && (!scope || phone === scope.recipient) && phoneCounts.get(phone) === 1) destinations.set(phone, { label: owner, audience: 'employee' });
    }
    for (const manager of managers) destinations.set(manager.phone, { label: manager.label, audience: 'management' });
    for (const [recipient, destination] of destinations) candidates.push({
      instance, item_type: type, item_id: id, expiry_date: date, bucket, recipient,
      recipient_label: destination.label, audience: destination.audience, item_name: name, owner_name: owner,
      text: reminderText(destination.audience, name, owner, date, !employee),
    });
  }
  if ((!scope || scope.item_type === 'document') && getBoolean(db, 'cron.include_documents')) {
    for (const row of documents) {
      const employee = row.employee_id ? employees.get(String(row.employee_id)) : undefined;
      // A broken employee reference is not permission to disclose it as a company document.
      if (row.employee_id && !employee) continue;
      add('document', String(row.id), String(row.title), row.expiry_date, employee, row.company_id);
    }
  }
  if ((!scope || scope.item_type === 'employee_residency') && getBoolean(db, 'cron.include_employees')) {
    for (const employee of employees.values()) add('employee_residency', String(employee.id), 'الإقامة', employee.residency_expiry_date, employee);
  }
  return candidates;
}
