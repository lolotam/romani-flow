/**
 * HTTP helper for the API client.
 *
 * Every response is normalised into the `{ data, error }` envelope the UI
 * expects, so a page never has to handle a rejected promise.
 */

/**
 * The error object the server sends.
 *
 * It carries a human-readable message, a stable machine code and — depending on
 * the endpoint — extra details such as the list of settings that were refused.
 */
export interface ApiErrorPayload {
  message: string;
  code?: string;
  [key: string]: unknown;
}

/** The envelope every call resolves with. */
export interface ApiEnvelope<T> {
  data: T | null;
  error: Error | null;
}

/** The envelope as it arrives on the wire. */
interface WireEnvelope<T> {
  data: T | null;
  error: ApiErrorPayload | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** The full error object the server sent, including any extra details. */
    readonly details?: ApiErrorPayload,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Notifies the application when the session is gone, so it can sign out. */
type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function onUnauthorized(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers:
        options.body === undefined
          ? undefined
          : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (response.status === 401) {
      unauthorizedHandler?.();
    }

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as WireEnvelope<T>) : null;

    if (!response.ok) {
      const message = payload?.error?.message ?? `Request failed (${response.status}).`;
      const code = payload?.error?.code ?? 'http_error';
      return {
        data: null,
        error: new ApiRequestError(message, code, response.status, payload?.error ?? undefined),
      };
    }

    return {
      data: payload?.data ?? null,
      error: null,
    };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { data: null, error };
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'The request timed out. Please try again.'
        : 'The server could not be reached. Please check your connection.';

    return { data: null, error: new ApiRequestError(message, 'network_error', 0) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Uploads files as multipart form data. */
export async function uploadFiles<T>(
  path: string,
  files: File[],
  fields: Record<string, string> = {},
): Promise<ApiEnvelope<T>> {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as WireEnvelope<T>) : null;

    if (!response.ok) {
      const message = payload?.error?.message ?? `Upload failed (${response.status}).`;
      return {
        data: null,
        error: new ApiRequestError(
          message,
          payload?.error?.code ?? 'upload_failed',
          response.status,
          payload?.error ?? undefined,
        ),
      };
    }

    return { data: payload?.data ?? null, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The upload could not be completed.';
    return { data: null, error: new ApiRequestError(message, 'network_error', 0) };
  }
}
