import { createHash } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { limits, type ExtractionRequest, type ExtractionStatus, type ModelChoice } from '../contracts/documentExtraction.js';
import type { Approval, ExtractionConfig } from './config.js';
import { getBoolean, getString } from '../repositories/settings.js';
import { RepositoryError } from '../repositories/base.js';
import { validateDraftScope } from '../repositories/documentDrafts.js';
import { readCatalogs } from './catalog.js';
import { ExtractionError, isRecord, modelSegments } from './http.js';

/**
 * The admission rules of the extraction pipeline.
 *
 * The environment carries the keys and the owner approvals, but the
 * approvals alone are not enough: a model may only be used when the provider
 * itself proves, right now, that the model is free, that the endpoint is
 * healthy, that no data is retained and that no private key is attached.
 * Everything that cannot be proven is refused.
 */

/** The price dimensions every price record has to expose. */
const REQUIRED_PRICE_DIMENSIONS = ['prompt', 'completion', 'image', 'request'] as const;

/** The families that route a request instead of serving the model itself. */
const ROUTER_AUTHORS = new Set(['openrouter']);

/** The reviewed capability record of the direct Groq model. */
export const GROQ_CAPABILITIES: Record<string, { maxImages: number }> = {
  'qwen/qwen3.8-27b': { maxImages: 3 },
};

/**
 * Reports whether a price record is free.
 *
 * Every required dimension has to be present and every dimension of the
 * record has to be zero. An unknown representation, an exponent, a negative
 * value or a missing dimension is a refusal: a price that cannot be read as
 * zero is not a zero price.
 */
export function zeroPrices(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (!REQUIRED_PRICE_DIMENSIONS.every(key => Object.hasOwn(raw, key))) return false;
  return Object.values(raw).every(
    value => value === 0 || (typeof value === 'string' && /^0(?:\.0+)?$/.test(value)),
  );
}

/** Reports whether an approval is still valid at the given moment. */
export function isUnexpired(approval: Approval | undefined, now: string): boolean {
  if (!approval) return false;
  const expiresAt = Date.parse(approval.expiresAt);
  const moment = Date.parse(now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(moment)) return false;
  return expiresAt > moment;
}

/** Reports whether a model identifier belongs to a routing family. */
export function isRouterModel(modelId: string): boolean {
  const author = modelId.split('/')[0] ?? '';
  return ROUTER_AUTHORS.has(author.toLowerCase());
}

/** Reports whether the model accepts images and answers with text. */
function hasVisionText(model: Record<string, unknown>): boolean {
  const architecture = model.architecture;
  if (!isRecord(architecture)) return false;
  const modality = typeof architecture.modality === 'string' ? architecture.modality : '';
  if (!modality.includes('image') || !modality.endsWith('->text')) return false;
  const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  return inputs.includes('image') && outputs.includes('text');
}

/** Reports whether the model supports the parameters the pipeline sends. */
function supportsRequiredParameters(model: Record<string, unknown>): boolean {
  const parameters = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  return parameters.includes('response_format') && parameters.includes('max_tokens');
}

/** Reports whether the private key inventory is empty. */
function hasNoPrivateKeys(byok: Record<string, unknown>): boolean {
  if (byok.total_count !== 0) return false;
  return Array.isArray(byok.data) && byok.data.length === 0;
}

/** Reports whether the configuration contains the matching approval. */
function hasMatchingApproval(
  config: ExtractionConfig,
  approval: Approval,
  now: string,
): boolean {
  return config.approvals.some(
    item =>
      item.provider === approval.provider &&
      item.model === approval.model &&
      item.endpoint === approval.endpoint &&
      isUnexpired(item, now),
  );
}

/**
 * Decides whether an OpenRouter selection may be used.
 *
 * Every condition has to hold: a free and non-routing model that accepts
 * images and answers with text, a healthy endpoint with the exact approved
 * tag, a zero data retention record without safety retention, an empty
 * private key inventory, an unexpired approval and the privacy attestations
 * of the environment.
 */
export function eligibleOpenRouter(
  model: unknown,
  endpoint: unknown,
  zdr: unknown,
  byok: unknown,
  approval: Approval | undefined,
  config: ExtractionConfig,
  now: string,
): boolean {
  if (!isRecord(model) || !isRecord(endpoint) || !isRecord(zdr) || !isRecord(byok)) return false;
  if (!approval || approval.provider !== 'openrouter') return false;
  if (!config.authorized || !config.dataControlsApproved) return false;
  if (!config.openRouterNoByok || !config.openRouterZdrOnly) return false;

  const modelId = model.id;
  if (typeof modelId !== 'string' || !modelId.endsWith(':free')) return false;
  if (isRouterModel(modelId)) return false;
  if (approval.model !== modelId) return false;
  if (!zeroPrices(model.pricing)) return false;
  if (!hasVisionText(model)) return false;
  if (!supportsRequiredParameters(model)) return false;

  if (endpoint.model !== modelId || endpoint.tag !== approval.endpoint) return false;
  if (endpoint.status !== 0) return false;
  if (!zeroPrices(endpoint.pricing)) return false;

  if (zdr.model !== modelId || zdr.tag !== approval.endpoint) return false;
  if (zdr.safety_retention !== false) return false;

  if (!hasNoPrivateKeys(byok)) return false;

  if (approval.maxImages !== 1) return false;
  if (!approval.policyVersion) return false;
  if (!isUnexpired(approval, now)) return false;
  return hasMatchingApproval(config, approval, now);
}

/**
 * Decides whether a direct Groq selection may be used.
 *
 * The account has to be a free account, the data controls have to be
 * approved, the model has to be a reviewed capability and it has to be part
 * of the fresh model list of the provider.
 */
export function eligibleGroq(
  models: unknown,
  approval: Approval | undefined,
  config: ExtractionConfig,
  now: string,
): boolean {
  if (!approval || approval.provider !== 'groq') return false;
  if (!config.authorized || !config.dataControlsApproved || !config.groqFreeAccount) return false;
  if (!config.groqKey) return false;

  const capability = GROQ_CAPABILITIES[approval.model];
  if (!capability || capability.maxImages !== approval.maxImages) return false;
  if (!approval.policyVersion) return false;
  if (!isUnexpired(approval, now)) return false;
  if (!hasMatchingApproval(config, approval, now)) return false;

  const list = isRecord(models) && Array.isArray(models.data) ? models.data : [];
  return list.some(entry => isRecord(entry) && entry.id === approval.model);
}

/**
 * The model choices the server offers for one provider.
 *
 * The list is owned by the server: it is the reviewed capability record for
 * the direct provider and the approved models for the routed one. A model
 * that is not on the list can never be selected.
 */
export function modelChoices(
  provider: 'groq' | 'openrouter',
  config: ExtractionConfig,
): ModelChoice[] {
  if (provider === 'groq') {
    return Object.entries(GROQ_CAPABILITIES).map(([id, capability]) => ({
      id,
      label: id,
      provider,
      maxImages: capability.maxImages,
    }));
  }
  const now = new Date().toISOString();
  return config.approvals
    .filter(approval => approval.provider === provider && isUnexpired(approval, now))
    .map(approval => ({
      id: approval.model,
      label: approval.model,
      provider,
      maxImages: approval.maxImages,
    }));
}

/**
 * The fields of a resolved selection.
 *
 * Every field is owned by the server: the provider and the model come from
 * the settings, the endpoint and the image count come from the approval of
 * the owner and the key comes from the environment.
 */
export interface SelectionFields {
  provider: 'groq' | 'openrouter';
  model: string;
  endpoint: string;
  maxImages: number;
  key: string;
}

/** Why a candidate selection was refused. */
export type CandidateRefusal = 'not_approved' | 'not_configured' | 'invalid_model';

/** The resolved candidate of a provider and a model. */
export type ApprovedSelection =
  | { ok: true; selection: SelectionFields; approval: Approval }
  | { ok: false; refusal: CandidateRefusal };

/**
 * Resolves a candidate against the approvals of the owner.
 *
 * The approval of the owner is the first gate, so fresh metadata never
 * authorizes an unapproved context. A model without an approval, a provider
 * without a configured key and a malformed model identifier are refused on
 * their own, so the caller can answer with the exact reason.
 */
export function resolveApprovedSelection(
  config: ExtractionConfig,
  provider: 'groq' | 'openrouter',
  model: string,
  now: string,
): ApprovedSelection {
  const approval = config.approvals.find(
    item => item.provider === provider && item.model === model && isUnexpired(item, now),
  );
  if (!approval) return { ok: false, refusal: 'not_approved' };
  const key = provider === 'groq' ? config.groqKey : config.openRouterKey;
  if (!key) return { ok: false, refusal: 'not_configured' };
  try {
    modelSegments(model);
  } catch {
    return { ok: false, refusal: 'invalid_model' };
  }
  return {
    ok: true,
    selection: {
      provider,
      model,
      endpoint: approval.endpoint,
      maxImages: approval.maxImages,
      key,
    },
    approval,
  };
}

/**
 * The version of the effective extraction settings.
 *
 * The hash covers the non-secret selection, the approval list, the context
 * and the policy version of every approval. It never covers a key, so a
 * rotated key does not invalidate a running request while a changed
 * selection, a changed approval or a changed context does.
 */
export function settingsVersion(db: Db, config: { extraction: ExtractionConfig }): string {
  const payload = {
    enabled: getBoolean(db, 'ai_extraction.enabled'),
    provider: getString(db, 'ai_extraction.provider'),
    model: getString(db, 'ai_extraction.model'),
    context: config.extraction.context,
    approvals: config.extraction.approvals.map(approval => ({
      provider: approval.provider,
      model: approval.model,
      endpoint: approval.endpoint,
      maxImages: approval.maxImages,
      policyVersion: approval.policyVersion,
      expiresAt: approval.expiresAt,
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Reports whether the account is still an active administrator.
 *
 * The role is read from the server on every check, so a revoked role stops
 * the request even when the request was admitted with it.
 */
export function assertAdmin(db: Db, userId: string): void {
  const row = db
    .prepare('SELECT role FROM admin_users WHERE id = ? AND is_active = 1')
    .get(userId) as { role?: string } | undefined;
  if (!row || row.role !== 'admin') {
    throw new ExtractionError('forbidden', 403, 'Administrator privileges are required.');
  }
}

/**
 * Checks the draft scope of a request.
 *
 * A new form and a live entity are valid contexts, and a draft row is not
 * what makes a context valid: a deleted entity stops the request even when
 * its draft row still exists. The scope is checked with the scope validator
 * of the drafts, so both features agree on what a context is.
 */
export function assertDraftScope(db: Db, scope: string): void {
  try {
    validateDraftScope(db, scope);
  } catch (error) {
    if (error instanceof RepositoryError) {
      throw new ExtractionError('invalid_scope', 409, 'The draft scope is no longer available.');
    }
    throw error;
  }
}

/**
 * Checks the processing approval and the context of a request.
 *
 * Both are read from the server: an environment that does not approve the
 * processing refuses it, and a context that changed in the meantime makes
 * the request stale.
 */
export function assertProcessingContext(
  config: ExtractionConfig,
  request: { context: string },
): void {
  if (!config.authorized) {
    throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
  }
  if (!config.context || request.context !== config.context) {
    throw new ExtractionError('context_mismatch', 409, 'The extraction context is no longer valid.');
  }
}

/**
 * Checks the privacy attestations of the environment.
 *
 * The attestations are proven before every outbound call, never after it: a
 * missing data control approval, a missing free account proof or a missing
 * zero data retention proof is a refusal, not a metadata call.
 */
export function assertPrivacyAttestations(
  config: ExtractionConfig,
  provider: 'groq' | 'openrouter',
): void {
  if (!config.dataControlsApproved) {
    throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
  }
  if (provider === 'groq') {
    if (!config.groqFreeAccount) {
      throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
    }
    return;
  }
  if (!config.openRouterNoByok || !config.openRouterZdrOnly) {
    throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
  }
}

/**
 * Reports whether the privacy attestations of the environment hold.
 *
 * It is the predicate behind the attestations: the live pipeline refuses a
 * missing attestation, and the offline catalogue needs the same rules, so
 * both read the answer from one place.
 */
export function hasPrivacyAttestations(
  config: ExtractionConfig,
  provider: 'groq' | 'openrouter',
): boolean {
  if (!config.dataControlsApproved) return false;
  if (provider === 'groq') return config.groqFreeAccount;
  return config.openRouterNoByok && config.openRouterZdrOnly;
}

/** Checks the settings version of a request. */
export function assertSettingsCurrent(
  db: Db,
  config: { extraction: ExtractionConfig },
  request: { settingsVersion: string },
): void {
  if (settingsVersion(db, config) !== request.settingsVersion) {
    throw new ExtractionError('stale_settings', 409, 'The extraction settings changed. Reload and try again.');
  }
}

/** Checks the catalog version of a request. */
export function assertCatalogCurrent(db: Db, request: { catalogVersion: string }): void {
  if (readCatalogs(db).version !== request.catalogVersion) {
    throw new ExtractionError('stale_catalog', 409, 'The document catalogs changed. Reload and try again.');
  }
}

/**
 * Runs every check that guards an outbound call.
 *
 * The checks run in a fixed order — role, scope, environment, settings and
 * catalogs — and they are run again before every outbound call and again
 * after every answer, so a revocation that happens while a metadata request
 * is pending still stops the request before an image leaves the process.
 */
export function assertCurrent(
  db: Db,
  config: { extraction: ExtractionConfig },
  request: ExtractionRequest,
  userId: string,
): void {
  assertAdmin(db, userId);
  assertDraftScope(db, request.scope);
  assertProcessingContext(config.extraction, request);
  const provider = getString(db, 'ai_extraction.provider');
  if (provider === 'groq' || provider === 'openrouter') assertPrivacyAttestations(config.extraction, provider);
  assertSettingsCurrent(db, config, request);
  assertCatalogCurrent(db, request);
}

/**
 * The public status of the feature.
 *
 * The status carries no key, no approval payload and no model list: it only
 * says whether the feature is ready and why it is not.
 */
export function describeExtractionStatus(
  db: Db,
  config: { extraction: ExtractionConfig; maxUploadBytes?: number },
  now: string,
): ExtractionStatus {
  const enabled = getBoolean(db, 'ai_extraction.enabled');
  const providerValue = getString(db, 'ai_extraction.provider');
  const provider = providerValue === 'groq' || providerValue === 'openrouter' ? providerValue : null;
  const model = getString(db, 'ai_extraction.model');
  const configured = {
    groq: Boolean(config.extraction.groqKey),
    openrouter: Boolean(config.extraction.openRouterKey),
  };
  const processingAuthorized = config.extraction.authorized;
  const processingContext = config.extraction.context;
  const approval =
    provider && model
      ? config.extraction.approvals.find(
          item => item.provider === provider && item.model === model && isUnexpired(item, now),
        )
      : undefined;
  // The attestations of the environment are local facts of the provider, and
  // they are the same facts the live pipeline proves before every outbound
  // call. A status that advertises readiness without them would promise a
  // processing the server refuses, so readiness needs them as well.
  const attested = provider !== null && hasPrivacyAttestations(config.extraction, provider);
  const available =
    enabled &&
    processingAuthorized &&
    processingContext.length > 0 &&
    provider !== null &&
    Boolean(model) &&
    Boolean(approval) &&
    configured[provider] &&
    attested;
  const reason = !enabled
    ? 'disabled'
    : !processingAuthorized
      ? 'not_authorized'
      : !provider || !model
        ? 'not_configured'
        : !configured[provider]
          ? 'provider_not_configured'
          : !attested
            ? 'not_authorized'
            : !approval
              ? 'not_approved'
              : 'ready';
  return {
    enabled,
    provider: provider ?? '',
    model,
    configured,
    processingAuthorized,
    processingContext,
    available,
    reason,
    settingsVersion: settingsVersion(db, config),
    catalogVersion: readCatalogs(db).version,
    // The advertised cap is the smaller of the hard source bound of the
    // pipeline and the upload cap of the server, so a client never reads a
    // bound the server would refuse.
    maxSourceBytes: Math.min(limits.source, config.maxUploadBytes ?? limits.source),
  };
}
