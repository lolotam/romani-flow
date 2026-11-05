/** Application mailbox identity is case-insensitive, including retained history. */
export const emailIdentity = (address: string): string => address.trim().toLowerCase();

export function emailIdentities(addresses: string[]): string[] {
  return [...new Set(addresses.map(emailIdentity).filter(Boolean))];
}
