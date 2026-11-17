import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
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
  createAdminWithHash,
  findAdminByEmail,
  hashPassword,
  touchLastLogin,
  verifyPassword,
  type AdminUser,
} from '../repositories/adminUsers.js';
import { mayChangeSchedule } from '../services/cronService.js';
import { getNumber } from '../repositories/settings.js';
import { createWorkspace, isWorkspaceSuspended } from '../repositories/workspaces.js';
import { atomic } from '../notifications/whatsapp/repository.js';

import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { getWorkspaceInstance } from '../whatsapp/instance.js';

/**
 * Authentication routes.
 *
 * Native authentication issuing signed httpOnly JWT session cookies.
 * Supports registration with dedicated isolated workspace creation,
 * rate-limited login, workspace listing, and authenticated session metadata.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function checkOrigin(req: Request, res: Response, config: AppConfig): boolean {
  const origin = req.get('origin');
  if (!origin) {
    if (config.env === 'production') {
      res.status(403).json({
        data: null,
        error: { message: 'Origin header is required.', code: 'origin_forbidden' },
      });
      return false;
    }
    return true;
  }
  const host = req.get('host');
  const allowed = [
    `https://${host}`,
    `http://${host}`,
    'https://romani.curemedkw.com',
  ];
  if (!allowed.includes(origin)) {
    res.status(403).json({
      data: null,
      error: { message: 'Foreign origin refused.', code: 'origin_forbidden' },
    });
    return false;
  }
  return true;
}

export function createAuthRouter(
  config: AppConfig,
  db: Db,
  authenticated: RequestHandler,
  reminders?: WhatsAppReminders,
): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json({
      data: {
        provider: 'legacy',
        publishableKey: null,
      },
      error: null,
    });
  });

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      if (!req.is('application/json')) {
        res.status(415).json({
          data: null,
          error: { message: 'JSON body required.', code: 'unsupported_media_type' },
        });
        return;
      }

      if (!checkOrigin(req, res, config)) return;

      const ip = req.ip ?? 'unknown';
      if (config.env !== 'test' && isRateLimited(`reg:${ip}`)) {
        res.status(429).json({
          data: null,
          error: { message: 'Too many registration attempts. Try again later.', code: 'rate_limited' },
        });
        return;
      }

      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const rawWsName = typeof req.body?.workspaceName === 'string'
        ? req.body.workspaceName
        : (typeof req.body?.companyName === 'string' ? req.body.companyName : '');
      const workspaceName = (rawWsName.trim() || name || email.split('@')[0] || 'Workspace').slice(0, 120);

      if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
        res.status(400).json({
          data: null,
          error: { message: 'A valid email address is required.', code: 'invalid_email' },
        });
        return;
      }

      if (!password || password.length < 8) {
        res.status(400).json({
          data: null,
          error: { message: 'Password must be at least 8 characters long.', code: 'password_too_short' },
        });
        return;
      }

      if (Buffer.byteLength(password, 'utf8') > 72) {
        res.status(400).json({
          data: null,
          error: { message: 'Password cannot exceed 72 bytes.', code: 'password_too_long' },
        });
        return;
      }

      const existing = findAdminByEmail(db, email);
      if (existing) {
        res.status(409).json({
          data: null,
          error: { message: 'An account with this email already exists.', code: 'email_already_exists' },
        });
        return;
      }

      const passwordHash = await hashPassword(password);
      const wsId = `ws_${randomBytes(8).toString('hex')}`;

      let admin: AdminUser;
      try {
        admin = atomic(db, () => {
          const doubleCheck = findAdminByEmail(db, email);
          if (doubleCheck) {
            const err = new Error('email_already_exists');
            (err as any).code = 'EMAIL_EXISTS';
            throw err;
          }
          createWorkspace(db, { id: wsId, name: workspaceName });
          return createAdminWithHash(db, {
            email,
            name: (name || email.split('@')[0]).slice(0, 100),
            passwordHash,
            role: 'admin',
            workspaceId: wsId,
          });
        });
      } catch (err: any) {
        if (
          err.code === 'EMAIL_EXISTS' ||
          err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          err.code === 'SQLITE_CONSTRAINT' ||
          err.errcode === 2067 ||
          err.message?.includes('UNIQUE constraint failed')
        ) {
          res.status(409).json({
            data: null,
            error: { message: 'An account with this email already exists.', code: 'email_already_exists' },
          });
          return;
        }
        throw err;
      }

      if (reminders) {
        try {
          const inst = getWorkspaceInstance(db, wsId, reminders.instance);
          reminders.forWorkspace({ workspaceId: wsId }, inst).start();
        } catch {
          // Ignored if reminders unconfigured
        }
      }

      const user = toSessionUser(admin);
      setSessionCookie(config, res, signSession(config, user));

      res.status(201).json({
        data: {
          user,
          workspaceId: wsId,
          workspaceName,
          expiryWarningDays: 30,
        },
        error: null,
      });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      if (!req.is('application/json')) {
        res.status(415).json({
          data: null,
          error: { message: 'JSON body required.', code: 'unsupported_media_type' },
        });
        return;
      }

      if (!checkOrigin(req, res, config)) return;

      const key = `${req.ip ?? 'unknown'}:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''}`;
      if (config.env !== 'test' && isRateLimited(key)) {
        res.status(429).json({
          data: null,
          error: { message: 'Too many login attempts. Try again later.', code: 'rate_limited' },
        });
        return;
      }

      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
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

      if (isWorkspaceSuspended(db, admin.workspace_id)) {
        res.status(403).json({
          data: null,
          error: { message: 'This workspace is suspended.', code: 'workspace_suspended' },
        });
        return;
      }

      clearAttempts(key);
      touchLastLogin(db, admin.id);

      const user = toSessionUser(admin);
      setSessionCookie(config, res, signSession(config, user));
      const scope = { workspaceId: admin.workspace_id };

      const wsRow = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(admin.workspace_id) as { name: string } | undefined;

      res.json({
        data: {
          user,
          workspaceId: scope.workspaceId,
          workspaceName: wsRow?.name ?? '',
          expiryWarningDays: getNumber(db, scope, 'expiry_warning_days', 30),
        },
        error: null,
      });
    }),
  );

  router.post('/logout', (req, res) => {
    if (!checkOrigin(req, res, config)) return;
    clearSessionCookie(config, res);
    res.json({ data: { loggedOut: true }, error: null });
  });

  router.get('/workspaces', authenticated, (req, res) => {
    const scope = tenantOf(req);
    const rows = db.prepare('SELECT id, name FROM workspaces WHERE id = ?').all(scope.workspaceId);
    res.json({ data: rows, error: null });
  });

  router.get('/me', authenticated, (req, res) => {
    const scope = tenantOf(req);
    const wsRow = db.prepare('SELECT name FROM workspaces WHERE id = ?').get(scope.workspaceId) as { name: string } | undefined;

    res.json({
      data: {
        user: req.user,
        workspaceId: scope.workspaceId,
        workspaceName: wsRow?.name ?? '',
        expiryWarningDays: getNumber(db, scope, 'expiry_warning_days', 30),
        scheduleEditable: mayChangeSchedule(scope),
        whatsappAvailable: true,
      },
      error: null,
    });
  });

  return router;
}
