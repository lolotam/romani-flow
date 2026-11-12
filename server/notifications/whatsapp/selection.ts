import type { Db } from '../../db/connection.js';
import type { Row, Scope } from '../../repositories/base.js';
import { getBoolean, getRawList, getString } from '../../repositories/settings.js';
import { parseIntervals, resolveBucket } from '../../services/intervals.js';
import { daysUntil, normalizeDate } from '../../utils/dates.js';
import type { ReminderCandidate } from './contracts.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { reminderText } from './templates.js';
import { optedPhoneCounts } from './employeePolicy.js';

/**
 * A claim supplies its item/destination; daily selection omits it.
 * `tenant` is the workspace that owns the WhatsApp instance; nothing outside it is ever selected.
 */
export function selectReminders(db: Db, tenant: Scope, instance: string, now: Date, claim?: Pick<ReminderCandidate, 'item_type' | 'item_id' | 'recipient'>): ReminderCandidate[] {
  if (!getBoolean(db, tenant, 'whatsapp.enabled')) return [];
  const ws = tenant.workspaceId;
  const language = getString(db, tenant, 'whatsapp.language', 'ar') === 'en' ? 'en' : 'ar';
  const intervals = parseIntervals(getRawList(db, tenant, 'email.notification_intervals'));
  const documents = !getBoolean(db, tenant, 'cron.include_documents') ? [] : claim
    ? claim.item_type === 'document' ? db.prepare('SELECT id,title,expiry_date,employee_id,company_id FROM documents WHERE id=? AND workspace_id=?').all(claim.item_id, ws) as Row[] : []
    : db.prepare('SELECT id,title,expiry_date,employee_id,company_id FROM documents WHERE workspace_id=?').all(ws) as Row[];
  const employeeId = claim?.item_type === 'employee_residency' ? claim.item_id : documents[0]?.employee_id;
  const employeeRows = claim ? db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').all(String(employeeId ?? ''), ws) as Row[]
    : db.prepare('SELECT * FROM employees WHERE workspace_id=?').all(ws) as Row[];
  const employees = new Map(employeeRows.map(row => [String(row.id), row]));
  // Legacy formatting/collisions still need the opted-in phone projection, never full employee records.
  const needsCollisionCheck = claim && employeeRows.some(row => row.whatsapp_notifications_enabled === 1 && normalizeWhatsAppPhone(row.mobile_no) === claim.recipient);
  const phoneCounts = optedPhoneCounts(needsCollisionCheck
    ? db.prepare('SELECT mobile_no,whatsapp_notifications_enabled FROM employees WHERE whatsapp_notifications_enabled=1 AND workspace_id=?').all(ws) as Row[] : employeeRows);
  const companyRows = claim ? db.prepare('SELECT id,name,name_ar FROM companies WHERE id=? AND workspace_id=?').all(String(documents[0]?.company_id ?? ''), ws) as Row[]
    : db.prepare('SELECT id,name,name_ar FROM companies WHERE workspace_id=?').all(ws) as Row[];
  const companies = new Map(companyRows.map(row => {
    const primary = String((language === 'en' ? row.name : row.name_ar) ?? '').trim();
    const fallback = String((language === 'en' ? row.name_ar : row.name) ?? '').trim();
    return [String(row.id), primary || fallback];
  }));
  const managers = (claim ? db.prepare('SELECT label,phone FROM whatsapp_recipients WHERE enabled=1 AND phone=? AND workspace_id=?').all(claim.recipient, ws)
    : db.prepare('SELECT label,phone FROM whatsapp_recipients WHERE enabled=1 AND workspace_id=?').all(ws)) as { label: string; phone: string }[];
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
      if (phone && (!claim || phone === claim.recipient) && phoneCounts.get(phone) === 1) destinations.set(phone, { label: owner, audience: 'employee' });
    }
    for (const manager of managers) destinations.set(manager.phone, { label: manager.label, audience: 'management' });
    for (const [recipient, destination] of destinations) candidates.push({
      instance, item_type: type, item_id: id, expiry_date: date, bucket, recipient,
      recipient_label: destination.label, audience: destination.audience, item_name: name, owner_name: owner,
      text: reminderText(destination.audience, name, owner, date, !employee, language),
    });
  }
  if ((!claim || claim.item_type === 'document') && getBoolean(db, tenant, 'cron.include_documents')) {
    for (const row of documents) {
      const employee = row.employee_id ? employees.get(String(row.employee_id)) : undefined;
      // A broken employee reference is not permission to disclose it as a company document.
      if (row.employee_id && !employee) continue;
      add('document', String(row.id), String(row.title), row.expiry_date, employee, row.company_id);
    }
  }
  if ((!claim || claim.item_type === 'employee_residency') && getBoolean(db, tenant, 'cron.include_employees')) {
    for (const employee of employees.values()) add('employee_residency', String(employee.id), language === 'en' ? 'Residency' : 'الإقامة', employee.residency_expiry_date, employee);
  }
  return candidates;
}
