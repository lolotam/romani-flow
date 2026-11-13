import { Router, type RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  clearSessionCookie,
  setSessionCookie,
  signSession,
  tenantOf,
  toSessionUser,
} from '../middleware/auth.js';
import {
  findAdminByEmail,
  touchLastLogin,
  verifyPassword,
} from '../repositories/adminUsers.js';
import { mayChangeSchedule } from '../services/cronService.js';
import { getNumber } from '../repositories/settings.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';

/**
 * Authentication routes.
 *
 * Legacy login issues a signed session cookie; Clerk sessions stay in Clerk's
 * own httpOnly cookie. Neither scheme exposes a token to page JavaScript.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(key: string): void {
  attempts.delete(key);
}

export function createAuthRouter(
  config: AppConfig,
  db: Db,
  authenticated: RequestHandler,
  /** The workspace that owns the WhatsApp instance (D9). */
  whatsappWorkspaceId: string = LEGACY_WORKSPACE_ID,
): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json({
      data: {
        provider: config.authProvider,
        publishableKey: config.authProvider === 'clerk' ? config.clerkPublishableKey : null,
      },
      error: null,
    });
  });

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      if (config.authProvider === 'clerk') {
        res.status(410).json({
          data: null,
          error: { message: 'Legacy login is disabled.', code: 'legacy_login_disabled' },
        });
        return;
      }

      const key = req.ip ?? 'unknown';
      if (isRateLimited(key)) {
        res.status(429).json({
          data: null,
          error: { message: 'Too many login attempts. Try again later.', code: 'rate_limited' },
        });
        return;
      }

      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!email || !password) {
        res.status(400).json({
          data: null,
          error: { message: 'Email and password are required.', code: 'missing_credentials' },
        });
        return;
      }

      const admin = findAdminByEmail(db, email);
      const valid = admin ? await verifyPassword(password, admin.password_hash) : false;

      if (!admin || !valid || admin.is_active !== 1) {
        res.status(401).json({
          data: null,
          error: { message: 'Invalid email or password.', code: 'invalid_credentials' },
        });
        return;
      }

      clearAttempts(key);
      touchLastLogin(db, admin.id);

      const user = toSessionUser(admin);
      setSessionCookie(config, res, signSession(config, user));
      const scope = { workspaceId: admin.workspace_id };

      res.json({
        data: {
          user,
          workspaceId: scope.workspaceId,
          expiryWarningDays: getNumber(db, scope, 'expiry_warning_days', 30),
        },
        error: null,
      });
    }),
  );

  router.post('/logout', (_req, res) => {
    clearSessionCookie(config, res);
    res.json({ data: { loggedOut: true }, error: null });
  });

  router.get('/me', authenticated, (req, res) => {
    const scope = tenantOf(req);
    // The two capabilities the server enforces on its own: the shared schedule
    // belongs to the legacy workspace, and the WhatsApp instance belongs to the
    // workspace that owns it.
    res.json({
      data: {
        user: req.user,
        workspaceId: scope.workspaceId,
        expiryWarningDays: getNumber(db, scope, 'expiry_warning_days', 30),
        scheduleEditable: mayChangeSchedule(scope),
        whatsappAvailable: scope.workspaceId === whatsappWorkspaceId,
      },
      error: null,
    });
  });

  return router;
}
