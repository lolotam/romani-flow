import type { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import { getWorkspaceSmtp, upsertWorkspaceSmtp, deleteWorkspaceSmtp } from '../repositories/smtpSettings.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';
import { mailboxOf } from '../services/emailAddress.js';
import type { Mailer } from '../services/mailer.js';
import { assertPublicHost, SmtpSecurityError } from '../services/smtpSecurity.js';

/**
 * The relay settings of one workspace.
 *
 * One relay per workspace, stored beside the workspace it belongs to. The
 * stored password is never returned to the browser. A workspace without its own
 * relay falls back to the platform default, which only the legacy workspace
 * may use.
 */
export function registerWorkspaceSmtpRoutes(
  router: Router,
  deps: { config: AppConfig; db: Db; mailer: Mailer },
): void {
  const { config, db, mailer } = deps;

  router.get(
    '/smtp',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      const custom = getWorkspaceSmtp(db, scope.workspaceId);
      if (custom) {
        res.json({
          data: {
            configured: true,
            isCustom: true,
            host: custom.host,
            port: custom.port,
            secure: custom.secure,
            user: custom.user,
            from: custom.from,
            updatedAt: custom.updated_at,
          },
          error: null,
        });
        return;
      }

      const isLegacy = scope.workspaceId === LEGACY_WORKSPACE_ID;
      res.json({
        data: {
          configured: isLegacy && mailer.isConfigured({ workspaceId: scope.workspaceId }),
          isCustom: false,
          host: isLegacy ? config.smtp.host : '',
          port: isLegacy ? config.smtp.port : 587,
          secure: isLegacy ? config.smtp.secure : false,
          user: isLegacy ? config.smtp.user : '',
          from: isLegacy ? config.smtp.from : '',
          updatedAt: null,
        },
        error: null,
      });
    }),
  );

  router.put(
    '/smtp',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      const rawPort = req.body?.port;
      const rawSecure = req.body?.secure;
      const user = typeof req.body?.user === 'string' ? req.body.user.trim() : '';
      const pass = typeof req.body?.pass === 'string' ? req.body.pass : '';
      const from = typeof req.body?.from === 'string' ? req.body.from.trim() : '';

      if (rawPort !== undefined && (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535)) {
        res.status(400).json({
          data: null,
          error: { message: 'Port must be an integer between 1 and 65535.', code: 'invalid_smtp_settings' },
        });
        return;
      }
      const port = rawPort === undefined ? 587 : rawPort;

      if (rawSecure !== undefined && typeof rawSecure !== 'boolean') {
        res.status(400).json({
          data: null,
          error: { message: 'Secure must be a boolean.', code: 'invalid_smtp_settings' },
        });
        return;
      }
      const secure = rawSecure === true;

      if (!host || !user || !pass || !from) {
        res.status(400).json({
          data: null,
          error: { message: 'host, user, pass, and from address are required.', code: 'invalid_smtp_settings' },
        });
        return;
      }

      // A display name alone is not a sender: the relay would refuse it later
      // with a message that names nothing the operator can change.
      if (!mailboxOf(from)) {
        res.status(400).json({
          data: null,
          error: {
            message: 'The sender address must contain an email address, for example "Company <no-reply@example.com>".',
            code: 'invalid_smtp_settings',
          },
        });
        return;
      }

      try {
        await assertPublicHost(host);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const code = err instanceof SmtpSecurityError ? err.code : 'smtp_host_forbidden';
        res.status(400).json({
          data: null,
          error: { message: error.message || 'SMTP host is forbidden.', code },
        });
        return;
      }

      upsertWorkspaceSmtp(db, scope.workspaceId, { host, port, secure, user, pass, from });
      res.json({
        data: {
          configured: true,
          isCustom: true,
          host,
          port,
          secure,
          user,
          from,
        },
        error: null,
      });
    }),
  );

  router.delete(
    '/smtp',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      deleteWorkspaceSmtp(db, scope.workspaceId);
      res.json({ data: { deleted: true }, error: null });
    }),
  );
}
