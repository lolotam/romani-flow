/**
 * The local preparation of one document.
 *
 * The module turns a selected file into the bounded page images the
 * extraction request carries. It reads the source once, decides from the
 * bytes what the file really is, and refuses anything that is not a
 * supported document. Nothing is stored, nothing is uploaded and nothing is
 * requested from a network host.
 *
 * A preparation either returns every page of the document or fails with one
 * of the codes of the shared contract. A partially prepared document is
 * never returned.
 */

import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  displayedDimensions,
  readImageHeader,
  sniffImageKind,
} from './imageHeader';
import {
  abortedError,
  assertEncodedBudget,
  encodeBase64,
  failureCode,
  isPreparationFailure,
  preparationFailure,
} from './pdfAssets';
import type { ExtractionRequest } from '../../../server/contracts/documentExtraction';

/** The prepared pages of one document. */
export interface PreparedDocument {
  pageCount: number;
  images: ExtractionRequest['images'];
}

/** The largest source file the preparation reads. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** The source kinds the preparation accepts. */
type SourceKind = 'pdf' | 'png' | 'jpeg';

/** The signature every PDF starts with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];

/**
 * Prepares the selected document.
 *
 * The source bound is checked before the bytes are read, so an oversized
 * file is refused without being loaded. The signature decides the route,
 * the MIME type and the file name have to agree with it, and every step
 * observes the cancellation.
 */
export async function prepareDocument(
  file: File,
  signal: AbortSignal,
  maxSourceBytes: number,
): Promise<PreparedDocument> {
  assertNotAborted(signal);
  const limit = Number.isFinite(maxSourceBytes) && maxSourceBytes > 0 ? maxSourceBytes : MAX_SOURCE_BYTES;
  if (file.size > limit) throw preparationFailure(failureCode.limit);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertNotAborted(signal);
  const kind = sniffSource(bytes);
  assertSupportedSource(file, kind);
  if (kind === 'pdf') {
    const { preparePdfDocument } = await import('./pdf');
    return preparePdfDocument(bytes, signal);
  }
  return prepareImage(bytes, kind, signal);
}

/**
 * Decides from the bytes what the selected file really is.
 *
 * A file that carries no supported signature is rejected, so a renamed
 * document never reaches the renderer.
 */
function sniffSource(bytes: Uint8Array): SourceKind {
  const image = sniffImageKind(bytes);
  if (image === 'png') return 'png';
  if (image === 'jpeg') return 'jpeg';
  if (bytes.length >= PDF_SIGNATURE.length && PDF_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'pdf';
  }
  throw preparationFailure(failureCode.invalid);
}

/**
 * Refuses a source whose type or name does not match its signature.
 *
 * Only PDF, JPEG and PNG are accepted. A JPEG is accepted under both of its
 * usual endings, and no other type is accepted for any of them.
 */
function assertSupportedSource(file: File, kind: SourceKind): void {
  const extension = extensionOf(file.name);
  if (kind === 'pdf') {
    if (file.type !== 'application/pdf' || extension !== 'pdf') throw preparationFailure(failureCode.invalid);
    return;
  }
  if (kind === 'png') {
    if (file.type !== 'image/png' || extension !== 'png') throw preparationFailure(failureCode.invalid);
    return;
  }
  if (file.type !== 'image/jpeg' || (extension !== 'jpg' && extension !== 'jpeg')) {
    throw preparationFailure(failureCode.invalid);
  }
}

/**
 * Prepares a single picture as the only page of a document.
 *
 * The header is checked before the bitmap is created, and the decoded
 * bitmap is checked against the header afterwards, so a picture that only
 * pretends to be small is refused. A JPEG that carries an EXIF orientation is
 * compared against the edges its orientation shows, so a turned picture is
 * prepared while a picture that does not match its own header is still
 * refused. The bitmap is always closed and the picture is never downsampled:
 * an oversized source fails instead of being silently shrunk.
 */
async function prepareImage(
  bytes: Uint8Array,
  kind: 'png' | 'jpeg',
  signal: AbortSignal,
): Promise<PreparedDocument> {
  const header = readImageHeader(bytes);
  const mime = header.mime;
  const shown = displayedDimensions(header);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    assertNotAborted(signal);
    if (bitmap.width !== shown.width || bitmap.height !== shown.height) {
      throw preparationFailure(failureCode.invalid);
    }
    if (
      bitmap.width > MAX_IMAGE_DIMENSION ||
      bitmap.height > MAX_IMAGE_DIMENSION ||
      bitmap.width * bitmap.height > MAX_IMAGE_PIXELS
    ) {
      throw preparationFailure(failureCode.limit);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (isPreparationFailure(error)) throw error;
    throw preparationFailure(failureCode.invalid);
  } finally {
    bitmap?.close();
  }
  const base64 = encodeBase64(bytes);
  assertEncodedBudget(base64.length);
  return { pageCount: 1, images: [{ page: 1, mime, base64 }] };
}

/**
 * Reports a cancelled preparation.
 *
 * The failure is a real `Error` named `AbortError`, so a caller recognizes
 * a cancellation the same way it recognizes a cancelled request.
 */
function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedError();
}

/** Reads the lower case ending of a file name. */
function extensionOf(name: string): string {
  const separator = name.lastIndexOf('.');
  return separator < 0 ? '' : name.slice(separator + 1).toLowerCase();
}
