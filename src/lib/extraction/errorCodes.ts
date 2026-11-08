/**
 * The codes a failure of an extraction may carry.
 *
 * Only the codes the dictionary of the extraction knows may reach a form, so
 * the panel always finds the copy of the reason it shows and never a raw
 * message of the server. A code the server uses but the dictionary does not
 * name is mapped to the code that describes it, and only a code that nothing
 * describes becomes the generic connection failure.
 */

import { ApiRequestError } from '../api/http';
import { isPreparationFailure } from './pdfAssets';

/** The codes the approved dictionary of the extraction knows. */
const approvedErrorCodes = new Set<string>([
  'processing_not_authorized', 'extraction_disabled', 'unconfigured', 'policy_unavailable',
  'provider_auth', 'provider_balance', 'provider_policy', 'provider_rate_limit',
  'provider_unavailable', 'extraction_timeout', 'invalid_image', 'preparation_limit',
  'preparation_unavailable', 'unsupported_file', 'incomplete_pages', 'invalid_result',
  'extraction_conflict', 'busy', 'network_error', 'unauthenticated', 'forbidden',
  'origin_forbidden', 'invalid_request', 'request_too_large', 'unsupported_encoding',
  'invalid_provider',
]);

/** The codes of the server and of the preparation that lead to another code. */
const approvedErrorFallbacks: Record<string, string> = {
  payload_too_large: 'request_too_large', bad_request: 'invalid_request',
  extraction_invalid_request: 'invalid_request', extraction_invalid_response: 'invalid_result',
  provider_malformed_response: 'invalid_result', invalid_model: 'provider_unavailable',
  service_unavailable: 'provider_unavailable', preparation_encrypted: 'unsupported_file',
  preparation_invalid: 'invalid_image', preparation_timeout: 'extraction_timeout',
  extraction_rate_limit: 'provider_rate_limit', http_error: 'network_error',
  upload_failed: 'network_error', provider_not_configured: 'unconfigured',
  not_configured: 'unconfigured', disabled: 'extraction_disabled',
  not_authorized: 'processing_not_authorized', not_approved: 'processing_not_authorized',
  invalid_origin: 'origin_forbidden',
  // A changed setting, a changed catalogue and a changed account are the same
  // conflict for the form: the answer says so instead of hiding the reason
  // behind a connection failure.
  stale_settings: 'extraction_conflict', stale_catalog: 'extraction_conflict',
  account_mismatch: 'extraction_conflict',
  // A body that is not plain JSON is a refused request, not a broken network.
  unsupported_media_type: 'invalid_request',
};

/**
 * Reports whether a code of the server is one the dictionary knows.
 *
 * A refusal that carries a known reason keeps that reason, a refusal without
 * one stays a plain refusal and never leaks the reason the server sent.
 */
export function isApprovedErrorCode(code: string): boolean {
  return (
    approvedErrorCodes.has(code) ||
    Object.prototype.hasOwnProperty.call(approvedErrorFallbacks, code)
  );
}

/**
 * Maps a code of the server or of the preparation to an approved code.
 *
 * Only the codes of the approved dictionary reach a form, so the panel always
 * finds a string for the failure it shows and never a raw message.
 */
export function approvedErrorCode(code: string): string {
  if (approvedErrorCodes.has(code)) return code;
  return Object.prototype.hasOwnProperty.call(approvedErrorFallbacks, code)
    ? approvedErrorFallbacks[code]
    : 'network_error';
}

/**
 * Reads the sanitized code of a failure. The code of a preparation failure is
 * the message of its error, because the preparation raises bounded codes.
 */
export function failureCodeOf(error: unknown): string {
  if (error instanceof ApiRequestError) return approvedErrorCode(error.code);
  if (error instanceof Error && isPreparationFailure(error)) return approvedErrorCode(error.message);
  return 'network_error';
}
