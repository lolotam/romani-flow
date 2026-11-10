import type {
  ModelCatalogEntry,
  ModelCatalogListing,
  ModelCatalogReason,
  ModelCatalogStatus,
} from '../contracts/documentExtraction.js';
import { offlineCandidates } from './candidates.js';
import type { Approval, ExtractionConfig } from './config.js';
import { parseModelList } from './http.js';
import {
  GROQ_CAPABILITIES,
  hasPrivacyAttestations,
  hasVisionText,
  isRouterModel,
  supportsRequiredParameters,
} from './policy.js';
import { classifyPricing } from './pricing.js';

/**
 * The live model catalog of one provider.
 *
 * The catalog answers "what does the provider serve", never "what may be
 * processed": a model is `approved` only when the offline candidate rules
 * accept it, and every other model is offered as `approvable` with a template
 * record, as `unavailable` when the reviewed rules refuse it or as
 * `unverified` when nothing about it could be proven. Reading the list sends no
 * document and no image, so it does not need the processing attestations; the
 * eligibility of a selection still does, and the settings write proves it again.
 *
 * Every entry carries a fixed reason instead of a provider text, so the client
 * never receives a price, a key, an endpoint tag or a policy payload.
 */

/** The policy version a template record carries. */
export const TEMPLATE_POLICY_VERSION = '2026-11-08';

/** How long a copied template record stays valid, in days. */
const TEMPLATE_LIFETIME_DAYS = 180;

/** The largest catalog a provider answer may produce. */
const MAX_CATALOG_ENTRIES = 500;

/** The dependencies of the catalog reader. */
export interface ModelCatalogDeps {
  config: ExtractionConfig;
  /** The current moment of the server. */
  now: () => string;
  /** Reads the model list of one provider with the configured key. */
  fetchModels: (
    provider: 'groq' | 'openrouter',
    key: string,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

/** The facts of the environment that one catalog read needs. */
interface CatalogRead {
  provider: 'groq' | 'openrouter';
  config: ExtractionConfig;
  /** The models an approval names. */
  approved: Set<string>;
  /** The privacy attestations of the environment hold. */
  attested: boolean;
  /** The current moment of the server. */
  now: string;
}

/** What the catalog says about one model. */
interface CatalogDecision {
  status: ModelCatalogStatus;
  reason: ModelCatalogReason;
  maxImages: number | null;
  approval: string | null;
}

/** Builds the approval template of one model, or no template when refused. */
function approvalTemplate(
  provider: 'groq' | 'openrouter',
  model: string,
  maxImages: number,
  now: string,
): string {
  const moment = Date.parse(now);
  const expiresAt = new Date(
    (Number.isFinite(moment) ? moment : Date.now()) + TEMPLATE_LIFETIME_DAYS * 86_400_000,
  ).toISOString();
  const record: Approval = {
    provider,
    model,
    // Groq ignores the endpoint; a routed model needs the tag of the exact
    // endpoint the owner wants to pin, so the template says so.
    endpoint: provider === 'groq' ? 'groq' : 'PROVIDER_TAG',
    maxImages,
    expiresAt,
    policyVersion: TEMPLATE_POLICY_VERSION,
  };
  return JSON.stringify(record);
}

/** A model the reviewed rules refuse: no approval can ever select it. */
function refused(reason: ModelCatalogReason): CatalogDecision {
  return { status: 'unavailable', reason, maxImages: null, approval: null };
}

/** A model that could not be proven usable, whatever the approvals say. */
function unproven(reason: ModelCatalogReason): CatalogDecision {
  return { status: 'unverified', reason, maxImages: null, approval: null };
}

/**
 * Decides what the catalog says about one live OpenRouter model.
 *
 * The reviewed rules decide: a free, non-routing model that accepts images and
 * answers with text, a price that reads as zero and the privacy attestations
 * of the environment. A model that passes them is approved when an approval
 * names it and approvable otherwise.
 */
function decideLiveOpenRouter(
  model: Record<string, unknown>,
  id: string,
  read: CatalogRead,
): CatalogDecision {
  if (isRouterModel(id)) return refused('router_model');
  if (!id.endsWith(':free')) return refused('not_free');
  if (!hasVisionText(model)) return refused('unsupported_images');
  if (!supportsRequiredParameters(model)) return refused('unsupported_json');

  const price = classifyPricing(model.pricing);
  if (price === 'paid') return refused('nonzero_pricing');
  if (price === 'unverified') return unproven('pricing_unverified');
  if (!read.attested) return unproven('privacy_policy');

  if (read.approved.has(id)) {
    return { status: 'approved', reason: 'none', maxImages: 1, approval: null };
  }
  return {
    status: 'approvable',
    reason: 'approval_required',
    maxImages: 1,
    approval: approvalTemplate('openrouter', id, 1, read.now),
  };
}

/**
 * Decides what the catalog says about one live Groq model.
 *
 * A direct provider serves the model itself, so the reviewed capability record
 * is the rule: a model outside it can never be approved.
 */
function decideLiveGroq(id: string, read: CatalogRead): CatalogDecision {
  const capability = GROQ_CAPABILITIES[id];
  if (!capability) return refused('unsupported_model');
  if (!read.attested) return unproven('privacy_policy');
  if (read.approved.has(id)) {
    return {
      status: 'approved',
      reason: 'none',
      maxImages: capability.maxImages,
      approval: null,
    };
  }
  return {
    status: 'approvable',
    reason: 'approval_required',
    maxImages: capability.maxImages,
    approval: approvalTemplate('groq', id, capability.maxImages, read.now),
  };
}

/**
 * The gap that keeps the local records from proving a model usable.
 *
 * It is read only when the provider cannot be listed at all: a missing
 * authorization is a policy gap and a missing key is a configuration gap, and
 * only the owner can close either of them.
 */
function localGapReason(config: ExtractionConfig): ModelCatalogReason {
  if (!config.authorized || !config.context) return 'authorization_required';
  return 'provider_unconfigured';
}

/**
 * Decides what the local records say about one OpenRouter model.
 *
 * The local records know the identity of a model and the rules of its family,
 * but not its price and not its modality. A model that breaks the family rules
 * is refused for good; every other one stays unverified until the provider
 * itself is read.
 */
function decideLocalOpenRouter(id: string, gap: ModelCatalogReason): CatalogDecision {
  if (isRouterModel(id)) return refused('router_model');
  if (!id.endsWith(':free')) return refused('not_free');
  return unproven(gap);
}

/** Builds one entry of the catalog. */
function describeEntry(
  provider: 'groq' | 'openrouter',
  id: string,
  label: string,
  decision: CatalogDecision,
): ModelCatalogEntry {
  return {
    id,
    label,
    provider,
    status: decision.status,
    reason: decision.reason,
    maxImages: decision.maxImages,
    approval: decision.approval,
  };
}

/**
 * Reads the catalog of the local records.
 *
 * The provider is never contacted, so the listing stays the reviewed identity
 * of the models the owner already named.
 */
function readLocalCatalog(read: CatalogRead): ModelCatalogEntry[] {
  const gap = localGapReason(read.config);
  if (read.provider === 'groq') {
    return Object.keys(GROQ_CAPABILITIES).map(id =>
      describeEntry(read.provider, id, id, unproven(gap)),
    );
  }
  return read.config.approvals
    .filter(approval => approval.provider === read.provider)
    .map(approval => approval.model)
    .map(id => describeEntry(read.provider, id, id, decideLocalOpenRouter(id, gap)));
}

/** Reads the catalog of one provider answer. */
function readLiveCatalog(read: CatalogRead, payload: unknown): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  for (const model of parseModelList(payload)) {
    const id = typeof model.id === 'string' ? model.id : '';
    // The client contract refuses the whole listing over one oversized
    // field, so an entry outside the bounds is dropped instead of being
    // allowed to erase the catalog of every other model.
    if (!id || id.length > 128) continue;
    const label = (typeof model.name === 'string' && model.name ? model.name : id).slice(0, 128);
    const decision =
      read.provider === 'groq'
        ? decideLiveGroq(id, read)
        : decideLiveOpenRouter(model, id, read);
    entries.push(describeEntry(read.provider, id, label, decision));
  }
  return entries;
}

/** Orders the catalog: approved first, then approvable, then the refusals. */
function order(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const rank: Record<ModelCatalogStatus, number> = {
    approved: 0,
    approvable: 1,
    unverified: 2,
    unavailable: 3,
  };
  return entries
    .sort((left, right) => rank[left.status] - rank[right.status] || left.id.localeCompare(right.id))
    .slice(0, MAX_CATALOG_ENTRIES);
}

/** Creates the reader of the provider model catalog. */
export function createModelCatalog(deps: ModelCatalogDeps) {
  return async (
    provider: 'groq' | 'openrouter',
    signal: AbortSignal,
  ): Promise<ModelCatalogListing> => {
    const now = deps.now();
    const key = provider === 'groq' ? deps.config.groqKey : deps.config.openRouterKey;
    const read: CatalogRead = {
      provider,
      config: deps.config,
      approved: new Set(
        offlineCandidates(provider, deps.config, now).candidates.map(candidate => candidate.id),
      ),
      attested: hasPrivacyAttestations(deps.config, provider),
      now,
    };
    if (!key || !deps.config.authorized || !deps.config.context) {
      return { verification: 'local', entries: order(readLocalCatalog(read)) };
    }
    const payload = await deps.fetchModels(provider, key, signal);
    return { verification: 'live', entries: order(readLiveCatalog(read, payload)) };
  };
}
