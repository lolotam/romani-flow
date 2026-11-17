/**
 * The reasons the pairing panel can stay unusable.
 *
 * The panel names the reason instead of a general sentence: the operator has
 * to tell a refused key from a provider that cannot be reached, and only the
 * code tells them apart. A panel that says the same thing for both sends the
 * operator to check settings that are already correct.
 */
export const PAIRING_FAILURE_CODES = [
  'whatsapp_not_configured',
  'provider_unauthorized',
  'provider_unavailable',
  'instance_not_ready',
  'project_mismatch',
  'connection_state_unknown',
  'invalid_provider_response',
  'network_error',
  'http_error',
] as const;

export type PairingFailureCode = (typeof PAIRING_FAILURE_CODES)[number];

/**
 * The code of a failed pairing request, when the server named one.
 *
 * A code that is not on the list stays hidden: the panel shows the general
 * sentence rather than a code nobody documented.
 */
export function pairingFailureCode(error: unknown): PairingFailureCode | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  return (PAIRING_FAILURE_CODES as readonly string[]).includes(code) ? (code as PairingFailureCode) : null;
}
