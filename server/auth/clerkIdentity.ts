import { clerkClient, getAuth } from '@clerk/express';
import type { Identity, IdentityResolver } from './types.js';

const CACHE_TTL_MS = 60_000;

interface Cached<T> {
  value: T;
  expiresAt: number;
}

/** Resolves the session through Clerk and briefly caches backend profile reads. */
export function createClerkIdentityResolver(): IdentityResolver {
  const users = new Map<string, Cached<Pick<Identity, 'email' | 'emailVerified' | 'name'>>>();
  const organizations = new Map<string, Cached<string>>();

  return async req => {
    const auth = getAuth(req);
    if (!auth.userId) return null;

    let profile = users.get(auth.userId);
    if (!profile || profile.expiresAt <= Date.now()) {
      const user = await clerkClient.users.getUser(auth.userId);
      const primary = user.primaryEmailAddress;
      const email = primary?.emailAddress.trim() || null;
      profile = {
        value: {
          email,
          emailVerified: primary?.verification?.status === 'verified',
          name: user.fullName ?? user.username ?? email ?? 'User',
        },
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      users.set(auth.userId, profile);
    }

    let orgName: string | null = null;
    if (auth.orgId) {
      const cached = organizations.get(auth.orgId);
      if (cached && cached.expiresAt > Date.now()) {
        orgName = cached.value;
      } else {
        const organization = await clerkClient.organizations.getOrganization({ organizationId: auth.orgId });
        orgName = organization.name;
        organizations.set(auth.orgId, { value: orgName, expiresAt: Date.now() + CACHE_TTL_MS });
      }
    }

    return {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      orgRole: auth.orgRole ?? null,
      orgName,
      ...profile.value,
    };
  };
}
