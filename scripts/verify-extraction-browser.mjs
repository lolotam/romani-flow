/**
 * AI Document Extraction Browser Integration Suite.
 *
 * Execution Groups:
 * - --preparation: Focuses exclusively on the preparation and rendering contract group
 *                  (real PDF.js worker/assets allowlist, multi-page bounding, pre-createImageBitmap
 *                  header rejection, source/payload boundaries, cancellation & worker termination).
 * - Default: Includes all groups (preparation and forms). Fails explicitly if the forms group
 *            is incomplete (no silent fallback).
 *
 * Architecture & Constraints:
 * - Vite loopback server with configFile: resolve('vite.config.ts'), envFile: false.
 * - Local PDF.js worker and assets served from installed node_modules/pdfjs-dist/ allowlist in both
 *   dev and built fixture. ZERO fake /pdfjs return 200 comment stubs.
 * - Missing Task 11 production modules fail truthfully at preflight semantic check (RED).
 *   Never catch import failures and count them as passed negative tests.
 * - Unconditional assertions: NO conditional skips or if-count greens.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, build, preview } from 'vite';
import { syntheticPdf, syntheticPng, syntheticJpeg } from './fixtures/extraction-pdf.mjs';

const PDFJS_ASSET_BASE = '/pdfjs/6.5.438/';

// Required production modules from Task 11 (must exist for browser execution)
const REQUIRED_TASK11_MODULES = [
  'src/lib/extraction/imageHeader.ts',
  'src/lib/extraction/prepare.ts',
  'src/lib/extraction/pdfAssets.ts',
  'src/lib/extraction/pdf.worker.ts',
  'src/lib/extraction/pdf.ts',
  'src/lib/api/documentExtraction.ts',
];

// Required installed PDF.js assets in node_modules/pdfjs-dist
const REQUIRED_PDFJS_DIRECTORIES = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

/**
 * Validates preflight dependencies and reports missing modules cleanly.
 *
 * @returns {{ ok: boolean; missingModules: string[]; missingAssets: string[] }}
 */
function runPreflightCheck() {
  const missingModules = [];
  for (const mod of REQUIRED_TASK11_MODULES) {
    if (!fs.existsSync(resolve(mod))) {
      missingModules.push(mod);
    }
  }

  const missingAssets = [];
  const workerFile = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  if (!fs.existsSync(workerFile)) {
    missingAssets.push('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  for (const dir of REQUIRED_PDFJS_DIRECTORIES) {
    const fullDir = resolve('node_modules/pdfjs-dist', dir);
    if (!fs.existsSync(fullDir)) {
      missingAssets.push(`node_modules/pdfjs-dist/${dir}`);
    }
  }

  return {
    ok: missingModules.length === 0 && missingAssets.length === 0,
    missingModules,
    missingAssets,
  };
}

/**
 * Executes the preparation and rendering contract test group.
 *
 * @param {import('playwright').Page} page
 */
async function runPreparationTests(page, network) {
  console.log('[PREPARATION SUITE] Executing preparation & rendering contract group...');

  // -------------------------------------------------------------------------
  // Case 1: Setup & Asset Contract: Local PDF.js worker & assets allowlist
  // -------------------------------------------------------------------------
  console.log('[CASE 1] Verifying local PDF.js assets and worker availability...');
  assert.deepEqual(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 23; canvas.height = 17;
    return [canvas.width, canvas.height];
  }), [23, 17], 'Native canvas getters remain intact under the existing setter instrumentation');
  // Successful PDF preparation below must use the actual bundled worker.
  const cmapCheck = await page.evaluate(async (url) => {
    return window.__fixtureControls.testAssetUrl(url);
  }, `${PDFJS_ASSET_BASE}cmaps/Adobe-Japan1-6.bcmap`);
  assert.equal(cmapCheck.status, 200, 'Cmap asset must be served with HTTP 200');

  const fontCheck = await page.evaluate(async (url) => {
    return window.__fixtureControls.testAssetUrl(url);
  }, `${PDFJS_ASSET_BASE}standard_fonts/FoxitSerif.pfb`);
  assert.equal(fontCheck.status, 200, 'Standard font asset must be served with HTTP 200');

  const disallowedCheck = await page.evaluate(async (url) => {
    return window.__fixtureControls.testAssetUrl(url);
  }, `${PDFJS_ASSET_BASE}unauthorized-executable.exe`);
  assert.equal(disallowedCheck.status, 403, 'Asset outside precomputed allowlist must return HTTP 403');

  // -------------------------------------------------------------------------
  // Case 2: Positive Multi-Page PDF Preparation (1, 3, 10 Pages)
  // -------------------------------------------------------------------------
  console.log('[CASE 2.1] Positive Control: 1-page PDF preparation...');
  const pdf1 = syntheticPdf(1);
  const prep1Result = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'doc1.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(pdf1));
  assert.equal(prep1Result.success, true, `1-page PDF preparation failed: ${prep1Result.error}`);
  assert.equal(prep1Result.result?.pageCount, 1, '1-page PDF must report pageCount = 1');
  assert.equal(prep1Result.result?.images?.length, 1, '1-page PDF must produce exactly 1 image');
  assert.equal(prep1Result.result?.images?.[0]?.page, 1, 'First image page number must be 1');
  assert.equal(prep1Result.result?.images?.[0]?.mime, 'image/jpeg', 'PDF page image MIME must be image/jpeg');
  assert.ok((prep1Result.result?.images?.[0]?.base64?.length ?? 0) > 100, 'Image payload must be non-empty base64');

  // Verify decoded dimensions bounded <= 4 MP and <= 8192
  const decode1 = await page.evaluate(async (b64) => {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => res({ width: 0, height: 0 });
      img.src = `data:image/jpeg;base64,${b64}`;
    });
  }, prep1Result.result?.images?.[0]?.base64);
  assert.ok(decode1.width > 0 && decode1.height > 0, '1-page decoded image must have positive dimensions');
  assert.ok(decode1.width <= 8192 && decode1.height <= 8192, 'Dimensions must be <= 8192');
  assert.ok(decode1.width * decode1.height <= 4_000_000, 'Pixel count must be <= 4 MP');

  console.log('[CASE 2.2] Positive Control: 3-page PDF preparation...');
  const pdf3 = syntheticPdf(3);
  const prep3Result = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'doc3.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(pdf3));
  assert.equal(prep3Result.success, true, `3-page PDF preparation failed: ${prep3Result.error}`);
  assert.equal(prep3Result.result?.pageCount, 3, '3-page PDF must report pageCount = 3');
  assert.equal(prep3Result.result?.images?.length, 3, '3-page PDF must produce exactly 3 images');
  for (let i = 0; i < 3; i++) {
    assert.equal(prep3Result.result?.images?.[i]?.page, i + 1, `Image ${i} page index must be ${i + 1}`);
    assert.ok((prep3Result.result?.images?.[i]?.base64?.length ?? 0) > 100, `Image ${i} base64 must be non-empty`);
  }

  console.log('[CASE 2.3] Positive Control: 10-page PDF preparation (Upper Limit Boundary)...');
  const pdf10 = syntheticPdf(10);
  const prep10Result = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'doc10.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(pdf10));
  assert.equal(prep10Result.success, true, `10-page PDF preparation failed: ${prep10Result.error}`);
  assert.equal(prep10Result.result?.pageCount, 10, '10-page PDF must report pageCount = 10');
  assert.equal(prep10Result.result?.images?.length, 10, '10-page PDF must produce exactly 10 images');
  for (const prepared of [prep1Result, prep3Result, prep10Result]) {
    const dimensions = await page.evaluate(async images => Promise.all(images.map(image => new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve([img.naturalWidth, img.naturalHeight]); img.onerror = reject;
      img.src = 'data:' + image.mime + ';base64,' + image.base64;
    }))), prepared.result.images);
    prepared.result.images.forEach((image, index) => {
      assert.equal(image.page, index + 1); assert.ok(image.base64.length > 100);
      const [width, height] = dimensions[index];
      assert.ok(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 4000000);
    });
  }

  // -------------------------------------------------------------------------
  // Case 3: Negative Overlimit Boundary (11 Pages)
  // Positive control: 10-page PDF succeeded immediately above
  // -------------------------------------------------------------------------
  console.log('[CASE 3] Negative Boundary: 11-page PDF rejection...');
  const pdf11 = syntheticPdf(11);
  const prep11Result = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'doc11.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(pdf11));
  assert.equal(prep11Result.success, false, '11-page PDF must be rejected');
  assert.equal(prep11Result.error, 'preparation_limit');
  const embeddedOversize = await page.evaluate(async bytes => {
    return window.__fixtureControls.testPrepareDocument(new File([new Uint8Array(bytes)], 'large-embedded.pdf', { type: 'application/pdf' }));
  }, Array.from(syntheticPdf(1, { largeImage: true })));
  assert.equal(embeddedOversize.success, false, 'PDF.js must not silently omit an oversized embedded image');
  assert.equal(embeddedOversize.error, 'preparation_limit');
  // -------------------------------------------------------------------------
  // Case 4: Negative Encrypted PDF Rejection
  // Positive control: 1-page unencrypted PDF succeeded above
  // -------------------------------------------------------------------------
  console.log('[CASE 4] Negative Boundary: Encrypted PDF rejection...');
  const encryptedPdf = syntheticPdf(1, { encrypted: true });
  const encResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'encrypted.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(encryptedPdf));
  assert.equal(encResult.success, false, 'Encrypted PDF must be rejected');
  assert.equal(encResult.error, 'preparation_encrypted');
  // -------------------------------------------------------------------------
  // Case 5: Negative Corrupt PDF Rejection
  // Positive control: 1-page valid PDF succeeded above
  // -------------------------------------------------------------------------
  console.log('[CASE 5] Negative Boundary: Corrupted PDF rejection...');
  const brokenPdf = syntheticPdf(1, { broken: true });
  const brokenResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'corrupted.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(brokenPdf));
  assert.equal(brokenResult.success, false, 'Corrupted PDF must be rejected');
  assert.equal(brokenResult.error, 'preparation_invalid');
  // -------------------------------------------------------------------------
  // Case 6: Image Format Positive Controls (PNG & JPEG)
  // -------------------------------------------------------------------------
  console.log('[CASE 6.1] Positive Control: PNG image preparation...');
  const validPng = syntheticPng({ width: 100, height: 100 });
  const pngResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'valid.png', { type: 'image/png' });
    let reads = 0;
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => { reads++; return read(); };
    return { ...await window.__fixtureControls.testPrepareDocument(file), reads };
  }, Array.from(validPng));
  assert.ok(pngResult.reads > 0, 'Valid source control must read its bytes');
  assert.equal(pngResult.success, true, `Valid PNG preparation failed: ${pngResult.error}`);
  assert.equal(pngResult.result?.pageCount, 1, 'PNG must have pageCount = 1');
  assert.equal(pngResult.result?.images?.[0]?.mime, 'image/png', 'PNG image must preserve image/png MIME');

  console.log('[CASE 6.2] Positive Control: JPEG image preparation...');
  const validJpeg = await syntheticJpeg({ width: 100, height: 100 });
  const jpegResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'valid.jpg', { type: 'image/jpeg' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(validJpeg));
  assert.equal(jpegResult.success, true, `Valid JPEG preparation failed: ${jpegResult.error}`);
  assert.equal(jpegResult.result?.pageCount, 1, 'JPEG must have pageCount = 1');
  assert.equal(jpegResult.result?.images?.[0]?.mime, 'image/jpeg', 'JPEG image must preserve image/jpeg MIME');

  // -------------------------------------------------------------------------
  // Case 7: Image Header Inspection & Pre-createImageBitmap Rejection (>4 MP / >8192)
  // Positive control: Case 6.1 & 6.2 succeeded and invoked createImageBitmap
  // -------------------------------------------------------------------------
  console.log('[CASE 7.1] Negative Boundary: >4 MP Image Header Rejection before createImageBitmap...');
  await page.evaluate(() => window.__fixtureControls.resetSpies());
  // Oversized 2500x2000 = 5,000,000 pixels (>4,000,000 limit)
  const oversizedJpeg = await syntheticJpeg({ width: 2500, height: 2000 });
  const overPixelResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'large-pixel.jpg', { type: 'image/jpeg' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(oversizedJpeg));
  assert.equal(overPixelResult.success, false, 'Image with >4 MP header must be rejected');
  assert.equal(overPixelResult.error, 'preparation_limit');  // Spy boundary check: createImageBitmap must NOT have been called
  const spiesAfterPixels = await page.evaluate(() => window.__fixtureControls.getSpies());
  assert.equal(
    spiesAfterPixels.createImageBitmapCalls,
    0,
    'Image >4 MP must be rejected during header check before createImageBitmap is invoked'
  );

  console.log('[CASE 7.2] Negative Boundary: Dimension >8192 Image Header Rejection...');
  await page.evaluate(() => window.__fixtureControls.resetSpies());
  // Oversized dimension 9000x100 (>8192 limit)
  const oversizedDimJpeg = await syntheticJpeg({ width: 9000, height: 100 });
  const overDimResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'large-dim.jpg', { type: 'image/jpeg' });
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(oversizedDimJpeg));
  assert.equal(overDimResult.success, false, 'Image with dimension >8192 must be rejected');
  const spiesAfterDim = await page.evaluate(() => window.__fixtureControls.getSpies());
  assert.equal(
    spiesAfterDim.createImageBitmapCalls,
    0,
    'Image with dimension >8192 must be rejected before createImageBitmap is invoked'
  );

  // -------------------------------------------------------------------------
  // Case 8: Source File Size Boundary (20 MiB)
  // Positive control: Source cap accepted on valid files above
  // -------------------------------------------------------------------------
  console.log('[CASE 8] Negative Boundary: Source File >20 MiB Rejection...');
  const overSourceResult = await page.evaluate(async () => {
    const oversizedBlob = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'application/pdf' });
    const file = new File([oversizedBlob], 'oversized-source.pdf', { type: 'application/pdf' });
    let reads = 0;
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => { reads++; return read(); };
    const result = await window.__fixtureControls.testPrepareDocument(file, undefined, 20 * 1024 * 1024);
    return { ...result, reads };
  });
  assert.equal(overSourceResult.success, false, 'Source file >20 MiB must be rejected immediately');
  assert.equal(overSourceResult.error, 'preparation_limit');
  assert.equal(overSourceResult.reads, 0, 'Oversized source must be rejected before arrayBuffer reads');
  // -------------------------------------------------------------------------
  // Case 9: Request JSON Payload Size Boundary (10 MiB)
  // Positive control: Standard valid requests pass within 10 MiB limit
  // -------------------------------------------------------------------------
  console.log('[CASE 9] Negative Boundary: Request JSON Payload >10 MiB Rejection...');
  const postsBeforeControl = network.postAttempts;
  const payloadControl = await page.evaluate(async base64 => window.__fixtureControls.testExtractDocument({
    requestId: crypto.randomUUID(), scope: 'test-scope', context: 'kw-docs-context',
    settingsVersion: 'a'.repeat(64), catalogVersion: 'b'.repeat(64), pageCount: 1,
    images: [{ page: 1, mime: 'image/png', base64 }],
  }), Buffer.from(validPng).toString('base64'));
  assert.equal(payloadControl.success, true, 'Within-budget request must reach the actual HTTP boundary');
  assert.equal(network.postAttempts, postsBeforeControl + 1);
  const postsBeforeOversize = network.postAttempts;
  const overPayloadResult = await page.evaluate(async () => {
    const hugePayload = {
      requestId: crypto.randomUUID(),
      scope: 'test-scope',
      context: 'kw-docs-context',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      pageCount: 1,
      images: [
        {
          page: 1,
          mime: 'image/jpeg',
          base64: 'A'.repeat(10 * 1024 * 1024 + 1024), // Exceeds 10 MiB UTF-8 JSON budget
        },
      ],
    };
    return window.__fixtureControls.testExtractDocument(hugePayload);
  });
  assert.equal(overPayloadResult.success, false, 'Payload >10 MiB must be rejected before POST');
  assert.equal(overPayloadResult.error, 'payload_too_large');
  assert.equal(network.postAttempts, postsBeforeOversize, 'Oversized request must never reach POST transport');
  // -------------------------------------------------------------------------
  // Case 10: Cancellation & Resource Lifecycle at Browser Boundaries
  // -------------------------------------------------------------------------
  console.log('[CASE 10.1] Cancellation: Pre-aborted signal immediate rejection...');
  const preAbortedResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'pre-abort.pdf', { type: 'application/pdf' });
    const controller = new AbortController();
    controller.abort();
    return window.__fixtureControls.testPrepareDocument(file, controller.signal);
  }, Array.from(pdf1));
  assert.equal(preAbortedResult.success, false, 'Pre-aborted preparation must immediately reject');
  assert.equal(preAbortedResult.error, 'AbortError');
  console.log('[CASE 10.2] Cancellation: Mid-flight abort & worker/canvas release counters...');
  await page.evaluate(() => window.__fixtureControls.resetSpies());
  const midFlightResult = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'mid-abort.pdf', { type: 'application/pdf' });
    const controller = new AbortController();
    let onStart, timer;
    const started = new Promise(resolve => {
      onStart = resolve;
      window.addEventListener('fixture-worker-started', onStart, { once: true });
    });
    const prepPromise = window.__fixtureControls.testPrepareDocument(file, controller.signal);
    const settlePreparation = async () => {
      let settleTimer;
      try {
        return await Promise.race([prepPromise, new Promise((_, reject) => {
          settleTimer = setTimeout(() => reject(new Error('Aborted preparation did not settle')), 5000);
        })]);
      } finally { clearTimeout(settleTimer); }
    };
    try {
      await Promise.race([
        started,
        prepPromise.then(() => { throw new Error('Preparation settled before worker started'); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker start timeout')), 5000); }),
      ]);
      controller.abort();
      return await settlePreparation();
    } finally {
      clearTimeout(timer);
      window.removeEventListener('fixture-worker-started', onStart);
      controller.abort();
      await settlePreparation();
    }
  }, Array.from(pdf10));
  assert.equal(midFlightResult.success, false, 'Mid-flight aborted preparation must reject');
  const spiesAfterAbort = await page.evaluate(() => window.__fixtureControls.getSpies());
  assert.ok(
    spiesAfterAbort.workerTerminateCalls >= 1 || spiesAfterAbort.canvasReleaseCalls >= 1,
    'Mid-flight abort must terminate worker or release/zero canvas'
  );

  console.log('[CASE 10.3] Preparation deadline: 30s deadline with controlled page clock (29,999ms vs 30,000ms)...');
  const deadlineClock = new Date('2030-01-01T00:00:00Z');
  await page.clock.install({ time: deadlineClock });
  let observedRed = null;
  try {
    await page.evaluate(() => {
      window.__fixtureControls.resetSpies();
      window.__fixtureControls.setRenderGate(true);
    });

    const prepPromise = page.evaluate(async (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'deadline-test.pdf', { type: 'application/pdf' });
      const originalTimer = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 30_000 || delay === 60_000) window.__deadlineTimerStart = Date.now();
        return originalTimer(callback, delay, ...args);
      };
      window.__deadlineProbePending = true;
      try { return await window.__fixtureControls.testPrepareDocument(file); }
      finally { window.__deadlineProbePending = false; window.setTimeout = originalTimer; }
    }, Array.from(pdf1));

    // Await actual entered-toBlob gate barrier before advancing page clock!
    let entryTimer;
    try {
      await Promise.race([
        page.evaluate(() => window.__fixtureControls.awaitEnteredToBlob()),
        new Promise((_, reject) => { entryTimer = setTimeout(() => reject(new Error('PDF did not reach encoding gate')), 5000); }),
      ]);
    } finally { clearTimeout(entryTimer); }
    // Let real rAF reach encoding first, then freeze the clock and calculate
    // the boundary from the actual timer registration, not elapsed tool time.
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 50)));
    const elapsed = await page.evaluate(() => Date.now() - window.__deadlineTimerStart);
    assert.ok(Number.isFinite(elapsed) && elapsed < 29999, 'Deadline registration observed before boundary');

    // Advance to 29,999ms: positive control - deadline has NOT expired yet
    await page.clock.fastForward(29999 - elapsed);

    // At 29,999ms: assert work pending and live resources
    const isPendingAt29999 = await page.evaluate(() => window.__deadlineProbePending);
    assert.equal(isPendingAt29999, true, 'Preparation work must still be pending at 29,999ms');
    const midSpies = await page.evaluate(() => window.__fixtureControls.getSpies());
    assert.equal(midSpies.workerTerminateCalls, 0, 'Worker must not terminate before 30,000ms deadline');
    assert.equal(midSpies.canvasReleaseCalls, 0, 'Canvas must not be released before deadline');

    // Advance 1ms to 30,000ms: target contract requirement (30s deadline)
    await page.clock.fastForward(1);

    // Release render gate
    await page.evaluate(() => window.__fixtureControls.releaseRenderGate());

    const deadlineResult = await prepPromise;

    try {
      assert.equal(deadlineResult.success, false, 'Preparation must fail on 30s deadline expiration');
      assert.equal(deadlineResult.error, 'preparation_timeout', 'Exact failure category must be preparation_timeout');

      const endSpies = await page.evaluate(() => window.__fixtureControls.getSpies());
      assert.ok(endSpies.workerTerminateCalls >= 1, 'Worker must terminate upon deadline timeout');
      assert.ok(endSpies.canvasReleaseCalls >= 1, 'Canvas must be released upon deadline timeout');
      console.log('  ✔ [PASS] Case 10.3: Preparation 30s deadline');
    } catch (err) {
      if (err.name === 'AssertionError' || err instanceof assert.AssertionError) {
        observedRed = err;
        console.log(`  ✘ [OBSERVED RED (Target 30s Deadline)] ${err.message}`);
        console.log(`    Missing behavior: DEADLINE_MS is 60,000ms in src/lib/extraction/pdf.ts instead of 30,000ms`);
      } else {
        throw err;
      }
    }
  } finally {
    await page.evaluate(() => window.__fixtureControls.releaseRenderGate()).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Case 11: MIME Sniffing & Spoofed File Rejection
  // -------------------------------------------------------------------------
  console.log('[CASE 11] Negative Boundary: Spoofed MIME rejection...');
  const spoofedResult = await page.evaluate(async () => {
    const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>Spoofed</body></html>');
    const file = new File([htmlBytes], 'spoofed.pdf', { type: 'application/pdf' });
    return window.__fixtureControls.testPrepareDocument(file);
  });
  assert.equal(spoofedResult.success, false, 'Spoofed HTML file named .pdf must be rejected');

  // Codex 4504559741: use native JPEG encoding and actual browser decoding.
  // Keep cases independent so EXIF 6 failing does not hide EXIF 8.
  await page.clock.resume();
  let orientationPass = 0;
  let orientationRed = 0;
  let orientationSetupFailures = 0;
  for (const orientation of [1, 6, 8]) {
    let targetReached = false;
    try {
      const bytes = await syntheticJpeg({ width: 96, height: 48, orientation });
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.orientation, orientation, 'Fixture must contain genuine EXIF orientation');
      assert.equal(metadata.width, 96);
      assert.equal(metadata.height, 48);
      const result = await page.evaluate(async ({ bytes, orientation }) => {
        const file = new File([new Uint8Array(bytes)], `exif-${orientation}.jpg`, { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(file);
        const decoded = [bitmap.width, bitmap.height];
        bitmap.close();
        const controller = new AbortController();
        let timer;
        try {
          const prepared = await Promise.race([
            window.__fixtureControls.testPrepareDocument(file, controller.signal),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('EXIF preparation did not settle in 5s')); }, 5000); }),
          ]);
          return { decoded, prepared };
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
      }, { bytes: Array.from(bytes), orientation });
      assert.deepEqual(result.decoded, orientation === 1 ? [96, 48] : [48, 96], 'Real browser must honor EXIF rotation');
      console.log(`[PR16 EXIF ${orientation}] source=96x48, decoded=${result.decoded.join('x')}, bytes=${bytes.length}`);
      targetReached = true;
      assert.equal(result.prepared.success, true, `EXIF ${orientation} valid JPEG must prepare: ${result.prepared.error}`);
      assert.equal(result.prepared.result.pageCount, 1);
      assert.deepEqual(result.prepared.result.images, [{ page: 1, mime: 'image/jpeg', base64: bytes.toString('base64') }], 'Preserve exact JPEG bytes, orientation metadata and payload');
      orientationPass++;
      console.log(`[PR16 EXIF ${orientation}] PASS: genuine 96x48 JPEG, decoded ${result.decoded.join('x')}, exact payload preserved`);
    } catch (err) {
      if (targetReached && err instanceof assert.AssertionError) {
        orientationRed++;
        console.log(`[PR16 EXIF ${orientation}] OBSERVED RED: ${err.message}`);
      } else {
        orientationSetupFailures++;
        console.log(`[PR16 EXIF ${orientation}] HARNESS FAILURE: ${err.stack || err}`);
      }
    }
  }
  const passedCount = 11 + (observedRed ? 0 : 1) + orientationPass;
  const observedRedCount = (observedRed ? 1 : 0) + orientationRed;
  console.log(`[PREPARATION SUITE] total=15 pass=${passedCount} RED=${observedRedCount} setup=${orientationSetupFailures}`);
  return { totalCount: 15, passedCount, observedRedCount, unexpectedFailCount: orientationSetupFailures };
}

/**
 * Executes the forms test group (DocumentEditorDialog & EmployeeDocumentForm).
 *
 * NOTE: This group is explicitly incomplete and requires pending UI tasks.
 * When called in the default full run, it fails explicitly without silent fallback.
 */
async function main() {
  const args = process.argv.slice(2);
  const isPreparationOnly = args.includes('--preparation');
  const isLifecycleOnly = args.includes('--lifecycle');
  const isSettingsOnly = args.includes('--settings');
  const isFormsOnly = args.includes('--forms');
  const isBuiltMode = args.includes('--built');

  if (isLifecycleOnly) {
    const { main: runLifecycleMain } = await import('./verify-extraction-lifecycle.mjs');
    return await runLifecycleMain();
  }

  if (isSettingsOnly) {
    const { main: runSettingsMain } = await import('./verify-extraction-settings.mjs');
    return await runSettingsMain();
  }

  if (isFormsOnly) {
    const { main: runFormsMain } = await import('./verify-extraction-forms.mjs');
    return await runFormsMain();
  }

  console.log('======================================================================');
  console.log(`[BROWSER SUITE] Mode: ${isPreparationOnly ? 'PREPARATION GROUP ONLY' : 'DEFAULT FULL SUITE (ALL GROUPS)'}`);
  console.log(`[BROWSER SUITE] Target Fixture: ${isBuiltMode ? 'BUILT FIXTURE (REAL BUILD OUTPUT)' : 'DEV SERVER'}`);
  console.log('======================================================================');

  // Step 1: Preflight Semantic and Dependency Check
  console.log('[PREFLIGHT] Checking Task 11 production modules and PDF.js assets...');
  const preflight = runPreflightCheck();
  if (!preflight.ok) {
    console.error('======================================================================');
    console.error('[BROWSER SUITE] PREFLIGHT SEMANTIC CHECK: FAILED (EXPECTED RED)');
    if (preflight.missingModules.length > 0) {
      console.error('Missing required Task 11 production modules:');
      for (const mod of preflight.missingModules) {
        console.error(`  - ${mod}`);
      }
    }
    if (preflight.missingAssets.length > 0) {
      console.error('Missing required PDF.js assets:');
      for (const asset of preflight.missingAssets) {
        console.error(`  - ${asset}`);
      }
    }
    console.error('Harness contract review: Missing Task 11 implementation must fail truthfully.');
    console.error('Browser launch skipped until implementation modules exist.');
    console.error('======================================================================');
    process.exitCode = 1;
    return;
  }

  // Step 2: Build Allowlist for Local PDF.js Assets
  // Exercise the actual application asset plugin in both modes.

  let server = null;
  let origin = '';

  if (isBuiltMode) {
    // Built fixture: Real build output, not source served under 'production' label
    const outDir = resolve('scripts/fixtures/.dist');
    fs.writeFileSync(resolve('scripts/fixtures/extraction-browser.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-browser.tsx"></script></body></html>');
    console.log(`[BUILD] Building real fixture output to ${outDir}...`);
    await build({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@': resolve('src') } },
      build: {
        outDir,
        emptyOutDir: false,
        target: 'es2022',
        rollupOptions: {
          input: resolve('scripts/fixtures/extraction-browser.html'),
        },
      },

    });

    server = await preview({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 },
    });
    const port = server.httpServer.address().port;
    origin = `http://127.0.0.1:${port}`;
    console.log(`[BROWSER SUITE] Built fixture preview listening at ${origin}`);
  } else {
    // Dev fixture: Local loopback server with exact PDF.js asset serving
    server = await createServer({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@': resolve('src') } },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'synthetic-extraction-browser-fixture',
          configureServer(s) {
            s.middlewares.use('/fixture', async (_req, res, next) => {
              try {
              res.setHeader('Content-Type', 'text/html');
              res.end(await s.transformIndexHtml('/fixture',
                '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extraction Fixture</title></head>' +
                '<body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-browser.tsx"></script></body></html>'
              ));
              } catch (error) { next(error); }
            });
          },
        },
      ],
    });

    await server.listen();
    const port = server.httpServer.address().port;
    origin = `http://127.0.0.1:${port}`;
    console.log(`[BROWSER SUITE] Dev fixture listening at ${origin}`);
  }

  let browser = null;
  let preparationSummary = null;

  try {
    let playwright;
    try {
      playwright = await import(
        process.env.PLAYWRIGHT_MODULE_PATH
          ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
          : 'playwright'
      );
    } catch (importErr) {
      console.error('[BROWSER SUITE] Failed to import Playwright:', importErr.message);
      throw importErr;
    }

    const browserEngine = process.env.BROWSER_ENGINE || 'chromium';
    if (!['chromium', 'firefox'].includes(browserEngine)) throw new Error('Unsupported test browser engine');
    const browserType = playwright[browserEngine];
    try {
      browser = await browserType.launch({
        ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
        headless: true,
      });
      console.log('[BROWSER SUITE] Browser launched successfully.');
    } catch (launchErr) {
      console.error('======================================================================');
      console.error('[BROWSER SUITE] BROWSER BINARY NOT PROVISIONED ON THIS ENVIRONMENT');
      console.error('Diagnostic error:', launchErr.message);
      console.error('Parent owns browser installation and future execution.');
      console.error('======================================================================');
      process.exitCode = 1;
      return;
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const egressViolations = [];
    const network = { postAttempts: 0 };
    const consoleErrors = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Case 1 deliberately requests a denied local PDF.js asset (real server 403).
      if (message.location().url === `${origin}${PDFJS_ASSET_BASE}unauthorized-executable.exe`
        && /^Failed to load resource: the server responded with a status of 403\b/.test(message.text())) return;
      consoleErrors.push(message.text());
    });
    page.setDefaultTimeout(15000);

    // Strict loopback routing & zero fake PDF.js asset stub
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.origin !== origin || url.username || url.password) {
        egressViolations.push(req.url());
        console.error(`[SECURITY BLOCKED] Disallowed non-loopback egress: ${req.url()}`);
        return route.abort('blockedbyclient');
      }

      // PDF.js assets are served directly by the loopback Vite server (no mock interception)
      if (url.pathname.startsWith(PDFJS_ASSET_BASE)) {
        return route.continue();
      }

      // API calls mock store
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/document-extraction/status') {
          return route.fulfill({
            json: {
              data: {
                enabled: true,
                provider: 'groq',
                model: 'meta-llama/llama-3.2-11b-vision-instruct',
                configured: { groq: true, openrouter: false },
                processingAuthorized: true,
                processingContext: 'kw-docs-context',
                available: true,
                reason: '',
                settingsVersion: 'a'.repeat(64),
                catalogVersion: 'b'.repeat(64),
                maxSourceBytes: 20 * 1024 * 1024,
              },
              error: null,
            },
          });
        }

        if (url.pathname === '/api/document-extraction') {
          if (req.method() === 'POST') network.postAttempts++;
          const rawBody = req.postData() || '';
          if (Buffer.byteLength(rawBody, 'utf8') > 10 * 1024 * 1024) {
            return route.fulfill({
              status: 413,
              json: { data: null, error: { code: 'payload_too_large', message: 'Payload exceeds 10 MiB.' } },
            });
          }
          return route.fulfill({
            json: {
              data: {
                requestId: JSON.parse(rawBody).requestId,
                context: 'kw-docs-context',
                settingsVersion: 'a'.repeat(64),
                catalogVersion: 'b'.repeat(64),
                pageCount: 1,
                fields: {
                  title: { value: 'Civil ID', state: 'clear', alternatives: [], reason: 'none' },
                  document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
                  document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
                  ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
                  issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
                  expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
                },
              },
              error: null,
            },
          });
        }
      }

      return route.continue();
    });

    await page.goto((isBuiltMode ? `${origin}/scripts/fixtures/extraction-browser.html` : `${origin}/fixture`) + '?preparation');
    await page.waitForSelector('[data-testid="fixture-controls"]');

    const prepSummary = preparationSummary = await runPreparationTests(page, network);
    assert.deepEqual(egressViolations, [], 'Preparation must not attempt external requests');
    assert.deepEqual(pageErrors, [], 'Preparation must not emit uncaught page errors');
    assert.deepEqual(consoleErrors, [], 'Preparation must not emit unexpected console errors');
    if (prepSummary.observedRedCount > 0 || prepSummary.unexpectedFailCount > 0) {
      console.log(`[PREPARATION SUITE] Nonzero exit code enforced: ${prepSummary.observedRedCount} observed RED; ${prepSummary.unexpectedFailCount} setup failures.`);
      process.exitCode = 1;
    } else {
      console.log('[BROWSER SUITE] Preparation group run completed successfully.');
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }

  if (!isPreparationOnly) {
    if (process.exitCode && process.exitCode !== 0) return;
    console.log('\n======================================================================');
    console.log('[BROWSER ORCHESTRATION] Sequentially executing lifecycle group...');
    console.log('======================================================================');
    const { main: runLifecycleMain } = await import('./verify-extraction-lifecycle.mjs');
    const lifecycleSummary = await runLifecycleMain();
    if (process.exitCode && process.exitCode !== 0) {
      console.error(`\n[BROWSER ORCHESTRATION HALTED] Lifecycle group failed with exit code ${process.exitCode}`);
      return;
    }

    console.log('\n======================================================================');
    console.log('[BROWSER ORCHESTRATION] Sequentially executing settings group (12 cases)...');
    console.log('======================================================================');
    const { main: runSettingsMain } = await import('./verify-extraction-settings.mjs');
    await runSettingsMain();
    if (process.exitCode && process.exitCode !== 0) {
      console.error(`\n[BROWSER ORCHESTRATION HALTED] Settings group failed with exit code ${process.exitCode}`);
      return;
    }

    console.log('\n======================================================================');
    console.log('[BROWSER ORCHESTRATION] Sequentially executing forms group...');
    console.log('======================================================================');
    const { main: runFormsMain } = await import('./verify-extraction-forms.mjs');
    const formsSummary = await runFormsMain();
    if (process.exitCode && process.exitCode !== 0) {
      console.error(`\n[BROWSER ORCHESTRATION HALTED] Forms group failed with exit code ${process.exitCode}. No success banner displayed.`);
      return;
    }

    console.log('\n======================================================================');
    console.log('[BROWSER ORCHESTRATION SUMMARY]');
    console.log(`  Group 1: Preparation & Rendering: ${preparationSummary.totalCount} cases`);
    console.log(`  Group 2: Document Lifecycle:      ${lifecycleSummary.totalCount} cases`);
    console.log('  Group 3: Settings & Approvals:    12 cases');
    console.log(`  Group 4: Forms & CAS Integration: ${formsSummary.totalCount} cases`);
    const total = preparationSummary.totalCount + lifecycleSummary.totalCount + 12 + formsSummary.totalCount;
    console.log(`  Total Executed Cases:             ${total} group cases`);
    console.log('======================================================================');
    console.log(`[BROWSER ORCHESTRATION] All ${total} browser group cases completed successfully with exit code 0.`);
    console.log('======================================================================\n');
  }
}

main().catch((err) => {
  console.error('[BROWSER SUITE FATAL]', err);
  process.exit(1);
});
