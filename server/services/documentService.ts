import type { Db } from '../db/connection.js';
import {
  findRow,
  insertRow,
  RepositoryError,
  updateRow,
  type Row,
  type Scope,
} from '../repositories/base.js';
import type { StorageService } from './storageService.js';
import type { NotificationCoordinator } from '../notifications/coordinator.js';
import { atomic } from '../notifications/whatsapp/repository.js';
import { resolveDocumentEntity } from './documentEntity.js';

/**
 * Document file lifecycle.
 *
 * One service owns the pairing of a stored file and the record that references
 * it. A new file is always written before the reference is swapped, and the old
 * file is only removed after the database change succeeded — so a failure can
 * never leave a record pointing at a deleted file.
 */

export interface StoredUpload {
  uploadId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

/** The columns a document stores about its attachment. */
export interface StorageFields {
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
}

export interface UploadOwner { userId: string; scope: string }
interface DocumentWriteHooks { completed?: (row: Row) => void; uploadOwner?: UploadOwner }

export class DocumentService {
  private notifications: { coordinator: NotificationCoordinator; changed: () => void } | null = null;
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  configureNotifications(hooks: { coordinator: NotificationCoordinator; changed: () => void }): void {
    this.notifications = hooks;
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    return this.notifications ? this.notifications.coordinator.runExclusive(action) : action();
  }

  /** Stage files under erase's coordinator and check the draft before writing any bytes. */
  stageUploads(scope: Scope, files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>, guard?: () => void, owner?: { userId: string; scope: string }): Promise<StoredUpload[]> {
    return this.serialize(async () => {
      guard?.();
      const uploads: StoredUpload[] = [];
      const paths: string[] = [];
      try {
      for (const file of files) {
        const stored = await this.storage.save(scope.workspaceId, { buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype }, path => {
          this.db.prepare('INSERT INTO upload_cleanup_queue(file_path,created_at,workspace_id) VALUES(?,?,?)').run(path, new Date().toISOString(), scope.workspaceId);
          paths.push(path);
        });
        const upload = this.registerUpload(scope, { fileName: stored.fileName, filePath: stored.relativePath, fileSize: stored.size, mimeType: stored.mimeType });
        if (owner) this.db.prepare('UPDATE pending_uploads SET draft_user_id=?,draft_scope=? WHERE id=? AND workspace_id=?').run(owner.userId, owner.scope, upload.uploadId, scope.workspaceId);
        uploads.push(upload);
        this.db.prepare('DELETE FROM upload_cleanup_queue WHERE file_path=?').run(stored.relativePath);
      }
      return uploads;
      } catch (error) {
        for (const path of paths) {
          try { this.db.prepare('INSERT OR IGNORE INTO upload_cleanup_queue(file_path,created_at,workspace_id) VALUES(?,?,?)').run(path, new Date().toISOString(), scope.workspaceId); }
          catch { console.error('[uploads] could not record cleanup work'); }
        }
        await this.cleanupTrackedFiles(paths);
        throw error;
      }
    });
  }

  /** Reuse a still-pending upload only after validating the current draft. */
  validateStagedUpload(scope: Scope, uploadId: string, guard: () => void, owner?: UploadOwner): Promise<StoredUpload> {
    return this.serialize(async () => {
      guard();
      this.assertUploadOwner(scope, uploadId, owner);
      const upload = this.resolveUpload(scope, uploadId);
      if (!upload || !this.storage.exists(upload.filePath)) throw new RepositoryError('Upload is no longer pending.', 'invalid_upload', 404);
      return upload;
    });
  }

  /** Revoke claimability before unlink; failed cleanup remains durable and retryable. */
  abandonStagedUpload(scope: Scope, uploadId: string, owner: { userId: string; scope: string }, guard: () => void): Promise<{ cleanupPending: boolean }> {
    return this.serialize(async () => {
      guard();
      const ws = scope.workspaceId;
      const row = this.db.prepare('SELECT file_path,draft_user_id,draft_scope FROM pending_uploads WHERE id=? AND workspace_id=?').get(uploadId, ws)
        ?? this.db.prepare('SELECT file_path,draft_user_id,draft_scope FROM upload_cleanup_queue WHERE upload_id=? AND workspace_id=?').get(uploadId, ws);
      if (!row) return { cleanupPending: false };
      if (row.draft_user_id !== owner.userId || row.draft_scope !== owner.scope) {
        throw new RepositoryError('Upload does not belong to this draft.', 'invalid_upload', 403);
      }
      const path = String(row.file_path);
      atomic(this.db, () => {
        const queued = this.db.prepare('SELECT upload_id,draft_user_id,draft_scope FROM upload_cleanup_queue WHERE file_path=?').get(path);
        if (queued && (queued.upload_id !== uploadId || queued.draft_user_id !== owner.userId || queued.draft_scope !== owner.scope)) {
          throw new RepositoryError('Upload cleanup belongs to a different draft.', 'invalid_upload', 409);
        }
        this.db.prepare(`INSERT INTO upload_cleanup_queue(file_path,created_at,upload_id,draft_user_id,draft_scope,workspace_id) VALUES(?,?,?,?,?,?)
          ON CONFLICT(file_path) DO NOTHING`)
          .run(path, new Date().toISOString(), uploadId, owner.userId, owner.scope, ws);
        this.db.prepare('DELETE FROM pending_uploads WHERE id=? AND workspace_id=?').run(uploadId, ws);
      });
      await this.cleanupTrackedFiles([path]);
      return { cleanupPending: Boolean(this.db.prepare('SELECT 1 FROM upload_cleanup_queue WHERE file_path=?').get(path)) };
    });
  }

  /** Failed removals retain durable tracking and never hide the staging error. */
  async cleanupTrackedFiles(paths: string[]): Promise<number> {
    let removed = 0;
    for (const path of paths) {
      try {
        const existed = await this.storage.remove(path);
        this.db.prepare('DELETE FROM pending_uploads WHERE file_path=?').run(path);
        this.db.prepare('DELETE FROM upload_cleanup_queue WHERE file_path=?').run(path);
        if (existed) removed++;
      } catch { console.error('[uploads] cleanup deferred'); }
    }
    return removed;
  }

  /** Records a freshly uploaded file so a record can claim it. */
  registerUpload(scope: Scope, upload: Omit<StoredUpload, 'uploadId'>): StoredUpload {
    const uploadId = globalThis.crypto.randomUUID();

    this.db.prepare(
      `INSERT INTO pending_uploads (id, workspace_id, file_name, file_path, file_size, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uploadId,
      scope.workspaceId,
      upload.fileName,
      upload.filePath,
      upload.fileSize,
      upload.mimeType,
      new Date().toISOString(),
    );

    return { uploadId, ...upload };
  }

  /** Resolves an upload id to its staged file, if it has not been claimed yet. */
  resolveUpload(scope: Scope, uploadId: string): StoredUpload | null {
    const row = this.db.prepare('SELECT * FROM pending_uploads WHERE id = ? AND workspace_id = ?').get(uploadId, scope.workspaceId) as
      | Row
      | undefined;
    if (!row) return null;

    return {
      uploadId: String(row.id),
      fileName: String(row.file_name),
      filePath: String(row.file_path),
      fileSize: Number(row.file_size),
      mimeType: String(row.mime_type),
    };
  }

  /** Marks an upload as claimed so it cannot be used twice. */
  claimUpload(scope: Scope, uploadId: string): void {
    this.db.prepare('DELETE FROM pending_uploads WHERE id = ? AND workspace_id = ?').run(uploadId, scope.workspaceId);
  }

  /** The storage columns for a document, derived from an upload id. */
  storageFields(scope: Scope, uploadId: string, owner?: UploadOwner): StorageFields | null {
    this.assertUploadOwner(scope, uploadId, owner);
    const upload = this.resolveUpload(scope, uploadId);
    if (!upload) return null;

    return {
      file_name: upload.fileName,
      file_path: upload.filePath,
      file_size: upload.fileSize,
      mime_type: upload.mimeType,
    };
  }

  /** Bound draft uploads cannot be validated or claimed in a different account/context. */
  private assertUploadOwner(scope: Scope, uploadId: string, owner?: UploadOwner): void {
    const row = this.db.prepare('SELECT draft_user_id,draft_scope FROM pending_uploads WHERE id=? AND workspace_id=?').get(uploadId, scope.workspaceId);
    if (row && (row.draft_user_id !== null || row.draft_scope !== null) && (row.draft_user_id !== owner?.userId || row.draft_scope !== owner?.scope)) {
      throw new RepositoryError('Upload does not belong to this draft.', 'invalid_upload', 403);
    }
  }

  /**
   * Creates a document and claims its staged upload in one transaction.
   *
   * If the row cannot be written — a foreign key violation, for example — the
   * transaction rolls back and the upload stays pending, so the administrator
   * can correct the data and retry with the same upload id.
   */
  async createDocument(scope: Scope, payload: Row, status: (expiry: string | null) => string, hooks?: DocumentWriteHooks): Promise<Row> {
    // Same coordinator as update/delete, so a create cannot interleave with a backup erase.
    return this.serialize(async () => this.createDocumentLocked(scope, payload, status, hooks));
  }

  private createDocumentLocked(scope: Scope, payload: Row, status: (expiry: string | null) => string, hooks?: DocumentWriteHooks): Row {
    const fields: Row = { ...payload };
    const uploadId = typeof fields.upload_id === 'string' ? fields.upload_id : null;
    delete fields.upload_id;

    this.db.exec('BEGIN');
    try {
      resolveDocumentEntity(this.db, scope, fields);
      const storageFields: StorageFields | null = uploadId ? this.requireUpload(scope, uploadId, hooks?.uploadOwner) : null;
      const expiry = typeof fields.expiry_date === 'string' ? fields.expiry_date : null;

      const row = insertRow(this.db, scope, 'documents', {
        ...fields,
        ...(storageFields ?? {}),
        status: status(expiry),
      });

      if (uploadId) this.claimUpload(scope, uploadId);
      hooks?.completed?.(row);
      this.notifications?.changed();
      this.db.exec('COMMIT');
      return row;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Updates a document and swaps its attachment in one transaction.
   *
   * The previous file is removed only after the commit, so a failure can never
   * leave the record pointing at a file that was already deleted.
   */
  async updateDocument(
    scope: Scope,
    documentId: string,
    payload: Row,
    status: (expiry: string | null) => string,
    hooks?: DocumentWriteHooks,
  ): Promise<Row | null> {
    return this.serialize(() => this.updateDocumentLocked(scope, documentId, payload, status, hooks));
  }

  private async updateDocumentLocked(
    scope: Scope,
    documentId: string,
    payload: Row,
    status: (expiry: string | null) => string,
    hooks?: DocumentWriteHooks,
  ): Promise<Row | null> {
    const fields: Row = { ...payload };
    const uploadId = typeof fields.upload_id === 'string' ? fields.upload_id : null;
    delete fields.upload_id;

    const existing = findRow(this.db, scope, 'documents', documentId, []);
    if (!existing) return null;

    const previousPath = existing.file_path as string | undefined;

    this.db.exec('BEGIN');
    try {
      resolveDocumentEntity(this.db, scope, fields);
      const storageFields: StorageFields | null = uploadId ? this.requireUpload(scope, uploadId, hooks?.uploadOwner) : null;
      const expiry =
        'expiry_date' in fields
          ? (typeof fields.expiry_date === 'string' ? fields.expiry_date : null)
          : (existing.expiry_date as string | null);

      const row = updateRow(this.db, scope, 'documents', documentId, {
        ...fields,
        ...(storageFields ?? {}),
        status: status(expiry),
      });

      if (row) hooks?.completed?.(row);
      if (uploadId) this.claimUpload(scope, uploadId);
      this.notifications?.changed();
      this.db.exec('COMMIT');

      // Only a replacement upload retires the old file; a data-only update keeps it.
      if (previousPath && storageFields && storageFields.file_path !== previousPath) {
        await this.removeStoredFile(previousPath);
      }
      return row;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Resolves an upload id, or fails loudly. */
  private requireUpload(scope: Scope, uploadId: string, owner?: UploadOwner): StorageFields {
    const fields = this.storageFields(scope, uploadId, owner);
    if (!fields) {
      throw new RepositoryError(
        'The upload is unknown or has already been claimed.',
        'invalid_upload',
        400,
      );
    }
    return fields;
  }

  /** Removes the file that belongs to a record. Never throws. */
  async removeFile(record: Row | null): Promise<boolean> {
    const filePath = record?.file_path as string | undefined;
    if (!filePath) return false;

    try {
      return await this.storage.remove(filePath);
    } catch (error) {
      console.warn('[documents] the file could not be removed:', error);
      return false;
    }
  }

  /** Removes a stored file by its relative path. Never throws. */
  async removeStoredFile(filePath: string): Promise<boolean> {
    try {
      return await this.storage.remove(filePath);
    } catch (error) {
      console.warn('[documents] the file could not be removed:', error);
      return false;
    }
  }

  /** Deletes a document and its file together. */
  async deleteDocument(scope: Scope, documentId: string): Promise<boolean> {
    return this.serialize(() => this.deleteDocumentLocked(scope, documentId));
  }

  private async deleteDocumentLocked(scope: Scope, documentId: string): Promise<boolean> {
    const document = findRow(this.db, scope, 'documents', documentId, []);
    if (!document) return false;

    const deleted = atomic(this.db, () => {
      const result = this.db.prepare('DELETE FROM documents WHERE id = ? AND workspace_id = ?').run(documentId, scope.workspaceId);
      this.notifications?.changed();
      return result.changes !== 0;
    });
    if (!deleted) return false;

    await this.removeFile(document);
    return true;
  }

  /** Replaces the attachment of a document, keeping the old file until the swap succeeded. */
  async replaceFile(scope: Scope, documentId: string, uploadId: string, owner?: UploadOwner, guard?: () => void): Promise<Row | null> {
    return this.serialize(() => this.replaceFileLocked(scope, documentId, uploadId, owner, guard));
  }

  private async replaceFileLocked(scope: Scope, documentId: string, uploadId: string, owner?: UploadOwner, guard?: () => void): Promise<Row | null> {
    guard?.();
    const document = findRow(this.db, scope, 'documents', documentId, []);
    if (!document) return null;

    const fields = this.storageFields(scope, uploadId, owner);
    if (!fields) return null;

    const previousPath = document.file_path as string | undefined;

    atomic(this.db, () => {
      this.db.prepare(
        `UPDATE documents
          SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
      ).run(
        fields.file_name,
        fields.file_path,
        fields.file_size,
        fields.mime_type,
        new Date().toISOString(),
        documentId,
        scope.workspaceId,
      );

      this.claimUpload(scope, uploadId);
    });

    if (previousPath && previousPath !== fields.file_path) {
      await this.removeFile({ file_path: previousPath });
    }

    return findRow(this.db, scope, 'documents', documentId, []);
  }

  /** Detaches the file from a document without deleting the record. */
  async detachFile(scope: Scope, documentId: string): Promise<Row | null> {
    return this.serialize(() => this.detachFileLocked(scope, documentId));
  }

  private async detachFileLocked(scope: Scope, documentId: string): Promise<Row | null> {
    const document = findRow(this.db, scope, 'documents', documentId, []);
    if (!document) return null;

    this.db.prepare(
      `UPDATE documents
          SET file_name = NULL, file_path = NULL, file_size = NULL, mime_type = NULL, updated_at = ?
        WHERE id = ? AND workspace_id = ?`,
    ).run(new Date().toISOString(), documentId, scope.workspaceId);

    await this.removeFile(document);
    return findRow(this.db, scope, 'documents', documentId, []);
  }

  /** Removes staged uploads that were never claimed. */
  purgeStaleUploads(olderThanHours = 24): Promise<number> {
    return this.serialize(() => {
    const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
    const rows = this.db
      .prepare('SELECT file_path FROM pending_uploads WHERE created_at < ?')
      .all(cutoff) as Row[];

    const queued = this.db.prepare('SELECT file_path FROM upload_cleanup_queue').all() as Row[];
    return this.cleanupTrackedFiles([...new Set([...rows, ...queued].map(row => String(row.file_path)))]);
    });
  }
}
