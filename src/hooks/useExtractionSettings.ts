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
  type ModelCatalogEntry,
  type ModelChoice,
} from '@/lib/api/documentExtraction';
import {
  loadCandidates,
  loadCatalog,
  settingsError,
  type CandidateReason,
  type ExtractionProvider,
} from '@/lib/api/extractionSettings';
import { request } from '@/lib/api/http';

export {
  EXTRACTION_ERROR_CODES,
  type CandidateReason,
  type ExtractionProvider,
} from '@/lib/api/extractionSettings';

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
  /** The full catalog of the selected provider, approved first. */
  catalog: ModelCatalogEntry[];
  /** `live` when the catalog came from the provider, `local` otherwise. */
  catalogSource: 'live' | 'local' | null;
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

/** The answer of a settings write. */
const settingsUpdateSchema = z.object({
  updated: z.array(z.string().max(128)).max(10),
  rejected: z.array(z.object({ key: z.string().max(128), reason: z.string().max(512) }).strict()).max(10),
}).strict();

/** Reports whether the provider of the editor is configured. */
function isConfigured(status: ExtractionStatus | null, provider: ExtractionProvider | ''): boolean {
  if (!status || !provider) return false;
  return status.configured[provider];
}

/**
 * Reports whether the model of the editor is an approved choice of the current
 * offline list. A failed or refusing candidate list offers no choice; the
 * separately fetched full catalogue must also settle before enabling.
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
 * Reports whether the catalogue refuses the selected model.
 *
 * A catalogue that knows the model and does not approve it refuses it, whatever
 * the offline candidates and the saved value say: neither of them is a fresh
 * approval, so they never override a known refusal of the catalogue.
 */
function isRefusedByCatalog(
  catalog: ModelCatalogEntry[],
  provider: ExtractionProvider | '',
  model: string,
): boolean {
  if (!provider || !model) return false;
  const entry = catalog.find((item) => item.id === model && item.provider === provider);
  return entry !== undefined && entry.status !== 'approved';
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
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [catalogPending, setCatalogPending] = useState(true);
  const [catalogSource, setCatalogSource] = useState<'live' | 'local' | null>(null);
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
  // Only an actual catalogue settlement permits failure recovery.
  const catalogSettledRef = useRef(false);
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
    setCatalog([]);
    setCatalogSource(null);
    setCatalogPending(true);
    catalogSettledRef.current = false;
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

  // The offline catalogue and the full model catalog of the selected provider.
  // A catalogue of another provider never replaces the current one.
  useEffect(() => {
    const provider = editor.provider;
    if (!provider) {
      setCandidates([]);
      setCandidateReason(null);
      setCatalog([]);
      setCatalogSource(null);
      return;
    }

    const epoch = epochRef.current;
    const controller = new AbortController();
    let active = true;
    setCandidates([]);
    setCandidateReason(null);
    setCatalog([]);
    setCatalogSource(null);
    setCatalogPending(true);

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

    void loadCatalog(provider, controller.signal)
      .then((listing) => {
        if (!active || epoch !== epochRef.current) return;
        setCatalog(listing.entries);
        setCatalogSource(listing.verification);
        catalogSettledRef.current = true;
        setCatalogPending(false);
        setEditor(current => isRefusedByCatalog(listing.entries, provider, current.model) ? { ...current, enabled: false } : current);
      })
      .catch((cause) => {
        if (!active || epoch !== epochRef.current) return;
        // The full catalog fails soft: the approved candidates stay, so a
        // broken listing never erases a selection.
        setCatalog([]);
        setCatalogSource(null);
        catalogSettledRef.current = true;
        setCatalogPending(false);
        if (epoch !== epochRef.current) return;
        setError(settingsError('catalog_unavailable', cause));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [editor.provider]);

  // Pending full-catalogue reads block enabling and enabled writes. Once a read
  // fails, approved offline candidates remain the intentional fail-soft path;
  // a settled catalogue refusal always vetoes that fallback. The server still
  // performs fresh policy validation before any activation.
  const canEnable =
    status !== null &&
    statusLoaded &&
    !catalogPending &&
    status.processingAuthorized &&
    editor.provider !== '' &&
    editor.model !== '' &&
    isConfigured(status, editor.provider) &&
    isApprovedChoice(candidates, candidateReason, editor.provider, editor.model) &&
    !isRefusedByCatalog(catalog, editor.provider, editor.model);

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
    setCatalogPending(true);
    catalogSettledRef.current = false;
    setEditor((current) => ({ ...current, provider, model: '' }));
    setCandidates([]);
    setCandidateReason(null);
    setCatalog([]);
    setCatalogSource(null);
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
    setCatalogPending(true);
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
        if (!provider) { setCatalogPending(false); return; }
        const candidatesPromise = loadCandidates(provider, controller.signal)
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
        // Candidates become usable only after this catalogue settles; a failed
        // read then retains the approved-candidate fallback, never a refusal.
        const catalogPromise = loadCatalog(provider, controller.signal)
          .then((listing) => {
            if (epoch !== epochRef.current || controller.signal.aborted) return;
            setCatalog(listing.entries);
            setCatalogSource(listing.verification);
            catalogSettledRef.current = true;
            setCatalogPending(false);
            setEditor(current => isRefusedByCatalog(listing.entries, provider, current.model) ? { ...current, enabled: false } : current);
          })
          .catch((cause) => {
            if (epoch !== epochRef.current || controller.signal.aborted) return;
            setCatalog([]);
            setCatalogSource(null);
            catalogSettledRef.current = true;
            setCatalogPending(false);
            setError(settingsError('catalog_unavailable', cause));
          });
        return Promise.all([candidatesPromise, catalogPromise]);
      })
      .catch((cause) => {
        if (epoch !== epochRef.current || controller.signal.aborted) return;
        setCatalogPending(!catalogSettledRef.current);
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
    if (!statusLoaded || status === null || (editor.enabled && !canEnable)) return;
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
  }, [accountId, editor, status, statusLoaded, canEnable]);

  return {
    status,
    statusLoaded,
    editor,
    candidates,
    candidateReason,
    catalog,
    catalogSource,
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
