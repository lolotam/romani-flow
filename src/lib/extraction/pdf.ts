/**
 * The bounded rendering of a PDF document.
 *
 * The renderer turns every page of a document into one JPEG page image. It
 * never truncates a document: either every page of the document is rendered
 * and returned, or the preparation fails with one of the codes of the shared
 * contract.
 *
 * The renderer is strict on purpose. The pinned release of PDF.js removes an
 * image that is larger than the configured bound instead of rendering it, so
 * a document with such an image would lose content silently. The dedicated
 * worker reports that removal to the page, and the page refuses the whole
 * document instead of returning an incomplete preparation.
 *
 * The removal is only reported when the renderer is allowed to report it.
 * Measured against the pinned release 6.5.438 with the synthetic oversized
 * image fixture:
 *
 * - With `stopAtErrors: true` the renderer *throws* inside its evaluator and
 *   the evaluator swallows the error: the page receives an **empty** operator
 *   list, no error and no diagnostic. The whole page content disappears and
 *   the preparation reports success. Nothing about the omission is observable
 *   from the page.
 * - With `stopAtErrors: false` the renderer *warns* ("Image exceeded maximum
 *   allowed size and was removed.") before it drops the image. The dedicated
 *   worker turns that diagnostic into a rejection, so the omission becomes an
 *   explicit failure of the preparation.
 *
 * The renderer is therefore configured to report its diagnostics instead of
 * swallowing them, and the dedicated worker is configured to report them as
 * well. Every diagnostic of the renderer fails the preparation; the document
 * is either prepared completely or refused completely.
 */

import {
  abortedError,
  assertEncodedBudget,
  encodeBase64,
  failureCode,
  isPreparationFailure,
  pdfAssetUrls,
  preparationFailure,
} from './pdfAssets';
import type { PreparedDocument } from './prepare';
import type { ExtractionRequest } from '../../../server/contracts/documentExtraction';
import type { PDFDocumentLoadingTask, PDFWorker } from 'pdfjs-dist';

/** The largest number of pages a document may have. */
const MAX_PAGES = 10;

/** The largest number of pixels a rendered page may have. */
const MAX_PIXELS = 4_000_000;

/** The largest edge a rendered page may have. */
const MAX_DIMENSION = 8192;

/** The largest number of operators a page may have. */
const MAX_OPERATORS = 50_000;

/** The largest number of pixels the images of one page may have together. */
const MAX_IMAGE_OPERAND_PIXELS = 16_000_000;

/** The largest number of bytes the inline image of one page may have. */
const MAX_INLINE_IMAGE_BYTES = 16_000_000;

/** The quality the page images are encoded with. */
const JPEG_QUALITY = 0.85;

/** The time the whole preparation of one document may take. */
const DEADLINE_MS = 30_000;

/**
 * The level the dedicated worker reports its diagnostics with.
 *
 * The renderer reads the level from the worker when it is created, so the
 * level is handed over with the worker itself. The renderer uses the same
 * level by default, so this only states the requirement of the mechanism
 * explicitly: the worker has to report the problems of the renderer, because
 * the rejection of the worker is what turns such a problem into the failure
 * of the preparation.
 */
const WORKER_VERBOSITY = 1;

/** The image operators whose dimensions are known. */
const IMAGE_OPERATORS = [
  'paintImageXObject',
  'paintImageXObjectRepeat',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
] as const;

/** The inline image operators, whose data is carried by the operator. */
const INLINE_IMAGE_OPERATORS = ['paintInlineImageXObject', 'paintInlineImageXObjectGroup'] as const;

/** The operator list of one page. */
interface OperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

/** The renderer of the pinned release. */
type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** The options the renderer understands. */
type DocumentParameters = Parameters<PdfModule['getDocument']>[0];

/**
 * Renders every page of a document.
 *
 * The worker is created first, so a cancellation that arrives while the
 * renderer is still loading can already stop the preparation. The worker is
 * always terminated, the loading task is always destroyed and every canvas
 * is always released, whatever the outcome is.
 */
export async function preparePdfDocument(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PreparedDocument> {
  if (signal.aborted) throw abortedError();

  const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
  const controller = new AbortController();
  const canvases: HTMLCanvasElement[] = [];
  let timedOut = false;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let pdfWorker: PDFWorker | null = null;
  /**
   * The rejection of the worker, kept for the rest of the preparation.
   *
   * The worker reports a problem of the renderer while the renderer is still
   * working. The rejection ends the pending step at once, and the kept error
   * makes sure that the preparation cannot report success afterwards, not even
   * when the diagnostic of the worker arrives after the last step.
   */
  let workerRejectionError: Error | null = null;

  /**
   * The failure of the worker ends the preparation at once.
   *
   * A renderer that reported a problem will never answer the pending
   * request, so every pending step waits for this failure as well.
   */
  let failPreparation: (error: Error) => void = () => undefined;
  const workerFailure = new Promise<never>((_resolve, reject) => {
    failPreparation = reject;
  });
  workerFailure.catch(() => undefined);
  const guard = <T>(pending: Promise<T>): Promise<T> => Promise.race([pending, workerFailure]);

  const onWorkerMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: string; detail?: string } | null;
    if (!data || data.type !== 'romani-pdf-rejected') return;
    if (workerRejectionError) return;
    workerRejectionError = workerRejection(data.detail);
    failPreparation(workerRejectionError);
    controller.abort();
  };
  const onWorkerError = (): void => {
    failPreparation(preparationFailure(failureCode.invalid));
    controller.abort();
  };
  const onAbort = (): void => {
    controller.abort();
    failPreparation(abortedError());
  };

  worker.addEventListener('message', onWorkerMessage);
  worker.addEventListener('error', onWorkerError);
  signal.addEventListener('abort', onAbort, { once: true });
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
    failPreparation(preparationFailure(failureCode.timeout));
  }, DEADLINE_MS);

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    assertRunning(signal, controller, timedOut);
    // The published types of the release do not describe the `port` option of
    // the worker, although the renderer supports it. The option is how the
    // application hands its own module worker to the renderer, so the page
    // keeps the control over the worker and over its termination.
    const workerParameters = { port: worker, verbosity: WORKER_VERBOSITY } as unknown as {
      port?: null;
    };
    pdfWorker = new pdfjs.PDFWorker(workerParameters);
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      worker: pdfWorker,
      cMapUrl: pdfAssetUrls.cmaps,
      standardFontDataUrl: pdfAssetUrls.standardFonts,
      wasmUrl: pdfAssetUrls.wasm,
      iccUrl: pdfAssetUrls.iccs,
      cMapPacked: true,
      isEvalSupported: false,
      enableXfa: false,
      // The renderer reports its problems instead of swallowing them. The
      // pinned release throws at an image that is larger than the bound and
      // drops the error of its evaluator, which removes the content of the
      // page without a word. In the reporting mode the renderer warns before
      // it removes the image, and the dedicated worker turns that diagnostic
      // into the rejection of the preparation.
      stopAtErrors: false,
      maxImageSize: MAX_PIXELS,
      canvasMaxAreaInBytes: 16_000_000,
      verbosity: 1,
      isImageDecoderSupported: false,
    } as unknown as DocumentParameters);

    const source = await guard(loadingTask.promise);
    assertRunning(signal, controller, timedOut);
    if (source.isPureXfa) throw preparationFailure(failureCode.invalid);

    const pageCount = Number(await Promise.resolve(source.numPages as number | Promise<number>));
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
      throw preparationFailure(failureCode.limit);
    }

    const images: ExtractionRequest['images'] = [];
    let encodedBytes = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      assertRunning(signal, controller, timedOut);
      const page = await guard(source.getPage(pageNumber));
      let canvas: HTMLCanvasElement | null = null;
      try {
        const operators = await guard(page.getOperatorList());
        assertRunning(signal, controller, timedOut);
        inspectOperators(operators, pdfjs.OPS);

        const viewport = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(viewport.width) ||
          !Number.isFinite(viewport.height) ||
          viewport.width <= 0 ||
          viewport.height <= 0
        ) {
          throw preparationFailure(failureCode.invalid);
        }

        const scale = Math.min(2, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        canvas = globalThis.document.createElement('canvas');
        canvases.push(canvas);
        canvas.width = Math.max(1, Math.floor(viewport.width * scale));
        canvas.height = Math.max(1, Math.floor(viewport.height * scale));
        if (
          canvas.width > MAX_DIMENSION ||
          canvas.height > MAX_DIMENSION ||
          canvas.width * canvas.height > MAX_PIXELS
        ) {
          throw preparationFailure(failureCode.limit);
        }

        const context = canvas.getContext('2d');
        if (!context) throw preparationFailure(failureCode.unavailable);
        const rendering = page.render({
          canvasContext: context,
          canvas,
          viewport: page.getViewport({ scale }),
        });
        const cancel = (): void => {
          rendering.cancel();
        };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          await guard(rendering.promise);
        } finally {
          controller.signal.removeEventListener('abort', cancel);
        }
        assertRunning(signal, controller, timedOut);

        const base64 = await guard(encodeCanvas(canvas));
        assertRunning(signal, controller, timedOut);
        encodedBytes += base64.length;
        assertEncodedBudget(encodedBytes);
        images.push({ page: pageNumber, mime: 'image/jpeg', base64 });
      } finally {
        page.cleanup();
        releaseCanvas(canvas);
        const index = canvas ? canvases.indexOf(canvas) : -1;
        if (index >= 0) canvases.splice(index, 1);
      }
    }

    // A rejection of the worker that arrived while the last page was rendered
    // still fails the preparation, so a document is never reported as
    // prepared when the renderer reported a problem about it.
    if (workerRejectionError) throw workerRejectionError;

    return { pageCount, images };
  } catch (error) {
    throw mapFailure(error, signal, timedOut, workerRejectionError);
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onAbort);
    worker.removeEventListener('message', onWorkerMessage);
    worker.removeEventListener('error', onWorkerError);
    for (const canvas of canvases) releaseCanvas(canvas);
    canvases.length = 0;
    try {
      await loadingTask?.destroy();
    } catch {
      // The loading task is already gone.
    }
    try {
      pdfWorker?.destroy();
    } catch {
      // The worker is already gone.
    }
    worker.terminate();
  }
}

/**
 * Inspects the operators of one page.
 *
 * The inspection refuses a page with too many operators, an image operator
 * whose dimensions cannot be read, an image that is larger than the bounds of
 * the pipeline and a page whose images cannot be bounded. A page whose images
 * cannot be bounded is never rendered, so no content is ever dropped without
 * a failure.
 */
function inspectOperators(list: OperatorList, ops: Record<string, number>): void {
  const { fnArray, argsArray } = list;
  if (fnArray.length > MAX_OPERATORS) throw preparationFailure(failureCode.limit);
  let aggregate = 0;
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = argsArray[index] ?? [];
    if (IMAGE_OPERATORS.some((name) => ops[name] === fn)) {
      const width = Number(args[1]);
      const height = Number(args[2]);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw preparationFailure(failureCode.invalid);
      }
      if (width * height > MAX_PIXELS) throw preparationFailure(failureCode.limit);
      aggregate += width * height;
    } else if (INLINE_IMAGE_OPERATORS.some((name) => ops[name] === fn)) {
      const image = args[0] as { width?: number; height?: number; data?: { length?: number } } | undefined;
      const width = Number(image?.width);
      const height = Number(image?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw preparationFailure(failureCode.invalid);
      }
      if (width * height > MAX_PIXELS) throw preparationFailure(failureCode.limit);
      aggregate += width * height;
      if (Number(image?.data?.length ?? 0) > MAX_INLINE_IMAGE_BYTES) {
        throw preparationFailure(failureCode.limit);
      }
    }
    if (aggregate > MAX_IMAGE_OPERAND_PIXELS) throw preparationFailure(failureCode.limit);
  }
}

/**
 * Encodes a rendered page.
 *
 * The page is encoded exactly once. A page that does not fit into the
 * request budget fails the preparation; it is never rendered again with a
 * smaller quality to squeeze it into the budget.
 */
function encodeCanvas(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(preparationFailure(failureCode.unavailable));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(encodeBase64(new Uint8Array(buffer))))
          .catch(() => reject(preparationFailure(failureCode.unavailable)));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/**
 * Releases the memory of a canvas.
 *
 * The canvas is set to zero, so the browser frees the pixels of the page as
 * soon as the page is done.
 */
function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Reports a cancelled or expired preparation.
 *
 * A cancelled preparation is reported as an `AbortError` and an expired one
 * as its own code, so a caller can tell them apart.
 */
function assertRunning(signal: AbortSignal, controller: AbortController, timedOut: boolean): void {
  if (signal.aborted) throw abortedError();
  if (timedOut) throw preparationFailure(failureCode.timeout);
  if (controller.signal.aborted) throw abortedError();
}

/**
 * Maps a failure of the renderer to a code of the shared contract.
 *
 * A document the renderer refused to open is invalid, an encrypted document
 * is encrypted and a document with an image that is too large exceeds the
 * bounds. A rejection of the worker always wins over the failure that the
 * cancellation of the preparation caused, so the code of the worker is kept.
 * No message of the renderer is forwarded to the caller.
 */
function mapFailure(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
  workerRejectionError: Error | null,
): Error {
  if (signal.aborted) return abortedError();
  if (timedOut) return preparationFailure(failureCode.timeout);
  if (workerRejectionError) return workerRejectionError;
  if (isPreparationFailure(error)) return error as Error;
  if (error instanceof Error && error.name === 'AbortError') return abortedError();
  if (error instanceof Error && error.name === 'PasswordException') {
    return preparationFailure(failureCode.encrypted);
  }
  const message = error instanceof Error ? error.message : '';
  if (/password|encrypt/i.test(message)) return preparationFailure(failureCode.encrypted);
  if (/exceeded maximum allowed size|maxImageSize/i.test(message)) {
    return preparationFailure(failureCode.limit);
  }
  return preparationFailure(failureCode.invalid);
}

/**
 * Maps the rejection of the worker to a code of the shared contract.
 *
 * The worker only reports that the renderer wrote something. A bound that
 * the renderer reached is a limit, everything else is a document the
 * renderer could not process faithfully.
 */
function workerRejection(detail: string): Error {
  if (detail === 'limit') {
    return preparationFailure(failureCode.limit);
  }
  return preparationFailure(failureCode.invalid);
}
