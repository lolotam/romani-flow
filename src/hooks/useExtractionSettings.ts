/**
 * The settings of the AI document extraction.
 *
 * The hook owns the three preferences an administrator may change: the
 * provider, the model and the enabled flag. It reads the status of the
 * extraction, reads the offline catalogue of the candidates and writes the
 * three preferences in one atomic request.
 *
 * Every answer belongs to an account, to a provider and to a request. A
 * response of a former account, of a former provider or of a former request is
 * refused, so a late answer can never replace a newer selection.
 *
 * The catalogue is a local list of approved models, never a proof that a
 * provider still serves them. The hook therefore never chooses a model on its
 * own and never enables the extraction on its own: both are explicit acts of
 * the administrator. It never writes before the authoritative status is known,
 * because such a write would send the empty defaults of the editor and would
 * erase the settings of the administrator without ever showing them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  getExtractionStatus,
  type ExtractionStatus,
  type ModelChoice,
} from '@/lib/api/documentExtraction';
import { request } from '@/lib/api/http';

/** The providers the extraction may use. */
export type ExtractionProvider = 'groq' | 'openrouter';

/** The reasons a catalogue may answer with. */
const CANDIDATE_REASONS = [
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

/** The values the administrator edits. */
export interface ExtractionSettingsEditor {
  enabled: boolean;
  provider: ExtractionProvider | '';
  model: string;
}

/** The state of the extraction settings. */
export interface ExtractionSettingsState {
  status: ExtractionStatus | null;
  /** Reports whether the authoritative status of the extraction is known. */
  statusLoaded: boolean;
  editor: ExtractionSettingsEditor;
  candidates: ModelChoice[];
  candidateReason: CandidateReason | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  /** Reports whether the extraction may be enabled by the administrator. */
  canEnable: boolean;
  setEnabled(enabled: boolean): void;
  setProvider(provider: ExtractionProvider | ''): void;
  setModel(model: string): void;
  refresh(): void;
  save(): void;
}

/** The empty editor, before the status of the extraction is known. */
const EMPTY_EDITOR: ExtractionSettingsEditor = { enabled: false, provider: '', model: '' };

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
const modelChoiceSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(128),
  provider: z.enum(['groq', 'openrouter']),
  maxImages: z.number().int().min(1),
}).strict().refine(
  (value) => value.maxImages <= PROVIDER_MAX_IMAGES[value.provider],
  'the model claims more images than its provider accepts',
);

/** The answer of the offline catalogue of one provider. */
const candidateListingSchema = z.object({
  verification: z.literal('offline'),
  candidates: z.array(modelChoiceSchema).max(50),
  reason: z.enum(CANDIDATE_REASONS),
}).strict().refine(
  (value) => value.candidates.length === 0 ? value.reason !== 'locally_approved' : value.reason === 'locally_approved',
  'the reason must agree with the list of the candidates',
);

/** The answer of a settings write. */
const settingsUpdateSchema = z.object({
  updated: z.array(z.string().max(128)).max(10),
  rejected: z.array(z.object({ key: z.string().max(128), reason: z.string().max(512) }).strict()).max(10),
}).strict();

/** Creates the failure of the settings with a code the copy knows. */
function settingsError(code: (typeof EXTRACTION_ERROR_CODES)[number], cause?: unknown): Error {
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
async function loadCandidates(
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

/** Reports whether the provider of the editor is configured. */
function isConfigured(status: ExtractionStatus | null, provider: ExtractionProvider | ''): boolean {
  if (!status || !provider) return false;
  return status.configured[provider];
}

/**
 * Reports whether the model of the editor is an approved choice of the current
 * catalogue. A catalogue that is still loading, that failed or that refuses
 * with another reason never offers a choice, so nothing can be enabled from
 * it.
 */
function isApprovedChoice(
  candidates: ModelChoice[],
  reason: CandidateReason | null,
  provider: ExtractionProvider | '',
  model: string,
): boolean {
  if (reason !== 'locally_approved') return false;
  if (!provider || !model) return false;
  return candidates.some((candidate) => candidate.id === model && candidate.provider === provider);
}

/**
 * Owns the settings of the AI document extraction. The account owns the
 * settings: a change of the account starts from an empty editor and refuses
 * every answer that belongs to the former one.
 */
export function useExtractionSettings(accountId: string | null, refreshKey = 0): ExtractionSettingsState {
  const [status, setStatus] = useState<ExtractionStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [editor, setEditor] = useState<ExtractionSettingsEditor>(EMPTY_EDITOR);
  const [candidates, setCandidates] = useState<ModelChoice[]>([]);
  const [candidateReason, setCandidateReason] = useState<CandidateReason | null>(null);
  const [loading, setLoading] = useState(accountId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [statusTick, setStatusTick] = useState(0);

  /**
   * The epoch of the current identity. It changes with the account, with the
   * provider and with every explicit refresh: every answer of a status, of a
   * catalogue or of a refresh carries the epoch of its request and is refused
   * when the epoch moved on.
   */
  const epochRef = useRef(0);
  /**
   * The token of the current write. It changes with the account and with the
   * provider, so a result of a write never reaches the editor of another
   * account or of another provider.
   */
  const writeTokenRef = useRef(0);
  /**
   * The epoch of the current editor. It changes with every change of the
   * editor, so the result of a write never reaches an editor that the
   * administrator has changed in the meantime.
   */
  const editorEpochRef = useRef(0);
  const seededRef = useRef(false);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);

  /** Aborts the requests that a change of the account makes obsolete. */
  const abortPending = useCallback(() => {
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
  }, []);

  // A new account starts from an empty editor: nothing of a former account
  // may survive the change.
  useEffect(() => {
    epochRef.current += 1;
    writeTokenRef.current += 1;
    editorEpochRef.current += 1;
    seededRef.current = false;
    abortPending();
    setStatus(null);
    setStatusLoaded(false);
    setEditor(EMPTY_EDITOR);
    setCandidates([]);
    setCandidateReason(null);
    setError(null);
    setSaving(false);
    setLoading(accountId !== null);
  }, [accountId, abortPending]);

  useEffect(() => abortPending, [abortPending]);

  // The status of the extraction. The answer of a former account is refused.
  useEffect(() => {
    if (!accountId) return;
    const epoch = epochRef.current;
    const controller = new AbortController();
    let active = true;

    void getExtractionStatus(controller.signal)
      .then((next) => {
        if (!active || epoch !== epochRef.current) return;
        setStatus(next);
        setStatusLoaded(true);
        // The editor keeps the values of the administrator. It only takes the
        // values of the server while nobody has touched it yet.
        if (seededRef.current) return;
        seededRef.current = true;
        editorEpochRef.current += 1;
        setEditor({ enabled: next.enabled, provider: next.provider, model: next.model });
      })
      .catch((cause) => {
        if (!active || epoch !== epochRef.current) return;
        setStatusLoaded(false);
        setError(settingsError('status_unavailable', cause));
      })
      .finally(() => {
        if (active && epoch === epochRef.current) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, refreshKey, statusTick]);

  // The offline catalogue of the selected provider. A catalogue of another
  // provider never replaces the current one.
  useEffect(() => {
    const provider = editor.provider;
    if (!provider) {
      setCandidates([]);
      setCandidateReason(null);
      return;
    }

    const epoch = epochRef.current;
    const controller = new AbortController();
    let active = true;
    setCandidates([]);
    setCandidateReason(null);

    void loadCandidates(provider, controller.signal)
      .then((listing) => {
        if (!active || epoch !== epochRef.current) return;
        setCandidates(listing.candidates);
        setCandidateReason(listing.reason);
      })
      .catch((cause) => {
        if (!active || epoch !== epochRef.current) return;
        // A catalogue that could not be read is no catalogue: it never
        // advertises an approved choice.
        setCandidates([]);
        setCandidateReason(null);
        setError(settingsError('catalog_unavailable', cause));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [editor.provider]);

  // The extraction may only be enabled by an explicit act of the administrator
  // and only when the environment allows it. The catalogue has to be the
  // current one, it has to be approved locally and the chosen model has to
  // belong to it. A catalogue that is still loading, a catalogue that failed
  // and a model that the catalogue does not know never allow an activation.
  const canEnable =
    status !== null &&
    statusLoaded &&
    status.processingAuthorized &&
    editor.provider !== '' &&
    editor.model !== '' &&
    isConfigured(status, editor.provider) &&
    isApprovedChoice(candidates, candidateReason, editor.provider, editor.model);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      // Switching on is only possible with a usable catalogue. Switching off is
      // always possible: the administrator may stop the extraction without
      // choosing a provider or a model first.
      if (enabled && !canEnable) return;
      seededRef.current = true;
      editorEpochRef.current += 1;
      setEditor((current) => ({ ...current, enabled }));
    },
    [canEnable],
  );

  const setProvider = useCallback((provider: ExtractionProvider | '') => {
    seededRef.current = true;
    // A new provider is a new identity: every answer of the former provider is
    // obsolete and the refresh of the former provider is stopped.
    epochRef.current += 1;
    writeTokenRef.current += 1;
    editorEpochRef.current += 1;
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    setEditor((current) => ({ ...current, provider, model: '' }));
    setCandidates([]);
    setCandidateReason(null);
    setError(null);
  }, []);

  const setModel = useCallback((model: string) => {
    seededRef.current = true;
    editorEpochRef.current += 1;
    setEditor((current) => ({ ...current, model }));
    setError(null);
  }, []);

  /**
   * Refreshes the catalogue of the selected provider. The refresh only reads:
   * it never activates a provider, never chooses a model and never changes the
   * selection of the administrator. It carries the epoch of its request, so a
   * refresh that is overtaken by another refresh or by a change of the provider
   * writes nothing at all.
   */
  const refresh = useCallback(() => {
    if (!accountId) return;
    epochRef.current += 1;
    const epoch = epochRef.current;
    const controller = new AbortController();
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = controller;
    const selected = editor.provider;
    const seeded = seededRef.current;
    setError(null);

    void getExtractionStatus(controller.signal)
      .then((next) => {
        if (epoch !== epochRef.current || controller.signal.aborted) return;
        setStatus(next);
        setStatusLoaded(true);
        if (!seeded) {
          seededRef.current = true;
          editorEpochRef.current += 1;
          setEditor({ enabled: next.enabled, provider: next.provider, model: next.model });
        }
        // The catalogue belongs to the provider of the editor. A provider that
        // was never chosen has no catalogue.
        const provider = selected || (seeded ? '' : (next.provider as ExtractionProvider | ''));
        if (!provider) return;
        return loadCandidates(provider, controller.signal)
          .then((listing) => {
            if (epoch !== epochRef.current || controller.signal.aborted) return;
            setCandidates(listing.candidates);
            setCandidateReason(listing.reason);
          })
          .catch((cause) => {
            if (epoch !== epochRef.current || controller.signal.aborted) return;
            setCandidates([]);
            setCandidateReason(null);
            setError(settingsError('catalog_unavailable', cause));
          });
      })
      .catch((cause) => {
        if (epoch !== epochRef.current || controller.signal.aborted) return;
        setError(settingsError('status_unavailable', cause));
      });
  }, [accountId, editor.provider]);

  /**
   * Writes the three preferences in one request. The write only happens when
   * the authoritative status is known: a write while the status is still
   * loading would send the empty defaults of the editor and would erase the
   * settings of the administrator. A refusal keeps the editor as it is, so the
   * administrator sees the reason and decides again.
   */
  const save = useCallback(() => {
    if (!accountId) return;
    if (!statusLoaded || status === null) return;
    const token = writeTokenRef.current;
    const editorEpoch = editorEpochRef.current;
    const snapshot = editor;
    const controller = new AbortController();
    saveAbortRef.current?.abort();
    saveAbortRef.current = controller;
    setSaving(true);
    setError(null);

    void request<unknown>('/api/settings', {
      method: 'PUT',
      body: {
        settings: {
          'ai_extraction.enabled': snapshot.enabled,
          'ai_extraction.provider': snapshot.provider,
          'ai_extraction.model': snapshot.model,
        },
      },
      signal: controller.signal,
    })
      .then(({ data, error: failure }) => {
        if (token !== writeTokenRef.current) return;
        if (failure) {
          // A refusal of another editor identity is not shown: it belongs to a
          // selection that is not the one on the screen anymore.
          if (editorEpochRef.current !== editorEpoch) return;
          setError(failure);
          return;
        }
        const parsed = settingsUpdateSchema.safeParse(data);
        if (!parsed.success) {
          setError(settingsError('invalid_response', parsed.error));
          return;
        }
        setStatusTick((tick) => tick + 1);
      })
      .catch((cause) => {
        if (token !== writeTokenRef.current) return;
        if (editorEpochRef.current !== editorEpoch) return;
        setError(settingsError('invalid_response', cause));
      })
      .finally(() => {
        // The write of the moment always ends: the button never stays blocked
        // by a write that was overtaken.
        if (saveAbortRef.current === controller) {
          saveAbortRef.current = null;
          setSaving(false);
        }
      });
  }, [accountId, editor, status, statusLoaded]);

  return {
    status,
    statusLoaded,
    editor,
    candidates,
    candidateReason,
    loading,
    saving,
    error,
    canEnable,
    setEnabled,
    setProvider,
    setModel,
    refresh,
    save,
  };
}
