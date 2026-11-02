import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config.js';
import { findAdminById, type AdminUser } from '../repositories/adminUsers.js';
import type { Db } from '../db/connection.js';

/**
 * Session authentication.
 *
 * A signed JWT lives in an httpOnly cookie, so the browser never exposes the
 * token to JavaScript and a cross-site request cannot read it.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      db?: Db;
    }
  }
}

export function signSession(
  config: AppConfig,
  user: SessionUser,
): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret as string,
    { expiresIn: config.jwtTtlSeconds },
  );
}

export function setSessionCookie(config: AppConfig, res: Response, token: string): void {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: config.jwtTtlSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(config: AppConfig, res: Response): void {
  res.clearCookie(config.cookieName, { path: '/' });
}

/** Reads and verifies the session cookie. Returns null when there is no valid one. */
export function readSession(config: AppConfig, req: Request): SessionUser | null {
  const token = req.cookies?.[config.cookieName];
  if (typeof token !== 'string' || token.length === 0) return null;

  try {
    const payload = jwt.verify(token, config.jwtSecret as string) as {
      sub: string;
      email: string;
      name: string;
      role: string;
    };
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

/** Rejects the request with 401 when no valid session is present. */
export function requireAuth(config: AppConfig, db: Db) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = readSession(config, req);
    if (!session) {
      res.status(401).json({
        data: null,
        error: { message: 'Authentication required.', code: 'unauthenticated' },
      });
      return;
    }

    // The session must still map to an active account. The role is read from
    // the database rather than from the token, so a demoted account loses its
    // privileges without waiting for the token to expire.
    const admin = findAdminById(db, session.id);
    if (!admin || admin.is_active !== 1) {
      clearSessionCookie(config, res);
      res.status(401).json({
        data: null,
        error: { message: 'Session is no longer valid.', code: 'unauthenticated' },
      });
      return;
    }

    req.user = { ...session, role: admin.role };
    next();
  };
}

/** Restricts a route to administrator accounts. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({
      data: null,
      error: { message: 'Administrator privileges are required.', code: 'forbidden' },
    });
    return;
  }
  next();
}

export function toSessionUser(admin: AdminUser): SessionUser {
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}
