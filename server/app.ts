import path from 'node:path';
import cookieParser from 'cookie-parser';
import cronEngine from 'node-cron';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AppConfig } from './config.js';
import type { Db } from './db/connection.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { asyncHandler, errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';
import { createBackupRouter } from './routes/backup.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createEmailRouter } from './routes/email.js';
import { createFilesRouter } from './routes/files.js';
import { createHealthRouter, createRootHealthRouter } from './routes/health.js';
import { createResourceRouter } from './routes/resources.js';
import { createSettingsRouter } from './routes/settings.js';
import { createFormDefaultsRouter } from './routes/formDefaults.js';
import { createPairingRouter, createPairingWebhook } from './whatsapp/routes.js';
import type { CronService } from './services/cronService.js';
import type { DocumentService } from './services/documentService.js';
import type { Mailer } from './services/mailer.js';
import type { StorageService } from './services/storageService.js';
import { WhatsAppReminders } from './notifications/whatsapp/service.js';
import { MessageClient } from './whatsapp/messageClient.js';
import { createReminderRouter } from './notifications/whatsapp/routes.js';
import { prepareEmployee } from './notifications/whatsapp/employeePolicy.js';

/**
 * Express application.
 *
 * The API and the built SPA are served from the same origin, so the session
 * cookie works without any CORS configuration.
 */

export interface AppDependencies {
  config: AppConfig;
  db: Db;
  mailer: Mailer;
  cron: CronService;
  storage: StorageService;
  documents: DocumentService;
  staticDir: string;
  reminders?: WhatsAppReminders;
}

export function createApp(deps: AppDependencies): Express {
  const { config, db, mailer, cron, storage, documents, staticDir } = deps;
  const reminders = deps.reminders ?? new WhatsAppReminders(db, config.whatsapp.instance, new MessageClient(config.whatsapp));
  documents.configureNotifications({ coordinator: reminders.coordinator, changed: () => reminders.reconcile() });
  cron.setReminderEnqueue(() => reminders.schedule());
  const app = express();

  app.disable('x-powered-by');
  // The proxy is only trusted when the deployment actually sits behind one —
  // otherwise a direct client could spoof its own address through
  // `X-Forwarded-For` and defeat the login rate limiter.
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
  // Express 5 defaults to the "simple" query parser, which flattens
  // `eq[field]=value` into a single key. The client contract depends on the
  // nested form, so the extended parser is required.
  app.set('query parser', 'extended');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  // Public endpoints.
  app.use('/health', createRootHealthRouter(db, () => mailer.isConfigured()));
  app.use('/api/health', createHealthRouter(db));
  app.use('/api/auth', createAuthRouter(config, db));
  app.use('/api/whatsapp/webhook', createPairingWebhook(config.whatsapp));

  // Everything below requires a session.
  const authenticated = requireAuth(config, db);
  app.use('/api/whatsapp', authenticated, createPairingRouter(config.whatsapp, config.env));
  app.use('/api/whatsapp', authenticated, createReminderRouter(reminders, config.env));
  app.use('/api/form-defaults', authenticated, createFormDefaultsRouter(db));

  app.use('/api/settings', authenticated, createSettingsRouter(config, db, cron, reminders));
  app.use('/api/files', authenticated, createFilesRouter(config, db, storage, documents));
  app.use('/api/email', authenticated, createEmailRouter(config, db, mailer, cron, storage));
  app.use('/api/backup', authenticated, createBackupRouter(db, documents, reminders));

  app.get(
    '/api/cron/status',
    authenticated,
    (_req: Request, res: Response) => {
      res.json({ data: cron.status(), error: null });
    },
  );

  app.put(
    '/api/cron/schedule',
    authenticated,
    requireAdmin,
    (req: Request, res: Response) => {
      const schedule = typeof req.body?.schedule === 'string' ? req.body.schedule.trim() : '';
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;

      if (!schedule) {
        res.status(400).json({
          data: null,
          error: { message: 'A cron expression is required.', code: 'invalid_schedule' },
        });
        return;
      }

      if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(schedule) || !cronEngine.validate(schedule)) {
        res.status(400).json({
          data: null,
          error: {
            message: 'A valid five-field cron expression is required (minute hour day month weekday).',
            code: 'invalid_schedule',
          },
        });
        return;
      }

      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run('cron.schedule', JSON.stringify(schedule), new Date().toISOString());

      if (enabled !== undefined) {
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run('cron.enabled', JSON.stringify(enabled), new Date().toISOString());
      }

      res.json({ data: cron.reschedule(), error: null });
    },
  );

  // The document writes live in their own router: `DocumentService` owns the
  // file lifecycle and performs the row write and the upload claim in one
  // transaction.
  app.use('/api/documents', authenticated, createDocumentsRouter(db, documents));

  app.put(
    '/api/documents/:id/file',
    authenticated,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const uploadId = typeof req.body?.upload_id === 'string' ? req.body.upload_id : '';
      if (!uploadId) {
        res.status(400).json({
          data: null,
          error: { message: 'An upload_id is required.', code: 'missing_upload' },
        });
        return;
      }

      const updated = await documents.replaceFile(String(req.params.id), uploadId);
      if (!updated) {
        res.status(404).json({
          data: null,
          error: { message: 'The document or the upload was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: updated, error: null });
    }),
  );

  app.delete(
    '/api/documents/:id/file',
    authenticated,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const updated = await documents.detachFile(String(req.params.id));
      if (!updated) {
        res.status(404).json({
          data: null,
          error: { message: 'The document was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: updated, error: null });
    }),
  );

  app.use(
    '/api/employees',
    authenticated,
    createResourceRouter(db, 'employees', {
      defaultRelations: ['companies'],
      managedFields: ['photo_path', 'photo_mime_type'],
      transformWrite: (payload, _db, existing) => prepareEmployee(payload, existing),
      aroundWrite: action => reminders.coordinator.runExclusive(action),
      afterWrite: () => reminders.reconcile(),
      transformRead: (row) => ({
        ...row,
        is_active: Boolean(row.is_active),
        driving_license: Boolean(row.driving_license),
        whatsapp_notifications_enabled: Boolean(row.whatsapp_notifications_enabled),
      }),
    }),
  );
  app.use('/api/companies', authenticated, createResourceRouter(db, 'companies', {
    aroundWrite: action => reminders.coordinator.runExclusive(action), afterWrite: () => reminders.reconcile(),
  }));
  app.use('/api/ministries', authenticated, createResourceRouter(db, 'ministries'));
  app.use('/api/document-types', authenticated, createResourceRouter(db, 'document_types'));
  app.use('/api/positions', authenticated, createResourceRouter(db, 'positions'));

  // Static SPA with a history fallback.
  app.use(
    express.static(staticDir, {
      index: false,
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, 'index.html'), (error) => {
      if (error) next(error);
    });
  });

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
