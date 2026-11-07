import { z } from 'zod';

/**
 * The optional document number contract.
 *
 * A document number is free text: it keeps its own representation, so leading
 * zeros, Arabic-Indic digits and internal separators survive unchanged. The
 * value is trimmed and capped at 128 characters, and an absent or blank value
 * means "no number" (`null`) — never a number derived from anything else.
 *
 * Only strings are accepted. A number or a boolean is rejected instead of
 * being coerced, because a coerced value would silently change the document's
 * identity.
 */
export const documentNumber = z
  .string()
  .trim()
  .max(128)
  .nullish()
  .transform(value => value || null);
