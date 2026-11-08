/**
 * The typed calls of the AI document extraction.
 *
 * The wrapper owns the wire format of the extraction endpoints. Every answer
 * is validated here with the shared contract before it leaves the module, so
 * a form only ever sees a value the contract accepts. The raw answer of the
 * server is never handed to a form.
 *
 * The calls fail with an `Error`: the failure of the server is raised with
 * the code of the server, a rejected body is raised with `payload_too_large`
 * and an obsolete answer is raised as an `AbortError`.
 */

import { z } from 'zod';
import { request } from './http';
import {
  extractionRequest,
  resultSchema,
  type ExtractionRequest,
  type ExtractionResult,
} from '../../../server/contracts/documentExtraction';

/** The providers the extraction may use. */
export type ExtractionProvider = 'groq' | 'openrouter';

/** The largest request the extraction endpoint accepts. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

/** The time an extraction request may take. */
const REQUEST_TIMEOUT_MS = 50_000;

/** The public status of the extraction. */
const statusSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['', 'groq', 'openrouter']),
    model: z.string().max(256),
    configured: z.object({ groq: z.boolean(), openrouter: z.boolean() }).strict(),
    processingAuthorized: z.boolean(),
    processingContext: z.string().max(128),
    available: z.boolean(),
    reason: z.string().max(256),
    settingsVersion: z.string().length(64),
    catalogVersion: z.string().length(64),
    maxSourceBytes: z.number().int().positive().max(20 * 1024 * 1024),
  })
  .strict();

/** The status of the extraction. */
export type ExtractionStatus = z.infer<typeof statusSchema>;

/** One model the administrator may choose. */
const modelChoiceSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(128),
    provider: z.enum(['groq', 'openrouter']),
    maxImages: z.number().int().min(1).max(10),
  })
  .strict();

/** The models the administrator may choose. */
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/**
 * Reads the public status of the extraction.
 *
 * The answer is validated before it is returned, so a changed or broken
 * answer can never reach a form.
 */
export async function getExtractionStatus(signal?: AbortSignal): Promise<ExtractionStatus> {
  const envelope = await request<unknown>('/api/document-extraction/status', { signal });
  if (signal?.aborted) throw abortedError();
  if (envelope.error) throw envelope.error;
  const parsed = statusSchema.safeParse(envelope.data);
  if (!parsed.success) throw new Error('extraction_invalid_response');
  return parsed.data;
}

/**
 * Reads the models of one provider.
 *
 * The list is bounded and every entry is validated, so a form never shows a
 * model the contract does not know.
 */
export async function getExtractionModels(
  provider: ExtractionProvider,
  signal?: AbortSignal,
): Promise<ModelChoice[]> {
  if (provider !== 'groq' && provider !== 'openrouter') {
    throw new Error('extraction_invalid_provider');
  }
  const envelope = await request<unknown>(
    `/api/document-extraction/models?provider=${encodeURIComponent(provider)}`,
    { signal },
  );
  if (signal?.aborted) throw abortedError();
  if (envelope.error) throw envelope.error;
  const parsed = z.array(modelChoiceSchema).max(50).safeParse(envelope.data);
  if (!parsed.success) throw new Error('extraction_invalid_response');
  return parsed.data;
}

/**
 * Sends one prepared document to the extraction.
 *
 * The request is refused before it leaves the page when the caller already
 * cancelled it or when the encoded request is larger than the budget of the
 * endpoint. The answer is validated with the shared contract before it is
 * returned, and a cancelled answer is refused.
 *
 * The wrapper keeps no state of its own: which answer belongs to which
 * attempt is decided by the form that started the attempt, so two forms that
 * extract at the same time never cancel each other.
 */
export async function extractDocument(
  body: ExtractionRequest,
  account: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  if (signal?.aborted) throw abortedError();
  const encoded = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (encoded > MAX_REQUEST_BYTES) throw new Error('payload_too_large');
  if (!extractionRequest.safeParse(body).success) throw new Error('extraction_invalid_request');

  const envelope = await request<unknown>('/api/document-extraction', {
    method: 'POST',
    body,
    draftAccount: account,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal,
  });
  if (signal?.aborted) throw abortedError();
  if (envelope.error) throw envelope.error;
  const parsed = resultSchema.safeParse(envelope.data);
  if (!parsed.success) throw new Error('extraction_invalid_response');
  return parsed.data;
}

/**
 * Creates the failure of an obsolete or cancelled call.
 *
 * The failure is a real `Error` named `AbortError`, so a caller recognizes
 * a cancellation the same way it recognizes a cancelled request.
 */
function abortedError(): Error {
  const error = new Error('The extraction request was cancelled.');
  error.name = 'AbortError';
  return error;
}
