import type { Company, EmployeeWithRelations, ExpiryStatus } from '@/types';
import type { EmployeeFormState } from './employeeTypes';
import { formPatch } from '../../lib/formPatch';

/**
 * Builds the payload sent to the API.
 *
 * Empty fields are sent as `null` on purpose: the server keeps a stored value
 * when a key is absent, but clears it when the key is explicitly `null`.
 * Untouched edit-form consent is omitted rather than replayed from a stale form.
 * Other untouched fields are omitted too, including concurrent mobile changes.
 */
export function buildEmployeePayload(formData: EmployeeFormState, changes?: Partial<Record<keyof EmployeeFormState, boolean>>) {
  const payload = {
    name: formData.name,
    email: formData.email || null,
    mobile_no: formData.mobile_no || null,
    whatsapp_notifications_enabled: formData.whatsapp_notifications_enabled,
    position: formData.position || null,
    hire_date: formData.hire_date || null,
    birth_date: formData.birth_date || null,
    civil_id_no: formData.civil_id_no || null,
    residency_expiry_date: formData.residency_expiry_date || null,
    driving_license: formData.driving_license,
    driving_license_expiry_date: formData.driving_license ? formData.driving_license_expiry_date || null : null,
    company_id: formData.company_id,
    is_active: formData.is_active,
  };
  // Disabling the licence explicitly clears its dependent expiry as before.
  return formPatch(payload, changes?.driving_license && !formData.driving_license
    ? { ...changes, driving_license_expiry_date: true } : changes);
}

/**
 * Shared helpers for the employee screens.
 *
 * These were previously inline in `src/pages/Employees.tsx`; they now live here
 * so the table, the form dialog and the profile dialog agree on the same
 * formatting rules.
 */

/**
 * Normalises the boolean flags of an employee row.
 *
 * The server stores `is_active` and `driving_license` as SQLite integers and
 * converts them back to booleans when it reads a row. The insert endpoint
 * answers with the raw row, so the flags are coerced here to keep the browser
 * state consistent with what the API returns everywhere else.
 */
export function toEmployeeFlags<T extends { is_active?: boolean; driving_license?: boolean }>(
  employee: T,
): T {
  return {
    ...employee,
    is_active: Boolean(employee.is_active),
    driving_license: Boolean(employee.driving_license),
  };
}

/** Formats a stored date for display (`dd/mm/yyyy`). */
export function formatDateForDisplay(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB');
}

/** Formats a stored date for an `<input type="date">` value (`yyyy-mm-dd`). */
export function formatDateForInput(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

/**
 * Derives the expiry state of a date.
 *
 * The server stores the raw date; the state is always computed in the browser.
 */
export function calculateExpiryStatus(expiryDate?: string | null): ExpiryStatus | undefined {
  if (!expiryDate) return undefined;
  const today = new Date();
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return undefined;
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'less_than_week';
  if (diffDays <= 30) return 'less_than_month';
  return 'valid';
}

/** Colour class used for a date that is expired / expiring soon / still valid. */
export function expiryDateClassName(expiryDate?: string | null): string {
  if (!expiryDate) return '';
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return '';
  if (expiry < new Date()) return 'text-red-500';
  if (expiry < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) return 'text-orange-500';
  return 'text-green-600';
}

/**
 * The company relation an employee row should display for `companyId`.
 *
 * It never returns a relation that belongs to a different company: sources are
 * only trusted when their own `company_id` matches, and the loaded company list
 * is the fallback. This keeps the displayed company consistent with the id the
 * server stored, even when another administrator changed it after the form opened.
 */
export function relationForCompany(
  companyId: string | null | undefined,
  sources: Array<Pick<EmployeeWithRelations, 'company_id' | 'companies'>>,
  companies: Company[],
): Company | null {
  if (!companyId) return null;
  const loaded = companies.find((company) => company.id === companyId);
  if (loaded) return loaded;
  return sources.find((source) => source.company_id === companyId && source.companies)?.companies ?? null;
}

const WHATSAPP_ERROR_KEYS: Record<string, string> = {
  invalid_whatsapp_phone: 'employees.messages.whatsappPhoneInvalid',
  duplicate_employee_whatsapp_phone: 'employees.messages.whatsappPhoneDuplicate',
};

/** Picks the translation key for a failed employee save: a specific WhatsApp reason, else the generic one. */
export function employeeSaveErrorKey(error: unknown, fallbackKey: string): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
  return WHATSAPP_ERROR_KEYS[code] ?? fallbackKey;
}
