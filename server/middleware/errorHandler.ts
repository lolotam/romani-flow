import type { NextFunction, Request, Response } from 'express';
import { RepositoryError } from '../repositories/base.js';

/** Reads the SQLite error code from a driver error, when there is one. */
function getSqliteErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Reads the code of a storage or upload error.
 *
 * `StorageError` carries its own `code`; multer uses `code` for its own
 * conditions, so both are mapped to the same vocabulary here.
 */
function getStorageErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as { code?: unknown; name?: unknown; status?: unknown };
  if (typeof candidate.code === 'string') {
    if (candidate.code === 'LIMIT_FILE_SIZE') return 'file_too_large';
    if (candidate.code === 'LIMIT_UNEXPECTED_FILE' || candidate.code === 'LIMIT_FILE_COUNT') {
      return 'too_many_files';
    }
    return candidate.code;
  }
  if (typeof candidate.status === 'number') return null;
  return null;
}

/**
 * Uniform error envelope.
 *
 * Every failed request answers with `{ data: null, error: { message, code } }`,
 * which is exactly what the SPA's data layer expects — errors are surfaced, never
 * thrown, so the client never has to deal with a rejected promise.
 */

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    data: null,
    error: { message: `No route for ${req.method} ${req.path}`, code: 'not_found' },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Body-parser errors may carry the original body (including transient QR or
  // webhook credentials). Never pass them to the generic exception logger.
  const parseType = (error as { type?: unknown } | null)?.type;
  if (parseType === 'entity.parse.failed' || parseType === 'entity.too.large') {
    res.status(parseType === 'entity.too.large' ? 413 : 400).json({
      data: null, error: { message: 'Invalid request body.', code: 'invalid_body' },
    });
    return;
  }
  if (error instanceof RepositoryError) {
    res.status(error.status).json({
      data: null,
      error: { message: error.message, code: error.code },
    });
    return;
  }

  // A foreign-key violation means the record is still referenced. That is a
  // conflict the administrator can act on, not a server fault.
  const sqliteCode = getSqliteErrorCode(error);
  if (sqliteCode === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    res.status(409).json({
      data: null,
      error: {
        message:
          'This record is still referenced by other data. Remove the dependent records first.',
        code: 'resource_in_use',
      },
    });
    return;
  }

  if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE') {
    res.status(409).json({
      data: null,
      error: { message: 'A record with this identifier already exists.', code: 'duplicate' },
    });
    return;
  }

  if (sqliteCode === 'SQLITE_CONSTRAINT_CHECK') {
    res.status(400).json({
      data: null,
      error: { message: 'The value is not allowed for this field.', code: 'invalid_value' },
    });
    return;
  }

  // A storage or upload error carries its own meaning; it must not collapse
  // into a generic 500.
  const storageCode = getStorageErrorCode(error);
  if (storageCode === 'unsupported_type') {
    res.status(415).json({
      data: null,
      error: { message: 'That file type is not allowed.', code: 'unsupported_type' },
    });
    return;
  }
  if (storageCode === 'file_too_large') {
    res.status(413).json({
      data: null,
      error: { message: 'The file is larger than the configured limit.', code: 'file_too_large' },
    });
    return;
  }
  if (storageCode === 'too_many_files') {
    res.status(413).json({
      data: null,
      error: { message: 'Too many files were uploaded at once.', code: 'too_many_files' },
    });
    return;
  }
  if (storageCode === 'file_missing') {
    res.status(404).json({
      data: null,
      error: { message: 'The stored file is missing.', code: 'file_missing' },
    });
    return;
  }
  if (storageCode === 'invalid_path' || storageCode === 'missing_path') {
    res.status(400).json({
      data: null,
      error: { message: 'That file path is not valid.', code: storageCode },
    });
    return;
  }

  console.error('[api] unhandled error:', error);

  // Express body-parser errors arrive with a `type` property.
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = String((error as { type: string }).type);
    if (type === 'entity.too.large') {
      res.status(413).json({
        data: null,
        error: { message: 'Request body is too large.', code: 'payload_too_large' },
      });
      return;
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json({
        data: null,
        error: { message: 'Request body is not valid JSON.', code: 'invalid_json' },
      });
      return;
    }
  }

  res.status(500).json({
    data: null,
    error: { message: 'Internal server error.', code: 'internal_error' },
  });
}

/** Wraps an async route handler so rejected promises reach the error handler. */
export function asyncHandler<T extends Request = Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req as T, res, next).catch(next);
  };
}
