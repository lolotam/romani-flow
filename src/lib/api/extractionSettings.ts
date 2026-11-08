/**
 * The validated reads of the extraction settings.
 *
 * The module owns the wire format of the two catalog reads the settings card
 * performs. Every answer is validated before it is used, so a broken answer
 * never becomes a list of models.
 *
 * A candidate is a model the local records already approve. A catalog entry is
 * a model the provider serves, with the reviewed state that says whether it
 * may be selected. Neither read selects, approves or activates anything.
 */

import { z } from 'zod';
import {
  getExtractionCatalog,
  type ExtractionProvider,
  type ModelCatalogListing,
  type ModelChoice,
} from '@/lib/api/documentExtraction';
import { request } from '@/lib/api/http';

export type { ExtractionProvider };

/** The reasons a candidate listing may answer with. */
export const CANDIDATE_REASONS = [
  'locally_approved',
  'processing_not_authorized',
  'unconfigured',
  'policy_unavailable',
  'no_candidates',
] as const;

/** Why the catalogue of a provider is empty. */
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

/**
 * The codes of a failure that have their own copy in the dictionary. Every
 * other failure keeps the generic copy, so no text of the server and no text
 * of an exception ever reaches the interface.
 */
export const EXTRACTION_ERROR_CODES = [
  'invalid_settings',
  'invalid_provider',
  'catalog_unavailable',
  'status_unavailable',
  'invalid_response',
] as const;

/**
 * The number of images one provider accepts. The bound belongs to the
 * provider: Groq accepts three images per request and OpenRouter accepts one.
 * A candidate that claims more than its provider accepts is a broken answer.
 */
const PROVIDER_MAX_IMAGES: Record<ExtractionProvider, number> = {
  groq: 3,
  openrouter: 1,
};

/** One model of the offline catalogue. */
const modelChoiceSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(128),
    provider: z.enum(['groq', 'openrouter']),
    maxImages: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) => value.maxImages <= PROVIDER_MAX_IMAGES[value.provider],
    'the model claims more images than its provider accepts',
  );

/** The answer of the offline catalogue of one provider. */
const candidateListingSchema = z
  .object({
    verification: z.literal('offline'),
    candidates: z.array(modelChoiceSchema).max(50),
    reason: z.enum(CANDIDATE_REASONS),
  })
  .strict()
  .refine(
    (value) =>
      value.candidates.length === 0
        ? value.reason !== 'locally_approved'
        : value.reason === 'locally_approved',
    'the reason must agree with the list of the candidates',
  );

/** Creates the failure of the settings with a code the copy knows. */
export function settingsError(
  code: (typeof EXTRACTION_ERROR_CODES)[number],
  cause?: unknown,
): Error {
  const error = new Error(code);
  error.name = 'ExtractionSettingsError';
  (error as Error & { code: string }).code = code;
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

/**
 * Reads the offline catalogue of one provider. The answer is validated before
 * it is used: a broken answer never becomes a list of models, and a model of
 * another provider is refused.
 */
export async function loadCandidates(
  provider: ExtractionProvider,
  signal: AbortSignal,
): Promise<{ candidates: ModelChoice[]; reason: CandidateReason }> {
  const envelope = await request<unknown>(
    `/api/document-extraction/candidates?provider=${encodeURIComponent(provider)}`,
    { signal },
  );
  if (signal.aborted) throw settingsError('invalid_response');
  if (envelope.error) throw envelope.error;
  const parsed = candidateListingSchema.safeParse(envelope.data);
  if (!parsed.success) throw settingsError('invalid_response', parsed.error);
  if (parsed.data.candidates.some((candidate) => candidate.provider !== provider)) {
    throw settingsError('invalid_response');
  }
  return { candidates: parsed.data.candidates, reason: parsed.data.reason };
}

/**
 * Reads the live model catalog of one provider.
 *
 * A catalog that cannot be read is a soft failure: the caller keeps the
 * approved candidates, so a broken listing never erases a selection.
 */
export async function loadCatalog(
  provider: ExtractionProvider,
  signal: AbortSignal,
): Promise<ModelCatalogListing> {
  try {
    return await getExtractionCatalog(provider, signal);
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw settingsError('catalog_unavailable', cause);
  }
}
