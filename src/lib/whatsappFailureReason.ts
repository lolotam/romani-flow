export const WHATSAPP_FAILURE_CODES = [
  'whatsapp_not_configured', 'invalid_number', 'invalid_text', 'provider_unauthorized',
  'provider_uncertain_response', 'invalid_provider_response', 'provider_connection_failed',
  'transport_interrupted', 'interrupted_restart', 'no_longer_eligible',
] as const;

/** Unknown server codes use generic copy rather than exposing arbitrary error text. */
export function whatsappFailureKey(code: string): string {
  return WHATSAPP_FAILURE_CODES.some(known => known === code) ? code : 'other';
}
