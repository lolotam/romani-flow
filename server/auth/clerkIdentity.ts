import { clerkClient, getAuth } from '@clerk/express';
import type { Identity, IdentityResolver } from './types.js';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;

interface Cached<T> {
  value: T;
  expiresAt: number;
}

function writeCache<T>(cache: Map<string, Cached<T>>, key: string, value: T): void {
  const now = Date.now();
  cache.delete(key);
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cachedKey);
  }
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

async function cachedValue<T>(cache: Map<string, Cached<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await read();
    writeCache(cache, key, value);
    return value;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

/** Resolves the session through Clerk and briefly caches backend profile reads. */
export function createClerkIdentityResolver(): IdentityResolver {
  const users = new Map<string, Cached<Pick<Identity, 'email' | 'emailVerified' | 'name'>>>();
  const organizations = new Map<string, Cached<string>>();

  return async req => {
    const auth = getAuth(req);
    if (!auth.userId) return null;

    const profile = await cachedValue(users, auth.userId, async () => {
      const user = await clerkClient.users.getUser(auth.userId!);
      const primary = user.primaryEmailAddress;
      const email = primary?.emailAddress.trim() || null;
      return {
        email,
        emailVerified: primary?.verification?.status === 'verified',
        name: user.fullName ?? user.username ?? email ?? 'User',
      };
    });

    const orgName = auth.orgId ? await cachedValue(organizations, auth.orgId, async () => {
      const organization = await clerkClient.organizations.getOrganization({ organizationId: auth.orgId! });
      return organization.name;
    }) : null;

    return {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      orgRole: auth.orgRole ?? null,
      orgName,
      ...profile,
    };
  };
}
