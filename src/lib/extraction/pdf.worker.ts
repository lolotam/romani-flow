/**
 * The dedicated worker of the local PDF preparation.
 *
 * The worker is the only place where the PDF.js renderer runs. It is
 * deliberately quiet: anything the renderer writes to the console is a
 * symptom of a document the renderer could not process faithfully, so the
 * worker reports the rejection to the page instead of letting the renderer
 * continue with an incomplete document.
 *
 * The renderer itself is the pinned legacy build of PDF.js. It is imported
 * here, so the page never loads a worker from a network host and the worker
 * version can never differ from the version of the renderer.
 *
 * The renderer is imported statically on purpose. A worker that loads the
 * renderer with a dynamic import becomes ready before the renderer has
 * attached its message handler, so the document request of the page is
 * dispatched into the void and the document never loads. A static import
 * belongs to the module graph of the worker, so the renderer is listening
 * before the page can send anything.
 */

import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/** The message the worker sends when the renderer reported a problem. */
interface WorkerRejection {
  type: 'romani-pdf-rejected';
  detail: 'limit' | 'invalid';
}

/** The part of the worker scope the wrapper uses. */
interface WorkerScope {
  postMessage: (message: WorkerRejection) => void;
}

const scope = globalThis as unknown as WorkerScope;

/**
 * Reports the rejection of the document to the page.
 *
 * Only a fixed category reaches the page. Raw renderer diagnostics may
 * contain document text and are never forwarded.
 */
const rejectDocument = (detail?: unknown): void => {
  scope.postMessage({
    type: 'romani-pdf-rejected',
    detail: typeof detail === 'string' && /exceeded maximum allowed size|maxImageSize|too large|exceeds/i.test(detail) ? 'limit' : 'invalid',
  });
};

console.log = rejectDocument;
console.warn = rejectDocument;
console.error = rejectDocument;
