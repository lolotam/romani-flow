import dns from 'node:dns';
import net from 'node:net';
import type { AppConfig } from '../config.js';
import { MailError } from './mailError.js';

/**
 * The destination policy for a member SMTP relay.
 *
 * A member chooses the relay, so the server would otherwise connect wherever
 * the member points it, including a loopback or internal address that only
 * the host can reach. A private destination is refused unless the host is
 * named in the allowlist, which is how an approved internal relay is used.
 */

/** The addresses the server refuses to reach on its own initiative. */
const PRIVATE_ADDRESSES = (() => {
  const blockList = new net.BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) blockList.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ] as const) blockList.addSubnet(network, prefix, 'ipv6');
  return blockList;
})();

/** The names that always mean the host itself. */
const PRIVATE_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/** The same form the allowlist uses: lower case, without a trailing dot or brackets. */
export function normalizeSmtpHost(host: string): string {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, '');
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
}

/** True when the address is one the server refuses to reach. */
export function isPrivateSmtpAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  // An IPv4-mapped IPv6 address is the same address in another notation.
  const mapped = value.startsWith('::ffff:') && net.isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const family = net.isIP(mapped);
  if (family === 4) return PRIVATE_ADDRESSES.check(mapped, 'ipv4');
  if (family === 6) return PRIVATE_ADDRESSES.check(mapped, 'ipv6');
  return false;
}

/** True when the host itself is a private address or a name that means the host. */
export function isPrivateSmtpHost(host: string): boolean {
  const value = normalizeSmtpHost(host);
  if (PRIVATE_NAMES.has(value)) return true;
  return net.isIP(value) === 4 || net.isIP(value) === 6 ? isPrivateSmtpAddress(value) : false;
}

/** True when the owner named the host in the allowlist. */
export function isAllowedSmtpHost(config: AppConfig, host: string): boolean {
  return config.smtpAllowedHosts.includes(normalizeSmtpHost(host));
}

/**
 * True when the host may use a plaintext session.
 *
 * TLS is required in production without exception. The exemption exists for
 * the loopback test server, which has no certificate.
 */
export function allowsPlaintextSmtp(config: AppConfig, host: string): boolean {
  if (config.env === 'production') return false;
  return config.smtpAllowPlaintextHosts.includes(normalizeSmtpHost(host));
}

/** Resolves the host the way the mail client resolves it, so both see the same addresses. */
async function resolveSmtpAddresses(host: string): Promise<string[]> {
  const addresses: string[] = [];
  for (const family of [4, 6] as const) {
    try {
      const resolved = await dns.promises[`resolve${family}`](host);
      addresses.push(...resolved);
    } catch {
      // A name that does not resolve is a connection error, not a policy error.
    }
  }
  return addresses;
}

/**
 * Refuses a destination the server must not reach.
 *
 * The check runs before the connection, so a saved configuration cannot point
 * the server at a private address. A name is resolved with the same resolver
 * the mail client uses, and every address it resolves to has to be public.
 */
export async function assertAllowedSmtpDestination(config: AppConfig, host: string): Promise<void> {
  const value = normalizeSmtpHost(host);
  if (!value || isAllowedSmtpHost(config, value)) return;
  if (isPrivateSmtpHost(value)) {
    throw new MailError('This SMTP host is not allowed.', 'smtp_destination_not_allowed', 400);
  }
  const addresses = await resolveSmtpAddresses(value);
  if (addresses.some(address => isPrivateSmtpAddress(address))) {
    throw new MailError('This SMTP host is not allowed.', 'smtp_destination_not_allowed', 400);
  }
}

/**
 * The destination policy of the running server.
 *
 * The resolver receives the policy instead of the whole configuration, so a
 * test can state its own destination rules.
 */
export interface SmtpDestinationPolicy {
  /** True when the owner named the host in the allowlist. */
  isAllowed(host: string): boolean;
  /** True when the host may use a plaintext session. */
  allowsPlaintext(host: string): boolean;
  /** Refuses a destination the server must not reach. */
  assertAllowed(host: string): Promise<void>;
}

/** The policy of the running server, built from its configuration. */
export function createSmtpDestinationPolicy(config: AppConfig): SmtpDestinationPolicy {
  return {
    isAllowed: host => isAllowedSmtpHost(config, host),
    allowsPlaintext: host => allowsPlaintextSmtp(config, host),
    assertAllowed: host => assertAllowedSmtpDestination(config, host),
  };
}
