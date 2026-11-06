/** NFC and simple lowercase are comparison-only; SMTP preserves configured spelling. */
export const emailIdentity = (address: string): string => address.trim().normalize('NFC').toLowerCase().normalize('NFC');

export function emailIdentities(addresses: string[]): string[] {
  const first = new Map<string, string>();
  for (const address of addresses) {
    const key = emailIdentity(address);
    if (key && !first.has(key)) first.set(key, address.trim());
  }
  return [...first.values()];
}
