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
async function runPreparationTests(page) {
  console.log('[PREPARATION SUITE] Executing preparation & rendering contract group...');

  // -------------------------------------------------------------------------
  // Case 1: Setup & Asset Contract: Local PDF.js worker & assets allowlist
  // -------------------------------------------------------------------------
  console.log('[CASE 1] Verifying local PDF.js assets and worker availability...');
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
    return window.__fixtureControls.testPrepareDocument(file);
  }, Array.from(validPng));
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
    return window.__fixtureControls.testPrepareDocument(file, undefined, 20 * 1024 * 1024);
  });
  assert.equal(overSourceResult.success, false, 'Source file >20 MiB must be rejected immediately');
  assert.equal(overSourceResult.error, 'preparation_limit');
  // -------------------------------------------------------------------------
  // Case 9: Request JSON Payload Size Boundary (10 MiB)
  // Positive control: Standard valid requests pass within 10 MiB limit
  // -------------------------------------------------------------------------
  console.log('[CASE 9] Negative Boundary: Request JSON Payload >10 MiB Rejection...');
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
    const started = new Promise(resolve => window.addEventListener('fixture-worker-started', resolve, { once: true }));
    const prepPromise = window.__fixtureControls.testPrepareDocument(file, controller.signal);
    await started;
    controller.abort();
    return prepPromise;
  }, Array.from(pdf10));
  assert.equal(midFlightResult.success, false, 'Mid-flight aborted preparation must reject');
  const spiesAfterAbort = await page.evaluate(() => window.__fixtureControls.getSpies());
  assert.ok(
    spiesAfterAbort.workerTerminateCalls >= 1 || spiesAfterAbort.canvasReleaseCalls >= 1,
    'Mid-flight abort must terminate worker or release/zero canvas'
  );

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

  console.log('[PREPARATION SUITE] All 11 preparation/rendering contract cases verified.');
}

/**
 * Executes the forms test group (DocumentEditorDialog & EmployeeDocumentForm).
 *
 * NOTE: This group is explicitly incomplete and requires pending UI tasks.
 * When called in the default full run, it fails explicitly without silent fallback.
 */
async function runFormsTests() {
  console.log('[FORMS SUITE] Executing forms test group...');
  // Explicitly incomplete: Task 10 review focus is preparation/rendering.
  // Forms group requires Task 13/14 UI completion.
  assert.fail(
    '[INCOMPLETE GROUP] Forms / UI group is explicitly incomplete and requires pending UI tasks. ' +
    'Run with --preparation to verify the preparation/rendering contract group.'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const isPreparationOnly = args.includes('--preparation');
  const isLifecycleOnly = args.includes('--lifecycle');
  const isSettingsOnly = args.includes('--settings');
  const isBuiltMode = args.includes('--built');

  if (isLifecycleOnly) {
    const { main: runLifecycleMain } = await import('./verify-extraction-lifecycle.mjs');
    return await runLifecycleMain();
  }

  if (isSettingsOnly) {
    const { main: runSettingsMain } = await import('./verify-extraction-settings.mjs');
    return await runSettingsMain();
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

    const { chromium } = playwright;
    try {
      browser = await chromium.launch({
        ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
        headless: true,
      });
      console.log('[BROWSER SUITE] Chromium browser launched successfully.');
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
    page.setDefaultTimeout(15000);

    // Strict loopback routing & zero fake PDF.js asset stub
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
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
                requestId: crypto.randomUUID(),
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

    // Run selected execution group
    if (isPreparationOnly) {
      await runPreparationTests(page);
      assert.deepEqual(egressViolations, [], 'Preparation must not attempt external requests');
      console.log('[BROWSER SUITE] Preparation group run completed successfully.');
    } else {
      await runPreparationTests(page);
      await runFormsTests();
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
}

main().catch((err) => {
  console.error('[BROWSER SUITE FATAL]', err);
  process.exit(1);
});
