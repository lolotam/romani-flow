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
  /** The EXIF orientation of the source, or null when it carries none. */
  orientation: number | null;
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

/** The marker of the JPEG segment that carries EXIF metadata. */
const EXIF_SEGMENT_MARKER = 0xe1;

/** The EXIF orientation tag inside the first TIFF directory. */
const EXIF_ORIENTATION_TAG = 0x0112;

/** The EXIF types that hold the orientation value. */
const EXIF_SHORT_TYPE = 3;
const EXIF_LONG_TYPE = 4;

/** The orientations a decoder shows with the edges of the picture swapped. */
const ROTATED_ORIENTATIONS = [5, 6, 7, 8];

/** The byte order of a TIFF header. */
type ByteOrder = 'little' | 'big';

/**
 * Reports the dimensions a decoder shows for the header.
 *
 * A JPEG that carries an EXIF orientation of 5, 6, 7 or 8 is turned by the
 * decoder, so the shown picture swaps its edges. The swap is only applied for
 * the orientations that really turn the picture, so a picture that does not
 * match its own header is still refused.
 */
export function displayedDimensions(header: ImageHeader): { width: number; height: number } {
  if (header.orientation !== null && ROTATED_ORIENTATIONS.includes(header.orientation)) {
    return { width: header.height, height: header.width };
  }
  return { width: header.width, height: header.height };
}

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
  if (readUint32(bytes, 8, 'big') !== 13) throw preparationFailure(failureCode.invalid);
  const width = readUint32(bytes, 16, 'big');
  const height = readUint32(bytes, 20, 'big');
  if (width === 0 || height === 0) throw preparationFailure(failureCode.invalid);
  return boundedHeader('image/png', width, height, null);
}

/**
 * Reads the frame of a JPEG.
 *
 * The scan walks the marker segments of the source and stops at the first
 * supported frame. The scan never leaves the source bytes, a segment that
 * claims more bytes than the source holds is a truncation, and a file
 * without a supported frame is rejected.
 *
 * The EXIF orientation is read on the way, because the orientation decides
 * the edges a decoder shows for the picture.
 */
function readJpegHeader(bytes: Uint8Array): ImageHeader {
  let offset = 2;
  let orientation: number | null = null;
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
    if (marker === EXIF_SEGMENT_MARKER && orientation === null) {
      orientation = readExifOrientation(bytes, offset + 2, segmentEnd);
    }
    if (SUPPORTED_FRAME_MARKERS.includes(marker)) {
      if (segmentEnd - offset < 7) throw preparationFailure(failureCode.invalid);
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width === 0 || height === 0) throw preparationFailure(failureCode.invalid);
      return boundedHeader('image/jpeg', width, height, orientation);
    }
    offset = segmentEnd;
  }
  throw preparationFailure(failureCode.invalid);
}

/**
 * Reads the EXIF orientation of a JPEG segment.
 *
 * The read never leaves the segment it was given and stops at the first
 * directory that holds the orientation tag. A segment without a well formed
 * TIFF header, or an orientation outside the eight defined values, carries
 * nothing a decoder would turn the picture by, so it reports no orientation
 * and the picture has to match its own edges.
 */
function readExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 8) return null;
  if (
    bytes[start] !== 0x45 ||
    bytes[start + 1] !== 0x78 ||
    bytes[start + 2] !== 0x69 ||
    bytes[start + 3] !== 0x66
  ) {
    return null;
  }
  if (bytes[start + 4] !== 0x00 || bytes[start + 5] !== 0x00) return null;
  const tiff = start + 6;
  if (end - tiff < 8) return null;
  const order = readByteOrder(bytes, tiff);
  if (order === null) return null;
  if (readUint16(bytes, tiff + 2, order) !== 42) return null;
  const directory = tiff + readUint32(bytes, tiff + 4, order);
  if (directory < tiff + 8 || directory + 2 > end) return null;
  const entries = readUint16(bytes, directory, order);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (readUint16(bytes, entry, order) !== EXIF_ORIENTATION_TAG) continue;
    return readOrientationValue(bytes, entry + 8, order, readUint16(bytes, entry + 2, order));
  }
  return null;
}

/** Reads the byte order a TIFF header declares. */
function readByteOrder(bytes: Uint8Array, offset: number): ByteOrder | null {
  if (bytes[offset] === 0x49 && bytes[offset + 1] === 0x49) return 'little';
  if (bytes[offset] === 0x4d && bytes[offset + 1] === 0x4d) return 'big';
  return null;
}

/**
 * Reads the orientation an EXIF entry holds.
 *
 * The orientation is a single short or long value that sits in the value
 * field of the entry. A value outside the eight defined orientations is no
 * orientation at all.
 */
function readOrientationValue(
  bytes: Uint8Array,
  offset: number,
  order: ByteOrder,
  type: number,
): number | null {
  let value: number;
  if (type === EXIF_SHORT_TYPE) value = readUint16(bytes, offset, order);
  else if (type === EXIF_LONG_TYPE) value = readUint32(bytes, offset, order);
  else return null;
  return value >= 1 && value <= 8 ? value : null;
}

/**
 * Rejects an image that is larger than the preparation bounds.
 *
 * The bounds are the product bounds of the pipeline, so the check belongs to
 * the header: a picture that is too large never reaches the decoder.
 */
function boundedHeader(
  mime: 'image/jpeg' | 'image/png',
  width: number,
  height: number,
  orientation: number | null,
): ImageHeader {
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw preparationFailure(failureCode.limit);
  }
  return { mime, width, height, orientation };
}

/** Reads an unsigned 16 bit number in the given byte order. */
function readUint16(bytes: Uint8Array, offset: number, order: ByteOrder): number {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  return order === 'little' ? first | (second << 8) : (first << 8) | second;
}

/** Reads an unsigned 32 bit number in the given byte order. */
function readUint32(bytes: Uint8Array, offset: number, order: ByteOrder): number {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  const fourth = bytes[offset + 3];
  if (order === 'little') {
    return (first | (second << 8) | (third << 16) | (fourth << 24)) >>> 0;
  }
  return (((first << 24) >>> 0) + (second << 16) + (third << 8) + fourth) >>> 0;
}
