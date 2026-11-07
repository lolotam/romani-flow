/**
 * The asynchronous lifecycle of one document extraction.
 *
 * The hook owns the whole life of an extraction inside a document form: the
 * single automatic attempt of a selected attachment, the local preparation of
 * the pages, the request, the review of the candidates and every reason that
 * ends an attempt early. The provenance of the values is the job of
 * `ExtractionSession`, the rules of the module are the job of the session
 * module, the pages are the job of the preparation and the wire format is the
 * job of the API wrapper.
 *
 * Every asynchronous boundary of an attempt compares the live options of the
 * form with the identity the attempt started for. A changed account, a changed
 * scope, a changed context, another file object, a closed form and a form that
 * is not ready any more end the attempt, even when React has not rendered the
 * change yet. The values of the form are read and written through the
 * callbacks of the moment, so a form that changed its callbacks is never
 * served with an answer that belongs to an older form.
 *
 * Nothing here is persisted. The candidates live in the memory of the
 * component until the attachment is replaced or the form is closed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ExtractionResult, type Field, type Values } from '../../server/contracts/documentExtraction';
import { extractDocument, getExtractionStatus, type ExtractionStatus } from '../lib/api/documentExtraction';
import { prepareDocument, type PreparedDocument } from '../lib/extraction/prepare';
import {
  acceptedCandidateValue,
  createRequestId,
  describeFailure,
  eligibleSuggestions,
  ExtractionSession,
  matchesLiveForm,
  matchesRequest,
  refusalOf,
  supportedCandidates,
  type AttemptIdentity,
  type ExtractionTicket,
} from '../lib/extraction/session';

/** The states the extraction of a form can be in. */
export type ExtractionPhase =
  | 'idle'
  | 'preparing'
  | 'extracting'
  | 'review'
  | 'failed'
  | 'cooldown'
  | 'cancelled'
  | 'unavailable';

/** The normalized candidates of one answer. */
export type ExtractionFields = Partial<ExtractionResult['fields']>;

/**
 * The options a document form gives to the hook.
 *
 * `context` is the local identity of the form and is never sent to the
 * server; the processing context of the request always comes from the status
 * of the server. `ready` means that the draft of the form finished loading.
 */
export interface DocumentExtractionOptions {
  account: string | null;
  scope: string;
  context: string;
  file: File | null;
  ready: boolean;
  open: boolean;
  values: () => Values;
  apply: (patch: Partial<Values>) => void;
  supported: Field[];
  onStart: () => void;
}

/** The state a document form receives from the hook. */
export interface DocumentExtractionState {
  phase: ExtractionPhase;
  fields: ExtractionFields | null;
  errorCode: string | null;
  retryAfterSeconds: number;
  manual: (field: Field) => void;
  protect: (fields: Field[]) => void;
  replace: () => void;
  invalidate: () => void;
  reset: () => void;
  retry: () => void;
  cancel: () => void;
  accept: (field: Field, value: string) => boolean;
}

/** Everything one attempt needs from the hook while it runs. */
interface AttemptRuntime {
  identity: AttemptIdentity;
  session: ExtractionSession;
  signal: AbortSignal;
  /** The options of the form of the moment, never a snapshot of the start. */
  live: () => DocumentExtractionOptions;
  /** Reports whether the attempt still belongs to the form of the moment. */
  belongs: () => boolean;
  /** Enters the phase of the running request. */
  enterExtracting: () => void;
}

/** The way an attempt ended. */
type AttemptOutcome =
  | { kind: 'obsolete' }
  | { kind: 'unavailable' }
  | { kind: 'stale' }
  | { kind: 'changed'; code: string }
  | { kind: 'review'; ticket: ExtractionTicket; result: ExtractionResult };

/**
 * The number of every distinct file object a form selected.
 *
 * Two files with the same name, the same size and the same modification time
 * are still two different selections, so the identity of a selection is the
 * identity of the object and never its metadata.
 */
const fileTokens = new WeakMap<File, number>();
let lastFileToken = 0;

/**
 * Reads the number of a selected file.
 *
 * The same file object always carries the same number, so a selection is
 * recognised by the object it handed to the form.
 */
function tokenOfFile(file: File | null): number {
  if (!file) return 0;
  const known = fileTokens.get(file);
  if (known !== undefined) return known;
  lastFileToken += 1;
  fileTokens.set(file, lastFileToken);
  return lastFileToken;
}

/**
 * Runs the extraction of one document form.
 *
 * One selection of one attachment causes at most one automatic attempt. Every
 * further attempt is an explicit retry of the administrator, so a failure
 * never becomes a loop and a rate limit is never worked around.
 */
export function useDocumentExtraction(options: DocumentExtractionOptions): DocumentExtractionState {
  const [phase, setPhase] = useState<ExtractionPhase>('idle');
  const [fields, setFields] = useState<ExtractionFields | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  const sessionRef = useRef<ExtractionSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = new ExtractionSession();

  /** The latest options, so the callbacks of the hook never change. */
  const latestOptions = useRef(options);
  latestOptions.current = options;

  const fieldsRef = useRef<ExtractionFields | null>(null);
  fieldsRef.current = fields;
  const fieldsIdentityRef = useRef<AttemptIdentity | null>(null);

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef<string | null>(null);
  const identityRef = useRef<string | null>(null);
  const cooldownUntilRef = useRef(0);

  const identity = `${options.account ?? ''}|${options.scope}|${options.context}|${tokenOfFile(options.file)}`;

  /**
   * Ends the running attempt. The generation rises before anything is
   * awaited, so an answer that is already on its way can no longer be
   * written.
   */
  const endRunningAttempt = useCallback((): void => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current?.invalidate();
  }, []);

  /** Ends the attempt and drops the candidates of the finished attempt. */
  const stopAttempt = useCallback((next: ExtractionPhase): void => {
    endRunningAttempt();
    fieldsIdentityRef.current = null;
    setFields(null);
    setErrorCode(null);
    setPhase(next);
  }, [endRunningAttempt]);

  /** Runs one attempt and reports how it ended. */
  const runAttempt = useCallback(async (): Promise<void> => {
    const live = latestOptions.current;
    const session = sessionRef.current;
    const selected = live.file;
    const account = live.account;
    if (!selected || !account || !session) return;
    if (!live.open || !live.ready) return;

    const attempt: AttemptIdentity = {
      account,
      scope: live.scope,
      context: live.context,
      file: selected,
    };

    generationRef.current += 1;
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setErrorCode(null);
    setFields(null);
    fieldsIdentityRef.current = null;
    setPhase('preparing');

    const runtime: AttemptRuntime = {
      identity: attempt,
      session,
      signal: controller.signal,
      live: () => latestOptions.current,
      belongs: () =>
        generation === generationRef.current && matchesLiveForm(attempt, latestOptions.current),
      enterExtracting: () => setPhase('extracting'),
    };

    try {
      const outcome = await performAttempt(runtime);
      if (!runtime.belongs()) return;
      if (outcome.kind === 'obsolete') return;
      if (outcome.kind === 'unavailable') {
        setPhase('unavailable');
        return;
      }
      if (outcome.kind === 'stale') {
        setErrorCode('invalid_result');
        setPhase('failed');
        return;
      }
      if (outcome.kind === 'changed') {
        session.invalidate();
        setErrorCode(outcome.code);
        setPhase('failed');
        return;
      }
      fieldsIdentityRef.current = attempt;
      setFields(supportedCandidates(outcome.result.fields, latestOptions.current.supported));
      setPhase('review');
    } catch (error) {
      if (!runtime.belongs()) return;
      const failure = describeFailure(error);
      setErrorCode(failure.errorCode);
      setPhase(failure.phase);
      if (failure.retryAfterSeconds !== null) {
        cooldownUntilRef.current = Date.now() + failure.retryAfterSeconds * 1000;
        setRetryAfterSeconds(failure.retryAfterSeconds);
      }
    }
  }, []);

  /** Ends the attempt of a changed form, file, account or context. */
  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    attemptRef.current = null;
    stopAttempt('idle');
  }, [identity, stopAttempt]);

  /** Ends the attempt of a closed form. */
  useEffect(() => {
    if (options.open) return;
    attemptRef.current = null;
    stopAttempt('idle');
  }, [options.open, stopAttempt]);

  /** Releases the attempt when the form disappears. */
  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      sessionRef.current?.invalidate();
    },
    [],
  );

  /** Starts the single automatic attempt of the selected attachment. */
  useEffect(() => {
    if (!options.open || !options.ready) return;
    if (!options.file || !options.account) return;
    if (attemptRef.current === identity) return;
    attemptRef.current = identity;
    void runAttempt();
  }, [identity, options.open, options.ready, options.file, options.account, runAttempt]);

  /** Counts the cooldown of the server down to its end. */
  useEffect(() => {
    if (phase !== 'cooldown') return;
    const tick = (): void => {
      const remaining = Math.max(0, Math.ceil((cooldownUntilRef.current - Date.now()) / 1000));
      setRetryAfterSeconds(remaining);
      if (remaining === 0) setPhase('failed');
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  /** Records an administrator action on one field. */
  const manual = useCallback((field: Field): void => {
    sessionRef.current?.manual(field);
  }, []);

  /** Protects the fields a draft or a stored document carries. */
  const protect = useCallback((restored: Field[]): void => {
    sessionRef.current?.protect(restored);
  }, []);

  /**
   * Ends the attachment of the form. Only the values the machine filled and
   * that nobody changed afterwards are cleared.
   */
  const replace = useCallback((): void => {
    const session = sessionRef.current;
    endRunningAttempt();
    if (session) {
      const form = latestOptions.current;
      const clears = session.replace(form.values());
      if (Object.keys(clears).length > 0) form.apply(clears);
    }
    setFields(null);
    fieldsIdentityRef.current = null;
    setErrorCode(null);
    setPhase('idle');
  }, [endRunningAttempt]);

  /** Ends the attempt without touching the values of the form. */
  const invalidate = useCallback((): void => {
    stopAttempt('idle');
  }, [stopAttempt]);

  /** Starts a genuinely new form session. */
  const reset = useCallback((): void => {
    stopAttempt('idle');
    sessionRef.current?.reset();
    attemptRef.current = null;
  }, [stopAttempt]);

  /** Cancels the running attempt. */
  const cancel = useCallback((): void => {
    stopAttempt('cancelled');
  }, [stopAttempt]);

  /**
   * Runs another attempt after a failure or a cooldown.
   *
   * The retry invalidates the previous ticket first, so the answer of the
   * previous request can never arrive any more. A closed form and a form that
   * is not ready make no request at all, and no retry ever happens on its own.
   */
  const retry = useCallback((): void => {
    sessionRef.current?.invalidate();
    if (cooldownUntilRef.current > Date.now()) return;
    const form = latestOptions.current;
    if (!form.open || !form.ready) return;
    if (!form.file || !form.account) return;
    attemptRef.current = identityRef.current;
    void runAttempt();
  }, [runAttempt]);

  /**
   * Writes a candidate the administrator chose explicitly. The candidate has
   * to be one the server proposed, the form has to support the field and the
   * value has to be valid for the field. The accepted field becomes owned by
   * the administrator, so no later attempt may change it.
   */
  const accept = useCallback((field: Field, value: string): boolean => {
    const session = sessionRef.current;
    const candidates = fieldsRef.current;
    if (!session || !candidates) return false;
    const form = latestOptions.current;
    const candidateIdentity = fieldsIdentityRef.current;
    if (!candidateIdentity || !matchesLiveForm(candidateIdentity, form)) return false;
    if (!form.supported.includes(field)) return false;
    const candidate = candidates[field];
    if (!candidate) return false;
    const accepted = acceptedCandidateValue(field, value, candidate);
    if (accepted === null) return false;
    session.manual(field);
    form.apply({ [field]: accepted });
    return true;
  }, []);

  return useMemo<DocumentExtractionState>(
    () => ({
      phase, fields, errorCode, retryAfterSeconds, manual, protect, replace,
      invalidate, reset, retry, cancel, accept,
    }),
    [
      phase, fields, errorCode, retryAfterSeconds, manual, protect, replace,
      invalidate, reset, retry, cancel, accept,
    ],
  );
}

/**
 * Runs the whole attempt outside of the hook.
 *
 * The status is read first, every page of the document is prepared locally
 * and only then the request is sent, in the phase of the running request.
 * Before the answer is accepted the status is read again, so a changed
 * setting, a changed catalog and a lost authority are noticed instead of
 * applied. The attempt stops as soon as it no longer belongs to the form.
 */
async function performAttempt(runtime: AttemptRuntime): Promise<AttemptOutcome> {
  const { session, signal, live, belongs } = runtime;

  const status = await getExtractionStatus(signal);
  if (!belongs()) return { kind: 'obsolete' };
  if (!status.available || !status.processingAuthorized || !status.processingContext) {
    return { kind: 'unavailable' };
  }

  const form = live();
  form.onStart();
  const ticket = session.begin(runtime.identity.context, form.values());
  const prepared = await prepareDocument(runtime.identity.file, signal, status.maxSourceBytes);
  if (!belongs()) return { kind: 'obsolete' };

  const requestId = createRequestId();
  runtime.enterExtracting();
  const result = await sendExtractionRequest(
    { requestId, identity: runtime.identity, status, prepared },
    signal,
  );
  if (!belongs()) return { kind: 'obsolete' };
  if (!matchesRequest(result, requestId, status)) return { kind: 'stale' };

  const fresh = await getExtractionStatus(signal);
  if (!belongs()) return { kind: 'obsolete' };
  const refusal = refusalOf(fresh, status);
  if (refusal !== null) return { kind: 'changed', code: refusal };

  const current = live();
  const patch = session.apply(
    ticket,
    eligibleSuggestions(result.fields, current.supported),
    current.values(),
  );
  if (Object.keys(patch).length > 0) current.apply(patch);
  return { kind: 'review', ticket, result };
}

/**
 * Sends the prepared pages to the extraction.
 *
 * The request carries the processing context and both versions of the status,
 * so the server can refuse an answer of another generation.
 */
function sendExtractionRequest(
  plan: {
    requestId: string;
    identity: AttemptIdentity;
    status: ExtractionStatus;
    prepared: PreparedDocument;
  },
  signal: AbortSignal,
): Promise<ExtractionResult> {
  return extractDocument(
    {
      requestId: plan.requestId,
      scope: plan.identity.scope,
      context: plan.status.processingContext,
      settingsVersion: plan.status.settingsVersion,
      catalogVersion: plan.status.catalogVersion,
      pageCount: plan.prepared.pageCount,
      images: plan.prepared.images,
    },
    plan.identity.account,
    signal,
  );
}
