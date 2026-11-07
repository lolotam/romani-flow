import type { Db } from '../db/connection.js';
import type { ModelChoice } from '../contracts/documentExtraction.js';
import type { Approval, ExtractionConfig } from './config.js';
import type { Selection } from './provider.js';
import {
  GROQ_CAPABILITIES,
  assertAdmin,
  hasPrivacyAttestations,
  isRouterModel,
  isUnexpired,
  resolveApprovedSelection,
} from './policy.js';
import { ExtractionError } from './http.js';

/**
 * The offline candidate catalogue of the extraction.
 *
 * A candidate is a model that the local records already allow: the owner
 * approved it, it is not expired, the environment is configured for it and
 * the reviewed capability rules know it. The catalogue reads the local
 * records only — it performs no transport call, so it never proves that a
 * provider still serves the model. It is a starting point for an explicit
 * selection, never an authorization and never an activation.
 *
 * The second half of the module owns the authority of a candidate: the
 * snapshot that is taken when a selection is validated and that is read again
 * before the selection is written. The snapshot stays immutable, the
 * authority behind it is always re-read from the server.
 */

/** Why the catalogue of a provider is empty. */
export type CandidateReason =
  | 'locally_approved'
  | 'processing_not_authorized'
  | 'unconfigured'
  | 'policy_unavailable'
  | 'no_candidates';

/** The offline catalogue of one provider. */
export interface CandidateListing {
  verification: 'offline';
  candidates: ModelChoice[];
  reason: CandidateReason;
}

/**
 * Reports whether an approval may be offered as a candidate.
 *
 * The rules are the reviewed ones: the direct provider needs a known model
 * with the exact reviewed image count, and the routed provider needs a free
 * model that does not route itself and that is approved for a single image.
 * An expired approval and an approval without a policy version are never
 * candidates.
 */
function isLocalCandidate(approval: Approval, now: string): boolean {
  if (!approval.policyVersion) return false;
  if (!isUnexpired(approval, now)) return false;
  if (approval.provider === 'groq') {
    const capability = GROQ_CAPABILITIES[approval.model];
    return capability !== undefined && capability.maxImages === approval.maxImages;
  }
  if (approval.provider === 'openrouter') {
    if (approval.maxImages !== 1) return false;
    if (!approval.model.endsWith(':free')) return false;
    return !isRouterModel(approval.model);
  }
  return false;
}

/**
 * Lists the candidates of one provider from the local records.
 *
 * The persisted enabled flag is deliberately ignored: the catalogue answers
 * the question "what may I choose locally", not "what may I process now".
 * Every other local predicate still applies, and each failure has its own
 * fixed reason so a caller never has to guess why the list is empty.
 */
export function offlineCandidates(
  provider: 'groq' | 'openrouter',
  config: ExtractionConfig,
  now: string,
): CandidateListing {
  const empty = (reason: CandidateReason): CandidateListing => ({
    verification: 'offline',
    candidates: [],
    reason,
  });
  if (!config.authorized || !config.context) return empty('processing_not_authorized');
  const key = provider === 'groq' ? config.groqKey : config.openRouterKey;
  if (!key) return empty('unconfigured');
  if (!hasPrivacyAttestations(config, provider)) return empty('policy_unavailable');

  const candidates: ModelChoice[] = [];
  for (const approval of config.approvals) {
    if (approval.provider !== provider) continue;
    if (!isLocalCandidate(approval, now)) continue;
    if (candidates.some(item => item.id === approval.model)) continue;
    candidates.push({
      id: approval.model,
      label: approval.model,
      provider,
      maxImages: approval.maxImages,
    });
  }
  if (candidates.length === 0) return empty('no_candidates');
  return { verification: 'offline', candidates, reason: 'locally_approved' };
}

/**
 * The authority of one candidate selection.
 *
 * The snapshot is taken when the selection is validated and it never changes:
 * the requested provider, the requested model, the context of the request and
 * the approval it was resolved from. The authority behind the snapshot is
 * always read again, so a revoked role, a changed context or a revoked
 * approval stops the request.
 */
export interface SelectionAuthority {
  userId: string;
  provider: 'groq' | 'openrouter';
  model: string;
  context: string;
  endpoint: string;
  maxImages: number;
  policyVersion: string;
}

/**
 * Reads the authority of a candidate selection again.
 *
 * The role is read from the database, the context and the attestations from
 * the environment and the approval from the approval list, so none of them
 * can be stale. Every failure is a refusal: nothing is written and nothing
 * is activated.
 */
export function assertSelectionAuthority(
  db: Db,
  config: ExtractionConfig,
  authority: SelectionAuthority,
  now: string,
): void {
  assertAdmin(db, authority.userId);
  if (!config.authorized) {
    throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
  }
  if (!config.context || config.context !== authority.context) {
    throw new ExtractionError('context_mismatch', 409, 'The extraction context is no longer valid.');
  }
  const key = authority.provider === 'groq' ? config.groqKey : config.openRouterKey;
  if (!key) {
    throw new ExtractionError('provider_not_configured', 403, 'The selected provider is not configured.');
  }
  if (!hasPrivacyAttestations(config, authority.provider)) {
    throw new ExtractionError('processing_not_authorized', 403, 'External document processing is not authorized.');
  }
  const approval = config.approvals.find(
    item =>
      item.provider === authority.provider &&
      item.model === authority.model &&
      item.endpoint === authority.endpoint &&
      item.maxImages === authority.maxImages &&
      item.policyVersion === authority.policyVersion &&
      isUnexpired(item, now),
  );
  if (!approval) {
    throw new ExtractionError('provider_policy', 502, 'The selected model is not approved.');
  }
}

/** The request of a candidate validation. */
export interface CandidateRequest {
  userId: string;
  provider: 'groq' | 'openrouter';
  model: string;
  context: string;
}

/** The result of a candidate validation. */
export interface CandidateValidation {
  /** The reason the selection was refused, or null when it holds. */
  problem: string | null;
  /** The authority of the selection, or null when the selection was refused. */
  authority: SelectionAuthority | null;
}

/**
 * Reports the reason of a refused candidate in a public form.
 *
 * The message of the server is used when it is a known refusal, so the
 * caller learns why the selection failed. Every other failure keeps a
 * generic message, so no upstream text ever reaches the browser.
 */
export function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof ExtractionError) return error.message;
  return fallback;
}

/**
 * Reads the authority of a candidate again and reports it as a reason.
 *
 * The caller uses it right before it writes, so a revocation that happened
 * while the remote proof was pending still refuses the whole request.
 */
export function checkSelectionAuthority(
  db: Db,
  config: ExtractionConfig,
  authority: SelectionAuthority,
  now: string,
): string | null {
  try {
    assertSelectionAuthority(db, config, authority, now);
    return null;
  } catch (error) {
    return failureMessage(error, 'The extraction selection is no longer authorized.');
  }
}

/** The dependencies of the candidate catalogue. */
export interface CandidateCatalogueDeps {
  db: Db;
  config: { extraction: ExtractionConfig };
  /** The current moment of the server. */
  now: () => string;
  /** The live proof of a selection against the fresh metadata of a provider. */
  assertEligible: (
    selection: Selection,
    approval: Approval,
    signal: AbortSignal,
    recheck: () => void,
  ) => Promise<void>;
}

/** The catalogue of the candidates and the authority of a selection. */
export interface CandidateCatalogue {
  candidates(provider: 'groq' | 'openrouter'): CandidateListing;
  validateCandidate(request: CandidateRequest): Promise<CandidateValidation>;
  assertCandidateAuthority(authority: SelectionAuthority): string | null;
}

/**
 * Creates the catalogue of the candidates and the authority of a selection.
 *
 * The catalogue offers the locally approved candidates and it validates a
 * selection against the fresh metadata of the provider. The validation holds
 * an immutable snapshot of the requested candidate and it reads the authority
 * behind that snapshot again after every metadata call, so a revoked role, a
 * changed context or a revoked approval stops the request while it is still
 * in flight. Nothing here writes a setting and nothing here activates
 * anything.
 */
export function createCandidateCatalogue(deps: CandidateCatalogueDeps): CandidateCatalogue {
  const candidates = (provider: 'groq' | 'openrouter'): CandidateListing =>
    offlineCandidates(provider, deps.config.extraction, deps.now());

  const validateCandidate = async (request: CandidateRequest): Promise<CandidateValidation> => {
    const { userId, provider, model, context } = request;
    if (!deps.config.extraction.authorized) {
      return { problem: 'External document processing is not authorized.', authority: null };
    }
    const resolved = resolveApprovedSelection(deps.config.extraction, provider, model, deps.now());
    if (!resolved.ok) {
      const problem =
        resolved.refusal === 'not_configured'
          ? 'The selected provider is not configured.'
          : resolved.refusal === 'invalid_model'
            ? 'The selected model identifier is not valid.'
            : 'The selected model is not one of the approved models.';
      return { problem, authority: null };
    }
    const authority: SelectionAuthority = {
      userId,
      provider,
      model,
      context,
      endpoint: resolved.approval.endpoint,
      maxImages: resolved.approval.maxImages,
      policyVersion: resolved.approval.policyVersion,
    };
    const controller = new AbortController();
    try {
      await deps.assertEligible(resolved.selection, resolved.approval, controller.signal, () => {
        assertSelectionAuthority(deps.db, deps.config.extraction, authority, deps.now());
      });
    } catch (error) {
      return {
        problem: failureMessage(error, 'The selected model is not eligible.'),
        authority: null,
      };
    }
    return { problem: null, authority };
  };

  const assertCandidateAuthority = (authority: SelectionAuthority): string | null =>
    checkSelectionAuthority(deps.db, deps.config.extraction, authority, deps.now());

  return { candidates, validateCandidate, assertCandidateAuthority };
}
