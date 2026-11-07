/**
 * AI Document Extraction Forms Integration Test Runner (Task 10 / Tasks 13 & 14).
 *
 * Exercises real DocumentEditorDialog/DocumentForm and EmployeeDocumentForm in Chromium
 * with strictly mocked loopback HTTP endpoints conforming to shared Zod contracts.
 *
 * Scope & Constraints:
 * - Statically mounts real components via scripts/fixtures/extraction-forms.tsx.
 * - Real AuthProvider and LanguageProvider with synthetic admin session on loopback.
 * - Strict loopback security boundary: zero disallowed non-localhost egress.
 * - Truthful preflight check: fails explicitly if required base modules are missing.
 * - Per-request barriers with timeout guards and settled routes in finally blocks.
 * - Distinguishes passing positive controls (baseline manual form behavior)
 *   from observed RED failures (pending Task 13/14 additions).
 * - Exact executed counts vs unreached cases reported truthfully.
 * - Runner exits NONZERO if ANY case fails (observed RED or unexpected error).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, build, preview } from 'vite';
import { tsImport } from 'tsx/esm/api';
import { syntheticPng } from './fixtures/extraction-pdf.mjs';
import { format } from 'date-fns';

const { extractionRequest: extractionRequestSchema, resultSchema } = await tsImport(
  '../server/contracts/documentExtraction.ts', import.meta.url,
);

const { documentNumber } = await tsImport(
  '../server/contracts/documentNumber.ts', import.meta.url,
);

const { createDocumentSchema } = await tsImport(
  '../src/components/documents/documentFormSchema.ts', import.meta.url,
);

const { runMigrations } = await tsImport(
  '../server/db/migrator.ts', import.meta.url,
);

const { createDocumentDraftsRouter } = await tsImport(
  '../server/routes/documentDrafts.ts', import.meta.url,
);

const { insertRow } = await tsImport(
  '../server/repositories/base.ts', import.meta.url,
);

const { writeDraft } = await tsImport(
  '../server/repositories/documentDrafts.ts', import.meta.url,
);

const { signSession, requireAuth, requireAdmin } = await tsImport(
  '../server/middleware/auth.ts', import.meta.url,
);

const { loadConfig } = await tsImport(
  '../server/config.ts', import.meta.url,
);

const { NotificationCoordinator } = await tsImport(
  '../server/notifications/coordinator.ts', import.meta.url,
);

const fixtureConfig = loadConfig({
  JWT_SECRET: 'fixture-jwt-secret-min-32-chars-task-17-review',
  SESSION_COOKIE_NAME: 'romani_session',
});

function makeSessionCookie(accountId) {
  return signSession(fixtureConfig, {
    id: accountId,
    email: `${accountId}@example.invalid`,
    name: `Synthetic ${accountId}`,
    role: 'admin',
  });
}

// Required production modules that must exist
const REQUIRED_MODULES = [
  'src/components/DocumentForm.tsx',
  'src/components/EmployeeDocumentForm.tsx',
  'src/components/documents/DocumentDialogs.tsx',
  'src/components/documents/documentFormSchema.ts',
  'src/components/documents/saveDocument.ts',
  'src/components/documents/useStagedDocumentUpload.ts',
  'src/hooks/useDocumentDraft.ts',
  'src/hooks/useAuth.tsx',
  'src/contexts/LanguageContext.tsx',
  'scripts/fixtures/extraction-forms.tsx',
];

const DEFAULT_DOCUMENT_TYPES = [
  { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' },
  { id: 'type-passport', name: 'Passport', name_ar: 'جواز السفر' },
  { id: 'type-contract', name: 'Work Contract', name_ar: 'عقد العمل' },
];

const DEFAULT_MINISTRIES = [
  { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' },
  { id: 'min-molf', name: 'Ministry of Labor', name_ar: 'وزارة العمل' },
];

const DEFAULT_COMPANIES = [
  { id: 'comp-1', name: 'Romani Trading Co', name_ar: 'شركة روماني للتجارة' },
  { id: 'comp-2', name: 'Gulf Services Ltd', name_ar: 'شركة الخليج للخدمات' },
];

const DEFAULT_EMPLOYEES = [
  { id: 'emp-1', name: 'Ahmed Al-Sabah', company_id: 'comp-1' },
  { id: 'emp-2', name: 'Fatima Al-Mansoor', company_id: 'comp-1' },
];

function runPreflightCheck() {
  const missing = [];
  for (const mod of REQUIRED_MODULES) {
    if (!fs.existsSync(resolve(mod))) {
      missing.push(mod);
    }
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Stateful Mock API controller managing loopback HTTP routes and per-request barriers.
 */
class FormsMockApi {
  constructor(draftDb = null) {
    this.draftDb = draftDb;
    this.currentAccount = 'account-admin-1';
    // Use server-known model IDs and settings from server/extraction/policy.ts
    this.extractionStatus = {
      enabled: true,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
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
    this.statusHttpStatus = 200;

    this.postCalls = 0;
    this.capturedRequests = [];
    this.requestListeners = [];

    this.uploadCalls = 0;
    this.capturedUploads = [];
    this.uploadListeners = [];

    this.documentCalls = 0;
    this.capturedDocuments = [];
    this.documentListeners = [];

    this.updateCalls = 0;
    this.capturedUpdates = [];
    this.updateListeners = [];

    this.draftPuts = [];
    this.draftPutListeners = [];

    this.drafts = new Map();
    this.formDefaults = null;

    this.retiringPutHeld = false;
    this.retiringPutDeferred = null;
    this.retiringPutEntryDeferred = null;
    this.retiringPutSettledDeferred = null;
    this.draftRequestsLog = [];
  }

  armRetiringPutGate() {
    this.retiringPutHeld = true;
    let resolveEntry;
    this.retiringPutEntryDeferred = new Promise((res) => { resolveEntry = res; });
    this.retiringPutEntryDeferred.resolve = resolveEntry;

    let resolveRelease;
    this.retiringPutDeferred = new Promise((res) => { resolveRelease = res; });
    this.retiringPutDeferred.resolve = resolveRelease;

    let resolveSettled;
    this.retiringPutSettledDeferred = new Promise((res) => { resolveSettled = res; });
    this.retiringPutSettledDeferred.resolve = resolveSettled;
  }

  async waitForRetiringPutEntry(timeoutMs = 5000) {
    if (!this.retiringPutEntryDeferred) return;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout waiting for retiring PUT entry')), timeoutMs));
    await Promise.race([this.retiringPutEntryDeferred, timeout]);
  }

  releaseRetiringPut() {
    if (this.retiringPutDeferred) {
      this.retiringPutDeferred.resolve();
      this.retiringPutHeld = false;
    }
  }

  async waitForRetiringPutSettled(timeoutMs = 5000) {
    if (!this.retiringPutSettledDeferred) return;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout waiting for retiring PUT to settle')), timeoutMs));
    await Promise.race([this.retiringPutSettledDeferred, timeout]);
  }

  async reset() {
    await this.settleAllHeld();
    this.statusCalls = 0;
    this.statusHttpStatus = 200;
    this.postCalls = 0;
    this.capturedRequests = [];
    for (const l of this.requestListeners) clearTimeout(l.timer);
    this.requestListeners = [];
    this.uploadCalls = 0;
    this.capturedUploads = [];
    for (const l of this.uploadListeners) clearTimeout(l.timer);
    this.uploadListeners = [];
    this.documentCalls = 0;
    this.capturedDocuments = [];
    for (const l of this.documentListeners) clearTimeout(l.timer);
    this.documentListeners = [];
    this.updateCalls = 0;
    this.capturedUpdates = [];
    for (const l of this.updateListeners) clearTimeout(l.timer);
    this.updateListeners = [];
    this.draftPuts = [];
    for (const l of this.draftPutListeners) clearTimeout(l.timer);
    this.draftPutListeners = [];
    this.drafts.clear();
    if (this.draftDb) {
      this.draftDb.prepare('DELETE FROM document_drafts').run();
    }
    this.formDefaults = null;
    this.currentAccount = 'account-admin-1';
    this.releaseRetiringPut();
    this.draftRequestsLog = [];
  }

  async settleAllHeld() {
    this.releaseRetiringPut();
    await Promise.all(
      this.capturedRequests.map(async (req) => {
        if (!req.settled) {
          req.settled = true;
          try {
            await req.route.abort('aborted');
          } catch (_) {}
        }
      })
    );
  }

  waitForRequest(expectedIndex, timeoutMs = 8000) {
    if (this.capturedRequests.length > expectedIndex) {
      return Promise.resolve(this.capturedRequests[expectedIndex]);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for extraction request index ${expectedIndex}`));
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

  waitForUpload(expectedIndex, timeoutMs = 8000) {
    if (this.capturedUploads.length > expectedIndex) {
      return Promise.resolve(this.capturedUploads[expectedIndex]);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for file upload index ${expectedIndex}`));
      }, timeoutMs);
      this.uploadListeners.push({ expectedIndex, resolve: res, reject: rej, timer });
    });
  }

  recordUpload(upload) {
    this.capturedUploads.push(upload);
    const index = this.capturedUploads.length - 1;
    for (let i = this.uploadListeners.length - 1; i >= 0; i--) {
      const listener = this.uploadListeners[i];
      if (listener.expectedIndex === index) {
        clearTimeout(listener.timer);
        this.uploadListeners.splice(i, 1);
        listener.resolve(upload);
      }
    }
  }

  waitForDocument(expectedIndex, timeoutMs = 8000) {
    if (this.capturedDocuments.length > expectedIndex) {
      return Promise.resolve(this.capturedDocuments[expectedIndex]);
    }
    const pending = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for document save index ${expectedIndex}`));
      }, timeoutMs);
      this.documentListeners.push({ expectedIndex, resolve: res, reject: rej, timer });
    });
    // The caller may still be awaiting its click. Keep the rejection handled
    // until that caller awaits this same promise; the failure still propagates.
    void pending.catch(() => undefined);
    return pending;
  }

  recordDocument(doc) {
    this.capturedDocuments.push(doc);
    const index = this.capturedDocuments.length - 1;
    for (let i = this.documentListeners.length - 1; i >= 0; i--) {
      const listener = this.documentListeners[i];
      if (listener.expectedIndex === index) {
        clearTimeout(listener.timer);
        this.documentListeners.splice(i, 1);
        listener.resolve(doc);
      }
    }
  }

  waitForUpdate(expectedIndex, timeoutMs = 8000) {
    if (this.capturedUpdates.length > expectedIndex) {
      return Promise.resolve(this.capturedUpdates[expectedIndex]);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for document update index ${expectedIndex}`));
      }, timeoutMs);
      this.updateListeners.push({ expectedIndex, resolve: res, reject: rej, timer });
    });
  }

  recordUpdate(update) {
    this.capturedUpdates.push(update);
    const index = this.capturedUpdates.length - 1;
    for (let i = this.updateListeners.length - 1; i >= 0; i--) {
      const listener = this.updateListeners[i];
      if (listener.expectedIndex === index) {
        clearTimeout(listener.timer);
        this.updateListeners.splice(i, 1);
        listener.resolve(update);
      }
    }
  }

  waitForDraftPut(expectedIndex, timeoutMs = 8000) {
    if (this.draftPuts.length > expectedIndex) {
      return Promise.resolve(this.draftPuts[expectedIndex]);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout waiting for draft PUT index ${expectedIndex}`));
      }, timeoutMs);
      this.draftPutListeners.push({ expectedIndex, resolve: res, reject: rej, timer });
    });
  }

  recordDraftPut(put) {
    this.draftPuts.push(put);
    const index = this.draftPuts.length - 1;
    for (let i = this.draftPutListeners.length - 1; i >= 0; i--) {
      const listener = this.draftPutListeners[i];
      if (listener.expectedIndex === index) {
        clearTimeout(listener.timer);
        this.draftPutListeners.splice(i, 1);
        listener.resolve(put);
      }
    }
  }

  getDraft(scope, account = this.currentAccount) {
    if (!this.draftDb) return null;
    const row = this.draftDb.prepare('SELECT revision, values_json FROM document_drafts WHERE user_id=? AND scope=?').get(account, scope);
    if (!row) return null;
    return {
      revision: String(row.revision),
      values: row.values_json ? JSON.parse(String(row.values_json)) : null,
    };
  }

  seedDraft(scope, values, account = this.currentAccount, revision = crypto.randomUUID()) {
    if (!this.draftDb) return { revision, values };
    this.draftDb.prepare(
      "INSERT OR REPLACE INTO document_drafts(user_id, scope, revision, values_json, updated_at) VALUES(?, ?, ?, ?, ?)"
    ).run(account, scope, revision, values ? JSON.stringify(values) : null, new Date().toISOString());
    return { revision, values };
  }

  getOrCreateDraft(scope, account = this.currentAccount) {
    let existing = this.getDraft(scope, account);
    if (!existing) {
      const rev = crypto.randomUUID();
      this.seedDraft(scope, null, account, rev);
      existing = { revision: rev, values: null };
    }
    const self = this;
    return {
      get revision() {
        const cur = self.getDraft(scope, self.currentAccount);
        return cur ? cur.revision : existing.revision;
      },
      set revision(rev) {
        const cur = self.getDraft(scope, self.currentAccount);
        self.seedDraft(scope, cur ? cur.values : null, self.currentAccount, rev);
      },
      get values() {
        const cur = self.getDraft(scope, self.currentAccount);
        return cur ? cur.values : null;
      },
      set values(vals) {
        // A fixture write is a new revision, just like a real CAS write.
        self.seedDraft(scope, vals, self.currentAccount, crypto.randomUUID());
      },
    };
  }
}

function createDraftsBackend(draftDb, config) {
  const coordinator = new NotificationCoordinator();

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(requireAuth(config, draftDb));
  app.use('/api/document-drafts', createDocumentDraftsRouter(draftDb, coordinator));
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 'draft_conflict' ? 409 : 500);
    res.status(status).json({ data: null, error: { code: err.code || 'error', message: err.message } });
  });

  return app;
}

async function selectComboboxOption(page, labelText, optionText) {
  const container = page.locator(`label:has-text("${labelText}")`).locator('..');
  const trigger = container.locator('button[role="combobox"], button').first();
  await trigger.click();
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  const option = page.locator(`[role="option"]:has-text("${optionText}")`).first();
  await option.click();
  await page.waitForSelector('[role="option"]', { state: 'hidden', timeout: 5000 }).catch(() => {});
  await trigger.filter({ hasText: optionText }).waitFor({ state: 'visible', timeout: 5000 });
}

async function selectPopoverDate(page, labelText, which = 'last') {
  const container = page.locator(`label:has-text("${labelText}")`).locator('..');
  const trigger = container.locator('button').first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const dayBtns = page
    .locator('[role="gridcell"] button:not([disabled]), button[name="day"]:not([disabled])');
  const dayBtn = which === 'first' ? dayBtns.first() : dayBtns.last();
  await dayBtn.click();
  await page.keyboard.press('Escape');
  await dayBtn.waitFor({ state: 'hidden', timeout: 5000 });
}

async function waitForFormReady(page, expectedEpoch) {
  if (expectedEpoch !== undefined) {
    await page.waitForSelector(
      `[data-testid="forms-mount-container"][data-mount-epoch="${expectedEpoch}"][data-auth-ready="true"]`,
      { timeout: 10000 }
    );
  } else {
    await page.waitForSelector('[data-testid="forms-mount-container"][data-auth-ready="true"]', { timeout: 10000 });
  }
  await page.waitForSelector('form', { timeout: 10000 });
}

async function assertDateTriggerValue(page, labelText, expectedIsoDate) {
  const container = page.locator(`label:has-text("${labelText}")`).locator('..');
  const trigger = container.locator('button').first();
  const expected = format(new Date(`${expectedIsoDate}T00:00:00`), 'PPP');
  await trigger.filter({ hasText: expected }).waitFor({ state: 'visible', timeout: 5000 });
  assert.equal((await trigger.innerText()).trim(), expected, `Exact date for ${labelText}`);
}

/**
 *
 * @param {import('playwright').Page} page
 * @param {FormsMockApi} api
 * @param {DatabaseSync} draftDb
 * @param {number} draftsPort
 */
async function runFormsTests(page, api, draftDb, draftsPort) {
  const validPng = syntheticPng({ width: 100, height: 100 });
  const results = [];

  let totalCount = 0;
  let passedCount = 0;
  let observedRedCount = 0;
  let unexpectedFailCount = 0;

  async function testCase(name, isPositiveControl, fn) {
    totalCount++;
    const start = Date.now();
    try {
      await api.reset();
      await page.evaluate(() => window.__formsControls?.setAccount('account-admin-1')).catch(() => {});
      await fn();
      const duration = Date.now() - start;
      passedCount++;
      results.push({ name, isPositiveControl, status: 'PASS', duration, error: null });
      console.log(`  ✔ [PASS] ${name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - start;
      const failureState = await page.locator('form').evaluateAll(forms => forms.map(form => ({
        valid: form.checkValidity(),
        fields: Array.from(form.querySelectorAll('input, select')).map(field => ({ name: field.name || field.id, value: field.value, valid: field.checkValidity() })),
        buttons: Array.from(form.querySelectorAll('button[type="submit"]')).map(button => ({ disabled: button.disabled, text: button.textContent })),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(alert => alert.textContent),
      }))).catch(() => []);
      console.log('[FORM FAILURE STATE]', JSON.stringify(failureState));
      const isAssertionError = err.name === 'AssertionError' || err instanceof assert.AssertionError;
      if (isPositiveControl) {
        unexpectedFailCount++;
        results.push({ name, isPositiveControl, status: 'UNEXPECTED_FAIL', duration, error: err.message, stack: err.stack });
        console.log(`  ✖ [FAIL - POSITIVE CONTROL] ${name} (${duration}ms)`);
        console.log(`    Error: ${err.message}`);
      } else if (isAssertionError) {
        // True assertion failure on target contract indicates truthful observed RED
        observedRedCount++;
        results.push({ name, isPositiveControl, status: 'OBSERVED_RED', duration, error: err.message });
        console.log(`  ✘ [OBSERVED RED (Pending T13/14)] ${name} (${duration}ms)`);
        console.log(`    Missing behavior: ${err.message}`);
      } else {
        // Harness/setup failure (e.g. TypeError, ReferenceError, runtime exception)
        unexpectedFailCount++;
        results.push({ name, isPositiveControl, status: 'UNEXPECTED_FAIL', duration, error: err.message, stack: err.stack });
        console.log(`  ✖ [HARNESS / SETUP FAILURE in Target Case] ${name} (${duration}ms)`);
        console.log(`    Unexpected Error: ${err.stack || err.message}`);
      }
    } finally {
      await api.settleAllHeld();
    }
  }

  console.log('\n--- GROUP 1: POSITIVE BASELINE CONTROLS (Manual Contracts) ---');

  // Case 1: File selection stages 0 uploads before Save; Save stages upload and claims upload_id
  await testCase(
    'Case 1: File selection stages 0 uploads before Save; Save stages upload and claims upload_id',
    true,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'civil-id.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);

      // Assert 0 uploads staged on initial file selection
      assert.equal(api.uploadCalls, 0, 'Zero uploads staged on file selection');

      // Fill in required form fields
      const form = page.locator('form');
      await form.locator('input[name="title"]').fill('Civil ID Card Front');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      const uploadPromise = api.waitForUpload(0, 5000);
      const docPromise = api.waitForDocument(0, 5000);

      await form.locator('button[type="submit"]').click();

      const upload = await uploadPromise;
      const doc = await docPromise;

      assert.equal(api.uploadCalls, 1, 'Exactly 1 upload staged on explicit save');
      assert.equal(api.documentCalls, 1, 'Exactly 1 document saved');
      assert.equal(doc.payload.upload_id, upload.upload_id, 'Claimed upload_id matches staged upload');
    }
  );

  // Case 2: Documents saved without document number send document_number: null via actual browser save
  await testCase(
    'Case 2: Documents saved without document number send document_number: null via browser save',
    true,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'doc-no-number.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      const form = page.locator('form');

      await form.locator('input[name="title"]').fill('Doc Without Stored Number');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      // A fresh untouched form has no document number; submit its actual defaults.

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.document_number, null, 'Captured document save must carry document_number: null');
    }
  );

  // Case 3: General date validation requires expiry and rejects reversed date range via actual browser controls
  await testCase(
    'Case 3: General date validation requires expiry and rejects reversed date range via browser controls',
    true,
    async () => {
      // Sub-step A: Missing expiry date rejects before staging
      let epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'doc-missing-expiry.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      let form = page.locator('form');
      await form.locator('input[name="title"]').fill('Missing Expiry Document');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');

      // Click save without picking expiry date
      await form.locator('button[type="submit"]').click();
      await page.waitForSelector('[role="alert"], .text-destructive, [data-sonner-toast][data-type="error"]', { timeout: 3000 });
      assert.equal(api.uploadCalls, 0, 'Missing expiry date must not trigger file staging upload');
      assert.equal(api.documentCalls, 0, 'Missing expiry date must not trigger document save');

      // Sub-step B: Reversed date range rejects before staging via authentic draft restoration
      api.getOrCreateDraft('company:comp-1').values = {
        title: 'Reversed Dates Document',
        document_type_id: 'type-civil-id',
        ministry_id: 'min-moi',
        issue_date: '2026-05-10',
        expiry_date: '2026-05-01',
      };

      epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'doc-reversed.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');

      // Prove intended dates
      await assertDateTriggerValue(page, 'تاريخ الإصدار', '2026-05-10');
      await assertDateTriggerValue(page, 'تاريخ الانتهاء', '2026-05-01');

      await form.locator('button[type="submit"]').click();
      await page.waitForSelector('[role="alert"]:has-text("انتهاء"), [role="alert"]:has-text("expiry"), .text-destructive', { timeout: 3000 });

      assert.equal(api.uploadCalls, 0, 'Reversed dates (expiry < issue) must reject before file staging');
      assert.equal(api.documentCalls, 0, 'Reversed dates must reject before document save');

      // Sub-step C: Valid date range (expiry >= issue) succeeds (positive control)
      api.getOrCreateDraft('company:comp-1').values = {
        title: 'Valid Dates Document',
        document_type_id: 'type-civil-id',
        ministry_id: 'min-moi',
        issue_date: '2026-05-01',
        expiry_date: '2026-05-10',
      };

      epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'doc-valid.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');

      // Prove intended dates
      await assertDateTriggerValue(page, 'تاريخ الإصدار', '2026-05-01');
      await assertDateTriggerValue(page, 'تاريخ الانتهاء', '2026-05-10');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.issue_date, '2026-05-01', 'Valid issue date saved');
      assert.equal(doc.payload.expiry_date, '2026-05-10', 'Valid expiry date saved');
    }
  );

  // Case 4: Employee document form enforces fixed employee identity and company_id null
  await testCase(
    'Case 4: Employee document form enforces fixed employee identity and company_id null',
    true,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'employee-contract.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      const form = page.locator('form');
      assert.equal(api.uploadCalls, 0, 'Zero uploads staged on file selection');

      await form.locator('#title').fill('Employee Contract');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.employee_id, 'emp-1', 'Fixed employee_id preserved');
      assert.equal(doc.payload.company_id, null, 'company_id must be null for employee document');
      assert.ok(doc.payload.upload_id, 'Upload ID claimed in document save');
    }
  );

  // Case 5: Employee document form permits nullable expiry and preserves ministry policy
  await testCase(
    'Case 5: Employee document form permits nullable expiry and preserves ministry policy',
    true,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'cert.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      const form = page.locator('form');
      await form.locator('#title').fill('Degree Certificate');

      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.expiry_date, null, 'Employee expiry date can be null');
      assert.equal(doc.payload.ministry_id, 'min-moi', 'Ministry ID preserved');
    }
  );

  // Case 6: General ministry policy: company preserves ministry while employee forces ministry null via browser actions
  await testCase(
    'Case 6: General ministry policy: company preserves ministry while employee forces ministry null via browser',
    true,
    async () => {
      // Sub-step A: Company mode preserves ministry
      let epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'company-doc.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      let form = page.locator('form');
      await form.locator('input[name="title"]').fill('Company Ministry Doc');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      let docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      let doc = await docPromise;

      assert.equal(doc.payload.company_id, 'comp-1', 'Company mode sets company_id');
      assert.equal(doc.payload.ministry_id, 'min-moi', 'Company mode preserves ministry_id');

      // Sub-step B: Employee mode forces ministry to null in general form
      epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'emp-general-doc.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedEmployeeId: 'emp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');
      await form.locator('input[name="title"]').fill('Employee General Doc');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      docPromise = api.waitForDocument(1, 5000);
      await form.locator('button[type="submit"]').click();
      doc = await docPromise;

      assert.equal(doc.payload.employee_id, 'emp-1', 'Employee mode sets employee_id');
      assert.equal(doc.payload.ministry_id, null, 'Employee mode forces ministry_id to null');
    }
  );

  // Case 7: Draft CAS responses use actual UUID revisions across form edits and validates 409 conflict
  await testCase(
    'Case 7: Draft CAS responses use actual UUID revisions across form edits and validates 409 conflict',
    true,
    async () => {
      const epoch = await page.evaluate(() => {
        return window.__formsControls.mountGeneral({
          uploadedFile: null,
          fileName: '',
          preselectedCompanyId: 'comp-1',
        });
      });

      await waitForFormReady(page, epoch);
      const form = page.locator('form');

      // Observe initial draft revision
      const initialDraft = api.getOrCreateDraft('company:comp-1');
      const initialRev = initialDraft.revision;
      assert.ok(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(initialRev),
        'Initial draft revision must be an RFC 4122 v4 UUID'
      );

      // Perform user edit in browser: trigger draft session change
      const putPromise = api.waitForDraftPut(0, 5000);
      await form.locator('input[name="title"]').fill('Live Draft Title from User Edit');
      const put0 = await putPromise;

      assert.equal(put0.revision, initialRev, 'Browser draft PUT sent the loaded initial revision');
      assert.ok(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(put0.newRevision),
        'Server returned a new RFC 4122 v4 UUID revision'
      );

      // Trigger second edit: verify browser adopted the new revision
      const putPromise2 = api.waitForDraftPut(1, 5000);
      await form.locator('textarea[name="notes"]').fill('Draft notes added');
      const put1 = await putPromise2;

      assert.equal(put1.revision, put0.newRevision, 'Second browser draft PUT sent the updated revision from first PUT');

      // CAS conflict validation: stale revision must return 409 and put form into conflict state
      initialDraft.revision = crypto.randomUUID(); // Server revision advanced externally (other device)
      await form.locator('input[name="title"]').fill('Conflicting Title Edit');
      await page.waitForSelector('[role="alert"]:has-text("أحدث"), [role="alert"]:has-text("newer draft")', { timeout: 5000 });
    }
  );

  // Case 8: Manual Save remains possible during extraction quota error (429) / provider error without AI autosave
  await testCase(
    'Case 8: Manual Save remains possible during extraction quota error (429) / provider error without AI autosave',
    false,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'quota-doc.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);

      // Pending Task 13: selecting a file must trigger an extraction request to POST /api/document-extraction
      const extractionReq = await api.waitForRequest(0, 2000).catch(() => null);
      assert.ok(
        extractionReq,
        'Contract Requirement (Task 13): DocumentForm must trigger extraction request on file selection to test in-flight 429'
      );

      // Fulfill with provider rate limit (429) while request is held
      await extractionReq.fulfillRateLimit(30);

      // Verify 0 auto-saves were triggered
      assert.equal(api.documentCalls, 0, 'Zero AI auto-saves must occur on 429 quota error');

      // Verify manual save remains functional
      const form = page.locator('form');
      await form.locator('input[name="title"]').fill('Manual Save After 429');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.title, 'Manual Save After 429', 'Document saved manually after extraction 429');
    }
  );

  // Case 9: Notes and metadata persist strictly without extraction provenance or pixel leakage
  await testCase(
    'Case 9: Notes and metadata persist strictly without extraction provenance or pixel leakage',
    true,
    async () => {
      const userNotes = 'Special instructions: verified via original stamped document. No pixel data.';
      const epoch = await page.evaluate(({ bytes, notes }) => {
        const file = new File([new Uint8Array(bytes)], 'clean-notes.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, { bytes: Array.from(validPng), notes: userNotes });

      await waitForFormReady(page, epoch);
      const form = page.locator('form');
      await form.locator('#title').fill('Document With Clean Notes');
      await form.locator('#notes').fill(userNotes);

      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.notes, userNotes, 'Notes field contains exact user input');
      assert.ok(!doc.payload.notes.includes('data:image'), 'Zero pixel data in notes');
      assert.ok(!doc.payload.notes.includes('provenance'), 'Zero provenance tags in notes');
    }
  );

  console.log('\n--- GROUP 2: TARGET CONTRACT TESTS (Pending Task 13 & 14) ---');

  // Case 10: General form renders optional document_number input with text type, max 128, leading zeros
  await testCase(
    'Case 10: General form renders optional document_number input with text type, max 128, leading zeros',
    false,
    async () => {
      const epoch = await page.evaluate(() => {
        return window.__formsControls.mountGeneral({
          uploadedFile: null,
          fileName: '',
          preselectedCompanyId: 'comp-1',
        });
      });

      await waitForFormReady(page, epoch);
      const form = page.locator('form');

      const numInput = form.locator('input[name="document_number"]');
      assert.ok(
        (await numInput.count()) > 0,
        'Contract Requirement (Task 13): input[name="document_number"] must be rendered inside DocumentForm'
      );

      const inputType = await numInput.first().getAttribute('type');
      assert.equal(inputType, 'text', 'document_number must be type="text" (no numeric coercion)');

      const maxLength = await numInput.first().getAttribute('maxLength');
      assert.equal(maxLength, '128', 'document_number must have maxLength={128}');

      await numInput.first().fill('00123456');
      const val = await numInput.first().inputValue();
      assert.equal(val, '00123456', 'Leading zero preserved');
    }
  );

  // Case 11: Editing existing document loads document_number and unmodified/edited saves persist it
  await testCase(
    'Case 11: Editing existing document loads document_number and unmodified/edited saves persist it',
    false,
    async () => {
      // Sub-step A: Unchanged existing document_number save
      let epoch = await page.evaluate(() => {
        return window.__formsControls.mountGeneral({
          uploadedFile: null,
          fileName: 'passport.pdf',
          editingDocument: {
            id: 'doc-edit-1',
            company_id: 'comp-1',
            ministry_id: 'min-moi',
            title: 'Employee Passport',
            document_number: '00789XYZ',
            document_type_id: 'type-passport',
            expiry_date: '2028-01-01',
          },
        });
      });

      await waitForFormReady(page, epoch);
      let form = page.locator('form');

      let numInput = form.locator('input[name="document_number"]');
      assert.ok(
        (await numInput.count()) > 0,
        'Contract Requirement (Task 13): input[name="document_number"] must be rendered in edit mode'
      );

      let loadedValue = await numInput.first().inputValue();
      assert.equal(
        loadedValue,
        '00789XYZ',
        'Contract Requirement (Task 13): editingDocument.document_number must load into defaultValues'
      );

      // Perform UNCHANGED save
      let updatePromise = api.waitForUpdate(0, 5000);
      await form.locator('button[type="submit"]').click();
      let update = await updatePromise;

      assert.equal(update.id, 'doc-edit-1', 'PATCH requested for doc-edit-1');
      assert.equal(
        update.payload.document_number,
        '00789XYZ',
        'Unchanged document_number must persist in captured PATCH request'
      );

      // Sub-step B: Separate edited document_number save
      epoch = await page.evaluate(() => {
        return window.__formsControls.mountGeneral({
          uploadedFile: null,
          fileName: 'civil-id.pdf',
          editingDocument: {
            id: 'doc-edit-2',
            company_id: 'comp-1',
            ministry_id: 'min-moi',
            title: 'Civil ID Card Edit',
            document_number: '112233ABC',
            document_type_id: 'type-civil-id',
            expiry_date: '2029-01-01',
          },
        });
      });

      await waitForFormReady(page, epoch);
      form = page.locator('form');
      numInput = form.locator('input[name="document_number"]');
      assert.ok(
        (await numInput.count()) > 0,
        'Contract Requirement (Task 13): input[name="document_number"] must be rendered in edit mode'
      );

      loadedValue = await numInput.first().inputValue();
      assert.equal(
        loadedValue,
        '112233ABC',
        'Contract Requirement (Task 13): editingDocument.document_number must load into defaultValues'
      );

      await numInput.first().fill('112233ABC-MODIFIED');
      updatePromise = api.waitForUpdate(1, 5000);
      await form.locator('button[type="submit"]').click();
      update = await updatePromise;

      assert.equal(update.id, 'doc-edit-2', 'PATCH requested for doc-edit-2');
      assert.equal(
        update.payload.document_number,
        '112233ABC-MODIFIED',
        'Updated document_number must persist in captured PATCH request'
      );
    }
  );

  // Case 12: General Save & Add Next clears document_number, file, and title with settled UI state
  await testCase(
    'Case 12: General Save & Add Next clears document_number, file, and title with settled UI state',
    false,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'doc-1.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      const form = page.locator('form');

      const numInput = form.locator('input[name="document_number"]');
      assert.ok(
        (await numInput.count()) > 0,
        'Contract Requirement (Task 13): document_number input must exist to verify Save & Add Next clear'
      );

      const titleInput = form.locator('input[name="title"]');
      await titleInput.fill('First Document to Save');
      await numInput.first().fill('DOC-NUM-999');
      await selectComboboxOption(page, 'نوع الوثيقة', 'البطاقة المدنية');
      await selectComboboxOption(page, 'الوزارة', 'وزارة الداخلية');
      await selectPopoverDate(page, 'تاريخ الانتهاء');

      const saveAndAddNextBtn = form.locator('button:has(svg.lucide-plus), button:has-text("&")');
      assert.ok(
        (await saveAndAddNextBtn.count()) > 0,
        'Save & Add Next button must be present in DocumentForm'
      );

      const docPromise = api.waitForDocument(0, 5000);
      await saveAndAddNextBtn.first().click();
      const doc = await docPromise;

      assert.equal(doc.payload.document_number, 'DOC-NUM-999', 'Saved document received document_number');

      // Wait for settled UI state: form resets after successful Save & Add Next
      await page.waitForFunction(() => {
        const num = document.querySelector('input[name="document_number"]');
        return num && num.value === '';
      }, null, { timeout: 5000 });

      // Assert reset contract: document_number is cleared, title is reset, attachment is cleared
      const resetNumber = await numInput.first().inputValue();
      assert.equal(resetNumber, '', 'document_number must be cleared to empty string after Save & Add Next');

      const resetTitle = await titleInput.inputValue();
      assert.equal(resetTitle, '', 'title must be reset to empty string after Save & Add Next');

      // Assert attachment reset: change button is gone, file dropzone is restored, preview indicates no file
      const changeBtn = page.locator('button:has-text("اختر الملفات"), button:has-text("Choose files")');
      assert.equal(await changeBtn.count(), 0, 'Attachment change button must be absent after file reset');

      const fileInput = page.locator('input[type="file"]');
      assert.ok((await fileInput.count()) > 0, 'File upload dropzone must be restored after Save & Add Next');
      assert.equal(await fileInput.inputValue(), '', 'Reset file input must be empty');
      assert.equal(await page.locator('section img, section iframe').count(), 0, 'Reset attachment has no preview');
      assert.equal(await fileInput.isEnabled(), true, 'Save transaction settled and next file can be selected');
      assert.equal(await form.locator('button[type="submit"]').isEnabled(), false, 'New empty form cannot save until a file is selected');
    }
  );

  // Case 13: DocumentExtractionPanel integrated into DocumentForm and EmployeeDocumentForm
  await testCase(
    'Case 13: DocumentExtractionPanel integrated into DocumentForm and EmployeeDocumentForm',
    false,
    async () => {
      // General form check
      let epoch = await page.evaluate(() => {
        return window.__formsControls.mountGeneral();
      });
      await waitForFormReady(page, epoch);
      let form = page.locator('form');

      const generalPanel = form.locator('[role="status"][aria-live="polite"]');
      assert.ok(
        (await generalPanel.count()) > 0,
        'Contract Requirement (Task 13): DocumentExtractionPanel [role="status"][aria-live="polite"] must be rendered inside DocumentForm'
      );

      // Employee form check
      epoch = await page.evaluate(() => {
        return window.__formsControls.mountEmployee({ isOpen: true, employeeId: 'emp-1' });
      });
      await waitForFormReady(page, epoch);
      form = page.locator('form');

      const employeePanel = form.locator('[role="status"][aria-live="polite"]');
      assert.ok(
        (await employeePanel.count()) > 0,
        'Contract Requirement (Task 14): DocumentExtractionPanel [role="status"][aria-live="polite"] must be rendered inside EmployeeDocumentForm'
      );
    }
  );

  // Case 14: Manual edit/clear/restored keys protected during in-flight held extraction across both forms
  await testCase(
    'Case 14: Manual edit/clear/restored keys protected during in-flight held extraction across both forms',
    false,
    async () => {
      // Part 14A: General Form (DocumentForm)
      // Establish actual restored draft with empty/null keys
      api.getOrCreateDraft('company:comp-1').values = {
        title: 'Draft Title Before File',
        notes: '',
        ministry_id: null,
        expiry_date: null,
      };

      let epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'general-doc.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      let form = page.locator('form');

      // Pending Task 13: wait for held extraction request
      let req = await api.waitForRequest(0, 2000).catch(() => null);
      assert.ok(
        req,
        'Contract Requirement (Task 13): DocumentForm must invoke useDocumentExtraction and dispatch extraction POST on file selection'
      );

      // While extraction is held:
      // 1. Deliberate clear of title
      await form.locator('input[name="title"]').fill('');
      // 2. Manual edit of notes
      await form.locator('textarea[name="notes"]').fill('User protected note during in-flight');
      await form.locator('input[name="document_number"]').fill('MANUAL-GENERAL');
      // 3. Untouched eligible field: document_type_id remains unselected / untouched

      // Await response fulfillment proposing all fields
      await req.fulfillSuccess({
        title: { value: 'AI Proposed General Title', state: 'clear', alternatives: [], reason: 'none' },
        document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Await response and application settlement in DOM
      const generalTypeTrigger = form.locator('label:has-text("نوع الوثيقة")').locator('..').locator('button[role="combobox"]').first();
      await generalTypeTrigger.filter({ hasText: 'البطاقة المدنية' }).waitFor({ state: 'visible', timeout: 5000 });

      // Assert deliberate clear is protected (title remains empty)
      const generalTitle = await form.locator('input[name="title"]').inputValue();
      assert.equal(generalTitle, '', 'Deliberately cleared title must remain empty (not overwritten by AI proposal)');

      // Assert manual edit is protected (notes retains user edit)
      const generalNotes = await form.locator('textarea[name="notes"]').inputValue();
      assert.equal(generalNotes, 'User protected note during in-flight', 'Manually edited notes must be protected');
      assert.equal(await form.locator('input[name="document_number"]').inputValue(), 'MANUAL-GENERAL', 'Manual extraction field remains protected');
      assert.ok(!(await form.locator('label:has-text("الوزارة")').locator('..').locator('button[role="combobox"]').innerText()).includes('وزارة الداخلية'), 'Restored null ministry must resist the proposal');
      assert.ok((await form.locator('label:has-text("تاريخ الانتهاء")').locator('..').innerText()).includes('اختر التاريخ'), 'Restored null expiry must resist the proposal');

      // Assert untouched eligible field applied as a positive control
      assert.ok(
        (await generalTypeTrigger.innerText()).includes('البطاقة المدنية'),
        'Untouched eligible field (document_type_id) must apply AI extraction as positive control'
      );

      // Part 14B: Employee Form (EmployeeDocumentForm)
      // Establish actual restored draft with empty/null keys
      api.getOrCreateDraft('employee:emp-1').values = {
        title: 'Employee Draft Title',
        notes: '',
        ministry_id: null,
        expiry_date: null,
      };

      epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'employee-doc.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');

      // Pending Task 14: wait for held extraction request
      req = await api.waitForRequest(1, 2000).catch(() => null);
      assert.ok(
        req,
        'Contract Requirement (Task 14): EmployeeDocumentForm must invoke useDocumentExtraction and dispatch extraction POST on file selection'
      );

      // While extraction is held:
      // 1. Deliberate clear of title
      await form.locator('#title').fill('');
      // 2. Manual edit of notes
      await form.locator('#notes').fill('Employee protected note during in-flight');
      await form.locator('#document_number').fill('MANUAL-EMPLOYEE');

      // Await response fulfillment proposing all fields
      await req.fulfillSuccess({
        title: { value: 'AI Proposed Employee Title', state: 'clear', alternatives: [], reason: 'none' },
        document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Await response and application settlement in DOM
      const empTypeTrigger = form.locator('label:has-text("نوع الوثيقة")').locator('..').locator('button').first();
      await empTypeTrigger.filter({ hasText: 'البطاقة المدنية' }).waitFor({ state: 'visible', timeout: 5000 });

      // Assert deliberate clear is protected
      const empTitle = await form.locator('#title').inputValue();
      assert.equal(empTitle, '', 'Deliberately cleared title in Employee form must remain empty');

      // Assert manual edit is protected
      const empNotes = await form.locator('#notes').inputValue();
      assert.equal(empNotes, 'Employee protected note during in-flight', 'Manually edited notes in Employee form must be protected');
      assert.equal(await form.locator('#document_number').inputValue(), 'MANUAL-EMPLOYEE', 'Manual employee number remains protected');
      assert.ok(!(await form.locator('label:has-text("الوزارة")').locator('..').locator('button[role="combobox"]').innerText()).includes('وزارة الداخلية'), 'Employee restored null ministry must resist the proposal');
      assert.ok((await form.locator('label:has-text("تاريخ الانتهاء")').locator('..').innerText()).includes('اختر التاريخ'), 'Employee restored null expiry must resist the proposal');

      // Assert untouched eligible field applied as a positive control
      assert.ok(
        (await empTypeTrigger.innerText()).includes('البطاقة المدنية'),
        'Untouched eligible field in Employee form must apply AI extraction as positive control'
      );
    }
  );

  // Case 15: A/B file replacement invalidates previous extraction and rejects late A response
  await testCase(
    'Case 15: A/B file replacement invalidates previous extraction and rejects late A response',
    false,
    async () => {
      const epoch = await page.evaluate((bytes) => {
        const fileA = new File([new Uint8Array(bytes)], 'fileA.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: fileA,
          fileName: fileA.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      const form = page.locator('form');

      // User performs manual edit on notes before/during file handling
      await form.locator('textarea[name="notes"]').fill('User manual notes preserved across replacement');

      const reqA = await api.waitForRequest(0, 2000).catch(() => null);
      assert.ok(
        reqA,
        'Contract Requirement (Task 13): Initial file selection must trigger extraction request A'
      );

      // Require the actual replacement control (no conditional checks)
      const changeBtn = page.locator('button:has-text("اختر الملفات"), button:has-text("Choose files")');
      assert.ok(
        (await changeBtn.count()) > 0,
        'Attachment replacement button must be present when file is selected'
      );
      await changeBtn.first().click();

      const fileInput = page.locator('input[type="file"]');
      assert.ok(
        (await fileInput.count()) > 0,
        'File input must be accessible for replacement'
      );
      await fileInput.setInputFiles({
        name: 'fileB.png',
        mimeType: 'image/png',
        buffer: Buffer.from(validPng),
      });

      const reqB = await api.waitForRequest(1, 2000).catch(() => null);
      assert.ok(
        reqB,
        'Contract Requirement (Task 13): File B selection must trigger extraction request B'
      );

      // Distinguish A and B with schema-valid non-title eligible proposals:
      // A has document_number: '290010112345', document_type_id: 'type-civil-id', ministry_id: 'min-moi'
      // B has document_number: '300020223456', document_type_id: 'type-passport', ministry_id: 'min-molf'
      // Resolve B FIRST
      await reqB.fulfillSuccess({
        document_number: { value: '300020223456', state: 'clear', alternatives: [], reason: 'none' },
        document_type_id: { value: 'type-passport', state: 'clear', alternatives: [], reason: 'none' },
        ministry_id: { value: 'min-molf', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Await B application settlement
      await page.waitForFunction(() => {
        const num = document.querySelector('input[name="document_number"]');
        return num && num.value === '300020223456';
      }, null, { timeout: 3000 });

      // Settle late A LATER
      await reqA.fulfillSuccess({
        document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
        document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
        ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Form must retain Document B values, NOT overwritten by late A
      const numInput = form.locator('input[name="document_number"]');
      assert.ok((await numInput.count()) > 0, 'document_number input must be rendered');
      const numVal = await numInput.first().inputValue();
      assert.equal(numVal, '300020223456', 'Stale request A document_number must be rejected; File B proposal retained');

      // Assert title preservation: title reflects File B filename title, NOT replaced by AI title
      const titleVal = await form.locator('input[name="title"]').inputValue();
      assert.equal(titleVal, 'fileB', 'Title preservation contract: title must preserve File B filename title');

      // Assert manually edited field was preserved against machine cleanup
      const notesVal = await form.locator('textarea[name="notes"]').inputValue();
      assert.equal(notesVal, 'User manual notes preserved across replacement', 'Manually edited notes must persist');

      // Third file: unchanged machine values clear, explicit number edit survives.
      await numInput.fill('MANUAL-AFTER-B');
      await page.getByRole('button', { name: 'اختر الملفات التي تريد رفعها', exact: true }).click();
      await page.locator('input[type="file"]').waitFor({ state: 'attached' });
      assert.ok(!(await form.locator('label:has-text("نوع الوثيقة")').locator('..').locator('button[role="combobox"]').innerText()).includes('جواز السفر'), 'Replacing B clears unchanged machine type before C resolves');
      assert.equal(await numInput.inputValue(), 'MANUAL-AFTER-B', 'Replacing B preserves manually edited number');
      await page.locator('input[type="file"]').setInputFiles({ name: 'fileC.png', mimeType: 'image/png', buffer: Buffer.from(validPng) });
      const reqC = await api.waitForRequest(2, 5000);
      await reqC.fulfillSuccess({
        document_number: { value: 'C-MACHINE', state: 'clear', alternatives: [], reason: 'none' },
        document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
      });
      await form.locator('label:has-text("نوع الوثيقة")').locator('..').locator('button[role="combobox"]').filter({ hasText: 'البطاقة المدنية' }).waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await numInput.inputValue(), 'MANUAL-AFTER-B', 'C cannot overwrite the explicitly edited number');

      // Click save only after C application and inspect persisted metadata.
      await selectPopoverDate(page, 'تاريخ الانتهاء');
      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.document_number, 'MANUAL-AFTER-B', 'Saved document carries protected manual document_number');
      assert.equal(doc.payload.document_type_id, 'type-civil-id', 'Saved document carries File C document_type_id');
      assert.equal(doc.payload.notes, 'User manual notes preserved across replacement', 'Saved document carries manual notes');
    }
  );

  // Case 16: Close / reopen / live account change invalidates in-flight extraction across both forms
  await testCase(
    'Case 16: Close / reopen / live account change invalidates in-flight extraction across both forms',
    false,
    async () => {
      // Sub-step 16A: Dialog close/unmount invalidation and account reopen (Employee form)
      let epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'temp-employee.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);

      let req = await api.waitForRequest(0, 2000).catch(() => null);
      assert.ok(
        req,
        'Contract Requirement (Task 14): EmployeeDocumentForm must trigger extraction request on file selection'
      );

      // User triggers close
      const closeBtn = page.locator('form button:has-text("إلغاء"), form button:has-text("Cancel")');
      await closeBtn.first().click();

      // Assert closed callback actually unmounted/hid component
      await page.waitForSelector('[data-mode="none"]', { timeout: 5000 });

      // Settle late extraction request with proposals for all fields
      await req.fulfillSuccess({
        title: { value: 'Late Unmounted Employee Title', state: 'clear', alternatives: [], reason: 'none' },
        document_number: { value: '99999999', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Switch account and reopen
      api.currentAccount = 'account-admin-2';
      epoch = await page.evaluate(() => {
        window.__formsControls.setAccount('account-admin-2');
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-2',
          uploadedFile: null,
        });
      });

      await waitForFormReady(page, epoch);
      let form = page.locator('form');

      // Assert committed authenticated account identity
      const accountIdentity = await page.locator('[data-testid="fixture-current-account"]').innerText();
      assert.equal(accountIdentity, 'account-admin-2', 'Committed auth account identity must match new account');

      // Assert exact new form values (clean slate, zero contamination from late unmounted response)
      const empTitleVal = await form.locator('#title').inputValue();
      assert.equal(empTitleVal, '', 'Reopened form title must be empty');
      const empNotesVal = await form.locator('#notes').inputValue();
      assert.equal(empNotesVal, '', 'Reopened form notes must be empty');

      // Sub-step 16B: Live account change while extraction is held independently of closing (General form)
      api.currentAccount = 'account-admin-1';
      epoch = await page.evaluate((bytes) => {
        window.__formsControls.setAccount('account-admin-1');
        const file = new File([new Uint8Array(bytes)], 'live-general.png', { type: 'image/png' });
        return window.__formsControls.mountGeneral({
          uploadedFile: file,
          fileName: file.name,
          preselectedCompanyId: 'comp-1',
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');

      const reqLive = await api.waitForRequest(1, 2000).catch(() => null);
      assert.ok(
        reqLive,
        'Contract Requirement (Task 13): DocumentForm must trigger extraction request on file selection'
      );

      // While held: WITHOUT clicking close, trigger live account change
      api.currentAccount = 'account-admin-2';
      const liveSwitchEpoch = await page.evaluate(() => {
        return window.__formsControls.setAccount('account-admin-2');
      });

      // Await committed requested epoch and auth ready under account-admin-2
      await waitForFormReady(page, liveSwitchEpoch);

      // Now settle the old held extraction request from account-admin-1
      await reqLive.fulfillSuccess({
        title: { value: 'Stale Old Account Title', state: 'clear', alternatives: [], reason: 'none' },
        document_number: { value: '11112222', state: 'clear', alternatives: [], reason: 'none' },
      });

      // Assert committed account identity in the fixture
      const liveAccountIdentity = await page.locator('[data-testid="fixture-current-account"]').innerText();
      assert.equal(liveAccountIdentity, 'account-admin-2', 'Live switched auth account identity must be account-admin-2');
      assert.equal(await page.locator('[data-testid="forms-mount-container"]').getAttribute('data-auth-account'), 'account-admin-2', 'Actual AuthProvider committed new account');

      // Assert exact protected values: old account extraction must NOT leak into the new account form
      form = page.locator('form');
      const generalTitleVal = await form.locator('input[name="title"]').inputValue();
      assert.notEqual(generalTitleVal, 'Stale Old Account Title', 'Old account late extraction title must not leak');

      const numInput = form.locator('input[name="document_number"]');
      assert.equal(await numInput.count(), 1, 'New account form has required number input');
      assert.equal(await numInput.inputValue(), '', 'Old account late extraction number must not leak');
    }
  );

  // Case 17: Employee document form invalid date range (expiry < issue) rejected before staging
  await testCase(
    'Case 17: Employee document form invalid date range (expiry < issue) rejected before staging',
    false,
    async () => {
      // Sub-step A: Reversed dates rejection before staging
      api.getOrCreateDraft('employee:emp-1').values = {
        title: 'Employee Reversed Dates Document',
        document_type_id: 'type-civil-id',
        issue_date: '2026-05-10',
        expiry_date: '2026-05-01',
      };

      let epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'emp-reversed.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      let form = page.locator('form');

      // Prove intended dates
      await assertDateTriggerValue(page, 'تاريخ الإصدار', '2026-05-10');
      await assertDateTriggerValue(page, 'تاريخ الانتهاء', '2026-05-01');

      // Click submit (no force click)
      await form.locator('button[type="submit"]').click();

      // Contract Requirement (Task 14): if both dates exist and expiry < issue,
      // form must display visible validation error (role="alert", destructive text, or toast error)
      // and reject BEFORE staging uploads or saving document
      const errorLocator = page.locator(
        '[role="alert"]:has-text("انتهاء"), [role="alert"]:has-text("expiry"), [data-sonner-toast][data-type="error"]:has-text("انتهاء"), [data-sonner-toast][data-type="error"]:has-text("expiry"), p.text-destructive:has-text("انتهاء"), p.text-destructive:has-text("expiry")'
      );
      await errorLocator.first().waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
      const hasValidationError = (await errorLocator.count()) > 0 && (await errorLocator.first().isVisible());

      assert.ok(
        hasValidationError,
        'Contract Requirement (Task 14): EmployeeDocumentForm must display visible validation error for reversed date range (expiry < issue)'
      );
      assert.equal(
        api.uploadCalls,
        0,
        'Contract Requirement (Task 14): Reversed date range must reject before staging uploads'
      );
      assert.equal(api.documentCalls, 0, 'Zero documents saved on invalid date range');

      // Sub-step B: Valid date range positive control
      api.getOrCreateDraft('employee:emp-1').values = {
        title: 'Employee Valid Dates Document',
        document_type_id: 'type-civil-id',
        issue_date: '2026-05-01',
        expiry_date: '2026-05-10',
      };

      epoch = await page.evaluate((bytes) => {
        const file = new File([new Uint8Array(bytes)], 'emp-valid.png', { type: 'image/png' });
        return window.__formsControls.mountEmployee({
          isOpen: true,
          employeeId: 'emp-1',
          uploadedFile: file,
        });
      }, Array.from(validPng));

      await waitForFormReady(page, epoch);
      form = page.locator('form');

      await assertDateTriggerValue(page, 'تاريخ الإصدار', '2026-05-01');
      await assertDateTriggerValue(page, 'تاريخ الانتهاء', '2026-05-10');

      const docPromise = api.waitForDocument(0, 5000);
      await form.locator('button[type="submit"]').click();
      const doc = await docPromise;

      assert.equal(doc.payload.issue_date, '2026-05-01', 'Valid issue date saved');
      assert.equal(doc.payload.expiry_date, '2026-05-10', 'Valid expiry date saved');
      assert.equal(api.uploadCalls, 1, 'File staged successfully for valid dates');
    }
  );

  await testCase('Case 18: Context changes clear machine values and preserve manual values', false, async () => {
    for (const variant of ['company', 'beneficiary', 'employee', 'filter']) {
      console.log(`    [Case 18] Running variant: ${variant}`);
      await api.reset();
      const epoch = await page.evaluate(() => window.__formsControls.mountGeneral());
      await waitForFormReady(page, epoch);
      const employeeMode = variant === 'employee' || variant === 'filter';
      await selectComboboxOption(page, 'نوع المستفيد', employeeMode ? 'الموظف' : 'الشركة');
      if (employeeMode) await selectComboboxOption(page, 'الموظف *', 'Ahmed Al-Sabah');
      else await selectComboboxOption(page, 'الشركة', 'شركة روماني للتجارة');
      await page.locator('input[type="file"]').setInputFiles({ name: 'context.png', mimeType: 'image/png', buffer: Buffer.from(validPng) });
      const request = await api.waitForRequest(0, 5000);
      await request.fulfillSuccess();
      await page.waitForFunction(() => document.querySelector('input[name="document_number"]')?.value === '290010112345', null, { timeout: 5000 });
      const form = page.locator('form');
      await form.locator('input[name="document_number"]').fill('MANUAL-CONTEXT');
      if (variant === 'company') await selectComboboxOption(page, 'الشركة', 'شركة الخليج للخدمات');
      if (variant === 'beneficiary') await selectComboboxOption(page, 'نوع المستفيد', 'الموظف');
      if (variant === 'employee') await selectComboboxOption(page, 'الموظف *', 'Fatima Al-Mansoor');
      if (variant === 'filter') await selectComboboxOption(page, 'تصفية حسب الشركة (اختياري)', 'Romani Trading Co');
      assert.equal(await form.locator('input[name="document_number"]').inputValue(), 'MANUAL-CONTEXT', `${variant}: manual number survives`);
      assert.equal(await form.locator('button[role="combobox"]').filter({ hasText: 'البطاقة المدنية' }).count(), 0, `${variant}: machine type cleared`);
      assert.equal(api.uploadCalls, 0, `${variant}: context changes do not stage files`);
      await api.settleAllHeld();
    }
  });

  // -------------------------------------------------------------------------
  // Case 19: Positive Control: Actual ReactDOM draft-probe mount, save, unmount, and successor restore against real Express CAS
  // -------------------------------------------------------------------------
  await testCase(
    'Case 19: Positive Control: Actual ReactDOM draft-probe mount, save, unmount, and successor restore against real Express CAS',
    true,
    async () => {
      // Step 1: Mount draft probe under company:comp-1
      let epoch = await page.evaluate(() => {
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(() => window.__draftProbeSession?.status === 'saved' || window.__draftProbeSession?.status === 'clean' || window.__draftProbeSession?.status === 'ready' || window.__draftProbeSession?.status === 'dirty', null, { timeout: 10000 });

      // Step 2: Prepare initial draft values via real useDocumentDraft session
      const savedRef = await page.evaluate(async () => {
        return window.__draftProbeSession.prepare({ title: 'First probe title', notes: 'First probe note' });
      });
      assert.ok(savedRef.revision, 'Draft prepare returned committed revision');

      // Step 3: Trigger real React unmount (runs effect cleanup, flushes draft)
      epoch = await page.evaluate(() => window.__formsControls.unmount());
      await page.waitForSelector('[data-testid="forms-mount-container"][data-mode="none"]', { timeout: 5000 });

      // Step 4: Mount successor probe with same scope: asserts restore
      epoch = await page.evaluate(() => {
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(() => window.__draftProbeSession?.hasDraft === true, null, { timeout: 10000 });

      // Verify restored values
      const restored = await page.evaluate(() => window.__draftProbeSession.restoredValues);
      assert.equal(restored?.title, 'First probe title', 'Successor probe restored title from real SQLite');
      assert.equal(restored?.notes, 'First probe note', 'Successor probe restored notes from real SQLite');

      // Step 5: Successor prepares second edit
      const secondRef = await page.evaluate(async () => {
        return window.__draftProbeSession.prepare({ title: 'Second probe title', notes: 'First probe note' });
      });
      assert.notEqual(secondRef.revision, savedRef.revision, 'Second edit advanced revision in SQLite');
    }
  );

  // -------------------------------------------------------------------------
  // Case 20: Positive Control: Real AuthProvider tenant isolation keeps draft scopes segregated in SQLite
  // -------------------------------------------------------------------------
  await testCase(
    'Case 20: Positive Control: Real AuthProvider tenant isolation keeps draft scopes segregated in SQLite',
    true,
    async () => {
      // Step 1: Account 1 saves draft for company:comp-1
      api.currentAccount = 'account-admin-1';
      let epoch = await page.evaluate(() => {
        window.__formsControls.setAccount('account-admin-1');
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(ep => window.__draftProbeSession?.epoch === ep && window.__draftProbeSession?.status === 'saved', epoch, { timeout: 5000 });
      await page.evaluate(async () => {
        await window.__draftProbeSession.prepare({ title: 'Account 1 Confidential Title' });
      });

      // Step 2: Switch to Account 2
      api.currentAccount = 'account-admin-2';
      epoch = await page.evaluate(() => {
        window.__formsControls.setAccount('account-admin-2');
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(ep => window.__draftProbeSession?.epoch === ep && window.__draftProbeSession?.status === 'saved', epoch, { timeout: 5000 });

      // Verify Account 2 sees empty draft (no leakage from Account 1)
      const hasDraftAcct2 = await page.evaluate(() => window.__draftProbeSession?.hasDraft);
      assert.equal(hasDraftAcct2, false, 'Account 2 must have clean draft without Account 1 data');

      // Step 3: Switch back to Account 1
      api.currentAccount = 'account-admin-1';
      epoch = await page.evaluate(() => {
        window.__formsControls.setAccount('account-admin-1');
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(ep => window.__draftProbeSession?.epoch === ep && window.__draftProbeSession?.status === 'saved' && window.__draftProbeSession?.hasDraft === true, epoch, { timeout: 5000 });
      const restoredAcct1 = await page.evaluate(() => window.__draftProbeSession.restoredValues);
      assert.equal(restoredAcct1?.title, 'Account 1 Confidential Title', 'Account 1 draft restored intact');

      // Step 4: Cross-account mismatch and authentication controls:
      // Direct request with cookie for account-admin-1 but x-draft-account: account-admin-2
      const mismatchRes = await fetch(`http://127.0.0.1:${draftsPort}/api/document-drafts/company:comp-1`, {
        method: 'GET',
        headers: {
          cookie: `${fixtureConfig.cookieName}=${makeSessionCookie('account-admin-1')}`,
          'x-draft-account': 'account-admin-2',
        },
      });
      assert.equal(mismatchRes.status, 409, 'Cookie/header account mismatch must be refused with 409 draft_conflict');
      const mismatchJson = await mismatchRes.json();
      assert.equal(mismatchJson.error?.code, 'draft_conflict', 'Mismatch error code must be draft_conflict');

      // Request without signed session cookie must be refused with 401 unauthenticated
      const unauthRes = await fetch(`http://127.0.0.1:${draftsPort}/api/document-drafts/company:comp-1`, {
        method: 'GET',
        headers: {
          'x-draft-account': 'account-admin-1',
        },
      });
      assert.equal(unauthRes.status, 401, 'Request without session cookie must be refused with 401 unauthenticated');
    }
  );

  // -------------------------------------------------------------------------
  // Case 21: Positive Control: External SQLite revision mutation triggers 409 conflict and preserves unsaved memory edits
  // -------------------------------------------------------------------------
  await testCase(
    'Case 21: Positive Control: External SQLite revision mutation triggers 409 conflict and preserves unsaved memory edits',
    true,
    async () => {
      // Step 1: Mount probe under company:comp-1
      let epoch = await page.evaluate(() => {
        return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
      });
      await page.waitForSelector('[data-testid="draft-probe-wrapper"]', { timeout: 10000 });
      await page.waitForFunction(() => window.__draftProbeSession?.status === 'saved' || window.__draftProbeSession?.status === 'ready', null, { timeout: 5000 });

      // Save baseline draft keeping session active
      await page.evaluate(async () => {
        window.__draftProbeSession.change({ title: 'Baseline Title' });
        await window.__draftProbeSession.flush();
      });

      // Step 2: Simulate another device/tab directly mutating SQLite revision
      const currentRev = draftDb.prepare('SELECT revision FROM document_drafts WHERE user_id=? AND scope=?').get('account-admin-1', 'company:comp-1').revision;
      writeDraft(draftDb, 'account-admin-1', { scope: 'company:comp-1', revision: String(currentRev) }, { title: 'Other Device Remote Edit' });

      // Step 3: Local session attempts to save unsaved local changes
      const conflictResult = await page.evaluate(async () => {
        try {
          window.__draftProbeSession.change({ title: 'Local Unsaved Conflict Title' });
          await window.__draftProbeSession.flush();
          return { conflicted: false };
        } catch (err) {
          return { conflicted: true, error: err.message };
        }
      });

      assert.equal(conflictResult.conflicted, true, 'Stale revision edit must trigger conflict rejection');

      // Await React re-render of draft.status to 'conflict'
      await page.waitForFunction(() => window.__draftProbeSession?.status === 'conflict', null, { timeout: 5000 });
      const finalConflictStatus = await page.evaluate(() => window.__draftProbeSession?.status);
      assert.equal(finalConflictStatus, 'conflict', 'Draft status must transition to conflict');

      // Step 4: Verify unsaved local edits are preserved in memory (not overwritten or dropped)
      const sessionValues = await page.evaluate(() => {
        const s = window.__draftProbeSession?.session?.current;
        return s?.pending?.title || s?.draft?.values?.title;
      });
      assert.equal(sessionValues, 'Local Unsaved Conflict Title', 'Unsaved local edit preserved in memory during conflict');
    }
  );

  // -------------------------------------------------------------------------
  // Case 22: Real hook regression: rapid unmount and successor remount handoff race against real Express CAS
  // -------------------------------------------------------------------------
  await testCase(
    'Case 22: Real hook regression: rapid unmount and successor remount handoff race against real Express CAS',
    false,
    async () => {
      try {
        api.draftRequestsLog = [];

        // Step 1: Mount Probe 1 under company:comp-1
        const epoch1 = await page.evaluate(() => {
          return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
        });
        await page.waitForSelector(`[data-testid="draft-probe-wrapper"][data-form-epoch="${epoch1}"]`, { timeout: 10000 });
        await page.waitForFunction(
          (ep) => window.__draftProbeSession?.epoch === ep && (window.__draftProbeSession?.status === 'saved' || window.__draftProbeSession?.status === 'ready' || window.__draftProbeSession?.status === 'clean'),
          epoch1,
          { timeout: 5000 }
        );

        // Step 2: Queue dirty edit in Probe 1 (un-flushed in memory)
        await page.evaluate(() => {
          window.__draftProbeSession.change({ title: 'Probe 1 Retiring Title', notes: 'Probe 1 Retiring Note' });
        });

        // Step 3: Arm deterministic one-shot retiring-PUT gate
        api.armRetiringPutGate();

        // Step 4: Unmount Probe 1 (triggers effect cleanup and flush() in useDocumentDraft)
        await page.evaluate(() => window.__formsControls.unmount());
        await page.waitForSelector('[data-testid="forms-mount-container"][data-mode="none"]', { timeout: 5000 });

        // Step 5: Await deterministic retiring-PUT entry barrier
        await api.waitForRetiringPutEntry(5000);

        // Step 6: Mount successor Probe 2 with same scope
        const epoch2 = await page.evaluate(() => {
          return window.__formsControls.mountDraftProbe({ scope: 'company:comp-1' });
        });

        // Step 7: Await mounted new probe epoch/session in DOM before old release,
        // BUT do NOT wait for successor status saved (a correct handoff must delay its GET/load)
        await page.waitForSelector(`[data-testid="draft-probe-wrapper"][data-form-epoch="${epoch2}"]`, { timeout: 10000 });
        await page.waitForFunction(
          (ep) => window.__draftProbeSession?.epoch === ep,
          epoch2,
          { timeout: 10000 }
        );

        // Record GET ordering evidence: in unpatched baseline, Probe 2 GET races before retiring PUT settles
        const getRequestsBeforeRelease = api.draftRequestsLog.filter((r) => r.method === 'GET');
        console.log(`    [Case 22 Handoff] Probe 2 mounted at epoch ${epoch2}; GET requests before predecessor release: ${getRequestsBeforeRelease.length}`);

        // Step 8: Release predecessor held PUT and await settlement barrier
        api.releaseRetiringPut();
        await api.waitForRetiringPutSettled(5000);

        // Step 9: Await restore and successor ready
        await page.waitForFunction(
          () => {
            const s = window.__draftProbeSession?.status;
            return s === 'ready' || s === 'saved' || s === 'clean' || s === 'conflict';
          },
          null,
          { timeout: 8000 }
        );

        // Assert restored predecessor metadata:
        // In unpatched baseline, Probe 2 GET raced before retiring PUT settled, so restored is null or stale
        const restored = await page.evaluate(() => window.__draftProbeSession?.restoredValues);
        assert.equal(
          restored?.title,
          'Probe 1 Retiring Title',
          'Successor must restore predecessor retiring title (baseline hook GET raced before retiring PUT settled)'
        );
        assert.equal(
          restored?.notes,
          'Probe 1 Retiring Note',
          'Successor must restore predecessor retiring notes'
        );

        // Step 10: Successor manual edits and actual server persistence with current revision
        const successorEdit = await page.evaluate(async () => {
          try {
            window.__draftProbeSession.change({ title: 'Probe 2 Successor Title', notes: 'Probe 2 Successor Note' });
            await window.__draftProbeSession.flush();
            return { ok: true, status: window.__draftProbeSession?.status };
          } catch (err) {
            return { ok: false, error: err.message, status: window.__draftProbeSession?.status };
          }
        });

        assert.equal(
          successorEdit.ok,
          true,
          `Successor must persist manual edits without CAS conflict (failed with: ${successorEdit.error})`
        );
        assert.notEqual(successorEdit.status, 'conflict', 'Draft status must not transition to conflict');

        // Verify actual server persistence with current revision
        const serverDraft = api.getDraft('company:comp-1', 'account-admin-1');
        assert.equal(serverDraft?.values?.title, 'Probe 2 Successor Title', 'Server SQLite must persist successor title with current revision');
      } finally {
        api.releaseRetiringPut();
      }
    }
  );

  return {
    totalCount,
    passedCount,
    observedRedCount,
    unexpectedFailCount,
    results,
  };
}

export async function main() {
  const args = process.argv.slice(2);
  const isBuiltMode = args.includes('--built');

  console.log('======================================================================');
  console.log('[FORMS SUITE] AI Document Extraction Forms Integration Suite (Task 10)');
  console.log(`[FORMS SUITE] Target Fixture: ${isBuiltMode ? 'BUILT FIXTURE (REAL BUILD OUTPUT)' : 'DEV SERVER'}`);
  console.log('======================================================================');

  const preflight = runPreflightCheck();
  if (!preflight.ok) {
    console.error('[FORMS SUITE PREFLIGHT ERROR] Missing required modules:');
    preflight.missing.forEach((m) => console.error(` - ${m}`));
    process.exit(1);
  }
  console.log('[FORMS SUITE PREFLIGHT] All required base modules present.');

  let server = null;
  let origin = '';

  if (isBuiltMode) {
    const outDir = resolve('scripts/fixtures/.dist-forms');
    fs.writeFileSync(
      resolve('scripts/fixtures/extraction-forms.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-forms.tsx"></script></body></html>'
    );
    console.log(`[BUILD] Building real forms fixture output to ${outDir}...`);
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
          input: resolve('scripts/fixtures/extraction-forms.html'),
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
    console.log(`[FORMS SUITE] Built forms fixture preview listening at ${origin}`);
  } else {
    server = await createServer({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      server: {
        port: 0,
        host: '127.0.0.1',
      },
      plugins: [
        {
          name: 'forms-fixture-endpoint',
          configureServer(s) {
            s.middlewares.use('/forms-fixture', async (req, res, next) => {
              try {
                res.setHeader('Content-Type', 'text/html');
                res.end(
                  await s.transformIndexHtml(
                    '/forms-fixture',
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extraction Forms Fixture</title></head>' +
                      '<body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-forms.tsx"></script></body></html>'
                  )
                );
              } catch (err) {
                next(err);
              }
            });
          },
        },
      ],
    });

    await server.listen();
    const port = server.httpServer.address().port;
    origin = `http://127.0.0.1:${port}`;
    console.log(`[FORMS SUITE] Dev fixture server listening at ${origin}`);
  }

  let browser = null;
  let draftsServer = null;
  const draftDb = new DatabaseSync(':memory:');
  draftDb.exec('PRAGMA foreign_keys=ON');
  runMigrations(draftDb, resolve('server/db/migrations'));

  for (const id of ['account-admin-1', 'account-admin-2', 'admin']) {
    draftDb.prepare(
      "INSERT OR REPLACE INTO admin_users(id, email, name, role, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')"
    ).run(id, `${id}@example.invalid`, `Synthetic ${id}`, 'admin', 'not-a-login-fixture');
  }

  insertRow(draftDb, 'companies', { id: 'comp-1', name: 'Romani Trading Co', name_ar: 'شركة روماني للتجارة' });
  insertRow(draftDb, 'companies', { id: 'comp-2', name: 'Gulf Services Ltd', name_ar: 'شركة الخليج للخدمات' });
  insertRow(draftDb, 'employees', { id: 'emp-1', company_id: 'comp-1', name: 'Ahmed Al-Sabah' });
  insertRow(draftDb, 'employees', { id: 'emp-2', company_id: 'comp-1', name: 'Fatima Al-Mansoor' });
  insertRow(draftDb, 'document_types', { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' });
  insertRow(draftDb, 'document_types', { id: 'type-passport', name: 'Passport', name_ar: 'جواز السفر' });
  insertRow(draftDb, 'document_types', { id: 'type-contract', name: 'Work Contract', name_ar: 'عقد العمل' });
  insertRow(draftDb, 'ministries', { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' });
  insertRow(draftDb, 'ministries', { id: 'min-molf', name: 'Ministry of Labor', name_ar: 'وزارة العمل' });
  insertRow(draftDb, 'documents', {
    id: 'doc-edit-1',
    title: 'Employee Passport',
    document_type_id: 'type-passport',
    company_id: 'comp-1',
    ministry_id: 'min-moi',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  });
  insertRow(draftDb, 'documents', {
    id: 'doc-edit-2',
    title: 'Civil ID Card Edit',
    document_type_id: 'type-civil-id',
    company_id: 'comp-1',
    ministry_id: 'min-moi',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  });

  const api = new FormsMockApi(draftDb);
  const draftsApp = createDraftsBackend(draftDb, fixtureConfig);

  draftsServer = await new Promise((res) => {
    const s = http.createServer(draftsApp);
    s.listen(0, '127.0.0.1', () => res(s));
  });
  const draftsPort = draftsServer.address().port;
  console.log(`[FORMS SUITE] Real Express CAS + SQLite backend listening at http://127.0.0.1:${draftsPort}`);

  try {
    let playwright;
    try {
      playwright = await import(
        process.env.PLAYWRIGHT_MODULE_PATH
          ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
          : 'playwright'
      );
    } catch (importErr) {
      console.error('[FORMS SUITE] Failed to import Playwright:', importErr.message);
      throw importErr;
    }

    const browserEngine = process.env.BROWSER_ENGINE || 'chromium';
    if (!['chromium', 'firefox'].includes(browserEngine)) throw new Error('Unsupported test browser engine');
    const browserType = playwright[browserEngine];
    browser = await browserType.launch({
      ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
      headless: true,
    });
    console.log('[FORMS SUITE] Browser launched successfully.');

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies([
      {
        name: fixtureConfig.cookieName,
        value: makeSessionCookie(api.currentAccount),
        url: origin,
      },
    ]);
    const page = await context.newPage();
    const egressViolations = [];
    const pageErrors = [];
    const unexpectedApiRequests = [];

    page.setDefaultTimeout(15000);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        if (!msg.text().includes('429') && !msg.text().includes('503') && !msg.text().includes('draft_conflict')) {
          console.error('[PAGE CONSOLE ERROR]', msg.text());
        }
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('[PAGE ERROR]', err.message);
    });

    // Strict loopback routing & zero disallowed egress
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
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

        if (url.pathname === '/api/form-defaults/documents') {
          return route.fulfill({
            status: 200,
            json: { data: api.formDefaults, error: null },
          });
        }

        if (url.pathname.startsWith('/api/document-types')) {
          return route.fulfill({
            status: 200,
            json: { data: DEFAULT_DOCUMENT_TYPES, error: null },
          });
        }

        if (url.pathname.startsWith('/api/ministries')) {
          return route.fulfill({
            status: 200,
            json: { data: DEFAULT_MINISTRIES, error: null },
          });
        }

        if (url.pathname.startsWith('/api/companies')) {
          return route.fulfill({
            status: 200,
            json: { data: DEFAULT_COMPANIES, error: null },
          });
        }

        if (url.pathname.startsWith('/api/employees')) {
          return route.fulfill({
            status: 200,
            json: { data: DEFAULT_EMPLOYEES, error: null },
          });
        }

        if (url.pathname.startsWith('/api/document-drafts/')) {
          const scope = decodeURIComponent(url.pathname.slice('/api/document-drafts/'.length));
          const method = req.method();
          const draftAccount = req.headers()['x-draft-account'] || api.currentAccount;

          api.draftRequestsLog.push({
            method,
            scope,
            draftAccount,
            timestamp: Date.now(),
          });

          if (method === 'GET') {
            api.getOrCreateDraft(scope, draftAccount);
          }

          if (method === 'PUT' && api.retiringPutHeld) {
            if (api.retiringPutEntryDeferred) {
              api.retiringPutEntryDeferred.resolve();
            }
            await api.retiringPutDeferred;
          }

          const postData = req.postData();
          const forwardHeaders = { ...req.headers() };
          // Authority cookie based on fixture account not draft header
          const authAccount = api.currentAccount;
          const token = makeSessionCookie(authAccount);
          forwardHeaders['cookie'] = `${fixtureConfig.cookieName}=${token}`;

          const forwardRes = await fetch(`http://127.0.0.1:${draftsPort}${url.pathname}`, {
            method,
            headers: forwardHeaders,
            body: ['POST', 'PUT', 'PATCH'].includes(method) ? postData : undefined,
          });
          const resText = await forwardRes.text();
          if (method === 'PUT' && forwardRes.status === 200) {
            try {
              const parsed = JSON.parse(resText);
              const postJson = req.postDataJSON() || {};
              api.recordDraftPut({
                scope,
                revision: postJson.revision,
                newRevision: parsed.data?.revision,
                values: postJson.values,
              });
            } catch (_) {}
            if (api.retiringPutSettledDeferred) {
              api.retiringPutSettledDeferred.resolve();
            }
          }
          return route.fulfill({
            status: forwardRes.status,
            headers: Object.fromEntries(forwardRes.headers.entries()),
            body: resText,
          });
        }

        if (url.pathname === '/api/files/upload') {
          if (req.method() === 'POST') {
            api.uploadCalls++;
            const uploadId = `upload-${crypto.randomUUID()}`;
            const upload = {
              upload_id: uploadId,
              file_name: 'test-upload.png',
              file_size: 1024,
              mime_type: 'image/png',
              original_name: 'test-upload.png',
            };
            api.recordUpload(upload);
            return route.fulfill({
              status: 200,
              json: { data: [upload], error: null },
            });
          }
        }

        if (url.pathname.startsWith('/api/files/uploads/')) {
          if (req.method() === 'DELETE') {
            return route.fulfill({
              status: 200,
              json: { data: { cleanupPending: false }, error: null },
            });
          }
          if (req.method() === 'POST' && url.pathname.endsWith('/validate')) {
            const match = url.pathname.match(/\/api\/files\/uploads\/([^/]+)\/validate/);
            const uploadId = match ? decodeURIComponent(match[1]) : `upload-${crypto.randomUUID()}`;
            return route.fulfill({
              status: 200,
              json: { data: { upload_id: uploadId }, error: null },
            });
          }
        }

        if (url.pathname === '/api/documents') {
          if (req.method() === 'POST') {
            api.documentCalls++;
            const payload = req.postDataJSON() || {};
            const doc = {
              id: `doc-${crypto.randomUUID()}`,
              ...payload,
            };
            api.recordDocument({ id: doc.id, payload });
            return route.fulfill({
              status: 200,
              json: { data: [doc], error: null },
            });
          }
        }

        if (url.pathname.startsWith('/api/documents/')) {
          if (req.method() === 'PATCH') {
            api.updateCalls++;
            const id = decodeURIComponent(url.pathname.slice('/api/documents/'.length));
            const payload = req.postDataJSON() || {};
            api.recordUpdate({ id, payload });
            return route.fulfill({
              status: 200,
              json: { data: { id, ...payload }, error: null },
            });
          }
        }

        if (url.pathname === '/api/document-extraction/status') {
          api.statusCalls++;
          return route.fulfill({
            status: api.statusHttpStatus,
            json: { data: api.statusHttpStatus === 200 ? api.extractionStatus : null, error: null },
          });
        }

        if (url.pathname === '/api/document-extraction') {
          if (req.method() === 'POST') {
            const rawBody = req.postData() || '';
            let payload;
            try {
              payload = JSON.parse(rawBody);
            } catch (err) {
              return route.fulfill({
                status: 400,
                json: { data: null, error: { code: 'bad_request', message: 'Invalid JSON payload' } },
              });
            }

            const parseReq = extractionRequestSchema.safeParse(payload);
            if (!parseReq.success) {
              return route.fulfill({
                status: 400,
                json: { data: null, error: { code: 'extraction_invalid_request', message: 'Invalid extraction schema' } },
              });
            }

            const captured = {
              id: payload.requestId,
              index: api.postCalls++,
              payload,
              route,
              settled: false,
              fulfillSuccess: async (fieldsOverride = {}) => {
                if (captured.settled) return;
                captured.settled = true;
                const responseData = {
                  requestId: payload.requestId,
                  context: payload.context,
                  settingsVersion: payload.settingsVersion,
                  catalogVersion: payload.catalogVersion,
                  pageCount: payload.pageCount,
                  fields: {
                    title: { value: 'Civil ID Card', state: 'clear', alternatives: [], reason: 'none' },
                    document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
                    document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
                    ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
                    issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
                    expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
                    ...fieldsOverride,
                  },
                };
                const parseRes = resultSchema.safeParse(responseData);
                assert.ok(parseRes.success, `Mock response conforms to resultSchema`);
                return await route.fulfill({
                  status: 200,
                  json: { data: responseData, error: null },
                });
              },
              fulfillRateLimit: async (retryAfterSeconds = 25) => {
                if (captured.settled) return;
                captured.settled = true;
                return await route.fulfill({
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
              fulfillError: async (status = 500, code = 'server_error', message = 'Server error') => {
                if (captured.settled) return;
                captured.settled = true;
                return await route.fulfill({
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
      ? `${origin}/scripts/fixtures/extraction-forms.html`
      : `${origin}/forms-fixture`;
    await page.goto(fixtureUrl);
    await page.waitForSelector('[data-testid="forms-mount-container"]', { timeout: 10000 });

    const testSummary = await runFormsTests(page, api, draftDb, draftsPort);

    assert.deepEqual(egressViolations, [], 'Forms suite must not attempt external egress');
    assert.deepEqual(pageErrors, [], 'Forms suite must not produce uncaught page errors');
    assert.deepEqual(unexpectedApiRequests, [], 'Forms suite must not call unexpected APIs');

    console.log('\n======================================================================');
    console.log('[FORMS SUITE SUMMARY]');
    console.log(`  Total Cases Executed:          ${testSummary.totalCount}`);
    console.log(`  Positive Controls Passing:     ${testSummary.passedCount}`);
    console.log(`  Observed RED (Pending T13/14): ${testSummary.observedRedCount}`);
    console.log(`  Unexpected Failures:           ${testSummary.unexpectedFailCount}`);
    console.log(`  Unreached Cases:               0`);
    console.log('======================================================================\n');

    // Runner exits nonzero if ANY case fails (observed RED or unexpected failure)
    if (testSummary.observedRedCount > 0 || testSummary.unexpectedFailCount > 0) {
      console.log(`[FORMS SUITE EXIT] Nonzero exit code (1) enforced: ${testSummary.observedRedCount} observed RED, ${testSummary.unexpectedFailCount} failures.\n`);
      process.exitCode = 1;
    } else {
      console.log('[FORMS SUITE EXIT] Zero exit code (0): all test cases passed.\n');
      process.exitCode = 0;
    }
  } finally {
    await api.settleAllHeld();
    if (browser) await browser.close();
    if (server) await server.close();
    if (draftsServer) await new Promise((res) => draftsServer.close(res));
    if (draftDb) draftDb.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/verify-extraction-forms.mjs')) {
  main().catch((err) => {
    console.error('[FORMS SUITE FATAL]', err);
    process.exit(1);
  });
}
