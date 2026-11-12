import path from 'node:path';
import cookieParser from 'cookie-parser';
import cronEngine from 'node-cron';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { clerkMiddleware } from '@clerk/express';
import type { AppConfig } from './config.js';
import type { Db } from './db/connection.js';
import { requireAuth, requireAdmin, requireRole, tenantOf } from './middleware/auth.js';
import { createClerkIdentityResolver } from './auth/clerkIdentity.js';
import { isPlatformAdmin, requireSignedIn, requireWorkspace } from './auth/middleware.js';
import type { IdentityResolver } from './auth/types.js';
import { createClerkWebhookRouter } from './auth/webhook.js';
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
import { mayChangeSchedule, type CronService } from './services/cronService.js';
import type { DocumentService } from './services/documentService.js';
import type { Mailer } from './services/mailer.js';
import type { StorageService } from './services/storageService.js';
import type { WhatsAppReminders } from './notifications/whatsapp/service.js';
import { createReminderRuntime } from './whatsapp/runtime.js';
import { createReminderRouter } from './notifications/whatsapp/routes.js';
import { createDocumentDraftsRouter } from './routes/documentDrafts.js';
import { createDocumentExtractionRouter } from './routes/documentExtraction.js';
import { createExtractionService, type ExtractionClock } from './extraction/service.js';
import { createDefaultTransport, type ExtractionTransport } from './extraction/http.js';
import type { DecoderFactory } from './extraction/images.js';
import { assertCurrentDraft, draftReference } from './repositories/documentDrafts.js';
import { RepositoryError } from './repositories/base.js';
import { PLATFORM, setSetting } from './repositories/settings.js';
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
  /** The injected provider transport. A test always injects its own. */
  extractionTransport?: ExtractionTransport;
  /** The injected clock of the extraction pipeline. */
  extractionClock?: ExtractionClock;
  /** The injected image decoder. The native decoder stays the default. */
  decoderFactory?: DecoderFactory;
  /** Clerk is the only auth boundary replaced by tests. */
  identityResolver?: IdentityResolver;
}

export function createApp(deps: AppDependencies): Express {
  const { config, db, mailer, cron, storage, documents, staticDir } = deps;
  const reminders = deps.reminders ?? createReminderRuntime(db, config.whatsapp);
  documents.configureNotifications({ coordinator: reminders.coordinator, changed: () => reminders.reconcile() });
  cron.setReminderEnqueue(reminders.scope, () => reminders.schedule());
  const app = express();
  app.locals.identityResolver = deps.identityResolver ?? createClerkIdentityResolver();

  // One service per application. The transport is injected, so the pipeline
  // never reaches a provider by accident.
  const extraction = createExtractionService(
    config,
    db,
    deps.extractionTransport ?? createDefaultTransport(config.env),
    deps.extractionClock,
  );

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

  // The cookie parser runs before the extraction route: the route needs the
  // session, and it brings its own body parser for the prepared document.
  app.use(cookieParser());
  if (config.authProvider === 'clerk') {
    app.use('/api', clerkMiddleware({
      secretKey: config.clerkSecretKey ?? undefined,
      publishableKey: config.clerkPublishableKey ?? undefined,
    }));
  }

  const authenticated = config.authProvider === 'clerk' ? requireWorkspace(db) : requireAuth(config, db);
  const signedIn = config.authProvider === 'clerk' ? requireSignedIn(db) : requireAuth(config, db);

  if (config.authProvider === 'clerk') {
    app.use('/api/webhooks/clerk', express.raw({ type: 'application/json', limit: '2mb' }), createClerkWebhookRouter(config, db));
  }

  // The extraction route owns its body parser, so it is mounted before the
  // global parser: the global limit of two megabytes stays untouched.
  app.use(
    '/api/document-extraction',
    authenticated,
    requireAdmin,
    createDocumentExtractionRouter(config, db, extraction, deps.decoderFactory),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Public endpoints.
  app.use('/health', createRootHealthRouter(db, () => mailer.isConfigured()));
  app.use('/api/health', createHealthRouter(db));
  app.use('/api/auth', createAuthRouter(config, db, authenticated));
  app.use('/api/whatsapp/webhook', createPairingWebhook(config.whatsapp));
  app.get('/api/platform/me', signedIn, (req, res) => {
    res.json({ data: { isPlatformAdmin: isPlatformAdmin(config, req) }, error: null });
  });

  // Everything below requires a session and a tenant selected by the server.
  app.use('/api/whatsapp', authenticated, createPairingRouter(config.whatsapp, config.env, reminders));
  app.use('/api/whatsapp', authenticated, createReminderRouter(reminders, config.env));
  app.use('/api/form-defaults', authenticated, createFormDefaultsRouter(db));
  app.use('/api/document-drafts', authenticated, createDocumentDraftsRouter(db, reminders.coordinator));

  app.use('/api/settings', authenticated, createSettingsRouter(config, db, cron, reminders, extraction));
  app.use('/api/files', authenticated, createFilesRouter(config, db, storage, documents));
  app.use('/api/email', authenticated, createEmailRouter(config, db, mailer, cron, storage));
  app.use('/api/backup', authenticated, createBackupRouter(db, documents, reminders));

  app.get(
    '/api/cron/status',
    authenticated,
    (req: Request, res: Response) => {
      res.json({ data: cron.status(tenantOf(req)), error: null });
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

      const scope = tenantOf(req);
      const current = cron.currentSchedule();
      if (schedule !== current && !mayChangeSchedule(scope)) {
        res.status(403).json({
          data: null,
          error: { message: 'The reminder schedule is managed by the platform.', code: 'schedule_platform_managed' },
        });
        return;
      }
      if (schedule !== current) setSetting(db, PLATFORM, 'cron.schedule', schedule);
      if (enabled !== undefined) setSetting(db, scope, 'cron.enabled', enabled);

      cron.reschedule();
      res.json({ data: cron.status(scope), error: null });
    },
  );

  // The document writes live in their own router: `DocumentService` owns the
  // file lifecycle and performs the row write and the upload claim in one
  // transaction.
  app.use('/api/documents', authenticated, createDocumentsRouter(db, documents));

  app.put(
    '/api/documents/:id/file',
    authenticated,
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const uploadId = typeof req.body?.upload_id === 'string' ? req.body.upload_id : '';
      if (!uploadId) {
        res.status(400).json({
          data: null,
          error: { message: 'An upload_id is required.', code: 'missing_upload' },
        });
        return;
      }

      const draftScope = 'edit:' + String(req.params.id);
      const draft = req.body?.draft === undefined ? undefined : draftReference(req.body.draft);
      if (draft && draft.scope !== draftScope) throw new RepositoryError('Draft does not match this document.', 'invalid_draft', 400);
      const updated = await documents.replaceFile(tenantOf(req), String(req.params.id), uploadId,
        draft ? { userId: req.user!.id, scope: draftScope } : undefined,
        draft ? () => assertCurrentDraft(db, tenantOf(req), req.user!.id, draft) : undefined);
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
    requireRole('editor'),
    asyncHandler(async (req, res) => {
      const updated = await documents.detachFile(tenantOf(req), String(req.params.id));
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
      transformWrite: (payload, db, scope, existing) => prepareEmployee(payload, db, scope, existing),
      aroundWrite: action => reminders.aroundWrite(action),
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
    aroundWrite: action => reminders.aroundWrite(action), afterWrite: () => reminders.reconcile(),
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
