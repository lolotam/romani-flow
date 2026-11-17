import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { isSmtpConfigured, loadConfig, validateConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { runMigrations } from './db/migrator.js';
import { defaultSeedFile, seedDatabase } from './db/seed.js';
import { applyOwnerCatalogs } from './db/ownerCatalogs.js';
import { applyLegacyClaimEmail, legacyClaimIsUnconfigured } from './repositories/workspaces.js';
import { CronService } from './services/cronService.js';
import { DocumentService } from './services/documentService.js';
import { Mailer } from './services/mailer.js';
import { StorageService } from './services/storageService.js';
import { createReminderRuntime } from './whatsapp/runtime.js';
import { drainApplication } from './shutdown.js';
import { stopRequestWork } from './middleware/requestWork.js';
import { runtimeLine, safeErrorLine } from './services/runtime.js';

/**
 * Server bootstrap.
 *
 * Order matters: configuration is validated before anything is opened, the
 * database is migrated before the seed runs, and the scheduler is armed only
 * after everything else is ready.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(here, '..');

/**
 * The volume marker.
 *
 * A writable `/data` directory proves nothing: the container creates it itself.
 * The operator prepares a marker file on the host, so its absence means the
 * volume was never mounted and the data would be lost with the container.
 */
const VOLUME_MARKER = '.romani-volume';

function assertVolumeIsMounted(dataDir: string, isProduction: boolean): void {
  if (!isProduction) return;

  const marker = path.join(dataDir, VOLUME_MARKER);
  if (!fs.existsSync(marker)) {
    throw new Error(
      `The persistent volume is not mounted.\n` +
        `Expected the marker file "${marker}" to exist.\n` +
        `Create it on the host and mount that directory into the container:\n` +
        `  sudo touch /opt/romani/data/${VOLUME_MARKER}\n` +
        `  # Dokploy: Mounts → bind ${VOLUME_MARKER} → /data`,
    );
  }
}

/**
 * A fatal error stops the process instead of leaving it half-broken.
 *
 * An uncaught exception means execution already left its recovery boundary,
 * so the state of the process is unknown: serving more traffic on it would
 * turn one failure into many. The process stops accepting traffic, writes
 * what broke to the log, and exits with a failing code so the supervisor
 * starts a clean one.
 */
function guardProcess(stop: () => void): void {
  const fatal = (kind: string, error: unknown) => {
    console.error(`[server] fatal ${kind}, the process stops: ${safeErrorLine(error)}`);
    console.error(runtimeLine('runtime'));
    stop();
  };
  process.on('uncaughtException', (error: unknown) => fatal('exception', error));
  process.on('unhandledRejection', (reason: unknown) => fatal('rejection', reason));
}

/**
 * A line about the process, once a minute.
 *
 * The uptime shows whether the container was restarted, and the memory shows
 * how close it is to the limit of the host. Both questions have only ever been
 * answerable from the log of a deployment that is not on this machine.
 */
function startHeartbeat(): void {
  const timer = setInterval(() => console.log(runtimeLine('runtime')), 60_000);
  timer.unref();
}

async function main(): Promise<void> {
  const config = loadConfig();
  validateConfig(config);
  if (!isSmtpConfigured(config)) console.warn('[server] WARNING: mail not configured');

  console.log('[server] starting ROMANI Flow API');
  console.log(`[server] environment : ${config.env}`);
  console.log(`[server] data dir    : ${config.dataDir}`);
  console.log(`[server] uploads dir : ${config.uploadsDir}`);

  fs.mkdirSync(config.dataDir, { recursive: true });
  assertVolumeIsMounted(config.dataDir, config.env === 'production');

  const db = openDatabase(config.dbPath);

  const migrations = runMigrations(db, path.join(projectRoot, 'server', 'db', 'migrations'));
  if (migrations.applied.length > 0) {
    console.log(`[server] applied migrations: ${migrations.applied.join(', ')}`);
  }

  // The address that may claim the legacy workspace comes from the environment
  // and is never logged: only the fact that it was written is reported.
  if (config.legacyClaimEmail && applyLegacyClaimEmail(db, config.legacyClaimEmail)) {
    console.log('[server] legacy workspace claim address configured');
  }
  if (config.authProvider === 'clerk' && legacyClaimIsUnconfigured(db)) {
    console.warn('[server] WARNING: the legacy workspace is unlinked and its claim address is not configured');
  }

  const storage = new StorageService(config.uploadsDir);
  storage.ensureDirectories();

  const mailer = new Mailer(config);
  const cron = new CronService(db, mailer);
  const documents = new DocumentService(db, storage);
  const reminders = createReminderRuntime(db, config.whatsapp);

  const seed = await seedDatabase(db, {
    seedFile: defaultSeedFile(projectRoot),
    adminEmails: config.adminSeedEmails,
    adminPassword: config.adminSeedPassword,
  });
  applyOwnerCatalogs(db);

  if (seed.adminsCreated.length > 0) {
    console.log(`[server] created admin accounts: ${seed.adminsCreated.join(', ')}`);
  }
  const imported = Object.entries(seed.imported)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${table}=${count}`);
  if (imported.length > 0) {
    console.log(`[server] imported seed data: ${imported.join(', ')}`);
  }
  if (seed.seedSkippedReason) {
    console.log(`[server] seed skipped: ${seed.seedSkippedReason}`);
  }
  if (seed.adminSeedSkippedReason) {
    const admins = (db.prepare('SELECT COUNT(*) AS total FROM admin_users').get() as { total: number }).total;
    if (admins === 0) {
      console.error(
        `[server] WARNING: no administrator exists and none can be created: ${seed.adminSeedSkippedReason}. ` +
          'Set ADMIN_SEED_EMAILS and ADMIN_SEED_PASSWORD and restart.',
      );
    }
  }

  const staticDir = path.join(projectRoot, 'dist');
  const app = createApp({ config, db, mailer, cron, storage, documents, staticDir, reminders });

  cron.reschedule();
  reminders.start();

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  });

  startHeartbeat();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);
    void drainApplication({ server, stopReminders: () => reminders.stop(),
      stopCron: () => cron.shutdown(), stopHandlers: () => stopRequestWork(app),
      closeDatabase: () => closeDatabase(db), exit: code => process.exit(code) });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A fatal error stops the process. The state after an uncaught exception is
  // unknown, so the API stops accepting traffic and leaves the restart to the
  // supervisor. The exit code is a failure, never a success.
  guardProcess(() => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forced = setTimeout(() => process.exit(1), 5_000);
    server.close(() => {
      clearTimeout(forced);
      process.exit(1);
    });
  });
}

main().catch((error) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
