import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  toSessionUser,
} from '../middleware/auth.js';
import {
  findAdminByEmail,
  touchLastLogin,
  verifyPassword,
} from '../repositories/adminUsers.js';

/**
 * Authentication routes.
 *
 * Login issues a signed session cookie; no token is ever exposed to page
 * JavaScript.
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

export function createAuthRouter(config: AppConfig, db: Db): Router {
  const router = Router();

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
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

      res.json({ data: { user }, error: null });
    }),
  );

  router.post('/logout', (_req, res) => {
    clearSessionCookie(config, res);
    res.json({ data: { loggedOut: true }, error: null });
  });

  router.get('/me', requireAuth(config, db), (req, res) => {
    res.json({ data: { user: req.user }, error: null });
  });

  return router;
}
