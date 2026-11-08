/**
 * AI Document Extraction Lifecycle Integration Test Runner (Task 10 / Task 12).
 *
 * Exercises the real useDocumentExtraction hook and DocumentExtractionPanel in a real
 * Chromium browser with strictly mocked loopback HTTP endpoints conforming to shared Zod contracts.
 *
 * In accordance with parent review findings:
 * - Statically imports real modules via scripts/fixtures/extraction-lifecycle.tsx (no virtual module, no any/null stubs).
 * - Truthful preflight check: fails with RED exit code 1 if Task 12 modules are absent (setup failure, not negative test).
 * - Per-request captured barriers and resolvers with timeout guards and settled routes in finally blocks.
 * - Contract alignment: provider_rate_limit & retryAfterSeconds, void replace() returning no patch, real callback observation.
 * - Real A-after-B race with late A response rejection, and File object identity collisions with identical metadata.
 * - Playwright clock fast-forwarding for cooldown expiry with zero auto-retry requests.
 * - Conservative catalog acceptance: review alternatives rejected, exact resolved clear IDs accepted.
 * - Loopback security boundary: /api/auth/me served with synthetic admin, egress and page errors strictly asserted.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, build, preview } from 'vite';
import { tsImport } from 'tsx/esm/api';
import { syntheticPng } from './fixtures/extraction-pdf.mjs';

const { extractionRequest: extractionRequestSchema, resultSchema } = await tsImport(
  '../server/contracts/documentExtraction.ts', import.meta.url,
);
const { extraction: arabicCopy } = await tsImport('../src/translations/ar/extraction.ts', import.meta.url);
const { extraction: englishCopy } = await tsImport('../src/translations/en/extraction.ts', import.meta.url);

// Required production modules from Task 11 (must exist)
const REQUIRED_TASK11_MODULES = [
  'src/lib/extraction/imageHeader.ts',
  'src/lib/extraction/prepare.ts',
  'src/lib/extraction/pdfAssets.ts',
  'src/lib/extraction/pdf.worker.ts',
  'src/lib/extraction/pdf.ts',
  'src/lib/api/documentExtraction.ts',
];

// Required production modules from Task 12 (must exist for lifecycle browser execution)
const REQUIRED_TASK12_MODULES = [
  'src/lib/extraction/session.ts',
  'src/hooks/useDocumentExtraction.ts',
  'src/components/documents/DocumentExtractionPanel.tsx',
];

/**
 * Validates preflight dependencies and reports missing modules cleanly.
 *
 * @returns {{ ok: boolean; missingModules: string[]; missingLifecycleModules: string[] }}
 */
function runPreflightCheck() {
  const missingModules = [];
  for (const mod of REQUIRED_TASK11_MODULES) {
    if (!fs.existsSync(resolve(mod))) {
      missingModules.push(mod);
    }
  }

  const missingLifecycleModules = [];
  for (const mod of REQUIRED_TASK12_MODULES) {
    if (!fs.existsSync(resolve(mod))) {
      missingLifecycleModules.push(mod);
    }
  }

  const ok = missingModules.length === 0 && missingLifecycleModules.length === 0;

  return {
    ok,
    missingModules,
    missingLifecycleModules,
  };
}

/**
 * Stateful Mock API Controller managing loopback HTTP routes and per-request barriers.
 */
function boundedGate(promise, label, timeoutMs = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

class ExtractionMockApi {
  constructor() {
    this.status = {
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
    };
    this.statusCalls = 0;
    this.statusHandler = null;
    this.statusHttpStatus = 200;

    this.postCalls = 0;
    this.capturedRequests = [];
    this.requestListeners = [];
    this.currentAccount = 'account-admin-1';
  }

  async reset() {
    await this.settleAllHeld();
    this.status = {
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
    };
    this.statusCalls = 0;
    this.statusHandler = null;
    this.statusHttpStatus = 200;

    this.postCalls = 0;
    this.capturedRequests = [];
    this.requestListeners = [];
    this.currentAccount = 'account-admin-1';
  }

  async settleAllHeld() {
    await Promise.all(this.capturedRequests.map(async req => {
      if (!req.settled) {
        req.settled = true;
        try {
          await req.route.abort('aborted');
        } catch (_) {}
      }
    }));
  }

  waitForRequest(expectedIndex, timeoutMs = 8000) {
    if (this.capturedRequests.length > expectedIndex) {
      return Promise.resolve(this.capturedRequests[expectedIndex]);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for extraction request at index ${expectedIndex}`));
      }, timeoutMs);
      this.requestListeners.push({ expectedIndex, resolve: res, reject: rej, timer });
    });
  }

  recordRequest(captured) {
    this.capturedRequests.push(captured);
    const index = this.capturedRequests.length - 1;
    for (let i = this.requestListeners.length - 1; i >= 0; i--) {
      const listener = this.requestListeners[i];
      if (listener.expectedIndex === index) {
        clearTimeout(listener.timer);
        this.requestListeners.splice(i, 1);
        listener.resolve(captured);
      }
    }
  }
}

/**
 * Resets the mounted fixture state cleanly with isolated fresh props.
 *
 * @param {import('playwright').Page} page
 * @param {object} props
 */
async function remountFixture(page, props = {}) {
  const currentEpoch = await page.evaluate((p) => {
    window.__lifecycleControls.remount(p);
    return window.__lifecycleControls.getState().mountEpoch;
  }, props);

  await page.waitForFunction(epoch => window.__lifecycleControls?.getState().mountEpoch === epoch,
    currentEpoch + 1, { timeout: 5000 });
}

/**
 * Executes the React hook and review panel browser lifecycle contract group.
 *
 * @param {import('playwright').Page} page
 * @param {ExtractionMockApi} api
 */
async function runLifecycleTests(page, api) {
  console.log('[LIFECYCLE SUITE] Executing React hook & review panel lifecycle contract group...');

  const validPng = syntheticPng({ width: 100, height: 100 });

  // -------------------------------------------------------------------------
  // Case 1: Normal eligible selection -> PNG preparation -> single POST ->
  // untouched supported clear fields applied with filename title preserved.
  // -------------------------------------------------------------------------
  console.log('[CASE 1] Normal selection -> PNG prep -> single POST -> untouched fields applied, title preserved...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'civil-id-front.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  const req0Promise = api.waitForRequest(0);

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'civil-id-front.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req0 = await req0Promise;

  // Behavioral regression check: hook must transition to 'extracting' phase while POST is in flight
  const inFlightPhase = await page.evaluate(() => window.__lifecycleControls.getState().phase);
  assert.equal(
    inFlightPhase,
    'extracting',
    'Hook must transition to phase "extracting" while POST is in flight (catches child bug remaining in preparing)'
  );

  assert.equal(req0.payload.images.length, 1, 'Prepared PNG image payload must have 1 image');
  assert.equal(req0.payload.images[0].mime, 'image/png', 'MIME must be image/png');
  assert.equal(req0.payload.context, 'kw-docs-context', 'Context matches processingContext');

  // Fulfill with valid clear candidates
  await req0.fulfillSuccess({
    document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
    document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
    ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
    issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
    expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase !== 'idle' && s.phase !== 'preparing' && s.phase !== 'extracting';
  });

  const state1 = await page.evaluate(() => window.__lifecycleControls.getState());
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 1, 'Exactly one POST request sent');
  assert.equal(state1.formValues.document_number, '290010112345', 'Untouched clear document_number applied');
  assert.equal(state1.formValues.document_type_id, 'type-civil-id', 'Untouched clear document_type_id applied');
  assert.equal(state1.formValues.ministry_id, 'min-moi', 'Untouched clear ministry_id applied');
  assert.equal(state1.formValues.issue_date, '2024-01-15', 'Untouched clear issue_date applied');
  assert.equal(state1.formValues.expiry_date, '2026-01-15', 'Untouched clear expiry_date applied');
  assert.equal(state1.formValues.title, 'civil-id-front.png', 'Filename title preserved; never overwritten by AI');

  // -------------------------------------------------------------------------
  // Case 2: Manual edit and deliberate clear during in-flight response persist
  // while untouched field applies.
  // -------------------------------------------------------------------------
  console.log('[CASE 2] Manual edit & deliberate clear during in-flight response persist against AI overwrite...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'scan.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  const req2Promise = api.waitForRequest(0);

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'scan.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req2 = await req2Promise;

  // While response is in flight: user manually edits document_number AND deliberately clears issue_date
  await page.evaluate(() => {
    window.__lifecycleControls.updateFieldValue('document_number', '999888777');
    window.__lifecycleControls.manual('document_number');
    window.__lifecycleControls.updateFieldValue('issue_date', '');
    window.__lifecycleControls.manual('issue_date');
  });

  // Fulfill with proposed clear values for all fields
  await req2.fulfillSuccess({
    document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
    ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
    issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase !== 'idle' && s.phase !== 'preparing' && s.phase !== 'extracting';
  });

  const state2 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state2.formValues.document_number, '999888777', 'Manually edited document_number persists');
  assert.equal(state2.formValues.issue_date, '', 'Deliberately cleared issue_date persists as empty');
  assert.equal(state2.formValues.ministry_id, 'min-moi', 'Untouched ministry_id still applies cleanly');

  // -------------------------------------------------------------------------
  // Case 3: A-after-B race & File object identity with identical metadata.
  // Distinct File objects with same name/size/lastModified must trigger a new attempt.
  // Late A response resolved after B must NOT overwrite B.
  // -------------------------------------------------------------------------
  console.log('[CASE 3] A-after-B race: distinct File objects with same metadata trigger new attempt; late A rejected...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'same-name.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  const req3APromise = api.waitForRequest(0);

  // File A selected
  await page.evaluate(async (bytes) => {
    const fileA = new File([new Uint8Array(bytes)], 'same-name.png', {
      type: 'image/png',
      lastModified: 1700000000000,
    });
    window.__lifecycleControls.setFile(fileA);
  }, Array.from(validPng));

  const req3A = await req3APromise;

  const req3BPromise = api.waitForRequest(1);

  // Select File B: distinct File object reference with identical name, size, lastModified
  await page.evaluate(async (bytes) => {
    const fileB = new File([new Uint8Array(bytes)], 'same-name.png', {
      type: 'image/png',
      lastModified: 1700000000000,
    });
    window.__lifecycleControls.setFile(fileB);
  }, Array.from(validPng));

  const req3B = await req3BPromise;
  assert.notEqual(req3A.payload.requestId, req3B.payload.requestId, 'File B must generate distinct request ID');

  // Resolve Request B FIRST
  await req3B.fulfillSuccess({
    document_number: { value: 'FILE-B-NUMBER', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.document_number === 'FILE-B-NUMBER';
  });

  // Resolve Request A (obsolete ticket) LAST
  await req3A.fulfillSuccess({
    document_number: { value: 'FILE-A-LATE-OVERWRITE', state: 'clear', alternatives: [], reason: 'none' },
  });

  // Settle and verify B was NOT overwritten
  await page.clock.runFor(100);
  await page.clock.resume();
  const state3 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(
    state3.formValues.document_number,
    'FILE-B-NUMBER',
    'Late response A must be rejected and must never overwrite File B values'
  );

  // -------------------------------------------------------------------------
  // Case 4: File replacement clears unchanged machine fields and retains manual edits.
  // replace() returns void and applies clearance patch through real callback.
  // -------------------------------------------------------------------------
  console.log('[CASE 4] File replacement: replace() returns void and clears machine fields via apply callback...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'replace-test.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  const req4Promise = api.waitForRequest(0);

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'replace-test.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req4 = await req4Promise;
  await req4.fulfillSuccess({
    document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
    ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.ministry_id === 'min-moi';
  });

  // User manually edits document_number; ministry_id remains untouched machine-owned
  await page.evaluate(() => {
    window.__lifecycleControls.manual('document_number');
    window.__lifecycleControls.updateFieldValue('document_number', 'MANUAL-USER-NUM');
  });

  // Attachment replacement occurs: invoke replace()
  const replaceReturnValue = await page.evaluate(() => {
    return window.__lifecycleControls.replace();
  });
  assert.equal(replaceReturnValue, undefined, 'replace() on actual hook contract returns void');

  // Verify that apply callback executed and applied clearance patch to formValues directly
  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.ministry_id === '';
  });

  const state4 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state4.formValues.ministry_id, '', 'Machine-owned ministry_id cleared via apply callback');
  assert.equal(state4.formValues.document_number, 'MANUAL-USER-NUM', 'Manual document_number retained');

  // -------------------------------------------------------------------------
  // Case 5: Retry increments generation epoch and invalidates prior response
  // using per-request captured barriers.
  // -------------------------------------------------------------------------
  console.log('[CASE 5] Retry increments ticket generation; Request 1 invalidated when Request 2 succeeds...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'retry-case.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  const req5Try1Promise = api.waitForRequest(0);

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'retry-case.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req5Try1 = await req5Try1Promise;

  const req5Try2Promise = api.waitForRequest(1);

  // Trigger retry while Try 1 is held in flight
  await page.evaluate(() => {
    window.__lifecycleControls.retry();
  });

  const req5Try2 = await req5Try2Promise;

  // Release Try 1 (obsolete ticket) first
  await req5Try1.fulfillSuccess({
    document_number: { value: 'TRY-1-NUMBER', state: 'clear', alternatives: [], reason: 'none' },
  });

  // Release Try 2 (active ticket) second
  await req5Try2.fulfillSuccess({
    document_number: { value: 'TRY-2-NUMBER', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.document_number === 'TRY-2-NUMBER';
  });

  const state5 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state5.formValues.document_number, 'TRY-2-NUMBER', 'Try 2 proposal applied; Try 1 rejected');

  // -------------------------------------------------------------------------
  // Case 6: Retry while closed (open: false) or not-ready (ready: false) causes
  // ZERO new POST requests.
  // -------------------------------------------------------------------------
  console.log('[CASE 6] Behavioral regression: retry while closed/not-ready causes ZERO new POST requests...');
  await api.reset();

  // Variant 6.1: open is false
  await remountFixture(page, {
    initialOpen: false,
    initialReady: true,
  });
  await page.evaluate(bytes => window.__lifecycleControls.setFile(
    new File([new Uint8Array(bytes)], 'closed.png', { type: 'image/png' }),
  ), Array.from(validPng));
  await page.waitForFunction(() => window.__lifecycleControls.getState().selectedFileName === 'closed.png');

  await page.evaluate(() => {
    window.__lifecycleControls.retry();
  });
  await page.clock.runFor(200);
  await page.clock.resume();
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 0, 'retry() while open=false must make ZERO requests (catches child bug)');

  // Variant 6.2: ready is false
  await remountFixture(page, {
    initialOpen: true,
    initialReady: false,
  });
  await page.evaluate(bytes => window.__lifecycleControls.setFile(
    new File([new Uint8Array(bytes)], 'not-ready.png', { type: 'image/png' }),
  ), Array.from(validPng));
  await page.waitForFunction(() => window.__lifecycleControls.getState().selectedFileName === 'not-ready.png');

  await page.evaluate(() => {
    window.__lifecycleControls.retry();
  });
  await page.clock.runFor(200);
  await page.clock.resume();
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 0, 'retry() while ready=false must make ZERO requests (catches child bug)');

  // -------------------------------------------------------------------------
  // Case 7: Configuration identity changes (settingsVersion, catalogVersion,
  // or loss of processing authorization) reject proposal.
  // -------------------------------------------------------------------------
  console.log('[CASE 7] Configuration identity changes / authorization loss reject proposal...');

  // Variant 7.1: settingsVersion changed before apply
  await api.reset();
  await remountFixture(page, {
    initialValues: { title: 'v-change.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  let statusCheckCount7 = 0;
  api.statusHandler = (route) => {
    statusCheckCount7 += 1;
    // Initial status check: 'a'*64; Status recheck before apply: changed to 'x'*64!
    const settingsVersion = statusCheckCount7 === 1 ? 'a'.repeat(64) : 'x'.repeat(64);
    route.fulfill({
      status: 200,
      json: { data: { ...api.status, settingsVersion }, error: null },
    });
  };

  const req7Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'v-change.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req7 = await req7Promise;
  await req7.fulfillSuccess({
    document_number: { value: 'PROPOSED-7', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase !== 'idle' && s.phase !== 'preparing' && s.phase !== 'extracting';
  });

  const state7 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state7.formValues.document_number, '', 'Suggestions rejected when settingsVersion changes');

  // Variant 7.2: catalogVersion changed before apply
  await api.reset();
  await remountFixture(page, {
    initialValues: { title: 'cat-change.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  let catCheckCount = 0;
  api.statusHandler = (route) => {
    catCheckCount += 1;
    const catalogVersion = catCheckCount === 1 ? 'b'.repeat(64) : 'z'.repeat(64);
    route.fulfill({
      status: 200,
      json: { data: { ...api.status, catalogVersion }, error: null },
    });
  };

  const reqCatPromise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'cat-change.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const reqCat = await reqCatPromise;
  await reqCat.fulfillSuccess({
    document_number: { value: 'PROPOSED-CAT', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase !== 'idle' && s.phase !== 'preparing' && s.phase !== 'extracting';
  });

  const stateCat = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(stateCat.formValues.document_number, '', 'Suggestions rejected when catalogVersion changes');

  // Variant 7.3: processingAuthorized lost before apply (with unchanged versions)
  await api.reset();
  await remountFixture(page, {
    initialValues: { title: 'auth-lost.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  let authCheckCount = 0;
  api.statusHandler = (route) => {
    authCheckCount += 1;
    const processingAuthorized = authCheckCount === 1 ? true : false;
    route.fulfill({
      status: 200,
      json: { data: { ...api.status, processingAuthorized }, error: null },
    });
  };

  const reqAuthPromise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'auth-lost.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const reqAuth = await reqAuthPromise;
  await reqAuth.fulfillSuccess({
    document_number: { value: 'PROPOSED-AUTH', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase !== 'idle' && s.phase !== 'preparing' && s.phase !== 'extracting';
  });

  const stateAuth = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(stateAuth.formValues.document_number, '', 'Suggestions rejected when processingAuthorized lost');

  // -------------------------------------------------------------------------
  // Case 8: Account, context, and file change / dialog close cancels in-flight
  // extraction and rejects late response.
  // -------------------------------------------------------------------------
  console.log('[CASE 8] Account/context/file change or close cancels and rejects late response...');
  await api.reset();

  await remountFixture(page, {
    initialValues: { title: 'cancel.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  const req8Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'cancel.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req8 = await req8Promise;

  // Change account while in flight
  await page.evaluate(() => {
    window.__lifecycleControls.setAccount('account-admin-2');
  });

  // Fulfill late response
  await req8.fulfillSuccess({
    document_number: { value: 'LATE-ACCOUNT-DOC', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.clock.runFor(100);
  await page.clock.resume();
  const state8 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state8.formValues.document_number, '', 'Late response rejected after account change');

  // Same stale-result assertion across the other real hook invalidation inputs.
  for (const invalidation of ['context', 'close']) {
    await api.reset();
    await remountFixture(page);
    await page.evaluate(bytes => window.__lifecycleControls.setFile(new File([new Uint8Array(bytes)], 'cancel-path.png', { type: 'image/png' })), Array.from(validPng));
    const held = await api.waitForRequest(0);
    await page.evaluate(kind => {
      if (kind === 'context') window.__lifecycleControls.setContext('replacement-context');
      else window.__lifecycleControls.setOpen(false);
    }, invalidation);
    await held.fulfillSuccess({ document_number: { value: 'STALE-INVALIDATED', state: 'clear', alternatives: [], reason: 'none' } });
    assert.equal((await page.evaluate(() => window.__lifecycleControls.getState())).formValues.document_number, '', `${invalidation} must reject its late response`);
  }

  // -------------------------------------------------------------------------
  // Case 9: No automatic re-run on typing render or callback updates.
  // -------------------------------------------------------------------------
  console.log('[CASE 9] No automatic re-run on typing render or callback updates...');
  await api.reset();

  await remountFixture(page, {
    initialValues: { title: 'typing.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  const req9Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'typing.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req9 = await req9Promise;
  await req9.fulfillSuccess({
    document_number: { value: 'TYPE-NUM', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.document_number === 'TYPE-NUM';
  });

  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 1, 'Initial extraction made exactly 1 POST');

  // Simulate repeated typing
  for (let i = 0; i < 5; i++) {
    await page.evaluate((idx) => {
      window.__lifecycleControls.updateFieldValue('title', `User Title Edit ${idx}`);
    }, i);
  }

  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 1, 'Typing renders must never trigger duplicate extraction calls');

  // -------------------------------------------------------------------------
  // Case 10: Restored explicit empty/null draft fields protected via protect before start.
  // -------------------------------------------------------------------------
  console.log('[CASE 10] Restored explicit empty draft fields protected via protect() before start...');
  await api.reset();

  await remountFixture(page, {
    initialValues: {
      title: 'restored.png',
      document_number: '',
      document_type_id: '',
      ministry_id: '',
      issue_date: '',
      expiry_date: '',
    },
  });

  // Explicitly protect document_number and expiry_date
  await page.evaluate(() => {
    window.__lifecycleControls.protect(['document_number', 'expiry_date']);
  });

  const req10Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'restored.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req10 = await req10Promise;
  await req10.fulfillSuccess({
    document_number: { value: 'RESTORE-NUM', state: 'clear', alternatives: [], reason: 'none' },
    ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
    expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.formValues.ministry_id === 'min-moi';
  });

  const state10 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state10.formValues.document_number, '', 'Protected restored document_number remains empty');
  assert.equal(state10.formValues.expiry_date, '', 'Protected restored expiry_date remains empty');
  assert.equal(state10.formValues.ministry_id, 'min-moi', 'Unprotected ministry_id applied');

  // -------------------------------------------------------------------------
  // Case 11: Unavailable status and HTTP failure invoke zero POST and preserve manual fields.
  // -------------------------------------------------------------------------
  console.log('[CASE 11] Unavailable status and HTTP 503 invoke ZERO POST and preserve manual fields...');

  // Variant 11.1: available=false
  await api.reset();
  api.status.available = false;
  api.status.reason = 'service_disabled';

  await remountFixture(page, {
    initialValues: { title: 'unavail.png', document_number: 'MANUAL-KEEP-1', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'unavail.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase === 'unavailable' || s.phase === 'failed';
  });
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 0, 'Zero POST calls when available=false');
  const state11A = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state11A.formValues.document_number, 'MANUAL-KEEP-1', 'Manual field preserved');

  // Variant 11.2: status endpoint returns HTTP 503
  await api.reset();
  api.statusHandler = (route) => {
    route.fulfill({ status: 503, json: { data: null, error: { code: 'service_unavailable', message: 'Unavailable' } } });
  };

  await remountFixture(page, {
    initialValues: { title: 'http503.png', document_number: 'MANUAL-KEEP-2', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'http503.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase === 'failed' || s.phase === 'unavailable';
  });
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 0, 'Zero POST calls on status HTTP 503');
  const state11B = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state11B.formValues.document_number, 'MANUAL-KEEP-2', 'Manual field preserved');

  // -------------------------------------------------------------------------
  // Case 12: Cooldown error (429 provider_rate_limit, retryAfterSeconds)
  // disables retry button until controlled fake clock expiry without auto-retry.
  // -------------------------------------------------------------------------
  console.log('[CASE 12] Cooldown error (429 provider_rate_limit) disables retry until clock expiry without auto-retry...');
  await api.reset();

  await remountFixture(page, {
    initialValues: { title: 'rate-limit.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  const req12Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'rate-limit.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req12 = await req12Promise;
  await req12.fulfillRateLimit(25);

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase === 'cooldown';
  });

  const state12 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state12.phase, 'cooldown', 'Hook enters cooldown phase');
  assert.equal(state12.retryAfterSeconds, 25, 'Captures retryAfterSeconds 25');

  // Assert retry button exists and is disabled using real Playwright locator
  const retryBtn = page.getByRole('button', { name: /retry|إعادة الاستخراج/i });
  await retryBtn.waitFor({ state: 'attached', timeout: 5000 });
  const isDisabledInitially = await retryBtn.isDisabled();
  assert.ok(isDisabledInitially, 'Retry button must be disabled during active cooldown');
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 1, 'Zero automatic retry requests initiated');

  // Fast-forward fake browser clock past cooldown expiry (26 seconds)
  await page.clock.fastForward(26000);

  // Assert retry button becomes enabled after cooldown expiry
  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase === 'failed' || s.retryAfterSeconds === 0;
  });

  const isEnabledAfterExpiry = await retryBtn.isEnabled();
  assert.ok(isEnabledAfterExpiry, 'Retry button becomes enabled after controlled cooldown expiry');
  await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
  assert.equal(api.postCalls, 1, 'No automatic retry request made upon expiry');

  // -------------------------------------------------------------------------
  // Case 13: Catalog candidate acceptance restricts to resolved catalog IDs,
  // rejects raw review alternatives and invalid dates.
  // -------------------------------------------------------------------------
  console.log('[CASE 13] Candidate accept: rejects raw review alternatives and invalid dates; accepts resolved IDs...');
  await api.reset();

  await remountFixture(page, {
    initialValues: { title: 'candidate-test.png', document_number: '', document_type_id: '', ministry_id: '', issue_date: '', expiry_date: '' },
  });

  const req13Promise = api.waitForRequest(0);
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'candidate-test.png', { type: 'image/png' });
    window.__lifecycleControls.setFile(file);
  }, Array.from(validPng));

  const req13 = await req13Promise;
  await req13.fulfillSuccess({
    document_number: { value: null, state: 'review', alternatives: ['290010112346'], reason: 'uncertain' },
    ministry_id: { value: 'min-moi', state: 'clear', alternatives: ['Ministry of Interior', 'min-fake-id'], reason: 'none' },
    issue_date: { value: null, state: 'review', alternatives: ['not-a-valid-date'], reason: 'invalid' },
  });

  await page.waitForFunction(() => {
    const s = window.__lifecycleControls.getState();
    return s.phase === 'review';
  });

  // Attempt to accept review alternative for catalog field (must be rejected)
  const rejectedAlt = await page.evaluate(() => {
    return window.__lifecycleControls.accept('ministry_id', 'Ministry of Interior');
  });
  assert.equal(rejectedAlt, false, 'Catalog review alternative label must be rejected');

  const rejectedFakeId = await page.evaluate(() => {
    return window.__lifecycleControls.accept('ministry_id', 'min-fake-id');
  });
  assert.equal(rejectedFakeId, false, 'Arbitrary review alternative ID must be rejected');

  // Attempt to accept invalid date (must be rejected)
  const rejectedDate = await page.evaluate(() => {
    return window.__lifecycleControls.accept('issue_date', 'not-a-valid-date');
  });
  assert.equal(rejectedDate, false, 'Invalid calendar date candidate must be rejected');

  // Accept valid resolved catalog clear value (must succeed)
  const acceptedMinistry = await page.evaluate(() => {
    return window.__lifecycleControls.accept('ministry_id', 'min-moi');
  });
  assert.equal(acceptedMinistry, true, 'Exact resolved catalog clear value must be accepted');

  // Accept valid alternative for document_number (must succeed)
  const acceptedDocNum = await page.evaluate(() => {
    return window.__lifecycleControls.accept('document_number', '290010112346');
  });
  assert.equal(acceptedDocNum, true, 'Valid alternative document number must be accepted');

  const state13 = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state13.formValues.ministry_id, 'min-moi', 'Accepted ministry applied to form values');
  assert.equal(state13.formValues.document_number, '290010112346', 'Accepted document_number applied to form values');
  assert.equal(state13.formValues.issue_date, '', 'Rejected date remains empty in form values');

  // File replacement retains explicitly accepted fields as manual
  await page.evaluate(() => {
    window.__lifecycleControls.replace();
  });
  await page.clock.runFor(50);
  await page.clock.resume();
  const state13AfterReplace = await page.evaluate(() => window.__lifecycleControls.getState());
  assert.equal(state13AfterReplace.formValues.ministry_id, 'min-moi', 'Explicitly accepted field protected across replacement');

  // -------------------------------------------------------------------------
  // Case 14: Panel rendering controls & accessibility.
  // -------------------------------------------------------------------------
  console.log('[CASE 14] Panel rendering controls: role="status", aria-live="polite", type="button"...');

  await api.reset();
  await remountFixture(page);
  const panelRequest = api.waitForRequest(0);
  await page.evaluate(bytes => {
    window.__lifecycleControls.setFile(new File([new Uint8Array(bytes)], 'panel.png', { type: 'image/png' }));
  }, Array.from(validPng));
  await (await panelRequest).fulfillSuccess();
  await page.waitForFunction(() => window.__lifecycleControls.getState().phase === 'review');

  const panelAttributes = await page.evaluate(() => {
    const panel = document.querySelector('[role="status"]');
    const live = panel?.getAttribute('aria-live');
    const buttons = Array.from(document.querySelectorAll('[data-testid="lifecycle-mount-container"] button'));
    const invalidButtonTypes = buttons.filter((b) => b.getAttribute('type') !== 'button');
    const hasMinW0 = Boolean(panel?.className.includes('min-w-0'));
    const hasBreakWords = Boolean(panel?.className.includes('break-words'));
    return {
      hasPanel: Boolean(panel),
      ariaLive: live,
      buttonCount: buttons.length,
      invalidButtonTypeCount: invalidButtonTypes.length,
      hasMinW0,
      hasBreakWords,
    };
  });

  assert.ok(panelAttributes.hasPanel, 'Panel renders role="status" container');
  assert.equal(panelAttributes.ariaLive, 'polite', 'Panel container has aria-live="polite"');
  assert.ok(panelAttributes.buttonCount > 0, 'Panel must render real action buttons in review phase');
  assert.equal(panelAttributes.invalidButtonTypeCount, 0, 'Every button in DocumentExtractionPanel must have type="button"');

  console.log('[LIFECYCLE SUITE] All 14 hook & panel lifecycle contract cases verified.');
}

/** MergePilot client regressions: real hook instances, HTTP barriers and public UI. */
async function runClientReviewRegressions(page, api) {
  const bytes = Array.from(syntheticPng({ width: 100, height: 100 }));
  const results = [];
  const clearNumber = value => ({ document_number: { value, state: 'clear', alternatives: [], reason: 'none' } });
  const state = () => page.evaluate(() => window.__lifecycleControls.getState());
  const panel = page.getByTestId('lifecycle-mount-container');
  const retry = () => panel.getByRole('button', { name: /Retry extraction|إعادة الاستخراج/ });
  const select = (name, second = false) => page.evaluate(({ bytes, name, second }) => {
    const controls = second ? window.__secondLifecycleControls : window.__lifecycleControls;
    controls.setFile(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
  }, { bytes, name, second });
  const terminal = () => page.waitForFunction(() =>
    !['idle', 'preparing', 'extracting'].includes(window.__lifecycleControls.getState().phase),
  null, { timeout: 5000 });
  const run = async (name, body) => {
    console.log(`[CLIENT REVIEW RUN] ${name}`);
    await api.reset();
    try {
      await body();
      results.push({ name, outcome: 'PASS' });
      console.log(`[CLIENT REVIEW PASS] ${name}`);
    } catch (error) {
      const outcome = error.code === 'ERR_ASSERTION' ? 'RED' : 'HARNESS_ERROR';
      results.push({ name, outcome, error: error.message });
      console.error(`[CLIENT REVIEW ${outcome}] ${name}: ${error.stack}`);
    } finally {
      // Cancel mounted hooks before releasing any route left by a failed assertion.
      await remountFixture(page);
      await api.settleAllHeld();
    }
  };

  await run('independent hooks both succeed with reverse-order HTTP responses', async () => {
    await remountFixture(page, { secondForm: true });
    await page.waitForFunction(() => Boolean(window.__secondLifecycleControls));
    await select('independent-a.png');
    const a = await api.waitForRequest(0);
    await select('independent-b.png', true);
    const b = await api.waitForRequest(1);
    assert.notEqual(a.payload.requestId, b.payload.requestId);
    assert.notEqual(a.payload.scope, b.payload.scope);
    await b.fulfillSuccess(clearNumber('INDEPENDENT-B'));
    await page.waitForFunction(() => window.__secondLifecycleControls.getState().phase === 'review');
    await a.fulfillSuccess(clearNumber('INDEPENDENT-A'));
    await terminal();
    const observed = await page.evaluate(() => ({
      a: window.__lifecycleControls.getState().formValues.document_number,
      b: window.__secondLifecycleControls.getState().formValues.document_number,
      aPhase: window.__lifecycleControls.getState().phase,
    }));
    console.log('[CLIENT REVIEW EVIDENCE] independent hooks', JSON.stringify(observed));
    assert.deepEqual(observed, { a: 'INDEPENDENT-A', b: 'INDEPENDENT-B', aPhase: 'review' });
  });

  await run('readiness false before selection blocks POST, restoration allows the same file', async () => {
    await remountFixture(page, { initialReady: false });
    await select('initially-not-ready.png');
    await page.waitForFunction(() => window.__lifecycleControls.getState().selectedFileName === 'initially-not-ready.png');
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 0);
    await page.evaluate(() => window.__lifecycleControls.setReady(true));
    const request = await api.waitForRequest(0);
    await request.fulfillSuccess(clearNumber('READY-CONTROL'));
    await terminal();
    assert.equal((await state()).formValues.document_number, 'READY-CONTROL');
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 1);
  });

  await run('readiness loss settles held attempt and permits deliberate same-file retry', async () => {
    await remountFixture(page);
    await select('readiness-loss.png');
    const obsolete = await api.waitForRequest(0);
    const abortedWhileHeldPromise = page.waitForEvent('requestfailed', {
      predicate: request => request === obsolete.route.request(), timeout: 1500,
    }).then(() => true, error => {
      if (error.name !== 'TimeoutError') throw error;
      return false;
    });
    await page.evaluate(() => {
      window.__lifecycleControls.manual('document_number');
      window.__lifecycleControls.updateFieldValue('document_number', 'MANUAL-READY');
      window.__lifecycleControls.setReady(false);
    });
    await page.waitForFunction(() => window.__lifecycleControls.getState().ready === false);
    // Bounded observable cancellation deadline, not a sleep or a transport timeout.
    let settledWhileHeld = true;
    try {
      await page.waitForFunction(() => !['preparing', 'extracting'].includes(window.__lifecycleControls.getState().phase),
        null, { timeout: 1500 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      settledWhileHeld = false;
    }
    const abortedWhileHeld = await abortedWhileHeldPromise;
    await obsolete.fulfillSuccess(clearNumber('OBSOLETE-READY'));
    await page.evaluate(() => window.__lifecycleControls.setReady(true));
    await page.waitForFunction(() => window.__lifecycleControls.getState().ready === true);
    await page.evaluate(() => window.__lifecycleControls.retry());
    const fresh = await api.waitForRequest(1);
    await fresh.fulfillSuccess(clearNumber('NEW-READY'));
    await terminal();
    const final = await state();
    const observed = { settledWhileHeld, abortedWhileHeld, phase: final.phase, manual: final.formValues.document_number,
      ministry: final.formValues.ministry_id, posts: api.postCalls, applyCount: final.applyCallCount };
    console.log('[CLIENT REVIEW EVIDENCE] readiness', JSON.stringify(observed));
    assert.deepEqual(observed, { settledWhileHeld: true, abortedWhileHeld: true, phase: 'review', manual: 'MANUAL-READY', ministry: 'min-moi', posts: 2, applyCount: 1 });
  });

  await run('file replacement preserves account cooldown until explicit clock expiry', async () => {
    await remountFixture(page);
    // Freeze Date but leave browser timers running for React and locator polling.
    const cooldownStart = await page.evaluate(() => Date.now());
    await page.clock.setFixedTime(cooldownStart);
    try {
      await select('cooldown-a.png');
      const first = await api.waitForRequest(0);
      await first.fulfillRateLimit(25);
      await page.waitForFunction(() => window.__lifecycleControls.getState().phase === 'cooldown');
      assert.equal(await retry().isDisabled(), true, 'Control: original cooldown disables Retry');
      await page.evaluate(() => {
        window.__lifecycleControls.manual('document_number');
        window.__lifecycleControls.updateFieldValue('document_number', 'MANUAL-COOLDOWN');
        window.__lifecycleControls.replace();
      });
      await select('cooldown-b.png');
      await page.waitForFunction(() => !['idle', 'preparing'].includes(window.__lifecycleControls.getState().phase));
      const during = await state();
      const postsBeforeExpiry = api.postCalls;
      const disabledBeforeExpiry = await retry().count() === 1 && await retry().isDisabled();
      // If the bug sent B, settle it before advancing time; do not mask its recorded POST.
      if (postsBeforeExpiry > 1) await api.capturedRequests[1].fulfillRateLimit(25);
      await page.waitForFunction(() => window.__lifecycleControls.getState().phase === 'cooldown');
      await page.clock.setFixedTime(cooldownStart + 26000);
      await page.clock.runFor(1000);
      await page.waitForFunction(() => window.__lifecycleControls.getState().phase === 'failed');
      const postsAtExpiry = api.postCalls;
      assert.equal(await retry().isEnabled(), true, 'Control: Retry enables after expiry');
      await retry().click();
      const after = await api.waitForRequest(postsBeforeExpiry);
      await after.fulfillSuccess(clearNumber('NEW-AFTER-COOLDOWN'));
      await terminal();
      await page.evaluate(() => window.__lifecycleControls.replace());
      await select('cooldown-c-after-expiry.png');
      const newFile = await api.waitForRequest(postsBeforeExpiry + 1);
      assert.notEqual(newFile.payload.requestId, after.payload.requestId, 'New file after expiry has its own request');
      await newFile.fulfillSuccess(clearNumber('NEW-FILE-AFTER-EXPIRY'));
      await terminal();
      const final = await state();
      const observed = { phaseBeforeExpiry: during.phase, postsBeforeExpiry, disabledBeforeExpiry,
        postsAtExpiry, manual: final.formValues.document_number, phaseAfterRetry: final.phase,
        newFileAfterExpiry: final.selectedFileName };
      console.log('[CLIENT REVIEW EVIDENCE] replacement cooldown', JSON.stringify(observed));
      assert.deepEqual(observed, { phaseBeforeExpiry: 'cooldown', postsBeforeExpiry: 1, disabledBeforeExpiry: true,
        postsAtExpiry: 1, manual: 'MANUAL-COOLDOWN', phaseAfterRetry: 'review', newFileAfterExpiry: 'cooldown-c-after-expiry.png' });
    } finally {
      await page.clock.setSystemTime(cooldownStart + 27000);
      await page.clock.resume();
    }
  });

  await run('initial unconfigured status retains approved reason and manual path', async () => {
    api.status.available = false;
    api.status.configured.groq = false;
    api.status.reason = 'provider_not_configured';
    await remountFixture(page);
    await select('unconfigured.png');
    await terminal();
    await page.evaluate(() => {
      window.__lifecycleControls.manual('document_number');
      window.__lifecycleControls.updateFieldValue('document_number', 'MANUAL-UNAVAILABLE');
    });
    const final = await state();
    const text = await panel.innerText();
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 0);
    assert.equal(final.formValues.document_number, 'MANUAL-UNAVAILABLE');
    console.log('[CLIENT REVIEW EVIDENCE] unavailable', JSON.stringify({ errorCode: final.errorCode, text }));
    assert.equal(final.errorCode, 'unconfigured');
    assert.ok([arabicCopy, englishCopy].some(copy => text.includes(copy.errors.unconfigured)), 'Approved refusal reason is visible');
    assert.ok([arabicCopy, englishCopy].some(copy => text.includes(copy.unavailable)), 'Approved manual-entry path is visible');
  });

  await run('availability recovery exposes deliberate UI Retry without an automatic loop', async () => {
    api.status.available = false;
    api.status.reason = 'provider_not_configured';
    api.status.configured.groq = false;
    await remountFixture(page);
    await select('availability-recovery.png');
    await terminal();
    const statusCalls = api.statusCalls;
    api.status.available = true;
    api.status.reason = '';
    api.status.configured.groq = true;
    await page.evaluate(() => window.__lifecycleControls.updateFieldValue('title', 'Manual title during recovery'));
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 0, 'Availability recovery never auto-posts');
    assert.equal(api.statusCalls, statusCalls, 'A render never polls status');
    assert.equal(await retry().count(), 1, 'Unavailable panel must offer deliberate Retry');
    await retry().click();
    const request = await api.waitForRequest(0);
    await request.fulfillSuccess(clearNumber('RECOVERED'));
    await terminal();
    assert.equal((await state()).formValues.document_number, 'RECOVERED');
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 1);
  });

  await run('recovered availability accepts deliberate hook retry without automatic POST', async () => {
    api.status.available = false;
    api.status.reason = 'unconfigured';
    api.status.configured.groq = false;
    await remountFixture(page);
    await select('available-control.png');
    await terminal();
    await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
    assert.equal(api.postCalls, 0);
    api.status.available = true;
    api.status.reason = '';
    api.status.configured.groq = true;
    await page.evaluate(() => window.__lifecycleControls.retry());
    const request = await api.waitForRequest(0);
    await request.fulfillSuccess(clearNumber('AVAILABLE-CONTROL'));
    await terminal();
    const final = await state();
    assert.equal(final.phase, 'review');
    assert.equal(final.errorCode, null);
    assert.equal(final.formValues.document_number, 'AVAILABLE-CONTROL');
  });

  const counts = results.reduce((all, result) => ({ ...all, [result.outcome]: (all[result.outcome] || 0) + 1 }), {});
  console.log('[CLIENT REVIEW SUMMARY]', JSON.stringify({ total: results.length, ...counts }));
  if (results.some(result => result.outcome !== 'PASS')) process.exitCode = 1;
  return results;
}

export async function main() {
  const args = process.argv.slice(2);
  const isBuiltMode = args.includes('--built');

  console.log('======================================================================');
  console.log('[BROWSER SUITE] Mode: LIFECYCLE GROUP ONLY');
  console.log(`[BROWSER SUITE] Target Fixture: ${isBuiltMode ? 'BUILT FIXTURE' : 'DEV SERVER'}`);
  console.log('======================================================================');

  // Step 1: Preflight Semantic and Dependency Check
  console.log('[PREFLIGHT] Checking production modules and assets...');
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
    if (preflight.missingLifecycleModules.length > 0) {
      console.error('Missing required Task 12 production modules:');
      for (const mod of preflight.missingLifecycleModules) {
        console.error(`  - ${mod}`);
      }
    }
    console.error('Harness contract review: Missing Task 12 implementation must fail truthfully as setup failure.');
    console.error('Browser launch skipped until implementation modules exist.');
    console.error('======================================================================');
    process.exitCode = 1;
    return;
  }

  let server = null;
  let origin = '';
  const api = new ExtractionMockApi();

  if (isBuiltMode) {
    const outDir = resolve('scripts/fixtures/.dist-lifecycle');
    fs.writeFileSync(
      resolve('scripts/fixtures/extraction-lifecycle.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-lifecycle.tsx"></script></body></html>'
    );
    console.log(`[BUILD] Building real lifecycle fixture output to ${outDir}...`);
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
          input: resolve('scripts/fixtures/extraction-lifecycle.html'),
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
    console.log(`[BROWSER SUITE] Built lifecycle fixture preview listening at ${origin}`);
  } else {
    server = await createServer({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@': resolve('src') } },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'synthetic-extraction-lifecycle-fixture',
          configureServer(s) {
            s.middlewares.use('/lifecycle-fixture', async (_req, res, next) => {
              try {
                res.setHeader('Content-Type', 'text/html');
                res.end(
                  await s.transformIndexHtml(
                    '/lifecycle-fixture',
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extraction Lifecycle Fixture</title></head>' +
                      '<body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-lifecycle.tsx"></script></body></html>'
                  )
                );
              } catch (error) {
                next(error);
              }
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
      console.error('======================================================================');
      process.exitCode = 1;
      return;
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const egressViolations = [];
    const pageErrors = [];
    const consoleErrors = [];
    const expectedHttpErrors = new Set();
    const unexpectedApiRequests = [];

    page.setDefaultTimeout(15000);

    // Install fake browser clock for precise timer testing (e.g. cooldown)
    await page.clock.install();

    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const match = /^Failed to load resource: the server responded with a status of (\d{3})\b/.exec(msg.text());
      // Negative HTTP cases deliberately render Chromium's standard resource diagnostic.
      if (match && expectedHttpErrors.has(`${msg.location().url}|${match[1]}`)) return;
      consoleErrors.push(msg.text());
      console.error('[UNEXPECTED PAGE CONSOLE ERROR]', msg.text());
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('[PAGE ERROR]', err.message);
    });

    // Strict loopback routing & zero disallowed egress
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const fulfill = route.fulfill.bind(route);
      route.fulfill = options => {
        if (options.status >= 400) expectedHttpErrors.add(`${url.href}|${options.status}`);
        return fulfill(options);
      };

      if (url.origin !== origin || url.username || url.password) {
        egressViolations.push(req.url());
        console.error(`[SECURITY BLOCKED] Disallowed non-loopback egress: ${req.url()}`);
        return route.abort('blockedbyclient');
      }

      // API calls mock store conforming strictly to server contracts
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/auth/me') {
          return route.fulfill({
            status: 200,
            json: {
              data: {
                user: {
                  id: api.currentAccount,
                  email: `${api.currentAccount}@romani.test`,
                  name: 'Administrator',
                  role: 'admin',
                },
              },
              error: null,
            },
          });
        }

        if (url.pathname === '/api/document-extraction/status') {
          api.statusCalls += 1;
          if (api.statusHandler) {
            return api.statusHandler(route);
          }
          return route.fulfill({
            status: api.statusHttpStatus,
            json: { data: api.statusHttpStatus === 200 ? api.status : null, error: null },
          });
        }

        if (url.pathname === '/api/document-extraction') {
          if (req.method() === 'POST') {
            const attemptIndex = api.postCalls++;
            const rawBody = req.postData() || '';
            if (Buffer.byteLength(rawBody, 'utf8') > 10 * 1024 * 1024) {
              return route.fulfill({
                status: 413,
                json: { data: null, error: { code: 'payload_too_large', message: 'Payload exceeds 10 MiB.' } },
              });
            }

            let payload;
            try {
              payload = JSON.parse(rawBody);
            } catch (err) {
              return route.fulfill({
                status: 400,
                json: { data: null, error: { code: 'bad_request', message: 'Invalid JSON payload' } },
              });
            }

            // Schema validation with shared Zod contract (no silent mask of bad requests)
            const parseReq = extractionRequestSchema.safeParse(payload);
            if (!parseReq.success) {
              return route.fulfill({
                status: 400,
                json: { data: null, error: { code: 'extraction_invalid_request', message: 'Invalid extraction request schema' } },
              });
            }

            const captured = {
              id: payload.requestId,
              index: attemptIndex,
              payload,
              route,
              settled: false,
              fulfillSuccess: async (fieldsOverride = {}) => {
                if (captured.settled) return;
                captured.settled = true;
                const defaultFields = {
                  title: { value: 'Civil ID Card', state: 'clear', alternatives: [], reason: 'none' },
                  document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
                  document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
                  ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
                  issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
                  expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
                };
                const responseData = {
                  requestId: payload.requestId,
                  context: payload.context,
                  settingsVersion: payload.settingsVersion,
                  catalogVersion: payload.catalogVersion,
                  pageCount: payload.pageCount,
                  fields: { ...defaultFields, ...fieldsOverride },
                };
                const parseRes = resultSchema.safeParse(responseData);
                assert.ok(parseRes.success, `Mock response must satisfy resultSchema: ${JSON.stringify(parseRes.error?.issues)}`);
                await route.fulfill({ status: 200, json: { data: responseData, error: null } });
                await page.waitForFunction(id => window.__extractionProbe.reads.get(id)?.settled, payload.requestId);
                await boundedGate(page.evaluate(() => window.__extractionProbe.drain()), 'client task/decode settlement');
              },
              fulfillRateLimit: (retryAfterSeconds = 25) => {
                if (captured.settled) return;
                captured.settled = true;
                return route.fulfill({
                  status: 429,
                  json: {
                    data: null,
                    error: {
                      code: 'provider_rate_limit',
                      message: 'Provider rate limit exceeded',
                      retryAfterSeconds,
                    },
                  },
                });
              },
              fulfillError: (status = 500, code = 'server_error', message = 'Server error') => {
                if (captured.settled) return;
                captured.settled = true;
                return route.fulfill({
                  status,
                  json: { data: null, error: { code, message } },
                });
              },
            };

            api.recordRequest(captured);
            return;
          }
        }

        unexpectedApiRequests.push(url.pathname);
        return route.fulfill({
          status: 404,
          json: { data: null, error: { code: 'not_found', message: `Unknown API: ${url.pathname}` } },
        });
      }

      return route.continue();
    });

    const fixtureUrl = isBuiltMode
      ? `${origin}/scripts/fixtures/extraction-lifecycle.html`
      : `${origin}/lifecycle-fixture`;

    await page.goto(fixtureUrl);
    await page.waitForSelector('[data-testid="lifecycle-mount-container"]', { timeout: 10000 });
    // The counter must see malformed attempts before the mock parser rejects them.
    const malformedStatus = await page.evaluate(async () => {
      const response = await fetch('/api/document-extraction', { method: 'POST', body: '{' });
      await response.text();
      return response.status;
    });
    assert.equal(malformedStatus, 400);
    assert.equal(api.postCalls, 1, 'Malformed extraction POST is still an HTTP attempt');
    console.log('[HARNESS CONTROL] Malformed extraction POST counted before parsing');
    await api.reset();


    try {
      await runLifecycleTests(page, api);
      const reviewResults = await runClientReviewRegressions(page, api);
      assert.deepEqual(egressViolations, [], 'Lifecycle must not attempt external requests');
      assert.deepEqual(consoleErrors, [], 'Lifecycle must not emit unexpected console errors');
      assert.deepEqual(pageErrors, [], 'Lifecycle must not produce uncaught page errors');
      assert.deepEqual(unexpectedApiRequests, [], 'Lifecycle must not invoke unexpected APIs');
      console.log(`[BROWSER SUITE] Lifecycle baseline 14/14; client review exit ${process.exitCode || 0}.`);
      return { totalCount: 14 + reviewResults.length };
    } finally {
      await api.settleAllHeld();
    }
  } finally {
    await api.settleAllHeld();
    if (browser) await browser.close();
    if (server) await server.close();
  }
}

// Direct CLI invocation
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/verify-extraction-lifecycle.mjs')) {
  main().catch((err) => {
    console.error('[LIFECYCLE SUITE FATAL]', err);
    process.exit(1);
  });
}
