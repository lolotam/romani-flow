/**
 * Shared helpers for the email templates.
 */

export type EmailLanguage = 'ar' | 'en';

export interface LocalisedText {
  ar: string;
  en: string;
}

export function pick(text: LocalisedText, language: EmailLanguage): string {
  return language === 'ar' ? text.ar : text.en;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `2026-11-04` becomes `04/11/2026` — unambiguous in both languages. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function remainingLabel(days: number, language: EmailLanguage): string {
  if (language === 'ar') {
    if (days < 0) return `منتهي منذ ${Math.abs(days)} يوم`;
    if (days === 0) return 'ينتهي اليوم';
    if (days === 1) return 'ينتهي غداً';
    if (days === 2) return 'ينتهي خلال يومين';
    if (days <= 10) return `ينتهي خلال ${days} أيام`;
    if (days <= 30) return `ينتهي خلال ${days} يوماً`;
    return `ينتهي خلال ${days} يوم`;
  }

  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

/** Arabic plural forms need three variants; this keeps the templates readable. */
export function arabicDays(count: number): string {
  if (count === 1) return 'يوم واحد';
  if (count === 2) return 'يومان';
  if (count <= 10) return `${count} أيام`;
  return `${count} يوماً`;
}

/** The colour palette mirrors the teal theme of the application. */
export const EMAIL_COLORS = {
  primary: '#0f766e',
  primaryDark: '#115e59',
  accent: '#14b8a6',
  surface: '#f0fdfa',
  border: '#ccfbf1',
  text: '#0f172a',
  muted: '#64748b',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  warning: '#b45309',
  warningBg: '#fffbeb',
} as const;

/** How urgent an item is, independent of the language. */
export interface ExpiryStatusInput {
  isExpired: boolean;
  daysRemaining: number;
}

const STATUS_COPY = {
  expired: { ar: 'منتهي', en: 'Expired' } satisfies LocalisedText,
  soon: { ar: 'قارب على الانتهاء', en: 'Expiring soon' } satisfies LocalisedText,
  valid: { ar: 'ساري', en: 'Valid' } satisfies LocalisedText,
};

/** The explicit status of an item, independent of how urgent it is. */
export function expiryStatus(item: ExpiryStatusInput, language: EmailLanguage): string {
  if (item.isExpired) return pick(STATUS_COPY.expired, language);
  if (item.daysRemaining <= 7) return pick(STATUS_COPY.soon, language);
  return pick(STATUS_COPY.valid, language);
}

/** The number of days left, phrased as a short quantity. */
export function remainingBadgeText(days: number, language: EmailLanguage): string {
  if (language === 'ar') {
    if (days < 0) return `منذ ${Math.abs(days)} يوم`;
    if (days === 0) return 'اليوم';
    if (days === 1) return 'يوم واحد';
    if (days === 2) return 'يومان';
    if (days <= 10) return `${days} أيام`;
    return `${days} يوماً`;
  }

  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  return `${days}d`;
}
