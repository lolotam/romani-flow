import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import { parseListOptions } from '../http/query.js';
import {
  findRow,
  listRows,
  RepositoryError,
  type Row,
  type Scope,
} from '../repositories/base.js';
import { getNumber } from '../repositories/settings.js';
import { rememberSubmission } from '../repositories/formDefaults.js';
import { draftReference, finishDraft } from '../repositories/documentDrafts.js';
import { documentNumber } from '../contracts/documentNumber.js';
import type { DocumentService } from '../services/documentService.js';
import { documentStatus, normalizeDate } from '../utils/dates.js';

/**
 * Document endpoints.
 *
 * The writes go through `DocumentService`, which owns the file lifecycle and
 * performs the row write and the upload claim in a single transaction.
 */

const RELATIONS = ['employees', 'companies', 'document_types', 'ministries'];

/** Columns the client may never write; the server owns them. */
const MANAGED_FIELDS = ['file_name', 'file_path', 'file_size', 'mime_type', 'status'];

function readPayload(body: unknown): Row {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RepositoryError('Request body must be an object.', 'invalid_body', 400);
  }
  const payload: Row = { ...(body as Row) };
  // The number is optional and only validated when the client sends the key:
  // an omitted value keeps the stored one, so it is never cleared by accident.
  if (Object.hasOwn(payload, 'document_number')) {
    const parsed = documentNumber.safeParse(payload.document_number);
    if (!parsed.success) {
      throw new RepositoryError('Invalid document number.', 'invalid_document_number', 400);
    }
    payload.document_number = parsed.data;
  }
  return payload;
}

function assertWritable(payload: Row): void {
  for (const field of MANAGED_FIELDS) {
    if (field in payload) {
      throw new RepositoryError(
        `"${field}" is managed by the server and cannot be written.`,
        'managed_field',
        400,
      );
    }
  }
  if ('id' in payload) {
    throw new RepositoryError('The identifier cannot be changed.', 'immutable_field', 400);
  }
}

export function createDocumentsRouter(db: Db, documents: DocumentService): Router {
  const router = Router();

  const warningDays = (scope: Scope): number => getNumber(db, scope, 'expiry_warning_days', 30);

  const statusFor = (scope: Scope) => (expiry: string | null): string =>
    documentStatus(expiry, warningDays(scope));

  const shape = (scope: Scope) => (row: Row): Row => ({
    ...row,
    status: documentStatus((row.expiry_date as string | null) ?? null, warningDays(scope)),
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = parseListOptions(req.query, 'documents');
      const relations = parsed.relations ?? [];
      const scope = tenantOf(req);
      const rows = listRows(db, scope, 'documents', {
        ...parsed,
        relations: relations.length > 0 ? relations : RELATIONS,
      }).map(shape(scope));
      res.json({ data: rows, error: null });
    }),
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = readPayload(req.body);
      assertWritable(payload);

      const prepared: Row = { ...payload };
      const draft = prepared.draft;
      delete prepared.draft;
      if ('expiry_date' in prepared) {
        prepared.expiry_date = normalizeDate(prepared.expiry_date);
      }

      const scope = tenantOf(req);
      const row = await documents.createDocument(scope, prepared, statusFor(scope), {
        uploadOwner: draft === undefined ? undefined : { userId: req.user!.id, scope: draftReference(draft).scope },
        completed: (created) => {
          rememberSubmission(db, scope, req.user!.id, 'documents', created);
          finishDraft(db, scope, req.user!.id, draft, created);
        } });
      // The envelope always carries a list, so the client's `insert()` contract
      // is the same for every resource.
      res.status(201).json({ data: [shape(scope)(row)], error: null });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      const row = findRow(db, scope, 'documents', String(req.params.id), RELATIONS);
      if (!row) {
        res.status(404).json({
          data: null,
          error: { message: 'The document was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: shape(scope)(row), error: null });
    }),
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = readPayload(req.body);
      assertWritable(payload);

      const prepared: Row = { ...payload };
      const draft = prepared.draft;
      delete prepared.draft;
      if ('expiry_date' in prepared) {
        prepared.expiry_date = normalizeDate(prepared.expiry_date);
      }

      const scope = tenantOf(req);
      const row = await documents.updateDocument(scope, String(req.params.id), prepared, statusFor(scope), {
        uploadOwner: draft === undefined ? undefined : { userId: req.user!.id, scope: draftReference(draft).scope },
        completed: updated => finishDraft(db, scope, req.user!.id, draft, updated, String(req.params.id)) });
      if (!row) {
        res.status(404).json({
          data: null,
          error: { message: 'The document was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: shape(scope)(row), error: null });
    }),
  );

  router.delete(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const deleted = await documents.deleteDocument(tenantOf(req), String(req.params.id));
      if (!deleted) {
        res.status(404).json({
          data: null,
          error: { message: 'The document was not found.', code: 'not_found' },
        });
        return;
      }
      res.json({ data: { id: String(req.params.id), deleted: true }, error: null });
    }),
  );

  return router;
}
