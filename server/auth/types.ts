import type { Request } from 'express';

/** The verified session fields plus the backend user's primary email. */
export interface Identity {
  userId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string;
  orgName?: string | null;
}

/** Clerk is the system boundary; tests inject this resolver and nothing else. */
export type IdentityResolver = (req: Request) => Identity | null | Promise<Identity | null>;
