import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import express from 'express';
import sharp from 'sharp';
import { ZodError } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { RepositoryError } from '../repositories/base.js';
import { limits, extractionRequest } from '../contracts/documentExtraction.js';
import { validateImages, type DecoderFactory, type ImageDecoder } from '../extraction/images.js';
import { ExtractionError } from '../extraction/http.js';
import type { ExtractionService } from '../extraction/service.js';

/**
 * The guarded extraction route.
 *
 * The route accepts one administrator request, one prepared document and
 * nothing else. It refuses a foreign origin, a foreign account, a body that
 * is not JSON, an encoded body and an oversized body before the document is
 * decoded, it refuses a body that does not have the shape of an extraction
 * request before the schema reads it, and it never logs the body, the account
 * or the document.
 */

/** The origin of the production deployment. */
const PRODUCTION_ORIGIN = 'https://romani.curemedkw.com';

/** Tracks the native work of the image admission. */
interface DecodeTracker {
  factory: DecoderFactory;
  pending(): number;
  idle(): Promise<void>;
}

/**
 * The decoder of the production pipeline.
 *
 * The native decoder is the default. A test may inject its own decoder, so a
 * decode can be exercised without the native library, but the injection is
 * internal: it is never reachable from a request, a setting or the
 * environment.
 */
const nativeDecoderFactory: DecoderFactory = (bytes, options) =>
  sharp(bytes, options) as unknown as ImageDecoder;

/**
 * Tracks the native decodes of one request.
 *
 * The decoder may outlive the caller: a cancellation rejects the request
 * while the native operation keeps running. The admission slot of the request
 * is only released once the native work has really settled, so a burst of
 * cancelled requests cannot outrun the native work.
 */
function createDecodeTracker(base: DecoderFactory): DecodeTracker {
  let pending = 0;
  const waiters: Array<() => void> = [];

  const settle = (): void => {
    pending -= 1;
    if (pending > 0) return;
    const resolvers = waiters.splice(0);
    for (const resolve of resolvers) resolve();
  };

  const track = <T>(work: Promise<T>): Promise<T> => {
    pending += 1;
    work.then(settle, settle);
    return work;
  };

  const factory: DecoderFactory = (bytes, options) => {
    const decoder = base(bytes, options);
    const wrapper: ImageDecoder = {
      metadata: () => track(decoder.metadata()),
      timeout: settings => {
        decoder.timeout(settings);
        return wrapper;
      },
      raw: () => {
        decoder.raw();
        return wrapper;
      },
      toBuffer: settings => track(decoder.toBuffer(settings)),
      destroy: () => decoder.destroy(),
    };
    return wrapper;
  };

  const idle = (): Promise<void> =>
    pending === 0
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          waiters.push(resolve);
        });

  return { factory, idle, pending: () => pending };
}

/** Reports whether a failure is a cancellation. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reports whether a failure is a rejected request body. */
function isBodyParserError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'type' in error;
}

/** Reads the code of a failure that carries one. */
function failureCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** The public answer of a failed request. */
interface PublicFailure {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
  /** The place of the answer that was refused, for the log of the server. */
  detail?: string;
}

/**
 * Reports whether a request body has the shape the extraction contract needs.
 *
 * The check costs the same for every body: it looks at the top level of the
 * body and at the length of the images array, and it never walks the body.
 * A body that is not an object, or that carries no images, too few images or
 * more images than the contract allows, is therefore refused before the
 * schema reads a single element of it.
 */
function hasBoundedRequestShape(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const images = (body as { images?: unknown }).images;
  if (!Array.isArray(images)) return false;
  return images.length >= 1 && images.length <= limits.pages;
}

/**
 * Maps a failure to its public answer.
 *
 * The mapping is fixed: an upstream failure is reported as a provider
 * failure, a parser failure as a rejected request and everything else as an
 * internal error. No message carries a body, a key, a file name or an
 * upstream sentence.
 */
function publicFailure(error: unknown): PublicFailure {
  if (error instanceof ExtractionError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
      detail: error.detail,
    };
  }
  if (error instanceof RepositoryError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { status: 400, code: 'invalid_request', message: 'The extraction request is not valid.' };
  }
  if (failureCode(error) === 'invalid_image') {
    return { status: 400, code: 'invalid_image', message: 'The document image was not accepted.' };
  }
  if (isAbortError(error)) {
    return {
      status: 504,
      code: 'extraction_timeout',
      message: 'The extraction did not finish in time.',
    };
  }
  if (isBodyParserError(error)) {
    const type = String((error as { type: string }).type);
    if (type === 'entity.too.large') {
      return { status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
    }
    if (type === 'encoding.unsupported') {
      return {
        status: 415,
        code: 'unsupported_media_type',
        message: 'The request must not be encoded.',
      };
    }
    return { status: 400, code: 'invalid_json', message: 'Request body is not valid JSON.' };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' };
}

/**
 * Creates the extraction router.
 *
 * The router owns its own body parser: the global parser of the application
 * stays at its small limit, and only this route accepts a prepared document.
 * The decoder may be injected for a test; the native decoder is the default.
 */
export function createDocumentExtractionRouter(
  config: AppConfig,
  _db: Db,
  service: ExtractionService,
  decoderFactory: DecoderFactory = nativeDecoderFactory,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /** Refuses a request that did not come from the own origin. */
  const originGuard = (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      const own = `${req.protocol}://${req.headers.host ?? ''}`;
      const allowed = config.env === 'production' ? [PRODUCTION_ORIGIN] : [own];
      if (!allowed.includes(origin)) {
        next(new ExtractionError('invalid_origin', 403, 'The request origin is not allowed.'));
        return;
      }
    }
    next();
  };

  /** Refuses a request that acts for another account. */
  const accountGuard = (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers['x-draft-account'];
    const account = Array.isArray(header) ? header[0] : header;
    if (typeof account !== 'string' || account !== req.user?.id) {
      next(new ExtractionError('account_mismatch', 409, 'The request account does not match the session.'));
      return;
    }
    next();
  };

  /** Refuses a body that is not plain JSON. */
  const mediaGuard = (req: Request, _res: Response, next: NextFunction): void => {
    const encoding = req.headers['content-encoding'];
    if (typeof encoding === 'string' && encoding.length > 0 && encoding !== 'identity') {
      next(new ExtractionError('unsupported_media_type', 415, 'The request must not be encoded.'));
      return;
    }
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      next(new ExtractionError('unsupported_media_type', 415, 'The request must be application/json.'));
      return;
    }
    next();
  };

  /**
   * Arms the body deadline and the socket lifecycle of one request.
   *
   * The listeners are attached before the body is parsed, so a body that
   * stalls or a client that disappears is noticed while the parser is still
   * waiting. The deadline itself is armed at the admission, and it answers
   * the caller with a sanitized timeout instead of waiting for a parser that
   * never finishes.
   */
  const lifecycle = (req: Request, res: Response, next: NextFunction): void => {
    const abort = (): void => {
      const controller = res.locals.extractionAbort as AbortController | undefined;
      if (controller && !res.writableEnded) controller.abort();
    };
    const expired = (): void => {
      if (res.headersSent || res.writableEnded) return;
      res.setHeader('Connection', 'close');
      res.status(504).json({
        data: null,
        error: {
          message: 'The extraction did not finish in time.',
          code: 'extraction_timeout',
          requestId: randomUUID(),
        },
      });
      const settle = res.locals.extractionSettled as (() => Promise<void>) | undefined;
      void Promise.resolve(settle?.()).catch(() => undefined);
    };
    res.locals.extractionBodyExpired = expired;
    req.once('aborted', abort);
    res.once('close', abort);
    res.once('finish', () => {
      req.off('aborted', abort);
      res.off('close', abort);
    });
    next();
  };

  /** Installs the tracker of the native decodes of one request. */
  const trackerMiddleware = (_req: Request, res: Response, next: NextFunction): void => {
    const tracker = createDecodeTracker(decoderFactory);
    const settle = res.locals.extractionSettled as (() => void) | undefined;
    res.locals.extractionSettled = (): Promise<void> => {
      const release = (): void => {
        settle?.();
      };
      if (tracker.pending() === 0) {
        release();
        return Promise.resolve();
      }
      return tracker.idle().then(release);
    };
    res.locals.extractionDecoderFactory = tracker.factory;
    next();
  };

  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      res.json({ data: service.status(), error: null });
    }),
  );

  /**
   * The offline catalogue of the candidates.
   *
   * The listing is local: it reads the current approvals, the configured
   * keys and the privacy attestations of the server and it performs no
   * transport call at all. It answers "what may I choose locally" and never
   * "what may I process now": the persisted enabled flag is ignored, every
   * other local predicate still applies, and the answer says that the
   * verification is offline. It never returns a key, an approval or an
   * endpoint tag.
   */
  router.get(
    '/candidates',
    asyncHandler(async (req, res) => {
      const provider = req.query.provider;
      if (provider !== 'groq' && provider !== 'openrouter') {
        res.status(400).json({
          data: null,
          error: {
            message: 'The provider is not known.',
            code: 'invalid_provider',
            requestId: randomUUID(),
          },
        });
        return;
      }
      res.json({ data: service.candidates(provider), error: null });
    }),
  );

  /**
   * Answers one provider-bound listing request.
   *
   * The provider is validated first and every read runs under the abort
   * wiring of the request: a client that leaves takes its transport call with
   * it, and an answer is only written while the connection is still alive.
   */
  const respondProviderListing = async (
    req: Request,
    res: Response,
    read: (provider: 'groq' | 'openrouter', signal: AbortSignal) => Promise<unknown>,
  ): Promise<void> => {
    const provider = req.query.provider;
    if (provider !== 'groq' && provider !== 'openrouter') {
      res.status(400).json({
        data: null,
        error: {
          message: 'The provider is not known.',
          code: 'invalid_provider',
          requestId: randomUUID(),
        },
      });
      return;
    }
    const controller = new AbortController();
    const cancel = (): void => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
      const data = await read(provider, controller.signal);
      if (!controller.signal.aborted && !res.destroyed) {
        res.json({ data, error: null });
      }
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  };

  /**
   * The live model catalog of one provider.
   *
   * The listing reads the provider model list and marks every entry as
   * approved, approvable or unavailable. It sends no document, so it works
   * before the extraction is enabled: the administrator needs it to choose a
   * model. It never authorizes a processing and it never returns a key.
   */
  router.get('/catalog', asyncHandler((req, res) =>
    respondProviderListing(req, res, (provider, signal) => service.catalog(provider, signal)),
  ));

  /** The reviewed live model list of one provider, as in earlier versions. */
  router.get('/models', asyncHandler((req, res) =>
    respondProviderListing(req, res, (provider, signal) => service.models(provider, signal)),
  ));

  router.post(
    '/',
    originGuard,
    accountGuard,
    service.preflight,
    mediaGuard,
    lifecycle,
    service.acquire,
    trackerMiddleware,
    express.json({ limit: limits.body, inflate: false, strict: false }),
    asyncHandler(async (req, res) => {
      const controller = res.locals.extractionAbort as AbortController;
      const settle = res.locals.extractionSettled as (() => Promise<void>) | undefined;
      (res.locals.extractionBodyComplete as (() => void) | undefined)?.();
      const cancel = (): void => {
        if (!res.writableEnded) controller.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      try {
        if (!hasBoundedRequestShape(req.body)) {
          // The body is refused on its shape alone, so the answer never
          // carries a key, an element or an upstream sentence.
          throw new ExtractionError('invalid_request', 400, 'The extraction request is not valid.');
        }
        const input = extractionRequest.parse(req.body);
        await validateImages(
          input.images,
          controller.signal,
          res.locals.extractionDecoderFactory as DecoderFactory,
        );
        const data = await service.run(input, req.user!.id, controller.signal);
        if (!controller.signal.aborted && !res.destroyed) {
          res.json({ data, error: null });
        }
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
        // The answer is never delayed by the native work. The admission
        // accounting is released when the native work really settled.
        void Promise.resolve(settle?.()).catch(() => undefined);
      }
    }),
  );

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const settle = res.locals.extractionSettled as (() => Promise<void>) | undefined;
    const released = Promise.resolve(settle?.()).catch(() => undefined);
    if (res.headersSent || res.writableEnded || res.destroyed) {
      // The answer is already given or the caller is gone. A late failure of
      // a closed response is not forwarded to the global logger.
      void released;
      return;
    }
    const failure = publicFailure(error);
    const requestId = randomUUID();
    // A refused extraction is recorded without a document, a key, a file name
    // or an upstream sentence: the code, the status and the request id are
    // enough to tell a refused environment from a refused provider, and the
    // administrator can quote the id. The detail names the place of the
    // answer that was refused, and it names a field of the contract and a
    // word of the vocabulary, never a value of the document.
    const detail = failure.detail ? ` detail=${failure.detail}` : '';
    console.error(
      `[extraction] refused code=${failure.code} status=${failure.status} request=${requestId}${detail}`,
    );
    const body: {
      data: null;
      error: { code: string; message: string; requestId: string; retryAfterSeconds?: number };
    } = {
      data: null,
      error: {
        code: failure.code,
        message: failure.message,
        requestId,
      },
    };
    if (failure.retryAfterSeconds !== undefined) {
      body.error.retryAfterSeconds = failure.retryAfterSeconds;
    }
    if (failure.status === 429 && failure.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(failure.retryAfterSeconds));
    }
    // The answer is never delayed by the native work: the admission
    // accounting is released when the native work really settled.
    try {
      res.status(failure.status).json(body);
    } catch {
      // The caller is gone, so the failure is already accounted for.
    }
    void released;
  });

  return router;
}
