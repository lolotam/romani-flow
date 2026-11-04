/** UI international numbers only; provider JIDs and guessed country codes are forbidden. */
export function normalizeWhatsAppPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const phone = input.trim().replace(/[\s()-]/g, '').replace(/^00/, '+');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
