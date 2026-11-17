import dns from 'node:dns';
import net from 'node:net';

/**
 * Checks whether an IP address belongs to loopback, private, link-local,
 * multicast, or other reserved/non-routable networks.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (b0 === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT RFC 6598: 100.64.0.0 - 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-Local RFC 3927)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (b0 === 192 && b1 === 168) return true;
    // 198.18.0.0/15 (Benchmarking RFC 2544: 198.18.0.0 - 198.19.255.255)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast RFC 5771: 224 - 239)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved / Broadcast RFC 1112: 240 - 255)
    if (b0 >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const clean = ip.toLowerCase().trim();

    // Loopback ::1
    if (clean === '::1' || clean === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // Unspecified ::
    if (clean === '::' || clean === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

    // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
    if (clean.startsWith('::ffff:') || clean.startsWith('0:0:0:0:0:ffff:')) {
      const v4Part = clean.replace(/^(::ffff:|0:0:0:0:0:ffff:)/, '');
      if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }

    // Unique Local (fc00::/7 -> fc.. or fd..)
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    // Link-Local (fe80::/10 -> fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(clean)) return true;
    // Multicast (ff00::/8 -> ff..)
    if (clean.startsWith('ff')) return true;
    // Documentation (2001:db8::/32)
    if (clean.startsWith('2001:db8') || clean.startsWith('2001:0db8')) return true;
    // Discard prefix (100::/64)
    if (clean.startsWith('100:')) return true;

    return false;
  }

  return true;
}

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

const FORBIDDEN_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.test',
  '.example',
  '.invalid',
  '.onion',
];

/**
 * Validates that an SMTP host is syntactically sound and resolves exclusively to
 * public, routable IP addresses.
 */
export async function assertPublicHost(host: string): Promise<void> {
  const normalized = host.toLowerCase().trim();
  if (!normalized || normalized.length > 255) {
    throw new SmtpSecurityError('Host must be a non-empty string under 255 characters.');
  }

  if (FORBIDDEN_HOSTNAMES.has(normalized)) {
    throw new SmtpSecurityError(`Connecting to "${normalized}" is forbidden.`);
  }

  for (const suffix of FORBIDDEN_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      throw new SmtpSecurityError(`Connecting to internal host "${normalized}" is forbidden.`);
    }
  }

  if (net.isIP(normalized)) {
    if (isPrivateOrReservedIp(normalized)) {
      throw new SmtpSecurityError(`Connecting to private IP "${normalized}" is forbidden.`);
    }
    return;
  }

  // Resolve hostname via DNS
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(normalized, { all: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SmtpSecurityError(`Could not resolve host "${normalized}": ${message || 'DNS resolution failed'}.`);
  }

  if (!records || records.length === 0) {
    throw new SmtpSecurityError(`No DNS records found for "${normalized}".`);
  }

  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new SmtpSecurityError(
        `Host "${normalized}" resolves to forbidden IP "${record.address}".`,
      );
    }
  }
}

/**
 * Custom DNS lookup callback for nodemailer transport to prevent DNS rebinding
 * at socket connection time.
 */
export function createSecureLookup() {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err);

      if (Array.isArray(address)) {
        for (const item of address) {
          if (isPrivateOrReservedIp(item.address)) {
            return callback(new Error(`Connecting to private IP address is forbidden (${item.address}).`));
          }
        }
        return callback(null, address, family);
      }

      if (typeof address === 'string' && isPrivateOrReservedIp(address)) {
        return callback(new Error(`Connecting to private IP address is forbidden (${address}).`));
      }

      callback(null, address, family);
    });
  };
}

export class SmtpSecurityError extends Error {
  readonly code = 'smtp_host_forbidden';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SmtpSecurityError';
  }
}
