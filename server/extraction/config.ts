import { z } from 'zod';

/**
 * The backend-only extraction configuration.
 *
 * Extraction ships disabled and unconfigured. Nothing here activates a
 * provider, a model or an endpoint: the environment only carries the keys and
 * the owner approvals, and the eligibility rules decide later whether a
 * request may be sent at all.
 *
 * The parsed keys stay on the server. Only booleans and labels may reach the
 * browser, so this module never exposes a key prefix, a key suffix or the
 * approval payload.
 */

/**
 * One owner approval for a single provider, model and endpoint.
 *
 * `expiresAt` is a plain ISO timestamp. It is validated here for shape only;
 * its freshness is checked against an injected clock at the moment of use, so
 * an approval that expires while the server runs is never honored.
 */
const approvalSchema = z
  .object({
    provider: z.enum(['groq', 'openrouter']),
    model: z.string().max(128).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/),
    endpoint: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/),
    maxImages: z.number().int().min(1).max(3),
    expiresAt: z.string().datetime(),
    policyVersion: z.string().min(1).max(128),
  })
  .strict()
  .refine((value) => value.provider === 'groq' || value.maxImages === 1);

export type Approval = z.infer<typeof approvalSchema>;

export interface ExtractionConfig {
  authorized: boolean;
  context: string;
  groqKey: string | null;
  openRouterKey: string | null;
  groqFreeAccount: boolean;
  dataControlsApproved: boolean;
  openRouterNoByok: boolean;
  openRouterZdrOnly: boolean;
  approvals: Approval[];
}

/**
 * Reads the extraction configuration from the environment.
 *
 * The result fails closed: a malformed approval list, a duplicate
 * provider/model pair, a missing context or a missing authorization flag all
 * leave the feature disabled. Invalid approval lists also discard their records.
 */
export function readExtractionConfig(env: NodeJS.ProcessEnv): ExtractionConfig {
  const text = (key: string) => env[key]?.trim() ?? '';
  const enabled = (key: string) => env[key] === 'true';

  let approvals: Approval[] = [];
  let valid = true;
  try {
    approvals = z.array(approvalSchema).max(20).parse(JSON.parse(text('AI_EXTRACTION_APPROVALS_JSON') || '[]'));
    if (new Set(approvals.map((item) => item.provider + ':' + item.model)).size !== approvals.length) valid = false;
  } catch {
    valid = false;
  }

  const context = text('AI_EXTRACTION_CONTEXT');

  return {
    authorized: valid && context.length > 0 && context.length <= 128 && enabled('AI_EXTRACTION_PROCESSING_AUTHORIZED'),
    context,
    groqKey: text('GROQ_API_KEY') || null,
    openRouterKey: text('OPENROUTER_API_KEY') || null,
    groqFreeAccount: enabled('AI_EXTRACTION_GROQ_FREE_ACCOUNT'),
    dataControlsApproved: enabled('AI_EXTRACTION_DATA_CONTROLS_APPROVED'),
    openRouterNoByok: enabled('AI_EXTRACTION_OPENROUTER_NO_BYOK'),
    openRouterZdrOnly: enabled('AI_EXTRACTION_OPENROUTER_ZDR_ONLY'),
    approvals: valid ? approvals : [],
  };
}
