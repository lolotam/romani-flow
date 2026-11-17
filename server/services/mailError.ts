/**
 * The failure of one mail operation.
 *
 * The code is the stable part an operator can act on. The message explains the
 * same failure in words, without a secret.
 */
export class MailError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

/** The code of a mail failure, whatever shape the failure has. */
export function mailErrorCode(error: unknown): string {
  if (error instanceof MailError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (['encryption_not_configured', 'credential_authentication_failed'].includes(code)) return code;
  }
  return 'send_failed';
}
