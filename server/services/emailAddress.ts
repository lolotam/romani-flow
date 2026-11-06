/** Application mailbox identity is case-insensitive, including retained history. */
export const emailIdentity = (address: string): string => address.trim().toLowerCase();

export function emailIdentities(addresses: string[]): string[] {
  const first = new Map<string, string>();
  for (const address of addresses) {
    const key = emailIdentity(address);
    if (key && !first.has(key)) first.set(key, address.trim());
  }
  return [...first.values()];
}
