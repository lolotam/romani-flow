/** Dates arrive as date-only strings; do not restore an invalid value into a date picker. */
export function restoreFormDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return undefined;
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return local === value ? date : undefined;
}
