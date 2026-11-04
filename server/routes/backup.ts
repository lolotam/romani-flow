import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import type { Row } from '../repositories/base.js';
import { setSetting } from '../repositories/settings.js';
import type { DocumentService } from '../services/documentService.js';
import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';

/**
 * Backup and erase.
 *
 * Both operations used to be browser-local (localStorage export and
 * `localStorage.removeItem`), which meant the "backup" only ever contained what
 * that one browser had seen. They now run against the server database.
 */

const BUSINESS_TABLES = [
  'documents',
  'employees',
  'companies',
  'document_types',
  'ministries',
  'positions',
];

export function createBackupRouter(db: Db, documents: DocumentService, reminders: WhatsAppReminders): Router {
  const router = Router();
  const write = <T>(action: () => Promise<T>): Promise<T> => reminders.coordinator.runExclusive(action);

  router.get(
    '/export',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const data: Record<string, unknown[]> = {};

      for (const table of [...BUSINESS_TABLES, 'whatsapp_recipients', 'whatsapp_jobs', 'whatsapp_attempts']) {
        data[table] = db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
      }

      // The accounts and the settings are included without the password
      // hashes, so a restore keeps the administrators and the configuration.
      data.admin_users = (
        db
          .prepare(
            `SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
               FROM admin_users ORDER BY created_at`,
          )
          .all() as Row[]
      );
      data.settings = db.prepare('SELECT key, value, updated_at FROM settings').all() as Row[];

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="romani-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.json({
        timestamp: new Date().toISOString(),
        version: '2.0',
        data,
      });
    }),
  );

  router.post(
    '/erase',
    requireAdmin,
    asyncHandler(async (_req, res) => write(async () => {
      // The files are collected before the rows disappear, because afterwards
      // there would be nothing left that points at them.
      const filePaths: string[] = [];

      for (const row of db.prepare('SELECT file_path FROM documents').all() as Row[]) {
        if (row.file_path) filePaths.push(String(row.file_path));
      }
      for (const row of db.prepare('SELECT photo_path FROM employees').all() as Row[]) {
        if (row.photo_path) filePaths.push(String(row.photo_path));
      }
      for (const row of db.prepare('SELECT file_path FROM pending_uploads').all() as Row[]) {
        if (row.file_path) filePaths.push(String(row.file_path));
      }

      // The business data is wiped, but the accounts and the settings survive so
      // the operator is not locked out of the application.
      db.exec('PRAGMA foreign_keys = OFF;');
      try {
        db.exec('BEGIN');
        for (const table of BUSINESS_TABLES) {
          db.prepare(`DELETE FROM "${table}"`).run();
        }
        db.prepare('DELETE FROM pending_uploads').run();
        db.prepare('DELETE FROM form_defaults').run();
        db.prepare('DELETE FROM expiry_notifications').run();
        reminders.reconcile();

        // The seed marker is written here as well: erasing the data must never
        // let the next boot import the seed and resurrect it.
        setSetting(db, 'system.seed_version', '1');

        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }

      // The files are removed only after the transaction succeeded, so a
      // failure leaves the data and the files consistent with each other.
      let removed = 0;
      for (const filePath of filePaths) {
        try {
          if (await documents.removeStoredFile(filePath)) removed += 1;
        } catch (error) {
          console.warn('[backup] a file could not be removed:', error);
        }
      }

      res.json({
        data: { erased: BUSINESS_TABLES, filesRemoved: removed, at: new Date().toISOString() },
        error: null,
      });
    })),
  );

  return router;
}
