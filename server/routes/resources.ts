import { Router, type Request } from 'express';
import type { Db } from '../db/connection.js';
import { parseListOptions } from '../http/query.js';
import {
  deleteRow,
  findRow,
  insertRow,
  listRows,
  RepositoryError,
  updateRow,
  type Row,
} from '../repositories/base.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import { rememberSubmission } from '../repositories/formDefaults.js';
import { atomic } from '../notifications/whatsapp/repository.js';

/**
 * Generic CRUD router.
 *
 * Every data table the SPA reads is exposed through the same contract so the
 * client can keep its fluent `from().select().eq()…` surface.
 */

export interface ResourceOptions {
  /** Relations embedded when the client does not ask for them explicitly. */
  defaultRelations?: string[];
  /** Hook applied to every write payload before it reaches the database. */
  transformWrite?: (payload: Row, db: Db, existing?: Row) => Row;
  aroundWrite?: <T>(action: () => Promise<T>) => Promise<T>;
  afterWrite?: () => void;
  /** Hook that shapes a row on the way out, for derived or typed values. */
  transformRead?: (row: Row, db: Db) => Row;
  /** Hook that performs the delete and any cleanup it owns. */
  onDelete?: (id: string) => Promise<boolean> | boolean;
  /** Columns the client may never write; they are owned by the server. */
  managedFields?: string[];
}

function readPayload(req: Request): Row {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new RepositoryError('Request body must be an object.', 'invalid_body', 400);
  }
  return body as Row;
}

/**
 * Rejects a payload that tries to write a server-owned column.
 *
 * Silently dropping the field would hide the mistake; the client is told which
 * key was refused and why.
 */
function assertNoManagedFields(payload: Row, managedFields: string[], tableName: string): void {
  for (const field of managedFields) {
    if (field in payload) {
      throw new RepositoryError(
        `"${field}" is managed by the server and cannot be written through /${tableName}.`,
        'managed_field',
        400,
      );
    }
  }
}

export function createResourceRouter(
  db: Db,
  tableName: string,
  options: ResourceOptions = {},
): Router {
  const router = Router();
  const write = <T>(action: () => Promise<T>): Promise<T> => options.aroundWrite ? options.aroundWrite(action) : action();

  const relationsFor = (req: Request): string[] => {
    const parsed = parseListOptions(req.query, tableName);
    const relations = parsed.relations ?? [];
    return relations.length > 0 ? relations : (options.defaultRelations ?? []);
  };

  const shape = (row: Row): Row => (options.transformRead ? options.transformRead(row, db) : row);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = parseListOptions(req.query, tableName);
      const relations = parsed.relations ?? [];
      const rows = listRows(db, tableName, {
        ...parsed,
        relations: relations.length > 0 ? relations : (options.defaultRelations ?? []),
      }).map(shape);
      res.json({ data: rows, error: null });
    }),
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => write(async () => {
      const payload = readPayload(req);
      const records = Array.isArray(payload) ? payload : [payload];

      let inserted: Row[];
      db.exec('BEGIN');
      try {
        inserted = records.map((record) => {
          assertNoManagedFields(record, options.managedFields ?? [], tableName);
          const prepared = options.transformWrite ? options.transformWrite(record, db) : record;
          const row = insertRow(db, tableName, prepared);
          rememberSubmission(db, req.user!.id, tableName, shape(row));
          options.afterWrite?.();
          return row;
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      // The rows are shaped on the way out, exactly like a GET would do them, so
      // the client sees the same column types no matter how it created the row.
      res.status(201).json({ data: inserted.map(shape), error: null });
    })),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = findRow(db, tableName, String(req.params.id), relationsFor(req));
      if (!row) {
        res.status(404).json({
          data: null,
          error: { message: `${tableName} "${String(req.params.id)}" was not found.`, code: 'not_found' },
        });
        return;
      }
      res.json({ data: shape(row), error: null });
    }),
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => write(async () => {
      const payload = readPayload(req);
      assertNoManagedFields(payload, options.managedFields ?? [], tableName);

      // The identifier is immutable — changing it would break every reference.
      if ('id' in payload) {
        throw new RepositoryError('The identifier cannot be changed.', 'immutable_field', 400);
      }

      const row = atomic(db, () => {
        const existing = findRow(db, tableName, String(req.params.id), []);
        const prepared = options.transformWrite ? options.transformWrite(payload, db, existing ?? undefined) : payload;
        const updated = updateRow(db, tableName, String(req.params.id), prepared);
        options.afterWrite?.();
        return updated;
      });

      if (!row) {
        res.status(404).json({
          data: null,
          error: { message: `${tableName} "${String(req.params.id)}" was not found.`, code: 'not_found' },
        });
        return;
      }
      res.json({ data: shape(row), error: null });
    })),
  );

  router.delete(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => write(async () => {
      const id = String(req.params.id);
      const deleted = options.onDelete ? await options.onDelete(id) : atomic(db, () => {
        const result = deleteRow(db, tableName, id);
        options.afterWrite?.();
        return result;
      });
      if (!deleted) {
        res.status(404).json({
          data: null,
          error: { message: `${tableName} "${id}" was not found.`, code: 'not_found' },
        });
        return;
      }
      res.json({ data: { id, deleted: true }, error: null });
    })),
  );

  return router;
}
