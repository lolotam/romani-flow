import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db/connection.js';
import {
  resultSchema,
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionStatus,
  type ModelCatalogListing,
  type ModelChoice,
  type RawPage,
} from '../contracts/documentExtraction.js';
import { normalizePages } from './normalize.js';
import { readCatalogs } from './catalog.js';
import {
  assertCurrent,
  assertPrivacyAttestations,
  describeExtractionStatus,
  eligibleGroq,
  eligibleOpenRouter,
  isUnexpired,
  resolveApprovedSelection,
} from './policy.js';
import { extractBatch, type Selection } from './provider.js';
import { createCandidateCatalogue } from './candidates.js';
import type { CandidateListing, CandidateRequest, CandidateValidation, SelectionAuthority } from './candidates.js';
import { createModelCatalog } from './modelCatalog.js';
import {
  ExtractionError,
  PROVIDER_URLS,
  fetchProviderJson,
  openRouterEndpointsUrl,
  parseModelList,
  parseOpenRouterByok,
  parseOpenRouterEndpoints,
  parseOpenRouterZdr,
  providerError,
  type ExtractionTransport,
  type ProviderClock,
} from './http.js';
import type { Approval, ExtractionConfig } from './config.js';
import { getBoolean, getString } from '../repositories/settings.js';

/**
 * The guarded backend of the extraction pipeline.
 *
 * The service owns the admission, the selection and the batches. It never
 * trusts the request: the provider, the model, the endpoint and the key come
 * from the settings and from the owner approvals, and every one of them is
 * checked again before every outbound call and again before the result is
 * returned.
 */

/** The clock seam of the pipeline. */
export interface ExtractionClock extends ProviderClock {
  now(): number;
}

/** The configuration the service reads. */
export interface ExtractionServiceConfig {
  env: string;
  extraction: ExtractionConfig;
}

/** The public surface of the service. */
export interface ExtractionService {
  status(): ExtractionStatus;
  models(provider: 'groq' | 'openrouter', signal: AbortSignal): Promise<ModelChoice[]>;
  catalog(provider: 'groq' | 'openrouter', signal: AbortSignal): Promise<ModelCatalogListing>;
  candidates(provider: 'groq' | 'openrouter'): CandidateListing;
  run(request: ExtractionRequest, userId: string, signal: AbortSignal): Promise<ExtractionResult>;
  preflight(req: Request, res: Response, next: NextFunction): void;
  acquire(req: Request, res: Response, next: NextFunction): void;
  validateCandidate(request: CandidateRequest): Promise<CandidateValidation>;
  assertCandidateAuthority(authority: SelectionAuthority): string | null;
}

/** The clock of the running process. */
const nativeClock: ExtractionClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** The number of extractions that may run at the same time. */
const MAX_GLOBAL_REQUESTS = 2;

/** The number of extractions one account may run at the same time. */
const MAX_REQUESTS_PER_ACCOUNT = 1;

/** The time the delivery of the body may take. */
const BODY_TIMEOUT_MS = 15_000;

/** The time the whole operation may take. */
const OVERALL_TIMEOUT_MS = 45_000;

/** The time one metadata request may take. */
const METADATA_TIMEOUT_MS = 5_000;

/** The maximum size of one metadata response. */
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

/** The longest cooldown a rate limited provider may impose on one account. */
const MAX_COOLDOWN_SECONDS = 300;

/** The shortest cooldown a rate limited provider may impose on one account. */
const MIN_COOLDOWN_SECONDS = 1;

/** The cooldown of a rate limited provider that names no delay. */
const DEFAULT_COOLDOWN_SECONDS = 30;

/** Builds the failure of a refused operation. */
function failure(code: string, status: number, message: string): ExtractionError {
  return new ExtractionError(code, status, message);
}

/**
 * Creates the extraction service.
 *
 * The transport is injected, so a test never reaches a provider by accident,
 * and the clock is injected as well, so a deadline can be exercised without
 * waiting for it.
 */
export function createExtractionService(
  config: ExtractionServiceConfig,
  db: Db,
  transport: ExtractionTransport,
  clock: ExtractionClock = nativeClock,
): ExtractionService {
  /** The running requests per account. */
  const accountRequests = new Map<string, number>();
  /** The number of running requests. */
  let activeRequests = 0;
  /** The moment until which an account may not reach the provider again. */
  const cooldowns = new Map<string, number>();

  /** The current moment as an ISO timestamp. */
  const now = () => new Date(clock.now()).toISOString();

  /**
   * Reports the remaining cooldown of one account.
   *
   * The cooldown is owned by the server and it is measured with the injected
   * clock, so it cannot be shortened by a client and it expires on its own.
   */
  const cooldownSeconds = (account: string): number => {
    const until = cooldowns.get(account);
    if (until === undefined) return 0;
    const remaining = until - clock.now();
    if (remaining <= 0) {
      cooldowns.delete(account);
      return 0;
    }
    return Math.max(MIN_COOLDOWN_SECONDS, Math.ceil(remaining / 1000));
  };

  /**
   * Starts the cooldown of one account.
   *
   * The delay of the provider is clamped into the accepted range, so a
   * provider can neither hide behind a week nor let the account retry at
   * once. The cooldown is per account: another account stays unaffected.
   */
  const startCooldown = (account: string, retryAfterSeconds: number | undefined): void => {
    const seconds = Math.min(
      MAX_COOLDOWN_SECONDS,
      Math.max(MIN_COOLDOWN_SECONDS, Math.round(retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS)),
    );
    cooldowns.set(account, clock.now() + seconds * 1000);
  };

  /** Reads one metadata document under its own sub deadline. */
  const fetchMetadata = (url: string, key: string, signal: AbortSignal): Promise<unknown> =>
    fetchProviderJson(url, key, signal, clock, METADATA_TIMEOUT_MS, MAX_METADATA_BYTES, transport);

  /**
   * Reads the private key inventory of the routed provider.
   *
   * The listing needs a management key. A workspace without that access stays
   * unavailable: it is never read as an empty inventory, so a missing access
   * can never prove that no private key is attached.
   *
   * A rate limited account keeps its identity through this wrapper: the delay
   * of the provider survives, so the refusal stays a rate limit and not an
   * outage of the provider.
   */
  const fetchByok = async (key: string, signal: AbortSignal): Promise<unknown> => {
    try {
      return await fetchMetadata(PROVIDER_URLS.openRouterByok, key, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ExtractionError && error.code === 'provider_rate_limit') throw error;
      throw providerError('provider_unavailable');
    }
  };

  /** Resolves the selection of the request from the settings and approvals. */
  const resolveSelection = (): { selection: Selection; approval: Approval } => {
    const provider = getString(db, 'ai_extraction.provider');
    const model = getString(db, 'ai_extraction.model');
    if (provider !== 'groq' && provider !== 'openrouter') {
      throw failure('provider_policy', 502, 'No extraction provider is selected.');
    }
    if (!model) {
      throw failure('provider_policy', 502, 'No extraction model is selected.');
    }
    const resolved = resolveApprovedSelection(config.extraction, provider, model, now());
    if (!resolved.ok) {
      throw failure('provider_policy', 502, 'The selected model is not approved.');
    }
    return { selection: resolved.selection, approval: resolved.approval };
  };

  /**
   * Reads the fresh metadata and proves that the selection may be used.
   *
   * The state of the server is checked again before and after every outbound
   * call, so a role, a scope, a context, a setting or a catalog that changes
   * while a metadata request is pending stops the request before an image
   * leaves the process. The envelopes of the provider are parsed as they are
   * documented and are mapped into the normalized records of the policy.
   */
  const assertEligible = async (
    selection: Selection,
    approval: Approval,
    signal: AbortSignal,
    recheck: () => void,
  ): Promise<void> => {
    assertPrivacyAttestations(config.extraction, selection.provider);
    if (selection.provider === 'groq') {
      recheck();
      const models = await fetchMetadata(PROVIDER_URLS.groqModels, selection.key, signal);
      recheck();
      if (!eligibleGroq(models, approval, config.extraction, now())) {
        throw failure('provider_policy', 502, 'The selected provider is not eligible.');
      }
      return;
    }
    recheck();
    const models = await fetchMetadata(PROVIDER_URLS.openRouterModels, selection.key, signal);
    recheck();
    const endpoints = await fetchMetadata(openRouterEndpointsUrl(selection.model), selection.key, signal);
    recheck();
    const zdr = await fetchMetadata(PROVIDER_URLS.openRouterZdr, selection.key, signal);
    recheck();
    const byok = await fetchByok(selection.key, signal);
    recheck();
    const model = parseModelList(models).find(entry => entry.id === selection.model);
    const endpoint = parseOpenRouterEndpoints(endpoints, selection.model, approval.endpoint);
    const zdrEntry = parseOpenRouterZdr(zdr, selection.model, approval.endpoint);
    const byokEntry = parseOpenRouterByok(byok);
    if (!eligibleOpenRouter(model, endpoint, zdrEntry, byokEntry, approval, config.extraction, now())) {
      throw failure('provider_policy', 502, 'The selected provider is not eligible.');
    }
  };

  /** The public status of the feature. It carries no key and no policy payload. */
  const status = (): ExtractionStatus => describeExtractionStatus(db, config, now());

  /**
   * Lists the models the administrator may choose from.
   *
   * The list is the intersection of the current provider catalog and the
   * approvals. A failing listing is reported as a failure: it never resets the
   * current selection. The listing never authorizes a processing: it is
   * refused before the first metadata call when the processing is not
   * approved, when the context is missing or when the feature is disabled.
   */
  const models = async (provider: 'groq' | 'openrouter', signal: AbortSignal): Promise<ModelChoice[]> => {
    if (!getBoolean(db, 'ai_extraction.enabled')) {
      throw failure('extraction_disabled', 403, 'Document extraction is disabled.');
    }
    if (!config.extraction.authorized || !config.extraction.context) {
      throw failure('processing_not_authorized', 403, 'External document processing is not authorized.');
    }
    assertPrivacyAttestations(config.extraction, provider);
    const key = provider === 'groq' ? config.extraction.groqKey : config.extraction.openRouterKey;
    if (!key) {
      throw failure('provider_not_configured', 403, 'The selected provider is not configured.');
    }
    const url = provider === 'groq' ? PROVIDER_URLS.groqModels : PROVIDER_URLS.openRouterModels;
    const catalog = await fetchMetadata(url, key, signal);
    const entries = parseModelList(catalog);
    const approvals = config.extraction.approvals.filter(
      item => item.provider === provider && isUnexpired(item, now()),
    );
    const choices: ModelChoice[] = [];
    for (const approval of approvals) {
      const entry = entries.find(item => item.id === approval.model);
      if (!entry) continue;
      const label = typeof entry.name === 'string' ? entry.name : approval.model;
      choices.push({ id: approval.model, label, provider, maxImages: approval.maxImages });
    }
    return choices;
  };

  /**
   * Runs one extraction.
   *
   * The pages are sent in contiguous batches, one batch after the other. The
   * result is built only when every batch succeeded, so a partial answer
   * never reaches the browser.
   */
  const run = async (
    request: ExtractionRequest,
    userId: string,
    signal: AbortSignal,
  ): Promise<ExtractionResult> => {
    /** Checks the state of the server that guards an outbound call. */
    const recheck = (): void => {
      assertCurrent(db, config, request, userId);
    };
    recheck();
    const { selection, approval } = resolveSelection();
    const batches: ExtractionRequest['images'][] = [];
    for (let index = 0; index < request.images.length; index += selection.maxImages) {
      batches.push(request.images.slice(index, index + selection.maxImages));
    }

    const pages: RawPage[] = [];
    for (const batch of batches) {
      recheck();
      let batchPages: RawPage[];
      try {
        // The eligibility proof and the inference share one rate limit
        // handling: a provider that limits the account while its metadata is
        // read limits it exactly like a provider that limits it while the
        // batch is sent.
        await assertEligible(selection, approval, signal, recheck);
        recheck();
        batchPages = await extractBatch(selection, batch, signal, transport);
      } catch (error) {
        if (error instanceof ExtractionError && error.code === 'provider_rate_limit') {
          startCooldown(userId, error.retryAfterSeconds);
        }
        throw error;
      }
      recheck();
      pages.push(...batchPages);
    }

    recheck();
    const fields = normalizePages(pages, request.pageCount, readCatalogs(db));
    return resultSchema.parse({
      requestId: request.requestId,
      context: request.context,
      settingsVersion: request.settingsVersion,
      catalogVersion: request.catalogVersion,
      pageCount: request.pageCount,
      fields,
    });
  };

  /**
   * The synchronous admission check of the route.
   *
   * It runs before the body is decoded and before a slot is taken: a
   * disabled, unconfigured or unapproved extraction answers without reading
   * a body and without a single metadata call. A rate limited account is
   * refused here as well, before the metadata and before the inference.
   */
  const preflight = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!getBoolean(db, 'ai_extraction.enabled')) {
        throw failure('extraction_disabled', 403, 'Document extraction is disabled.');
      }
      if (!config.extraction.authorized) {
        throw failure('processing_not_authorized', 403, 'External document processing is not authorized.');
      }
      if (!config.extraction.context) {
        throw failure('processing_not_authorized', 403, 'External document processing is not authorized.');
      }
      const provider = getString(db, 'ai_extraction.provider');
      if (provider !== 'groq' && provider !== 'openrouter') {
        throw failure('extraction_disabled', 403, 'No extraction provider is selected.');
      }
      const model = getString(db, 'ai_extraction.model');
      if (!model) {
        throw failure('extraction_disabled', 403, 'No extraction model is selected.');
      }
      // An expired approval is no approval: the record is checked against the
      // current clock here, before the body is decoded and before a single
      // image reaches the provider, so an expired selection never costs a
      // native decode and never leaves the process.
      const approval = config.extraction.approvals.find(
        item => item.provider === provider && item.model === model && isUnexpired(item, now()),
      );
      if (!approval) {
        throw failure('provider_policy', 403, 'The selected model is not approved.');
      }
      const key = provider === 'groq' ? config.extraction.groqKey : config.extraction.openRouterKey;
      if (!key) {
        throw failure('provider_not_configured', 403, 'The selected provider is not configured.');
      }
      assertPrivacyAttestations(config.extraction, provider);
      const remaining = cooldownSeconds(req.user?.id ?? '');
      if (remaining > 0) {
        throw new ExtractionError(
          'provider_rate_limit',
          429,
          'The provider is rate limiting this account.',
          remaining,
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Takes the admission slot of one request.
   *
   * The slot is taken before the body is decoded, so a burst of requests is
   * refused before it costs anything. The slot is released when the work
   * settles, never when a client disconnects while the work is still
   * running. The body deadline is armed here, at the admission, and it
   * reaches the route, so a body that never arrives is answered instead of
   * waiting for a parser that never finishes.
   */
  const acquire = (req: Request, res: Response, next: NextFunction): void => {
    const account = req.user?.id ?? '';
    const running = accountRequests.get(account) ?? 0;
    if (activeRequests >= MAX_GLOBAL_REQUESTS || running >= MAX_REQUESTS_PER_ACCOUNT) {
      next(failure('concurrency_limit', 429, 'Another extraction is already running.'));
      return;
    }
    activeRequests += 1;
    accountRequests.set(account, running + 1);

    const controller = new AbortController();
    let bodyComplete = false;
    const bodyTimer = clock.setTimeout(() => {
      if (bodyComplete) return;
      res.locals.extractionDeadlineExpired = true;
      controller.abort(failure('extraction_timeout', 504, 'The extraction did not finish in time.'));
      const expired = res.locals.extractionBodyExpired as (() => void) | undefined;
      expired?.();
    }, BODY_TIMEOUT_MS);
    const overallTimer = clock.setTimeout(() => {
      res.locals.extractionDeadlineExpired = true;
      controller.abort(failure('extraction_timeout', 504, 'The extraction did not finish in time.'));
    }, OVERALL_TIMEOUT_MS);

    let released = false;
    res.locals.extractionAbort = controller;
    res.locals.extractionBodyComplete = () => {
      bodyComplete = true;
      clock.clearTimeout(bodyTimer);
    };
    res.locals.extractionSettled = () => {
      if (released) return;
      released = true;
      clock.clearTimeout(bodyTimer);
      clock.clearTimeout(overallTimer);
      activeRequests -= 1;
      accountRequests.set(account, Math.max(0, (accountRequests.get(account) ?? 1) - 1));
    };
    next();
  };

  /**
   * The catalogue of the candidates and the authority of a selection.
   *
   * The catalogue owns the offline listing and the validation of a
   * selection, and the pipeline owns the proof of a selection against the
   * live metadata of the provider.
   */
  const catalogue = createCandidateCatalogue({ db, config, now, assertEligible });

  /**
   * The live model catalog of one provider.
   *
   * The list is read-only and it sends no document, so it works before the
   * extraction is enabled: the administrator needs it to choose a model.
   */
  const catalog = createModelCatalog({
    config: config.extraction,
    now,
    fetchModels: (provider, key, signal) =>
      fetchMetadata(
        provider === 'groq' ? PROVIDER_URLS.groqModels : PROVIDER_URLS.openRouterModels,
        key,
        signal,
      ),
  });

  return {
    status,
    models,
    catalog,
    candidates: catalogue.candidates,
    run,
    preflight,
    acquire,
    validateCandidate: catalogue.validateCandidate,
    assertCandidateAuthority: catalogue.assertCandidateAuthority,
  };
}
