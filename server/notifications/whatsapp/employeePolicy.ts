import type { Row } from '../../repositories/base.js';
import { RepositoryError } from '../../repositories/base.js';
import { normalizeWhatsAppPhone } from './phone.js';

export function prepareEmployee(payload: Row, existing: Row = {}): Row {
  if ('whatsapp_notifications_enabled' in payload && typeof payload.whatsapp_notifications_enabled !== 'boolean') {
    throw new RepositoryError('WhatsApp opt-in must be boolean.', 'invalid_whatsapp_opt_in', 400);
  }
  const merged = { ...existing, ...payload };
  const enabled = merged.whatsapp_notifications_enabled === true || merged.whatsapp_notifications_enabled === 1;
  if (!enabled) return payload;
  const phone = normalizeWhatsAppPhone(merged.mobile_no);
  if (!phone) throw new RepositoryError('An international mobile number is required for WhatsApp opt-in.', 'invalid_whatsapp_phone', 400);
  return { ...payload, mobile_no: phone };
}
