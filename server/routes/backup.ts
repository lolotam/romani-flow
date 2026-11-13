import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import type { Row } from '../repositories/base.js';
import { PLATFORM, setSetting } from '../repositories/settings.js';
import type { DocumentService } from '../services/documentService.js';
import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';

/**
 * Backup and erase.
 *
 * Both operations used to be browser-local (localStorage export and
 * `localStorage.removeItem`), which meant the "backup" only ever contained what
 * that one browser had seen. They now run against the server database.
 *
 * Both are confined to the caller's workspace: an export never contains another
 * workspace's rows, and an erase never touches them.
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
    asyncHandler(async (req, res) => {
      const ws = tenantOf(req).workspaceId;
      const data: Record<string, unknown[]> = {};

      for (const table of [...BUSINESS_TABLES, 'whatsapp_recipients', 'whatsapp_jobs', 'whatsapp_attempts']) {
        data[table] = db.prepare(`SELECT * FROM "${table}" WHERE workspace_id = ?`).all(ws) as Row[];
      }

      // The accounts and the settings are included without the password
      // hashes, so a restore keeps the administrators and the configuration.
      data.admin_users = (
        db
          .prepare(
            `SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
               FROM admin_users WHERE workspace_id = ? ORDER BY created_at`,
          )
          .all(ws) as Row[]
      );
      // Only the workspace's own settings; platform settings belong to no workspace.
      data.settings = db.prepare('SELECT key, value, updated_at FROM workspace_settings WHERE workspace_id = ?').all(ws) as Row[];

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
    asyncHandler(async (req, res) => write(async () => {
      const scope = tenantOf(req);
      const ws = scope.workspaceId;
      // The files are collected before the rows disappear, because afterwards
      // there would be nothing left that points at them.
      const filePaths: string[] = [];

      for (const row of db.prepare('SELECT file_path FROM documents WHERE workspace_id = ?').all(ws) as Row[]) {
        if (row.file_path) filePaths.push(String(row.file_path));
      }
      for (const row of db.prepare('SELECT photo_path FROM employees WHERE workspace_id = ?').all(ws) as Row[]) {
        if (row.photo_path) filePaths.push(String(row.photo_path));
      }
      for (const row of db.prepare('SELECT file_path FROM pending_uploads WHERE workspace_id = ?').all(ws) as Row[]) {
        if (row.file_path) filePaths.push(String(row.file_path));
      }
      for (const row of db.prepare('SELECT file_path FROM upload_cleanup_queue WHERE workspace_id = ?').all(ws) as Row[]) {
        if (row.file_path) filePaths.push(String(row.file_path));
      }
      const uniquePaths = [...new Set(filePaths)];

      // The business data is wiped, but the accounts and the settings survive so
      // the operator is not locked out of the application.
      db.exec('PRAGMA foreign_keys = OFF;');
      try {
        db.exec('BEGIN');
        setSetting(db, PLATFORM, 'document_drafts.erase_active', true);
        // Keep failed removals discoverable after business rows are erased.
        for (const path of uniquePaths) {
          db.prepare('INSERT OR IGNORE INTO upload_cleanup_queue(file_path,created_at,workspace_id) VALUES(?,?,?)').run(path, new Date().toISOString(), ws);
        }
        for (const table of BUSINESS_TABLES) {
          db.prepare(`DELETE FROM "${table}" WHERE workspace_id = ?`).run(ws);
        }
        db.prepare('DELETE FROM pending_uploads WHERE workspace_id = ?').run(ws);
        db.prepare('DELETE FROM form_defaults WHERE workspace_id = ?').run(ws);
        // Keep revision tombstones so pre-erase autosaves cannot resurrect private draft text.
        db.prepare("UPDATE document_drafts SET values_json=NULL,revision=lower(hex(randomblob(16))),updated_at=? WHERE workspace_id = ?")
          .run(new Date().toISOString(), ws);
        setSetting(db, scope, 'document_drafts.epoch', randomUUID());
        db.prepare('DELETE FROM expiry_notifications WHERE workspace_id = ?').run(ws);
        // Audit/recipient configuration survive business erase; sending requires deliberate re-enable.
        setSetting(db, scope, 'whatsapp.enabled', false);
        setSetting(db, scope, 'whatsapp.last_enqueue_date', '');
        db.prepare("UPDATE whatsapp_jobs SET state='cancelled',error_code='no_longer_eligible',updated_at=? WHERE workspace_id=? AND instance=? AND state IN ('pending','retryable_failed','permanent_failed')")
          .run(new Date().toISOString(), ws, reminders.auditInstance);

        // The seed marker is written here as well: erasing the data must never
        // let the next boot import the seed and resurrect it.
        setSetting(db, PLATFORM, 'system.seed_version', '1');
        db.prepare("DELETE FROM settings WHERE key='document_drafts.erase_active'").run();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }

      // The files are removed only after the transaction succeeded, so a
      // failure leaves the data and the files consistent with each other.
      const removed = await documents.cleanupTrackedFiles(uniquePaths);
      const pending = db.prepare('SELECT count(*) count FROM upload_cleanup_queue WHERE workspace_id = ?').get(ws) as { count: number };

      res.json({
        data: { erased: BUSINESS_TABLES, filesRemoved: removed, filesPendingCleanup: pending.count, at: new Date().toISOString() },
        error: null,
      });
    })),
  );

  return router;
}
