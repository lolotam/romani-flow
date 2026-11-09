/**
 * The bounded HTTP seam of the extraction pipeline.
 *
 * Every provider request leaves the process through this module, so the rules
 * live here: the destinations are constants, the model is the only part of a
 * URL that may vary, a model identifier is split into exactly two safe
 * segments, redirects are refused, the cache is bypassed and the response is
 * streamed through a byte counter before it is parsed.
 *
 * The transport is injected. The default transport refuses to leave the
 * process in the test environment, so a test can never reach a provider by
 * accident.
 */

/** The transport used for every provider request. */
export type ExtractionTransport = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The clock seam of the provider requests.
 *
 * The pipeline injects its own clock, so a deadline can be exercised without
 * waiting for it. The seam stays internal: it is never reachable from a
 * request, a setting or the environment.
 */
export interface ProviderClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * The request options of a provider call.
 *
 * The cache mode is part of the request options of the platform, but it is
 * not part of every type definition of `RequestInit`, so the pipeline states
 * it explicitly.
 */
export interface ProviderRequestInit extends RequestInit {
  cache?: 'no-store';
  redirect?: 'error';
}

/** The fixed base of the Groq API. */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** The fixed base of the OpenRouter API. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Every destination the pipeline may reach. */
export const PROVIDER_URLS = {
  groqModels: `${GROQ_BASE_URL}/models`,
  groqChat: `${GROQ_BASE_URL}/chat/completions`,
  openRouterModels: `${OPENROUTER_BASE_URL}/models`,
  openRouterZdr: `${OPENROUTER_BASE_URL}/endpoints/zdr`,
  openRouterByok: `${OPENROUTER_BASE_URL}/byok?limit=1&offset=0`,
  openRouterChat: `${OPENROUTER_BASE_URL}/chat/completions`,
} as const;

/** The paths a provider URL may carry besides the model. */
const ALLOWED_PATHS: Record<string, readonly string[]> = {
  groq: ['/models', '/chat/completions'],
  openrouter: ['/models', '/chat/completions'],
};

/** The two segments of a model identifier: an author and a slug. */
const AUTHOR_PATTERN = /^[A-Za-z0-9_.-]+$/;
const SLUG_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/** The public messages of the provider failures. They carry no upstream text. */
const ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  provider_auth: { status: 502, message: 'The provider rejected the configured credentials.' },
  provider_balance: { status: 502, message: 'The provider reported a billing problem.' },
  provider_policy: { status: 502, message: 'The provider refused the request under its policy.' },
  provider_rate_limit: { status: 429, message: 'The provider is rate limiting this account.' },
  provider_unavailable: { status: 502, message: 'The provider is currently unavailable.' },
  provider_malformed_response: { status: 502, message: 'The provider returned an unexpected response.' },
  provider_request_rejected: { status: 502, message: 'The provider refused the request.' },
  provider_identity_mismatch: { status: 502, message: 'The provider answered for a different model.' },
  truncated_output: { status: 502, message: 'The provider response was truncated.' },
  payload_too_large: { status: 502, message: 'The provider response exceeded the allowed size.' },
  invalid_model: { status: 502, message: 'invalid_model' },
  external_inference_forbidden: { status: 503, message: 'External inference is not available here.' },
};

/**
 * The failure of one extraction step.
 *
 * The code names the condition, the status is the public answer and the
 * message is fixed: a body, a key, a file name or an upstream sentence never
 * reaches the browser through this error. The detail names the place of the
 * answer that was refused, for the log of the server, and it never carries a
 * value of the document either.
 */
export class ExtractionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly detail?: string;

  constructor(
    code: string,
    status: number,
    message: string,
    retryAfterSeconds?: number,
    detail?: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Builds the failure of a provider step. */
export function providerError(
  code: string,
  retryAfterSeconds?: number,
  detail?: string,
): ExtractionError {
  const entry = ERROR_MESSAGES[code] ?? {
    status: 502,
    message: 'The extraction provider request failed.',
  };
  return new ExtractionError(code, entry.status, entry.message, retryAfterSeconds, detail);
}

/** Builds the failure of a rejected model identifier. */
export function invalidModelError(): ExtractionError {
  return providerError('invalid_model');
}

/** Reports whether a value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Splits a model identifier into its two safe segments.
 *
 * A model identifier is `author/slug` and nothing else: no extra segment, no
 * query, no fragment and no percent encoding. A traversal attempt is rejected
 * before any URL is built.
 */
export function modelSegments(model: string): [string, string] {
  if (typeof model !== 'string') throw invalidModelError();
  const parts = model.split('/');
  if (parts.length !== 2) throw invalidModelError();
  const [author, slug] = parts;
  if (!AUTHOR_PATTERN.test(author) || !SLUG_PATTERN.test(slug)) throw invalidModelError();
  return [author, slug];
}

/**
 * Builds a provider URL from a constant base, a known path and a model.
 *
 * The path is one of the known paths and the model is only validated, never
 * appended: a model reaches a URL exclusively through `openRouterEndpointsUrl`,
 * which uses the two validated segments.
 */
export function buildProviderUrl(provider: 'groq' | 'openrouter', path: string, model: string): string {
  const base = provider === 'groq' ? GROQ_BASE_URL : provider === 'openrouter' ? OPENROUTER_BASE_URL : null;
  if (!base || !ALLOWED_PATHS[provider]?.includes(path)) {
    throw new ExtractionError('invalid_path', 502, 'invalid_path');
  }
  modelSegments(model);
  return base + path;
}

/** Builds the endpoint list URL of one validated model. */
export function openRouterEndpointsUrl(model: string): string {
  const [author, slug] = modelSegments(model);
  return `${OPENROUTER_BASE_URL}/models/${author}/${slug}/endpoints`;
}

/**
 * The documented model list envelope.
 *
 * The list of the models of a provider is a `data` array of model objects.
 * Every entry that is not an object is dropped, so a malformed envelope can
 * never reach the policy as a model.
 */
export function parseModelList(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.filter(isRecord);
}

/**
 * The documented endpoint list envelope of one model.
 *
 * The endpoint list of a model is a `data` object that carries the `id` of the
 * model and the list of its endpoints. Every endpoint names its model with
 * `model_id`, so the documented envelope is mapped into the normalized
 * policy record here. The invented shape of an endpoint list in `data` is not
 * a fallback: it is refused, because a proof that cannot be read is no proof.
 */
export function parseOpenRouterEndpoints(
  payload: unknown,
  model: string,
  tag: string,
): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !isRecord(payload.data)) return undefined;
  if (payload.data.id !== model) return undefined;
  const entries = payload.data.endpoints;
  if (!Array.isArray(entries)) return undefined;
  const entry = entries.find(item => isRecord(item) && item.model_id === model && item.tag === tag);
  if (!isRecord(entry)) return undefined;
  return { model: entry.model_id, tag: entry.tag, status: entry.status, pricing: entry.pricing };
}

/**
 * The documented zero data retention preview envelope.
 *
 * The preview is a `data` array whose entries name their model with
 * `model_id` and carry the `tag`, the `status` and the `safety_retention` of
 * the endpoint. The retention proof is mapped as it is: a missing or a
 * changed proof stays a refusal in the policy.
 */
export function parseOpenRouterZdr(
  payload: unknown,
  model: string,
  tag: string,
): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const entry = payload.data.find(item => isRecord(item) && item.model_id === model && item.tag === tag);
  if (!isRecord(entry)) return undefined;
  return {
    model: entry.model_id,
    tag: entry.tag,
    status: entry.status,
    safety_retention: entry.safety_retention,
  };
}

/**
 * The documented private key inventory envelope.
 *
 * The inventory is a `data` array with the `total_count` of the workspace. A
 * workspace without management access never reaches this point: the caller
 * treats the missing listing as unavailable, never as an empty inventory.
 */
export function parseOpenRouterByok(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  return { data: payload.data, total_count: payload.total_count };
}

/** Returns the abort reason of a cancelled request. */
function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Reads a response body under a byte limit.
 *
 * The body is streamed and counted: a response that grows past the limit is
 * refused and the reader is cancelled, and a cancellation stops the read
 * promptly and cancels the reader as well. The body is never collected with
 * `response.text()`, so an endless response cannot exhaust the memory.
 */
export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const body = response.body;
  if (!body) throw providerError('provider_malformed_response');

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectOnAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort(abortError(signal));
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      const value = chunk.value;
      total += value.byteLength;
      if (total > maxBytes) throw providerError('payload_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw providerError('provider_malformed_response');
  }
}

/** Joins the collected chunks into one buffer. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Drops a response body that will not be read. */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is already gone, so there is nothing left to drop.
  }
}

/**
 * Builds the default transport.
 *
 * The transport is fetch, but the test environment refuses to leave the
 * process: a missing injection can never turn into a real provider call.
 */
export function createDefaultTransport(env: string): ExtractionTransport {
  return async (url, init) => {
    if (env === 'test') {
      throw new ExtractionError(
        'external_inference_forbidden',
        503,
        ERROR_MESSAGES.external_inference_forbidden.message,
      );
    }
    return fetch(url, init);
  };
}

/** The smallest accepted retry delay of a rate limited provider. */
const MIN_RETRY_AFTER_SECONDS = 1;

/** The largest accepted retry delay of a rate limited provider. */
const MAX_RETRY_AFTER_SECONDS = 300;

/** The retry delay of a rate limited provider that names no delay. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/** Clamps a retry delay into the accepted range. */
function clampRetryAfter(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, Math.round(seconds)));
}

/**
 * Reads the retry delay of a rate limited provider.
 *
 * The header may carry seconds or a date. An unusable value falls back to the
 * default delay and every delay is clamped, so a provider can neither hide
 * behind a week nor push the client into an immediate retry. The rules are the
 * ones of the inference path, so a refused metadata request and a refused
 * inference answer with the same delay.
 */
export function retryAfterSeconds(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return DEFAULT_RETRY_AFTER_SECONDS;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return clampRetryAfter(Number.parseInt(trimmed, 10));
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return clampRetryAfter((date - Date.now()) / 1000);
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Reads one metadata document of a provider.
 *
 * The request carries the key of the account, never a body and never a
 * redirect, and it is bounded twice: by its own deadline and by a byte
 * limit. The body of a refused answer is dropped instead of being read, and
 * a cancellation of the caller stops the request promptly.
 *
 * A rate limited account is answered with the sanitized rate limit failure
 * and its bounded delay, exactly like the inference path, so a metadata
 * refusal never leaks an upstream body and never looks like an outage.
 */
export async function fetchProviderJson(
  url: string,
  key: string,
  signal: AbortSignal,
  clock: ProviderClock,
  timeoutMs: number,
  maxBytes: number,
  transport: ExtractionTransport,
): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = clock.setTimeout(
    () => controller.abort(new ExtractionError('extraction_timeout', 504, 'The extraction did not finish in time.')),
    timeoutMs,
  );
  try {
    const init: ProviderRequestInit = {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    };
    const response = await transport(url, init);
    if (!response.ok) {
      await discardBody(response);
      if (response.status === 429) {
        throw providerError('provider_rate_limit', retryAfterSeconds(response));
      }
      throw providerError(response.status === 401 ? 'provider_auth' : 'provider_unavailable');
    }
    return await readBoundedJson(response, maxBytes, controller.signal);
  } finally {
    clock.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
