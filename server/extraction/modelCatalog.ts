import type { ModelCatalogEntry, ModelCatalogListing } from '../contracts/documentExtraction.js';
import { offlineCandidates } from './candidates.js';
import type { Approval, ExtractionConfig } from './config.js';
import { parseModelList } from './http.js';
import {
  GROQ_CAPABILITIES,
  hasVisionText,
  isRouterModel,
  supportsRequiredParameters,
  zeroPrices,
} from './policy.js';

/**
 * The live model catalog of one provider.
 *
 * The catalog answers "what does the provider serve", never "what may be
 * processed": a model is `approved` only when the offline candidate rules
 * accept it, and every other model is offered as `approvable` with a template
 * record or as `unavailable`. Reading the list sends no document and no image,
 * so it does not need the processing attestations; the eligibility of a
 * selection still does, and the settings write proves it again.
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

/** Reports whether the reviewed rules accept a live OpenRouter record. */
function reviewedOpenRouter(model: Record<string, unknown>): boolean {
  const id = typeof model.id === 'string' ? model.id : '';
  // The live pipeline only ever sends to a free, non-routing, zero-priced
  // vision model. A record outside those rules can never become usable, so
  // an approval for it would be a dead record: it is refused here.
  if (!id.endsWith(':free')) return false;
  if (isRouterModel(id)) return false;
  if (!zeroPrices(model.pricing)) return false;
  return hasVisionText(model) && supportsRequiredParameters(model);
}

/** Describes one model of the catalog. */
function describeEntry(
  provider: 'groq' | 'openrouter',
  id: string,
  label: string,
  approved: Set<string>,
  reviewed: boolean,
  maxImages: number | null,
  now: string,
): ModelCatalogEntry {
  if (!reviewed || maxImages === null) {
    return { id, label, provider, status: 'unavailable', maxImages: null, approval: null };
  }
  if (approved.has(id)) {
    return { id, label, provider, status: 'approved', maxImages, approval: null };
  }
  return {
    id,
    label,
    provider,
    status: 'approvable',
    maxImages,
    approval: approvalTemplate(provider, id, maxImages, now),
  };
}

/** Orders the catalog: approved first, then approvable, then unavailable. */
function order(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const rank: Record<ModelCatalogEntry['status'], number> = {
    approved: 0,
    approvable: 1,
    unavailable: 2,
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
    const approved = new Set(
      offlineCandidates(provider, deps.config, now).candidates.map(candidate => candidate.id),
    );
    const key = provider === 'groq' ? deps.config.groqKey : deps.config.openRouterKey;
    const canFetch = Boolean(key) && deps.config.authorized && Boolean(deps.config.context);

    if (!canFetch) {
      const local =
        provider === 'groq'
          ? Object.keys(GROQ_CAPABILITIES)
          : deps.config.approvals
              .filter(approval => approval.provider === provider)
              .map(approval => approval.model);
      return {
        verification: 'local',
        entries: order(
          local.map(id => {
            const maxImages =
              provider === 'groq' ? (GROQ_CAPABILITIES[id]?.maxImages ?? null) : 1;
            return describeEntry(provider, id, id, approved, maxImages !== null, maxImages, now);
          }),
        ),
      };
    }

    const payload = await deps.fetchModels(provider, key as string, signal);
    const entries: ModelCatalogEntry[] = [];
    for (const model of parseModelList(payload)) {
      const id = typeof model.id === 'string' ? model.id : '';
      if (!id) continue;
      const label = typeof model.name === 'string' && model.name ? model.name : id;
      if (provider === 'groq') {
        const maxImages = GROQ_CAPABILITIES[id]?.maxImages ?? null;
        entries.push(describeEntry(provider, id, label, approved, maxImages !== null, maxImages, now));
        continue;
      }
      const reviewed = reviewedOpenRouter(model);
      entries.push(describeEntry(provider, id, label, approved, reviewed, reviewed ? 1 : null, now));
    }
    return { verification: 'live', entries: order(entries) };
  };
}
