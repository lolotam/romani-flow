import { Router } from 'express';
import multer from 'multer';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { findRow } from '../repositories/base.js';
import type { DocumentService } from '../services/documentService.js';
import { StorageError, type StorageService } from '../services/storageService.js';

/**
 * File endpoints.
 *
 * An upload is *staged* here and returned as an `upload_id`. The record that
 * owns the file (a document or an employee photo) claims that id, so a client
 * can never point a record at a path of its choosing.
 */

/** Types that may be shown inline in the browser preview. */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
]);

/** Image types accepted for an employee photo. */
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export function createFilesRouter(
  config: AppConfig,
  db: Db,
  storage: StorageService,
  documents: DocumentService,
): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 20 },
    fileFilter: (_req, file, callback) => {
      if (config.allowedFileTypes.includes(file.mimetype)) {
        callback(null, true);
        return;
      }
      callback(
        new StorageError(`File type "${file.mimetype}" is not allowed.`, 'unsupported_type', 415),
      );
    },
  });

  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (PHOTO_TYPES.has(file.mimetype)) {
        callback(null, true);
        return;
      }
      callback(
        new StorageError('Only PNG, JPEG and WebP images are allowed.', 'unsupported_type', 415),
      );
    },
  });

  router.post(
    '/upload',
    requireAdmin,
    upload.any(),
    asyncHandler(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({
          data: null,
          error: { message: 'No files were uploaded.', code: 'no_files' },
        });
        return;
      }

      const staged = [];
      for (const file of files) {
        const stored = await storage.save(file.buffer, file.originalname, file.mimetype);
        const registered = documents.registerUpload({
          fileName: stored.fileName,
          filePath: stored.relativePath,
          fileSize: stored.size,
          mimeType: stored.mimeType,
        });

        staged.push({
          upload_id: registered.uploadId,
          file_name: registered.fileName,
          file_size: registered.fileSize,
          mime_type: registered.mimeType,
          original_name: file.originalname,
        });
      }

      res.status(201).json({ data: staged, error: null });
    }),
  );

  router.get(
    '/:documentId',
    asyncHandler(async (req, res) => {
      const document = findRow(db, 'documents', String(req.params.documentId), []);
      if (!document) {
        res.status(404).json({
          data: null,
          error: { message: 'Document was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: document, error: null });
    }),
  );

  router.get(
    '/:documentId/download',
    asyncHandler(async (req, res) => {
      const document = findRow(db, 'documents', String(req.params.documentId), []);
      const filePath = document?.file_path as string | undefined;

      if (!filePath) {
        res.status(404).json({
          data: null,
          error: { message: 'This document has no stored file.', code: 'no_file' },
        });
        return;
      }

      const buffer = await storage.read(filePath);
      const fileName = (document?.file_name as string | undefined) ?? 'document';

      res.setHeader(
        'Content-Type',
        (document?.mime_type as string | undefined) ?? 'application/octet-stream',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Length', buffer.byteLength);
      res.send(buffer);
    }),
  );

  router.get(
    '/:documentId/preview',
    asyncHandler(async (req, res) => {
      const document = findRow(db, 'documents', String(req.params.documentId), []);
      const filePath = document?.file_path as string | undefined;

      if (!filePath) {
        res.status(404).json({
          data: null,
          error: { message: 'This document has no stored file.', code: 'no_file' },
        });
        return;
      }

      const mimeType = (document?.mime_type as string | undefined) ?? 'application/octet-stream';
      const buffer = await storage.read(filePath);
      const fileName = (document?.file_name as string | undefined) ?? 'document';

      res.setHeader('Content-Type', mimeType);
      res.setHeader(
        'Content-Disposition',
        `${INLINE_TYPES.has(mimeType) ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
      );
      res.setHeader('Content-Length', buffer.byteLength);
      res.send(buffer);
    }),
  );

  // Employee photo: staged, claimed, and served through the same protected path.
  router.put(
    '/employees/:employeeId/photo',
    requireAdmin,
    photoUpload.any(),
    asyncHandler(async (req, res) => {
      const employeeId = String(req.params.employeeId);
      const employee = findRow(db, 'employees', employeeId, []);
      if (!employee) {
        res.status(404).json({
          data: null,
          error: { message: 'Employee was not found.', code: 'not_found' },
        });
        return;
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({
          data: null,
          error: { message: 'No image was uploaded.', code: 'no_files' },
        });
        return;
      }

      const file = files[0];
      const stored = await storage.save(file.buffer, file.originalname, file.mimetype);
      const previousPath = employee.photo_path as string | undefined;

      db.prepare('UPDATE employees SET photo_path = ?, updated_at = ? WHERE id = ?').run(
        stored.relativePath,
        new Date().toISOString(),
        employeeId,
      );

      if (previousPath && previousPath !== stored.relativePath) {
        await storage.remove(previousPath);
      }

      res.json({
        data: { photo_path: stored.relativePath, file_size: stored.size, mime_type: stored.mimeType },
        error: null,
      });
    }),
  );

  router.get(
    '/employees/:employeeId/photo',
    asyncHandler(async (req, res) => {
      const employee = findRow(db, 'employees', String(req.params.employeeId), []);
      const photoPath = employee?.photo_path as string | undefined;

      if (!photoPath) {
        res.status(404).json({
          data: null,
          error: { message: 'This employee has no photo.', code: 'no_file' },
        });
        return;
      }

      const buffer = await storage.read(photoPath);
      res.setHeader('Content-Type', (employee?.mime_type as string | undefined) ?? 'image/jpeg');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Length', buffer.byteLength);
      res.send(buffer);
    }),
  );

  router.delete(
    '/employees/:employeeId/photo',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const employeeId = String(req.params.employeeId);
      const employee = findRow(db, 'employees', employeeId, []);
      if (!employee) {
        res.status(404).json({
          data: null,
          error: { message: 'Employee was not found.', code: 'not_found' },
        });
        return;
      }

      const photoPath = employee.photo_path as string | undefined;
      db.prepare('UPDATE employees SET photo_path = NULL, updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        employeeId,
      );

      if (photoPath) await storage.remove(photoPath);

      res.json({ data: { id: employeeId, photoRemoved: Boolean(photoPath) }, error: null });
    }),
  );

  return router;
}
