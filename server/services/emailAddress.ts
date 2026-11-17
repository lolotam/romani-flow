/** NFC and simple lowercase are comparison-only; SMTP preserves configured spelling. */
export const emailIdentity = (address: string): string => address.trim().normalize('NFC').toLowerCase().normalize('NFC');

const MAILBOX_PATTERN = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

/**
 * The mailbox of a sender value.
 *
 * Accepts `Company <no-reply@example.com>` and a bare mailbox. A display name on
 * its own carries no mailbox, so it is refused here instead of failing later at
 * the relay with a message that names nothing the operator can change.
 */
export function mailboxOf(value: string): string | null {
  const trimmed = value.trim();
  const angled = /<([^<>]*)>/.exec(trimmed);
  const candidate = (angled ? angled[1] : trimmed).trim();
  return MAILBOX_PATTERN.test(candidate) ? candidate : null;
}

export function emailIdentities(addresses: string[]): string[] {
  const first = new Map<string, string>();
  for (const address of addresses) {
    const key = emailIdentity(address);
    if (key && !first.has(key)) first.set(key, address.trim());
  }
  return [...first.values()];
}
