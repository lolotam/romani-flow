import type { ExpiryStatus } from '@/types';

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
