import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_PNG_BYTES,
  VALID_PNG_BASE64,
  VALID_JPEG_BYTES,
  VALID_JPEG_BASE64,
  EXACT_4MP_PNG_BYTES,
  OVERSIZED_PIXELS_PNG_BYTES,
  OVERSIZED_DIMENSION_PNG_BYTES,
  ZERO_DIMENSION_PNG_BYTES,
  CORRUPT_CRC_PNG_BYTES,
  TRUNCATED_PNG_BYTES,
  TRUNCATED_PNG_BASE64,
  TRUNCATED_JPEG_BYTES,
  NON_CANONICAL_BASE64,
  TEXT_FILE_BYTES,
  WEBP_IMAGE_BYTES,
  ANIMATED_GIF_BYTES,
} from './fixtures/extraction-data.mjs';
import {
  validateImages,
  validateDecodedImage,
} from '../server/extraction/images.ts';

/**
 * Observable Decoder Seam Documentation:
 *
 * Task 7 module contract specifies:
 *   validateDecodedImage(bytes: Buffer, mime: 'image/jpeg' | 'image/png', signal: AbortSignal, decoderFactory?: DecoderFactory): Promise<void>
 *   validateImages(images: ExtractionRequest['images'], signal: AbortSignal, decoderFactory?: DecoderFactory): Promise<void>
 *
 * Decoder interface requires mandatory destroy():
 *   interface ImageDecoder {
 *     metadata(): Promise<DecoderMetadata>;
 *     timeout(options: { seconds: number }): ImageDecoder;
 *     raw(): ImageDecoder;
 *     toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: DecoderInfo }>;
 *     destroy: () => void;
 *   }
 *
 * When decoderFactory is omitted, it defaults to native Sharp: `(bytes, options) => sharp(bytes, options)`.
 *
 * Tests in Section 1 supply an observable spy decoderFactory to verify:
 * 1. Metadata inspection occurs before expensive raw pixel allocation.
 * 2. Over-limit headers halt immediately and NEVER allocate raw pixel decode.
 * 3. Multi-image validation processes strictly one image at a time (sequential decode).
 * 4. In-flight cancellation triggers active decoder `destroy()` immediately and aborts the pipeline.
 * 5. Deterministic hanging metadata abort promptly rejects and destroys decoder.
 * 6. Active raw promise ignores destroy and stays pending; second validation cannot create decoder until native first settles.
 * 7. Queued aborted validation rejects without ever entering decoder factory.
 *
 * Sections 2-6 execute positive controls and format rejection against real Sharp.
 */

// ---------------------------------------------------------------------------
// 1. Observable Decoder Seam: Ordering, Precedence & In-Flight Abort
// ---------------------------------------------------------------------------

test('metadata inspection precedes expensive raw pixel decode', async () => {
  const events = [];
  const spyDecoderFactory = () => ({
    metadata: async () => {
      events.push('metadata');
      return { format: 'png', pages: 1, width: 1, height: 1 };
    },
    timeout() {
      return this;
    },
    raw() {
      return this;
    },
    toBuffer: async () => {
      events.push('raw.toBuffer');
      return { data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } };
    },
    destroy: () => {
      events.push('destroy');
    },
  });

  const signal = new AbortController().signal;
  await validateDecodedImage(VALID_PNG_BYTES, 'image/png', signal, spyDecoderFactory);

  assert.deepEqual(events, ['metadata', 'raw.toBuffer', 'destroy']);
});

test('metadata pass rejects oversized pixel header (>4 MP) before allocating raw pixel decode', async () => {
  const events = [];
  let rawDecodeCalled = false;

  const spyDecoderFactory = () => ({
    metadata: async () => {
      events.push('metadata');
      // 3000 x 2000 = 6,000,000 pixels > 4,000,000
      return { format: 'png', pages: 1, width: 3000, height: 2000 };
    },
    timeout() {
      return this;
    },
    raw() {
      return this;
    },
    toBuffer: async () => {
      rawDecodeCalled = true;
      events.push('raw.toBuffer');
      return { data: Buffer.alloc(100), info: { width: 3000, height: 2000, size: 100 } };
    },
    destroy: () => {
      events.push('destroy');
    },
  });

  const signal = new AbortController().signal;
  await assert.rejects(
    () => validateDecodedImage(OVERSIZED_PIXELS_PNG_BYTES, 'image/png', signal, spyDecoderFactory),
    (err) => err.code === 'invalid_image'
  );

  assert.equal(rawDecodeCalled, false, 'Raw pixel decode must never be invoked when metadata exceeds 4 MP');
  assert.deepEqual(events, ['metadata', 'destroy']);
});

test('multi-image sequence decodes strictly one image at a time (sequential processing)', async () => {
  let activeDecoders = 0;
  let maxConcurrentDecoders = 0;
  const executionTrace = [];

  const spyDecoderFactory = (bytes) => {
    activeDecoders++;
    maxConcurrentDecoders = Math.max(maxConcurrentDecoders, activeDecoders);
    const id = bytes.equals(VALID_PNG_BYTES) ? 'png' : 'jpeg';
    executionTrace.push(`init:${id}`);
    let destroyed = false;
    return {
      metadata: async () => {
        executionTrace.push(`meta:${id}`);
        return { format: id, pages: 1, width: 1, height: 1 };
      },
      timeout() {
        return this;
      },
      raw() {
        return this;
      },
      toBuffer: async () => {
        executionTrace.push(`decode:${id}`);
        return { data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } };
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        activeDecoders--;
        executionTrace.push(`destroy:${id}`);
      },
    };
  };

  const images = [
    { page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 },
    { page: 2, mime: 'image/jpeg', base64: VALID_JPEG_BASE64 },
  ];

  await validateImages(images, new AbortController().signal, spyDecoderFactory);

  assert.equal(maxConcurrentDecoders, 1, 'Only one decoder may be active at any moment');
  assert.equal(activeDecoders, 0, 'Every decoder is destroyed');
  const firstDecode = executionTrace.findIndex(event => event.startsWith('decode:'));
  assert.ok(firstDecode >= 0, 'Valid inputs must reach actual decode');
  for (const id of ['png', 'jpeg']) {
    assert.ok(executionTrace.indexOf(`meta:${id}`) < firstDecode,
      'Every image metadata pass must finish before the first full decode');
  }
  assert.deepEqual(executionTrace.filter(event => event.startsWith('decode:')), ['decode:png', 'decode:jpeg']);
});

test('in-flight abort immediately destroys active decoder and stops next image from starting', async () => {
  const controller = new AbortController();
  const trace = [];
  let enteredDecode;
  const decoding = new Promise(resolve => { enteredDecode = resolve; });

  const spyDecoderFactory = () => ({
    metadata: async () => {
      trace.push('meta');
      return { format: 'png', pages: 1, width: 1, height: 1 };
    },
    timeout() {
      return this;
    },
    raw() {
      return this;
    },
    toBuffer: () =>
      new Promise((_, reject) => {
        trace.push('decoding-started');
        enteredDecode();
        controller.signal.addEventListener(
          'abort',
          () => {
            trace.push('decoder-aborted');
            reject(new DOMException('The operation was aborted', 'AbortError'));
          },
          { once: true }
        );
      }),
    destroy: () => {
      trace.push('destroyed');
    },
  });

  const images = [
    { page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 },
    { page: 2, mime: 'image/png', base64: VALID_PNG_BASE64 },
  ];

  const validationPromise = validateImages(images, controller.signal, spyDecoderFactory);

  // Trigger abort while decode is in-flight
  await decoding;
  const metadataCountAtAbort = trace.filter(event => event === 'meta').length;
  controller.abort();

  await assert.rejects(validationPromise, (err) => err.name === 'AbortError');

  assert.ok(trace.includes('decoder-aborted'));
  assert.ok(trace.includes('destroyed'));
  assert.equal(trace.filter(event => event === 'decoding-started').length, 1, 'Second full decode must never start');
  assert.equal(trace.filter(event => event === 'meta').length, metadataCountAtAbort, 'No new metadata work after abort');
});

test('deterministic hanging metadata abort promptly rejects and destroys decoder', async () => {
  const controller = new AbortController();
  let enteredMeta;
  const metaEntered = new Promise((resolve) => { enteredMeta = resolve; });
  let resolveHangingMeta;
  const hangingMetaPromise = new Promise((resolve) => { resolveHangingMeta = resolve; });
  let destroyed = false;

  const spyDecoderFactory = () => ({
    metadata: () => {
      enteredMeta();
      return hangingMetaPromise;
    },
    timeout() { return this; },
    raw() { return this; },
    toBuffer: async () => ({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } }),
    destroy: () => { destroyed = true; },
  });

  try {
    const valPromise = validateDecodedImage(VALID_PNG_BYTES, 'image/png', controller.signal, spyDecoderFactory);
    await metaEntered;
    controller.abort();
    await assert.rejects(valPromise, (err) => err.name === 'AbortError');
    assert.equal(destroyed, true, 'Decoder destroy must be invoked on hanging metadata abort');
  } finally {
    resolveHangingMeta({ format: 'png', pages: 1, width: 1, height: 1 });
  }
});

test('active raw promise ignores destroy and stays pending; second validation cannot create decoder until native first settles', async () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  let enteredRaw1;
  const raw1Entered = new Promise((resolve) => { enteredRaw1 = resolve; });
  let resolveRaw1;
  const raw1Promise = new Promise((resolve) => { resolveRaw1 = resolve; });

  let decoder1Destroyed = false;
  let factory2Calls = 0;
  let decoder2Destroyed = false;

  const spyDecoderFactory1 = () => ({
    metadata: async () => ({ format: 'png', pages: 1, width: 1, height: 1 }),
    timeout() { return this; },
    raw() { return this; },
    toBuffer: () => {
      enteredRaw1();
      return raw1Promise;
    },
    destroy: () => { decoder1Destroyed = true; },
  });

  const spyDecoderFactory2 = () => {
    factory2Calls++;
    return {
      metadata: async () => ({ format: 'png', pages: 1, width: 1, height: 1 }),
      timeout() { return this; },
      raw() { return this; },
      toBuffer: async () => ({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } }),
      destroy: () => { decoder2Destroyed = true; },
    };
  };

  try {
    const p1 = validateDecodedImage(VALID_PNG_BYTES, 'image/png', controller1.signal, spyDecoderFactory1);
    await raw1Entered;

    controller1.abort();
    await assert.rejects(p1, (err) => err.name === 'AbortError');
    assert.equal(decoder1Destroyed, true, 'Destroy must be called on decoder 1');

    const p2 = validateDecodedImage(VALID_PNG_BYTES, 'image/png', controller2.signal, spyDecoderFactory2);
    await new Promise((r) => setImmediate(r));
    assert.equal(factory2Calls, 0, 'Second validation must not create decoder while native first remains unsettled');

    resolveRaw1({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } });

    await p2;
    assert.equal(factory2Calls, 1, 'Second validation creates decoder only after first native settles');
    assert.equal(decoder2Destroyed, true, 'Decoder 2 must be destroyed');
  } finally {
    resolveRaw1({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } });
  }
});

test('queued aborted validation must reject without ever entering decoder factory', async () => {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  let enteredRaw1;
  const raw1Entered = new Promise((resolve) => { enteredRaw1 = resolve; });
  let resolveRaw1;
  const raw1Promise = new Promise((resolve) => { resolveRaw1 = resolve; });

  let factory2Calls = 0;

  const spyDecoderFactory1 = () => ({
    metadata: async () => ({ format: 'png', pages: 1, width: 1, height: 1 }),
    timeout() { return this; },
    raw() { return this; },
    toBuffer: () => {
      enteredRaw1();
      return raw1Promise;
    },
    destroy: () => {},
  });

  const spyDecoderFactory2 = () => {
    factory2Calls++;
    return {
      metadata: async () => ({ format: 'png', pages: 1, width: 1, height: 1 }),
      timeout() { return this; },
      raw() { return this; },
      toBuffer: async () => ({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } }),
      destroy: () => {},
    };
  };

  try {
    const p1 = validateDecodedImage(VALID_PNG_BYTES, 'image/png', controller1.signal, spyDecoderFactory1);
    await raw1Entered;

    const p2 = validateDecodedImage(VALID_PNG_BYTES, 'image/png', controller2.signal, spyDecoderFactory2);

    controller2.abort();
    await assert.rejects(p2, (err) => err.name === 'AbortError');
    assert.equal(factory2Calls, 0, 'Queued aborted validation must never enter decoder factory');

    resolveRaw1({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } });
    await p1;
  } finally {
    resolveRaw1({ data: Buffer.alloc(4), info: { width: 1, height: 1, size: 4 } });
  }
});

// ---------------------------------------------------------------------------
// 2. Positive Controls & Real Sharp Boundary Admission
// ---------------------------------------------------------------------------

test('validateDecodedImage accepts valid 1x1 synthetic PNG and JPEG bytes', async () => {
  const signal = new AbortController().signal;
  await assert.doesNotReject(() => validateDecodedImage(VALID_PNG_BYTES, 'image/png', signal));
  await assert.doesNotReject(() => validateDecodedImage(VALID_JPEG_BYTES, 'image/jpeg', signal));
});

test('validateDecodedImage accepts exact 4,000,000 pixel boundary PNG (2000x2000)', async () => {
  const signal = new AbortController().signal;
  await assert.doesNotReject(() => validateDecodedImage(EXACT_4MP_PNG_BYTES, 'image/png', signal));
});

test('validateImages accepts sequential valid images up to 10 pages', async () => {
  const signal = new AbortController().signal;
  const images = Array.from({ length: 10 }, (_, i) => ({
    page: i + 1,
    mime: i % 2 === 0 ? 'image/png' : 'image/jpeg',
    base64: i % 2 === 0 ? VALID_PNG_BASE64 : VALID_JPEG_BASE64,
  }));
  await assert.doesNotReject(() => validateImages(images, signal));
});

// ---------------------------------------------------------------------------
// 3. Base64 Canonical Syntax & Exact Round-Trip Check
// ---------------------------------------------------------------------------

test('validateImages rejects non-canonical base64 encoding with invalid_image', async () => {
  const signal = new AbortController().signal;
  const images = [{ page: 1, mime: 'image/png', base64: NON_CANONICAL_BASE64 }];
  await assert.rejects(() => validateImages(images, signal), (err) => err.code === 'invalid_image');
});

// ---------------------------------------------------------------------------
// 4. Format, Signature & MIME Agreement
// ---------------------------------------------------------------------------

test('validateDecodedImage rejects MIME mismatch between declared type and signature', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(VALID_JPEG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
  await assert.rejects(() => validateDecodedImage(VALID_PNG_BYTES, 'image/jpeg', signal), (err) => err.code === 'invalid_image');
});

test('validateDecodedImage rejects unsupported formats (WebP, GIF, plain text)', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(WEBP_IMAGE_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
  await assert.rejects(() => validateDecodedImage(ANIMATED_GIF_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
  await assert.rejects(() => validateDecodedImage(TEXT_FILE_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
});

// ---------------------------------------------------------------------------
// 5. Header & Dimension Limits with Valid CRC32
// ---------------------------------------------------------------------------

test('validateDecodedImage rejects pixel count exceeding 4,000,000 with valid CRC', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(OVERSIZED_PIXELS_PNG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
});

test('validateDecodedImage rejects single dimension exceeding 8192 limit with valid CRC', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(OVERSIZED_DIMENSION_PNG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
});

test('validateDecodedImage rejects zero width or height dimension with valid CRC', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(ZERO_DIMENSION_PNG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
});

test('validateDecodedImage rejects corrupt CRC PNG bytes', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(CORRUPT_CRC_PNG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
});

test('validateDecodedImage rejects truncated PNG and JPEG payloads', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(() => validateDecodedImage(TRUNCATED_PNG_BYTES, 'image/png', signal), (err) => err.code === 'invalid_image');
  await assert.rejects(() => validateDecodedImage(TRUNCATED_JPEG_BYTES, 'image/jpeg', signal), (err) => err.code === 'invalid_image');
});

// ---------------------------------------------------------------------------
// 6. Multi-page Processing & Cancellation Semantics
// ---------------------------------------------------------------------------

test('validateImages fails completely if any single page in sequence is invalid', async () => {
  const signal = new AbortController().signal;
  const images = [
    { page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 },
    { page: 2, mime: 'image/png', base64: TRUNCATED_PNG_BASE64 },
    { page: 3, mime: 'image/png', base64: VALID_PNG_BASE64 },
  ];
  await assert.rejects(() => validateImages(images, signal), (err) => err.code === 'invalid_image');
});

test('validateImages pre-aborted signal stops processing immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  const images = [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }];
  await assert.rejects(() => validateImages(images, controller.signal), (err) => err.name === 'AbortError');
});
