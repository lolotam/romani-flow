/**
 * The header of a supported image.
 *
 * The module reads the dimensions of a PNG or a JPEG from its own bytes and
 * never decodes the picture. The bounds are therefore enforced before a
 * bitmap is created, so an oversized source is rejected instead of being
 * decoded and shrunk afterwards.
 */

import { failureCode, preparationFailure } from './pdfAssets';

/** The header of a supported image. */
export interface ImageHeader {
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

/** The largest edge a prepared image may have. */
export const MAX_IMAGE_DIMENSION = 8192;

/** The largest number of pixels a prepared image may have. */
export const MAX_IMAGE_PIXELS = 4_000_000;

/** The signature every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The start of frame markers that describe a supported JPEG frame. */
const SUPPORTED_FRAME_MARKERS = [0xc0, 0xc1, 0xc2];

/** Markers that stand alone and carry no length. */
const STANDALONE_MARKERS = [0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7];

/**
 * Reads the header of a supported image.
 *
 * The bytes are sniffed, not trusted: an unsupported or truncated image is
 * rejected with `preparation_invalid`, and an image that is too large is
 * rejected with `preparation_limit` before it is ever decoded.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  if (isPng(bytes)) return readPngHeader(bytes);
  if (isJpeg(bytes)) return readJpegHeader(bytes);
  throw preparationFailure(failureCode.invalid);
}

/**
 * Reports which supported image the bytes are.
 *
 * The answer comes from the bytes alone: a file name or a MIME type never
 * decides what a document really is.
 */
export function sniffImageKind(bytes: Uint8Array): 'jpeg' | 'png' | null {
  if (isPng(bytes)) return 'png';
  if (isJpeg(bytes)) return 'jpeg';
  return null;
}

/** Reports whether the bytes start with the PNG signature. */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Reports whether the bytes start with the JPEG start of image marker. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Reads the first chunk of a PNG.
 *
 * The chunk length has to be the exact length of an `IHDR` chunk and the
 * dimensions have to be positive, so a truncated or a forged header is
 * rejected instead of being trusted.
 */
function readPngHeader(bytes: Uint8Array): ImageHeader {
  const headerEnd = 8 + 4 + 4 + 13;
  if (bytes.length < headerEnd) throw preparationFailure(failureCode.invalid);
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw preparationFailure(failureCode.invalid);
  }
  if (readUint32(bytes, 8) !== 13) throw preparationFailure(failureCode.invalid);
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width === 0 || height === 0) throw preparationFailure(failureCode.invalid);
  return boundedHeader('image/png', width, height);
}

/**
 * Reads the frame of a JPEG.
 *
 * The scan walks the marker segments of the source and stops at the first
 * supported frame. The scan never leaves the source bytes, a segment that
 * claims more bytes than the source holds is a truncation, and a file
 * without a supported frame is rejected.
 */
function readJpegHeader(bytes: Uint8Array): ImageHeader {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw preparationFailure(failureCode.invalid);
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw preparationFailure(failureCode.invalid);
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) {
      // A stuffed byte, an end of image or a start of scan before a frame.
      throw preparationFailure(failureCode.invalid);
    }
    if (STANDALONE_MARKERS.includes(marker)) continue;
    if (offset + 2 > bytes.length) throw preparationFailure(failureCode.invalid);
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) throw preparationFailure(failureCode.invalid);
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) throw preparationFailure(failureCode.invalid);
    if (SUPPORTED_FRAME_MARKERS.includes(marker)) {
      if (segmentEnd - offset < 7) throw preparationFailure(failureCode.invalid);
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width === 0 || height === 0) throw preparationFailure(failureCode.invalid);
      return boundedHeader('image/jpeg', width, height);
    }
    offset = segmentEnd;
  }
  throw preparationFailure(failureCode.invalid);
}

/**
 * Rejects an image that is larger than the preparation bounds.
 *
 * The bounds are the product bounds of the pipeline, so the check belongs to
 * the header: a picture that is too large never reaches the decoder.
 */
function boundedHeader(mime: 'image/jpeg' | 'image/png', width: number, height: number): ImageHeader {
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw preparationFailure(failureCode.limit);
  }
  return { mime, width, height };
}

/** Reads a big endian unsigned 32 bit number. */
function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}
