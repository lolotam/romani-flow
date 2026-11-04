import type { Row } from '../../repositories/base.js';
import { RepositoryError } from '../../repositories/base.js';
import { normalizeWhatsAppPhone } from './phone.js';
import type { Db } from '../../db/connection.js';

export function optedPhoneCounts(employees: Iterable<Row>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (employee.whatsapp_notifications_enabled !== 1) continue;
    const phone = normalizeWhatsAppPhone(employee.mobile_no);
    if (phone) counts.set(phone, (counts.get(phone) ?? 0) + 1);
  }
  return counts;
}

/** Called inside the employee write transaction and notification coordinator. */
export function prepareEmployee(payload: Row, db: Db, existing: Row = {}): Row {
  if ('whatsapp_notifications_enabled' in payload && typeof payload.whatsapp_notifications_enabled !== 'boolean') {
    throw new RepositoryError('WhatsApp opt-in must be boolean.', 'invalid_whatsapp_opt_in', 400);
  }
  const merged = { ...existing, ...payload };
  const enabled = merged.whatsapp_notifications_enabled === true || merged.whatsapp_notifications_enabled === 1;
  if (!enabled) return payload;
  const phone = normalizeWhatsAppPhone(merged.mobile_no);
  if (!phone) throw new RepositoryError('An international mobile number is required for WhatsApp opt-in.', 'invalid_whatsapp_phone', 400);
  const others = db.prepare('SELECT mobile_no,whatsapp_notifications_enabled FROM employees WHERE id!=? AND whatsapp_notifications_enabled=1')
    .all(String(existing.id ?? ''));
  if (optedPhoneCounts(others).has(phone)) {
    throw new RepositoryError('This WhatsApp mobile number is already assigned to another opted-in employee.', 'duplicate_employee_whatsapp_phone', 409);
  }
  return { ...payload, mobile_no: phone };
}
