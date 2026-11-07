/**
 * The shared contract of the local document preparation.
 *
 * The module is browser-safe and dependency-free on purpose: it is imported
 * by the preparation modules, by the PDF renderer and by the Vite plugin in
 * `vite.config.ts`. One module owns the locations of the bundled PDF.js
 * assets and the error codes of the preparation pipeline, so the browser, the
 * development server and the production build can never disagree.
 *
 * No asset is ever fetched from a network host. The renderer only ever reads
 * the files that are installed with the pinned PDF.js release and that the
 * build emits next to the application.
 */

/** The version of the bundled PDF.js release. */
export const pdfAssetVersion = '6.5.438';

/** The public base of every bundled PDF.js asset. */
export const pdfAssetBase = `/pdfjs/${pdfAssetVersion}/`;

/**
 * The installed asset directories that are bundled with the application.
 *
 * Only these four directories are ever emitted and only these four
 * directories are ever served. Nothing else of the PDF.js package reaches the
 * browser.
 */
export const pdfAssetDirectories = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

/** The asset locations the renderer is configured with. */
export const pdfAssetUrls = {
  cmaps: `${pdfAssetBase}cmaps/`,
  standardFonts: `${pdfAssetBase}standard_fonts/`,
  wasm: `${pdfAssetBase}wasm/`,
  iccs: `${pdfAssetBase}iccs/`,
} as const;

/**
 * The error codes of the preparation pipeline.
 *
 * A preparation either succeeds completely or fails with one of these codes.
 * A partially prepared document is never returned, so a caller can always
 * treat a failure as "nothing was prepared".
 */
export const failureCode = {
  /** A source, page, pixel or payload bound was exceeded. */
  limit: 'preparation_limit',
  /** The document is encrypted; a password is never requested. */
  encrypted: 'preparation_encrypted',
  /** The document is corrupt or unsupported. */
  invalid: 'preparation_invalid',
  /** The browser cannot render the document at all. */
  unavailable: 'preparation_unavailable',
  /** The preparation did not finish inside its deadline. */
  timeout: 'preparation_timeout',
  /** The encoded request would exceed the request budget. */
  payload: 'payload_too_large',
} as const;

/** One code of the preparation pipeline. */
export type FailureCode = (typeof failureCode)[keyof typeof failureCode];

/** The largest encoded request the extraction endpoint accepts. */
export const ENCODED_BUDGET_BYTES = 10 * 1024 * 1024;

/**
 * The space the request envelope needs.
 *
 * The preparation only knows the encoded pages, not the fields around them.
 * The allowance keeps the preparation conservative: the API wrapper performs
 * the exact check on the serialized request.
 */
export const ENVELOPE_ALLOWANCE_BYTES = 8192;

/**
 * Creates the failure of a preparation step.
 *
 * The message of the error is the code itself, so a caller can branch on it
 * without parsing a sentence.
 */
export function preparationFailure(code: FailureCode): Error {
  return new Error(code);
}

/**
 * Reports whether a failure is one of the preparation codes.
 *
 * The check keeps a failure of the preparation distinguishable from a
 * failure of the browser, so a broken picture is never reported as a broken
 * document.
 */
export function isPreparationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (Object.values(failureCode) as string[]).includes(error.message);
}

/**
 * Creates the failure of a cancelled preparation.
 *
 * The error is a real `Error` with the `AbortError` name, so a caller can
 * recognize a cancellation the same way it recognizes a cancelled request.
 */
export function abortedError(): Error {
  const error = new Error('The preparation was cancelled.');
  error.name = 'AbortError';
  return error;
}

/**
 * Rejects an encoded document that does not fit into the request budget.
 *
 * The check is called before and after every page, so an oversized document
 * fails instead of being sent half prepared.
 */
export function assertEncodedBudget(encodedBytes: number): void {
  if (encodedBytes + ENVELOPE_ALLOWANCE_BYTES > ENCODED_BUDGET_BYTES) {
    throw preparationFailure(failureCode.payload);
  }
}

/**
 * Encodes bytes as base64.
 *
 * The bytes are encoded in blocks, so a large page cannot overflow the call
 * stack of the encoder.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary);
}
