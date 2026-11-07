/**
 * The provenance of one document form session.
 *
 * The class remembers which values of a form a machine filled, which values
 * an administrator touched and which request is still allowed to write. It is
 * pure: it holds no timer, it performs no request and it never reads the
 * environment. Every decision it takes is a decision about the values it was
 * given, so the same session always answers the same way.
 *
 * The module holds the rules of the extraction next to the class: the
 * eligibility of the suggestions, the acceptance of an explicit value, the
 * identity of a selection and the vocabulary of the failures. They are pure
 * functions of their arguments, so the hook and the panel share them without
 * sharing any state.
 * The rules it enforces are the rules of the specification:
 *
 * - Only an empty field that no administrator touched since the request
 *   started may be filled automatically.
 * - A deliberate clear and a clear that is followed by an edit back are both
 *   permanent protections for the rest of the form session.
 * - A restored draft value and a stored value of an existing document are
 *   protected as well.
 * - On a replacement of the attachment only the values that the machine
 *   filled and that nobody changed afterwards are cleared.
 * - An answer of an obsolete request never writes anything.
 */

import {
  calendarDate,
  fieldNames,
  type ExtractionResult,
  type Field,
  type Values,
} from '../../../server/contracts/documentExtraction';
import { ApiRequestError } from '../api/http';
import { isPreparationFailure } from './pdfAssets';

/** One attempt at one document. */
export interface ExtractionTicket {
  /** The identity of the attempt. A newer attempt invalidates an older one. */
  id: number;
  /** The form identity the attempt belongs to. */
  context: string;
  /** The values of the form when the attempt started. */
  values: Values;
  /** The version of every field when the attempt started. */
  versions: Record<Field, number>;
}

/** The value the machine wrote into a field. */
interface AppliedValue {
  value: string;
  version: number;
}

/**
 * The provenance controller of one document form.
 *
 * A form creates one session when it opens and keeps it until the form is
 * reset. The session answers three questions for the form: may a suggestion
 * be written, which values have to be cleared when the attachment changes,
 * and is the answer of a request still relevant.
 */
export class ExtractionSession {
  /** The identity of the newest attempt. Every attempt gets the next number. */
  private epoch = 0;

  /** The fields an administrator owns for the rest of the form session. */
  private protectedFields = new Set<Field>();

  /** The number of administrator actions per field. */
  private versions = emptyVersions();

  /** The values the machine filled and still owns. */
  private applied = new Map<Field, AppliedValue>();

  /**
   * Records an administrator action on a field.
   *
   * The field is protected from the first action on it: typing, deleting and
   * restoring the original value all count. The version of the field rises so
   * a request that started before the action can no longer write it.
   */
  manual(field: Field): void {
    this.protectedFields.add(field);
    this.versions[field] += 1;
    this.applied.delete(field);
  }

  /**
   * Protects every field of a list.
   *
   * A restored draft and a stored document pass the keys they carry, so a
   * field that was restored empty is protected as well.
   */
  protect(fields: Field[]): void {
    fields.forEach((field) => this.manual(field));
  }

  /**
   * Invalidates the current attempt without touching the applied values.
   *
   * A close attempt, a discarded draft and a changed account use it: the
   * answer of the running request may not arrive any more, but the values the
   * machine filled are still owned by the machine until they are cleared.
   */
  invalidate(): void {
    this.epoch += 1;
  }

  /**
   * Starts a new attempt.
   *
   * The attempt snapshots the values and the versions of the form, so a
   * later change of the form is visible to the eligibility rules. Every new
   * attempt invalidates the older one.
   */
  begin(context: string, values: Values): ExtractionTicket {
    this.epoch += 1;
    return {
      id: this.epoch,
      context,
      values: { ...values },
      versions: { ...this.versions },
    };
  }

  /**
   * Reports whether an attempt is still the newest one.
   *
   * The answer of an obsolete attempt is refused.
   */
  current(ticket: ExtractionTicket): boolean {
    return ticket.id === this.epoch;
  }

  /**
   * Decides which suggestions may be written.
   *
   * A suggestion is written only when the attempt is current, the field is
   * empty, the field is not protected, the version of the field did not change
   * since the attempt started and the value of the field is still the value
   * of the snapshot. Every written value becomes owned by the machine.
   */
  apply(
    ticket: ExtractionTicket,
    suggestions: Partial<Values>,
    current: Values,
  ): Partial<Values> {
    const patch: Partial<Values> = {};
    if (!this.current(ticket)) return patch;
    for (const field of fieldNames) {
      const value = suggestions[field];
      if (!value) continue;
      if (current[field] !== '') continue;
      if (current[field] !== ticket.values[field]) continue;
      if (this.protectedFields.has(field)) continue;
      if (this.versions[field] !== ticket.versions[field]) continue;
      patch[field] = value;
      this.applied.set(field, { value, version: this.versions[field] });
    }
    return patch;
  }

  /**
   * Ends the attachment of the form.
   *
   * The attempt is invalidated and only the values the machine filled and
   * that nobody changed afterwards are cleared. A value an administrator
   * edited, cleared or accepted stays.
   */
  replace(current: Values): Partial<Values> {
    this.invalidate();
    const patch: Partial<Values> = {};
    for (const [field, applied] of this.applied) {
      if (this.protectedFields.has(field)) continue;
      if (current[field] !== applied.value) continue;
      if (this.versions[field] !== applied.version) continue;
      patch[field] = '';
    }
    this.applied.clear();
    return patch;
  }

  /**
   * Starts a genuinely new form session.
   *
   * A completed save with "add next" and a discarded draft use it. The
   * protections, the versions and the applied values of the old session are
   * gone, so the next document starts untouched.
   */
  reset(): void {
    this.invalidate();
    this.protectedFields.clear();
    this.applied.clear();
    this.versions = emptyVersions();
  }
}

/**
 * Creates the version record of a fresh form.
 *
 * Every field starts at zero, so the first snapshot of a form matches the
 * first snapshot of every other form.
 */
function emptyVersions(): Record<Field, number> {
  return Object.fromEntries(fieldNames.map((field) => [field, 0])) as Record<Field, number>;
}

/**
 * Collects the suggestions a form may take automatically.
 *
 * Only a field the form supports and a value the server marked as clear may
 * be written. The title is never written automatically, because the title of
 * a form usually comes from the name of the selected file and only the
 * administrator may replace it.
 */
export function eligibleSuggestions(
  fields: ExtractionResult['fields'],
  supported: Field[],
): Partial<Values> {
  const suggestions: Partial<Values> = {};
  for (const field of supported) {
    if (field === 'title') continue;
    const candidate = fields[field];
    if (!candidate || candidate.state !== 'clear' || !candidate.value) continue;
    suggestions[field] = candidate.value;
  }
  return suggestions;
}

/**
 * Keeps the candidates of the fields the form supports, so a candidate is
 * never offered for a field the form lacks.
 */
export function supportedCandidates(
  fields: ExtractionResult['fields'],
  supported: Field[],
): Partial<ExtractionResult['fields']> {
  const kept: Partial<ExtractionResult['fields']> = {};
  for (const field of supported) {
    kept[field] = fields[field];
  }
  return kept;
}

/** The fields whose value is the id of an entry of the catalog of the server. */
const catalogFields: readonly Field[] = ['document_type_id', 'ministry_id'];

/**
 * Validates a value the administrator chose from the candidates.
 *
 * A catalog field is stricter than the other fields. The value of such a
 * candidate is the id the server resolved out of the catalog, and the
 * alternatives are the raw labels the pages carried. A label is no id, so only
 * the resolved value may be written and no alternative of a catalog field is
 * ever accepted.
 *
 * Every other field keeps the exact membership in the proposed values and the
 * validation of its kind: a date has to be a real calendar date, a number
 * keeps its leading zeroes and stays a string, and a title stays short.
 */
export function acceptedCandidateValue(
  field: Field,
  value: string,
  candidate: ExtractionResult['fields'][Field],
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (catalogFields.includes(field)) {
    if (candidate.state !== 'clear') return null;
    if (candidate.value === null || candidate.value.trim() !== trimmed) return null;
    return trimmed;
  }

  const known =
    (candidate.value !== null && candidate.value.trim() === trimmed) ||
    candidate.alternatives.some((alternative) => alternative.trim() === trimmed);
  if (!known) return null;
  if (field === 'issue_date' || field === 'expiry_date') return calendarDate(trimmed);
  if (field === 'title') return trimmed.length <= 120 ? trimmed : null;
  if (field === 'document_number') return trimmed.length <= 128 ? trimmed : null;
  return trimmed;
}

/**
 * The identity of one attempt.
 *
 * The identity never changes while the attempt runs: it is the account, the
 * scope, the form context and the very file object the attempt started for.
 */
export interface AttemptIdentity {
  account: string;
  scope: string;
  context: string;
  file: File;
}

/** The parts of the form an attempt compares before it writes anything. */
export interface LiveFormState {
  account: string | null;
  scope: string;
  context: string;
  file: File | null;
  open: boolean;
  ready: boolean;
}

/**
 * Reports whether the form still is the form the attempt started for.
 *
 * The comparison uses the live state of the form, so a changed account, a
 * changed scope, a changed context, another file object, a closed form and a
 * form that is not ready any more end the attempt even before React renders
 * the change.
 */export function matchesLiveForm(identity: AttemptIdentity, live: LiveFormState): boolean {
  return (
    live.open === true &&
    live.ready === true &&
    live.account === identity.account &&
    live.scope === identity.scope &&
    live.context === identity.context &&
    live.file === identity.file
  );
}

/**
 * The part of the status the browser compares before it accepts a result.
 *
 * The fields are optional because the shared client type carries them that
 * way; the server always answers with all of them.
 */
export interface ExtractionStatusCheck {
  available?: boolean;
  processingAuthorized?: boolean;
  processingContext?: string;
  settingsVersion?: string;
  catalogVersion?: string;
}

/**
 * Reports why a fresh status refuses the result of an attempt.
 *
 * The versions alone are not enough: a status that is no longer available or
 * no longer authorized refuses the result as well, even when both version
 * strings are unchanged. A refusal never touches the values of the form.
 */
export function refusalOf(
  fresh: ExtractionStatusCheck,
  original: ExtractionStatusCheck,
): string | null {
  if (!fresh.processingAuthorized) return 'processing_not_authorized';
  if (!fresh.available) return 'extraction_disabled';
  if (fresh.processingContext !== original.processingContext) return 'extraction_conflict';
  if (fresh.settingsVersion !== original.settingsVersion) return 'extraction_conflict';
  if (fresh.catalogVersion !== original.catalogVersion) return 'extraction_conflict';
  return null;
}
/**
 * Reports whether an answer belongs to the attempt that asked for it.
 *
 * The request id, the processing context and both versions have to match, so
 * an answer of another attempt or of another generation is refused.
 */
export function matchesRequest(
  result: ExtractionResult,
  requestId: string,
  status: ExtractionStatusCheck,
): boolean {
  return (
    result.requestId === requestId &&
    result.settingsVersion === status.settingsVersion &&
    result.catalogVersion === status.catalogVersion &&
    result.context === status.processingContext
  );
}

/** The phases a failure of an attempt can end it in. */
export type ExtractionFailurePhase = 'cancelled' | 'unavailable' | 'cooldown' | 'failed';

/** The way a failure of an attempt ended it. */
export interface FailureOutcome {
  phase: ExtractionFailurePhase;
  errorCode: string | null;
  retryAfterSeconds: number | null;
}

/** The longest cooldown the server may announce. */
const MAX_RETRY_AFTER_SECONDS = 300;

/** The cooldown the hook assumes when the server announces none. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/**
 * Describes a failure of an attempt.
 *
 * The message of the server is never shown, so only the code of the failure
 * reaches the form. A cancellation is not a failure of the document, and a
 * rate limit becomes a cooldown the administrator has to wait out.
 */
export function describeFailure(error: unknown): FailureOutcome {
  if (isAbortError(error)) return { phase: 'cancelled', errorCode: null, retryAfterSeconds: null };
  if (error instanceof ApiRequestError && error.status === 401) {
    return { phase: 'unavailable', errorCode: 'unauthenticated', retryAfterSeconds: null };
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return { phase: 'unavailable', errorCode: 'forbidden', retryAfterSeconds: null };
  }
  const seconds = retryAfterOf(error);
  if (seconds !== null) {
    return { phase: 'cooldown', errorCode: failureCodeOf(error), retryAfterSeconds: seconds };
  }
  return { phase: 'failed', errorCode: failureCodeOf(error), retryAfterSeconds: null };
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

/**
 * Reads the cooldown the server announced. The seconds are clamped to a
 * bounded range, so a strange answer of the server can neither disable the
 * button forever nor hide a rate limit.
 */
function retryAfterOf(error: unknown): number | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.code !== 'provider_rate_limit' && error.code !== 'extraction_rate_limit') return null;
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  const raw = details?.retryAfterSeconds;
  const seconds =
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}

/** Reports whether a failure is a cancellation and not a failure of the document. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** The codes the approved dictionary of the extraction knows. */
const approvedErrorCodes = new Set<string>([
  'processing_not_authorized', 'extraction_disabled', 'unconfigured', 'policy_unavailable',
  'provider_auth', 'provider_balance', 'provider_policy', 'provider_rate_limit',
  'provider_unavailable', 'extraction_timeout', 'invalid_image', 'preparation_limit',
  'preparation_unavailable', 'unsupported_file', 'incomplete_pages', 'invalid_result',
  'extraction_conflict', 'busy', 'network_error', 'unauthenticated', 'forbidden',
  'origin_forbidden', 'invalid_request', 'request_too_large', 'unsupported_encoding',
]);
/** The codes of the server and of the preparation that lead to another code. */
const approvedErrorFallbacks: Record<string, string> = {
  payload_too_large: 'request_too_large',
  bad_request: 'invalid_request',
  extraction_invalid_request: 'invalid_request',
  extraction_invalid_response: 'invalid_result',
  provider_malformed_response: 'invalid_result',
  invalid_model: 'provider_unavailable',
  service_unavailable: 'provider_unavailable',
  preparation_encrypted: 'unsupported_file',
  preparation_invalid: 'invalid_image',
  preparation_timeout: 'extraction_timeout',
  extraction_rate_limit: 'provider_rate_limit',
  http_error: 'network_error',
  upload_failed: 'network_error',
};

/**
 * Maps a code of the server or of the preparation to an approved code.
 *
 * Only the codes of the approved dictionary reach a form, so the panel always
 * finds a string for the failure it shows and never a raw message.
 */
export function approvedErrorCode(code: string): string {
  if (approvedErrorCodes.has(code)) return code;
  return approvedErrorFallbacks[code] ?? 'network_error';
}

/**
 * Creates the identity of one request. The identity has to be a version 4
 * UUID, because the shared contract refuses anything else.
 */
export function createRequestId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
