import { z } from 'zod';

/**
 * The shared AI document extraction contract.
 *
 * The browser and the backend validate the same wire shapes with this module,
 * so a prepared page, a raw provider page and a normalized result have exactly
 * one definition. The schema is the authority: prompt JSON schemas only mirror
 * it and are never trusted on their own.
 *
 * The module is pure and browser-safe. It never reads the environment, never
 * performs network calls and never holds a secret.
 */

/** Hard limits applied to a prepared document before and during extraction. */
export const limits = {
  pages: 10,
  pixels: 4_000_000,
  body: 10 * 1024 * 1024,
  source: 20 * 1024 * 1024,
} as const;

/** The fields an extraction may propose, in the fixed catalog order. */
export const fieldNames = [
  'title',
  'document_number',
  'document_type_id',
  'ministry_id',
  'issue_date',
  'expiry_date',
] as const;

export type Field = typeof fieldNames[number];

/** One prepared page image encoded as base64. */
export const pageImage = z
  .object({
    page: z.number().int().min(1).max(10),
    mime: z.enum(['image/jpeg', 'image/png']),
    base64: z.string().min(4).max(limits.body),
  })
  .strict();

/** The request the browser sends after preparing every page of one document. */
export const extractionRequest = z
  .object({
    requestId: z.string().uuid(),
    scope: z.string().max(128),
    context: z.string().min(1).max(128),
    settingsVersion: z.string().length(64),
    catalogVersion: z.string().length(64),
    pageCount: z.number().int().min(1).max(10),
    images: z.array(pageImage).min(1).max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.images.length !== value.pageCount || value.images.some((image, i) => image.page !== i + 1)) {
      ctx.addIssue({ code: 'custom', message: 'Incomplete pages' });
    }
  });

const rawValue = z
  .object({
    value: z.string().max(128).nullable(),
    certainty: z.enum(['clear', 'uncertain', 'missing']),
  })
  .strict();

const rawDate = rawValue
  .extend({
    source: z.string().max(128).nullable(),
    calendar: z.enum(['gregorian', 'unknown']),
  })
  .strict();

/** One raw page as returned by a provider, before any reconciliation. */
export const rawPage = z
  .object({
    page: z.number().int().min(1).max(10),
    title: rawValue,
    document_number: rawValue,
    document_type_label: rawValue,
    ministry_label: rawValue,
    issue_date: rawDate,
    expiry_date: rawDate,
  })
  .strict();

/** The raw pages of one provider response. */
export const rawBatch = z.object({ pages: z.array(rawPage).min(1).max(10) }).strict();

/**
 * A normalized field proposal.
 *
 * `clear` carries a usable value, `review` and `missing` carry no value at all,
 * so a suggestion can never be applied while it is still unresolved.
 */
export const candidate = z
  .object({
    value: z.string().max(128).nullable(),
    state: z.enum(['clear', 'review', 'missing']),
    alternatives: z.array(z.string().max(128)).max(10),
    reason: z.enum(['none', 'uncertain', 'invalid', 'conflict', 'catalog']),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.state === 'clear' ? !value.value?.trim() || value.reason !== 'none' : value.value !== null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid candidate state' });
    }
    if (value.state === 'missing' && (value.alternatives.length !== 0 || value.reason !== 'none')) {
      ctx.addIssue({ code: 'custom', message: 'Invalid missing candidate' });
    }
  });

/** The normalized extraction result the backend returns to the browser. */
export const resultSchema = z
  .object({
    requestId: z.string().uuid(),
    context: z.string().max(128),
    settingsVersion: z.string().length(64),
    catalogVersion: z.string().length(64),
    pageCount: z.number().int().min(1).max(10),
    fields: z
      .object({
        title: candidate,
        document_number: candidate,
        document_type_id: candidate,
        ministry_id: candidate,
        issue_date: candidate,
        expiry_date: candidate,
      })
      .strict(),
  })
  .strict()
  .superRefine(({ fields }, ctx) => {
    const issue = (field: Field) =>
      ctx.addIssue({ code: 'custom', path: ['fields', field], message: 'Invalid normalized value' });
    if (fields.title.value && fields.title.value.length > 120) issue('title');
    if (fields.document_number.value !== null && fields.document_number.value !== fields.document_number.value.trim()) {
      issue('document_number');
    }
    for (const field of ['issue_date', 'expiry_date'] as const) {
      if (fields[field].value !== null && calendarDate(fields[field].value) === null) issue(field);
    }
    if (fields.issue_date.value && fields.expiry_date.value && fields.expiry_date.value < fields.issue_date.value) {
      issue('expiry_date');
    }
  });

export type ExtractionRequest = z.infer<typeof extractionRequest>;
export type ExtractionResult = z.infer<typeof resultSchema>;
export type RawPage = z.infer<typeof rawPage>;
export type Values = Record<Field, string>;

export interface CatalogEntry {
  id: string;
  name: string;
  name_ar: string;
}

export interface Catalogs {
  types: CatalogEntry[];
  ministries: CatalogEntry[];
  version: string;
}

/**
 * The public extraction status.
 *
 * It carries only booleans and labels: no key material, no key prefix and no
 * policy payload ever reaches the browser.
 */
export interface ExtractionStatus {
  enabled: boolean;
  provider: '' | 'groq' | 'openrouter';
  model: string;
  configured: { groq: boolean; openrouter: boolean };
  processingAuthorized: boolean;
  processingContext: string;
  available: boolean;
  reason: string;
  settingsVersion: string;
  catalogVersion: string;
  maxSourceBytes: number;
}

export interface ModelChoice {
  id: string;
  label: string;
  provider: 'groq' | 'openrouter';
  maxImages: number;
}

/**
 * Accepts only an explicit ISO Gregorian date and validates the real calendar
 * day, so an impossible or ambiguous date is rejected instead of guessed.
 *
 * The value is returned unchanged when it is already a valid `YYYY-MM-DD` date.
 */
export function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
