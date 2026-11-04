import type { Db } from '../../db/connection.js';
import type { Row } from '../../repositories/base.js';
import { getBoolean, getRawList } from '../../repositories/settings.js';
import { parseIntervals, resolveBucket } from '../../services/intervals.js';
import { daysUntil, normalizeDate } from '../../utils/dates.js';
import type { ReminderCandidate } from './contracts.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { reminderText } from './templates.js';
import { optedPhoneCounts } from './employeePolicy.js';

export function selectReminders(db: Db, instance: string, now: Date): ReminderCandidate[] {
  if (!getBoolean(db, 'whatsapp.enabled')) return [];
  const intervals = parseIntervals(getRawList(db, 'email.notification_intervals'));
  const employees = new Map((db.prepare('SELECT * FROM employees').all() as Row[]).map(row => [String(row.id), row]));
  const phoneCounts = optedPhoneCounts(employees.values());
  const companies = new Map((db.prepare('SELECT * FROM companies').all() as Row[]).map(row => [String(row.id), String(row.name_ar || row.name)]));
  const managers = db.prepare('SELECT label,phone FROM whatsapp_recipients WHERE enabled=1').all() as { label: string; phone: string }[];
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
      if (phone && phoneCounts.get(phone) === 1) destinations.set(phone, { label: owner, audience: 'employee' });
    }
    for (const manager of managers) destinations.set(manager.phone, { label: manager.label, audience: 'management' });
    for (const [recipient, destination] of destinations) candidates.push({
      instance, item_type: type, item_id: id, expiry_date: date, bucket, recipient,
      recipient_label: destination.label, audience: destination.audience, item_name: name, owner_name: owner,
      text: reminderText(destination.audience, name, owner, date, !employee),
    });
  }
  if (getBoolean(db, 'cron.include_documents')) {
    for (const row of db.prepare('SELECT id,title,expiry_date,employee_id,company_id FROM documents').all() as Row[]) {
      const employee = row.employee_id ? employees.get(String(row.employee_id)) : undefined;
      // A broken employee reference is not permission to disclose it as a company document.
      if (row.employee_id && !employee) continue;
      add('document', String(row.id), String(row.title), row.expiry_date, employee, row.company_id);
    }
  }
  if (getBoolean(db, 'cron.include_employees')) {
    for (const employee of employees.values()) add('employee_residency', String(employee.id), 'الإقامة', employee.residency_expiry_date, employee);
  }
  return candidates;
}
