import sharp, { type SharpOptions } from 'sharp';
import { limits, type ExtractionRequest } from '../contracts/documentExtraction.js';

/**
 * Independent image admission for the extraction pipeline.
 *
 * Every prepared page is untrusted input, so nothing reaches a provider before
 * it has been decoded locally and measured: the base64 payload must be
 * canonical, the declared MIME type must agree with the file signature, the
 * header of every image is inspected before any image is fully decoded, and
 * exactly one image is decoded at a time with its pixels dropped immediately.
 *
 * Native Sharp is the default decoder. The optional decoder factory is an
 * additive seam: it replaces the decoder implementation, never the rules.
 *
 * The native decoder is a Duplex, so it can be destroyed, but destroying it
 * does not settle the promise of the work that is already running inside
 * Sharp. A cancellation therefore rejects the caller promptly while the
 * underlying native operation keeps running until it really settles. To keep
 * the number of simultaneously running native operations bounded, one
 * module-wide admission slot is held for exactly that time: the slot is
 * released only when the underlying promise has settled, never when the
 * caller has already returned.
 */

/** The MIME types the extraction pipeline accepts. */
export type ImageMime = 'image/jpeg' | 'image/png';

/** The maximum accepted length of one encoded side. */
const MAX_DIMENSION = 8192;

/** The maximum accepted number of decoded pixels of one image. */
const MAX_PIXELS = limits.pixels;

/** The maximum accepted size of one decoded raw pixel buffer. */
const MAX_RAW_BYTES = 16_000_000;

/** The maximum time a single decode may take. */
const DECODE_TIMEOUT_SECONDS = 3;

/** The eight PNG signature bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The Sharp options used for every decode. */
const SHARP_OPTIONS: SharpOptions = {
  failOn: 'warning',
  limitInputPixels: MAX_PIXELS,
  limitInputChannels: 4,
};

/** The canonical base64 alphabet with at most two padding characters. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** The header information an admitted image must expose. */
export interface DecoderMetadata {
  format?: string;
  pages?: number;
  width?: number;
  height?: number;
}

/** The output information of one raw decode. */
export interface DecoderInfo {
  width: number;
  height: number;
  size: number;
}

/**
 * The decoder contract used by the admission.
 *
 * It is the subset of the Sharp instance this module relies on. `destroy` is
 * mandatory: the installed Sharp release exposes the inherited Duplex
 * `destroy`, and the admission has to be able to drop the active work on
 * cancellation.
 */
export interface ImageDecoder {
  metadata(): Promise<DecoderMetadata>;
  timeout(options: { seconds: number }): ImageDecoder;
  raw(): ImageDecoder;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: DecoderInfo }>;
  destroy: () => void;
}

/** Creates the decoder for one image. Native Sharp is the default. */
export type DecoderFactory = (bytes: Buffer, options: SharpOptions) => ImageDecoder;

/** The native Sharp decoder. */
const nativeDecoderFactory: DecoderFactory = (bytes, options) =>
  sharp(bytes, options) as unknown as ImageDecoder;

/** Builds the one error the caller may observe for a rejected image. */
function invalidImage(): Error {
  const error = new Error('invalid_image');
  (error as Error & { code?: string }).code = 'invalid_image';
  return error;
}

/** Returns the abort reason of a cancelled request. */
function abortReason(signal: AbortSignal, cause?: unknown): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (cause instanceof Error) return cause;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** Reports whether an error is a cancellation rather than a rejected image. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Rejects as soon as the request is cancelled.
 *
 * The native work itself is not stopped by this race: it keeps running and is
 * accounted for by the admission slot, so the caller returns promptly while
 * the number of running native operations stays bounded.
 */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** One caller waiting for the module-wide native admission slot. */
interface AdmissionWaiter {
  aborted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  dispose: () => void;
}

/** Whether the single module-wide native admission slot is taken. */
let admissionHeld = false;

/** The callers waiting for the module-wide native admission slot. */
const admissionWaiters: AdmissionWaiter[] = [];

/**
 * Hands the admission slot to the next waiting caller.
 *
 * The slot stays taken when a caller takes over, and it is only freed when no
 * caller is waiting for it.
 */
function releaseAdmission(): void {
  while (admissionWaiters.length > 0) {
    const waiter = admissionWaiters.shift();
    if (!waiter || waiter.aborted) continue;
    waiter.dispose();
    waiter.resolve();
    return;
  }
  admissionHeld = false;
}

/**
 * Takes the module-wide native admission slot.
 *
 * Waiting is abortable: a cancelled waiter is removed and never receives the
 * slot, so it can no longer start native work.
 */
function acquireAdmission(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (!admissionHeld) {
    admissionHeld = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let onAbort: () => void = () => {};
    const waiter: AdmissionWaiter = {
      aborted: false,
      resolve,
      reject,
      dispose: () => signal.removeEventListener('abort', onAbort),
    };
    onAbort = () => {
      if (waiter.aborted) return;
      waiter.aborted = true;
      const index = admissionWaiters.indexOf(waiter);
      if (index >= 0) admissionWaiters.splice(index, 1);
      waiter.dispose();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    admissionWaiters.push(waiter);
  });
}

/**
 * One admitted native operation.
 *
 * The operation owns the admission slot until every underlying native promise
 * it started has really settled, which is later than the moment the caller
 * returns after a cancellation.
 */
interface NativeOperation {
  decoder: ImageDecoder;
  track<T>(work: Promise<T>): Promise<T>;
  destroy(): void;
  finish(): void;
}

/**
 * Starts one native operation under the module-wide admission slot.
 *
 * The decoder is only created once the slot is held, so a queued caller that
 * is cancelled never reaches the decoder factory.
 */
async function beginOperation(
  bytes: Buffer,
  signal: AbortSignal,
  factory: DecoderFactory,
): Promise<NativeOperation> {
  await acquireAdmission(signal);
  if (signal.aborted) {
    releaseAdmission();
    throw abortReason(signal);
  }
  let decoder: ImageDecoder;
  try {
    decoder = factory(bytes, SHARP_OPTIONS);
  } catch (error) {
    releaseAdmission();
    throw error;
  }

  const pending = new Set<Promise<unknown>>();
  let finished = false;
  let released = false;
  let destroyed = false;

  const release = () => {
    if (released) return;
    released = true;
    releaseAdmission();
  };
  const settle = () => {
    if (finished && pending.size === 0) release();
  };
  const destroyDecoder = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      decoder.destroy();
    } catch {
      // The decoder is already gone, so there is nothing left to release.
    }
  };
  const onAbort = () => destroyDecoder();
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    decoder,
    track<T>(work: Promise<T>): Promise<T> {
      pending.add(work);
      work.then(
        () => {
          pending.delete(work);
          settle();
        },
        () => {
          pending.delete(work);
          settle();
        },
      );
      return work;
    },
    destroy() {
      signal.removeEventListener('abort', onAbort);
      destroyDecoder();
    },
    finish() {
      finished = true;
      settle();
    },
  };
}

/** Returns the Sharp format name of an accepted MIME type. */
function expectedFormat(mime: ImageMime): string {
  return mime === 'image/png' ? 'png' : 'jpeg';
}

/**
 * Checks the file signature and requires it to agree with the declared MIME
 * type. Every other format is rejected before any decoder is created.
 */
function assertSignature(bytes: Buffer, mime: ImageMime): void {
  if (mime === 'image/png') {
    if (bytes.length < PNG_SIGNATURE.length) throw invalidImage();
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
      if (bytes[index] !== PNG_SIGNATURE[index]) throw invalidImage();
    }
    return;
  }
  if (bytes.length < 3) throw invalidImage();
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw invalidImage();
}

/**
 * Decodes a base64 payload into bytes.
 *
 * The syntax of the payload is screened before any buffer is allocated: the
 * alphabet, the padding and the length have to be canonical. The bytes are
 * then decoded once and re-encoded, and the result has to match the input
 * exactly. A payload that carries padding noise, whitespace or a
 * non-alphabet character is rejected, not repaired.
 */
function decodeBase64(value: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > limits.body) throw invalidImage();
  if (value.length % 4 !== 0) throw invalidImage();
  if (!BASE64_PATTERN.test(value)) throw invalidImage();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.charAt(value.length - padding - 1) === '=') throw invalidImage();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > limits.body) throw invalidImage();
  if (bytes.toString('base64') !== value) throw invalidImage();
  return bytes;
}

/**
 * Checks the header of one image and returns its dimensions.
 *
 * Only the header is read here, so an oversized or malformed image is rejected
 * before a raw pixel buffer is ever allocated.
 */
function inspectMetadata(
  metadata: DecoderMetadata,
  mime: ImageMime,
): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== expectedFormat(mime)) throw invalidImage();
  if ((metadata.pages ?? 1) !== 1) throw invalidImage();
  if (width < 1 || height < 1) throw invalidImage();
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw invalidImage();
  if (width * height > MAX_PIXELS) throw invalidImage();
  return { width, height };
}

/**
 * Decodes one image into raw pixels and measures the result.
 *
 * The decoded pixels are not retained: only the reported dimensions and size
 * are kept, and the buffer is released with the decoder.
 */
function checkRaw(info: DecoderInfo, expected: { width: number; height: number }): void {
  if (info.width !== expected.width || info.height !== expected.height) throw invalidImage();
  if (info.width * info.height > MAX_PIXELS) throw invalidImage();
  if (info.size > MAX_RAW_BYTES) throw invalidImage();
}

/** Starts the raw decode of one admitted image. */
function decodeBuffer(decoder: ImageDecoder): Promise<{ data: Buffer; info: DecoderInfo }> {
  return decoder
    .timeout({ seconds: DECODE_TIMEOUT_SECONDS })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/**
 * Reads the header of one image under the admission slot.
 *
 * The slot is held until the header promise has really settled, so a
 * cancelled caller cannot let a second native operation start while the first
 * one is still running inside Sharp.
 */
async function readMetadata(
  bytes: Buffer,
  mime: ImageMime,
  signal: AbortSignal,
  factory: DecoderFactory,
): Promise<{ width: number; height: number }> {
  let operation: NativeOperation | undefined;
  try {
    operation = await beginOperation(bytes, signal, factory);
    const metadata = await raceAbort(operation.track(operation.decoder.metadata()), signal);
    return inspectMetadata(metadata, mime);
  } catch (error) {
    if (isAbort(error) || signal.aborted) throw abortReason(signal, error);
    throw invalidImage();
  } finally {
    operation?.destroy();
    operation?.finish();
  }
}

/**
 * Decodes one image under the admission slot.
 *
 * The slot is held until the decode promise has really settled, which is later
 * than the moment a cancellation returns the caller.
 */
async function decodeRawImage(
  bytes: Buffer,
  expected: { width: number; height: number },
  signal: AbortSignal,
  factory: DecoderFactory,
): Promise<void> {
  let operation: NativeOperation | undefined;
  try {
    operation = await beginOperation(bytes, signal, factory);
    const { info } = await raceAbort(operation.track(decodeBuffer(operation.decoder)), signal);
    checkRaw(info, expected);
  } catch (error) {
    if (isAbort(error) || signal.aborted) throw abortReason(signal, error);
    throw invalidImage();
  } finally {
    operation?.destroy();
    operation?.finish();
  }
}

/**
 * Admits one decoded image.
 *
 * The header is inspected first and the full decode happens afterwards, so an
 * over-limit header never costs a raw pixel allocation. The decoder is always
 * destroyed, and a cancellation destroys the active work and rejects promptly
 * while the native operation stays accounted for.
 */
export async function validateDecodedImage(
  bytes: Buffer,
  mime: ImageMime,
  signal: AbortSignal,
  decoderFactory: DecoderFactory = nativeDecoderFactory,
): Promise<void> {
  signal.throwIfAborted();
  assertSignature(bytes, mime);
  let operation: NativeOperation | undefined;
  try {
    operation = await beginOperation(bytes, signal, decoderFactory);
    const metadata = await raceAbort(operation.track(operation.decoder.metadata()), signal);
    const size = inspectMetadata(metadata, mime);
    signal.throwIfAborted();
    const { info } = await raceAbort(operation.track(decodeBuffer(operation.decoder)), signal);
    checkRaw(info, size);
  } catch (error) {
    if (isAbort(error) || signal.aborted) throw abortReason(signal, error);
    throw invalidImage();
  } finally {
    operation?.destroy();
    operation?.finish();
  }
}

/**
 * Admits every prepared page of one extraction request.
 *
 * The work happens in three ordered steps: the syntax of every payload is
 * checked, then the header of every image is inspected, and only then is one
 * image decoded at a time. A single rejected image fails the whole request,
 * and a cancellation stops the sequence before the next image begins.
 */
export async function validateImages(
  images: ExtractionRequest['images'],
  signal: AbortSignal,
  decoderFactory: DecoderFactory = nativeDecoderFactory,
): Promise<void> {
  signal.throwIfAborted();

  const prepared = images.map(image => {
    const bytes = decodeBase64(image.base64);
    assertSignature(bytes, image.mime);
    return { bytes, mime: image.mime };
  });

  const sizes: { width: number; height: number }[] = [];
  for (const image of prepared) {
    signal.throwIfAborted();
    sizes.push(await readMetadata(image.bytes, image.mime, signal, decoderFactory));
  }

  for (let index = 0; index < prepared.length; index += 1) {
    signal.throwIfAborted();
    await decodeRawImage(prepared[index].bytes, sizes[index], signal, decoderFactory);
  }
}
