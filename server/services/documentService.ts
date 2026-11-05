import type { Db } from '../db/connection.js';
import {
  findRow,
  insertRow,
  RepositoryError,
  updateRow,
  type Row,
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
  stageUploads(files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>, guard?: () => void): Promise<StoredUpload[]> {
    return this.serialize(async () => {
      guard?.();
      const uploads: StoredUpload[] = [];
      const paths: string[] = [];
      try {
      for (const file of files) {
        const stored = await this.storage.save(file.buffer, file.originalname, file.mimetype);
        paths.push(stored.relativePath);
        uploads.push(this.registerUpload({ fileName: stored.fileName, filePath: stored.relativePath, fileSize: stored.size, mimeType: stored.mimeType }));
      }
      return uploads;
      } catch (error) {
        for (const upload of uploads) this.db.prepare('DELETE FROM pending_uploads WHERE id=?').run(upload.uploadId);
        await Promise.all(paths.map(path => this.storage.remove(path)));
        throw error;
      }
    });
  }

  /** Records a freshly uploaded file so a record can claim it. */
  registerUpload(upload: Omit<StoredUpload, 'uploadId'>): StoredUpload {
    const uploadId = globalThis.crypto.randomUUID();

    this.db.prepare(
      `INSERT INTO pending_uploads (id, file_name, file_path, file_size, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      uploadId,
      upload.fileName,
      upload.filePath,
      upload.fileSize,
      upload.mimeType,
      new Date().toISOString(),
    );

    return { uploadId, ...upload };
  }

  /** Resolves an upload id to its staged file, if it has not been claimed yet. */
  resolveUpload(uploadId: string): StoredUpload | null {
    const row = this.db.prepare('SELECT * FROM pending_uploads WHERE id = ?').get(uploadId) as
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
  claimUpload(uploadId: string): void {
    this.db.prepare('DELETE FROM pending_uploads WHERE id = ?').run(uploadId);
  }

  /** The storage columns for a document, derived from an upload id. */
  storageFields(uploadId: string): StorageFields | null {
    const upload = this.resolveUpload(uploadId);
    if (!upload) return null;

    return {
      file_name: upload.fileName,
      file_path: upload.filePath,
      file_size: upload.fileSize,
      mime_type: upload.mimeType,
    };
  }

  /**
   * Creates a document and claims its staged upload in one transaction.
   *
   * If the row cannot be written — a foreign key violation, for example — the
   * transaction rolls back and the upload stays pending, so the administrator
   * can correct the data and retry with the same upload id.
   */
  async createDocument(payload: Row, status: (expiry: string | null) => string, onCreated?: (row: Row) => void): Promise<Row> {
    // Same coordinator as update/delete, so a create cannot interleave with a backup erase.
    return this.serialize(async () => this.createDocumentLocked(payload, status, onCreated));
  }

  private createDocumentLocked(payload: Row, status: (expiry: string | null) => string, onCreated?: (row: Row) => void): Row {
    const fields: Row = { ...payload };
    const uploadId = typeof fields.upload_id === 'string' ? fields.upload_id : null;
    delete fields.upload_id;

    this.db.exec('BEGIN');
    try {
      resolveDocumentEntity(this.db, fields);
      const storageFields: StorageFields | null = uploadId ? this.requireUpload(uploadId) : null;
      const expiry = typeof fields.expiry_date === 'string' ? fields.expiry_date : null;

      const row = insertRow(this.db, 'documents', {
        ...fields,
        ...(storageFields ?? {}),
        status: status(expiry),
      });

      if (uploadId) this.claimUpload(uploadId);
      onCreated?.(row);
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
    documentId: string,
    payload: Row,
    status: (expiry: string | null) => string,
    onUpdated?: (row: Row) => void,
  ): Promise<Row | null> {
    return this.serialize(() => this.updateDocumentLocked(documentId, payload, status, onUpdated));
  }

  private async updateDocumentLocked(
    documentId: string,
    payload: Row,
    status: (expiry: string | null) => string,
    onUpdated?: (row: Row) => void,
  ): Promise<Row | null> {
    const fields: Row = { ...payload };
    const uploadId = typeof fields.upload_id === 'string' ? fields.upload_id : null;
    delete fields.upload_id;

    const existing = findRow(this.db, 'documents', documentId, []);
    if (!existing) return null;

    const previousPath = existing.file_path as string | undefined;

    this.db.exec('BEGIN');
    try {
      resolveDocumentEntity(this.db, fields);
      const storageFields: StorageFields | null = uploadId ? this.requireUpload(uploadId) : null;
      const expiry =
        'expiry_date' in fields
          ? (typeof fields.expiry_date === 'string' ? fields.expiry_date : null)
          : (existing.expiry_date as string | null);

      const row = updateRow(this.db, 'documents', documentId, {
        ...fields,
        ...(storageFields ?? {}),
        status: status(expiry),
      });

      if (row) onUpdated?.(row);
      if (uploadId) this.claimUpload(uploadId);
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
  private requireUpload(uploadId: string): StorageFields {
    const fields = this.storageFields(uploadId);
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
  async deleteDocument(documentId: string): Promise<boolean> {
    return this.serialize(() => this.deleteDocumentLocked(documentId));
  }

  private async deleteDocumentLocked(documentId: string): Promise<boolean> {
    const document = findRow(this.db, 'documents', documentId, []);
    if (!document) return false;

    const deleted = atomic(this.db, () => {
      const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
      this.notifications?.changed();
      return result.changes !== 0;
    });
    if (!deleted) return false;

    await this.removeFile(document);
    return true;
  }

  /** Replaces the attachment of a document, keeping the old file until the swap succeeded. */
  async replaceFile(documentId: string, uploadId: string): Promise<Row | null> {
    const document = findRow(this.db, 'documents', documentId, []);
    if (!document) return null;

    const fields = this.storageFields(uploadId);
    if (!fields) return null;

    const previousPath = document.file_path as string | undefined;

    this.db.prepare(
      `UPDATE documents
          SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      fields.file_name,
      fields.file_path,
      fields.file_size,
      fields.mime_type,
      new Date().toISOString(),
      documentId,
    );

    this.claimUpload(uploadId);

    if (previousPath && previousPath !== fields.file_path) {
      await this.removeFile({ file_path: previousPath });
    }

    return findRow(this.db, 'documents', documentId, []);
  }

  /** Detaches the file from a document without deleting the record. */
  async detachFile(documentId: string): Promise<Row | null> {
    const document = findRow(this.db, 'documents', documentId, []);
    if (!document) return null;

    this.db.prepare(
      `UPDATE documents
          SET file_name = NULL, file_path = NULL, file_size = NULL, mime_type = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(new Date().toISOString(), documentId);

    await this.removeFile(document);
    return findRow(this.db, 'documents', documentId, []);
  }

  /** Removes staged uploads that were never claimed. */
  purgeStaleUploads(olderThanHours = 24): number {
    const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
    const rows = this.db
      .prepare('SELECT file_path FROM pending_uploads WHERE created_at < ?')
      .all(cutoff) as Row[];

    for (const row of rows) {
      void this.storage.remove(String(row.file_path));
    }

    this.db.prepare('DELETE FROM pending_uploads WHERE created_at < ?').run(cutoff);
    return rows.length;
  }
}
