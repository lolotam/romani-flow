import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { Identity, IdentityResolver } from './types.js';
import { upsertLocalUser, type LocalUser } from './users.js';
import { resolveWorkspace } from './workspaces.js';

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ data: null, error: { message, code } });
}

function organizationRole(role: string | null): 'owner' | 'editor' | 'viewer' | null {
  if (role === 'org:owner') return 'owner';
  if (role === 'org:editor') return 'editor';
  if (role === 'org:viewer') return 'viewer';
  return null;
}

function setUser(req: Request, identity: Identity, user: LocalUser, role: string): void {
  req.identity = identity;
  req.user = { id: user.id, email: user.email ?? identity.email ?? '', name: user.name ?? identity.name, role };
}

async function signedInUser(db: Db, req: Request, res: Response): Promise<Identity | null> {
  const identity = await (req.app.locals.identityResolver as IdentityResolver)(req);
  if (!identity) {
    fail(res, 401, 'unauthenticated', 'Authentication required.');
    return null;
  }
  const user = upsertLocalUser(db, identity);
  if (user.deleted_at) {
    fail(res, 401, 'unauthenticated', 'This account is no longer active.');
    return null;
  }
  setUser(req, identity, user, organizationRole(identity.orgRole) ?? 'viewer');
  return identity;
}

/** Resolves a signed-in user without requiring an organization, for platform metadata only. */
export function requireSignedIn(db: Db): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    if (await signedInUser(db, req, res)) next();
  });
}

/** Resolves the organization and local workspace; the request never chooses the tenant. */
export function requireWorkspace(db: Db): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const identity = await signedInUser(db, req, res);
    if (!identity) return;
    if (!identity.orgId) {
      fail(res, 403, 'workspace_required', 'An active workspace is required.');
      return;
    }
    const role = organizationRole(identity.orgRole);
    if (!role) {
      fail(res, 403, 'forbidden', 'This organization role is not allowed.');
      return;
    }
    if (role === 'viewer' && !['GET', 'HEAD'].includes(req.method)) {
      fail(res, 403, 'forbidden', 'Viewer accounts have read-only access.');
      return;
    }

    const workspace = resolveWorkspace(db, { ...identity, orgId: identity.orgId });
    if (workspace.suspended_at) {
      fail(res, 403, 'workspace_suspended', 'This workspace is suspended.');
      return;
    }
    req.tenant = { workspaceId: workspace.id };
    req.user!.role = role;
    next();
  });
}

/** Platform administration is an email allowlist, never a workspace permission. */
export function isPlatformAdmin(config: AppConfig, req: Request): boolean {
  const email = req.identity?.email?.trim().toLowerCase();
  return Boolean(req.identity?.emailVerified && email && config.platformAdminEmails.includes(email));
}

export function requirePlatformAdmin(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isPlatformAdmin(config, req)) {
      fail(res, 403, 'forbidden', 'Platform administrator privileges are required.');
      return;
    }
    next();
  };
}
