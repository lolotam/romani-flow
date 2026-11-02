/**
 * Date helpers.
 *
 * Business dates (issue_date, expiry_date, residency_expiry_date) are stored as
 * plain `YYYY-MM-DD` strings so SQLite can compare them lexicographically.
 * Timestamps (created_at, updated_at) are full ISO-8601 strings.
 */

/** Today as `YYYY-MM-DD` in UTC. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Adds `days` to a `YYYY-MM-DD` string and returns a `YYYY-MM-DD` string. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Normalises any incoming date value to `YYYY-MM-DD`, or null when unusable.
 *
 * A value like `2026-13-40` is rejected instead of being passed through, so a
 * typo cannot become a business date that silently never expires.
 */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    // The round trip rejects impossible dates such as 2026-13-40.
    return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Whole days from today until `date`; negative when the date has passed. */
export function daysUntil(date: string, now: Date = new Date()): number {
  const target = new Date(`${normalizeDate(date) ?? date}T00:00:00Z`).getTime();
  const base = new Date(`${today(now)}T00:00:00Z`).getTime();
  return Math.round((target - base) / 86_400_000);
}

/**
 * Document status derived from the expiry date.
 *
 * The warning window is configurable so operators can change it without a
 * redeploy; it is passed in rather than hard-coded.
 */
export function documentStatus(
  expiryDate: string | null | undefined,
  warningDays: number,
  now: Date = new Date(),
): 'valid' | 'expiring_soon' | 'expired' {
  if (!expiryDate) return 'valid';

  const days = daysUntil(expiryDate, now);
  if (days < 0) return 'expired';
  if (days <= warningDays) return 'expiring_soon';
  return 'valid';
}

/** True when the date falls inside the window `[today, today + days]`. */
export function isWithinWindow(date: string | null | undefined, days: number, now: Date = new Date()): boolean {
  if (!date) return false;
  const remaining = daysUntil(date, now);
  return remaining >= 0 && remaining <= days;
}
