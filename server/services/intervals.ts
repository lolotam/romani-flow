/**
 * Reminder intervals.
 *
 * The administrator picks any combination of these thresholds in the Settings
 * screen. Each selected threshold fires its own notice when an item reaches it,
 * and the notification history makes sure an item is never notified twice for the
 * same threshold.
 */

export const NOTIFICATION_INTERVALS = [90, 30, 15, 7, 1] as const;

export type NotificationInterval = (typeof NOTIFICATION_INTERVALS)[number];

/** The bucket used for items that are already expired. */
export const EXPIRED_BUCKET = 0;

export interface IntervalLabel {
  ar: string;
  en: string;
}

export const INTERVAL_LABELS: Record<number, IntervalLabel> = {
  90: { ar: 'قبل 3 أشهر', en: '3 months before' },
  30: { ar: 'قبل شهر واحد', en: '1 month before' },
  15: { ar: 'قبل 15 يوماً', en: '15 days before' },
  7: { ar: 'قبل أسبوع واحد', en: '1 week before' },
  1: { ar: 'قبل يوم واحد', en: '1 day before' },
  0: { ar: 'منتهي الصلاحية', en: 'Expired' },
};

/** Parses the stored interval list, keeping only the known values. */
export function parseIntervals(values: unknown): NotificationInterval[] {
  if (!Array.isArray(values)) return [];

  const parsed = values
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value): value is NotificationInterval =>
      (NOTIFICATION_INTERVALS as readonly number[]).includes(value),
    );

  return [...new Set(parsed)].sort((a, b) => b - a);
}

/**
 * Finds the reminder bucket an item belongs to.
 *
 * The **smallest selected interval that the item has reached** wins, so an item
 * that is 20 days away is notified under "1 month before" rather than under
 * "3 months before". Picking the largest interval would collapse the five
 * thresholds into one — the item would always be classified by the widest
 * window and the finer reminders would never fire.
 *
 * An item that has already expired belongs to its own bucket. Returns null
 * when no selected threshold applies.
 */
export function resolveBucket(
  daysRemaining: number,
  intervals: NotificationInterval[],
): number | null {
  if (!Number.isFinite(daysRemaining) || intervals.length === 0) return null;
  if (daysRemaining < 0) return EXPIRED_BUCKET;

  return [...intervals]
    .sort((a, b) => a - b)
    .find((interval) => daysRemaining <= interval) ?? null;
}
