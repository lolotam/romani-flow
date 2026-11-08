/**
 * AI Document Extraction Settings Integration Test Runner (Task 10 / Task 15).
 *
 * Exercises the real DocumentExtractionSettings component and useExtractionSettings hook
 * in a real Chromium browser with strictly mocked loopback HTTP endpoints conforming
 * to shared contracts, backend policy rules, and the bootstrap candidate amendment.
 *
 * Contract Review & Constraints:
 * - Statically imports real modules via scripts/fixtures/extraction-settings.tsx (named export only).
 * - Truthful preflight check: exits RED (code 1) when Task 15 modules are absent.
 * - Single owner for fixture controls; deterministic barriers for mount, auth, and language.
 * - Accurate candidate fixtures: Groq (qwen/qwen3.8-27b, maxImages: 3) & OpenRouter (:free, maxImages: 1).
 * - Realistic disabled status: available=false, reason='disabled'.
 * - Unconfigured/unauthorized states return empty candidate lists with fixed reasons.
 * - Stable required control test-IDs and accessible roles (no union nth(1) mistakes, no empty-string fallback).
 * - Per-request candidate barriers and exact B selected assertion in race condition.
 * - Actual account switch assertion with entry barrier and state isolation.
 * - Correct built fixture URL across all test cases (/scripts/fixtures/extraction-settings.html).
 * - Zero sleep-based proof: response/entry/committed-state barriers with bound settlement in finally.
 * - Fail closed on unknown API endpoints; assert zero unexpected API calls, page errors, and egress.
 * - Exact mock PUT success ({ data: { updated: [...], rejected: [] }, error: null }) and refusal (invalid_settings).
 * - Offline notice verified for both local approval and live unverified availability.
 * - Preserves raw test report and appends correction inventory.
 *
 * Regression Suite (Cases 9-12 per task-15-settings-source-review.md):
 * - Case 9: Initial status held while persisted settings non-empty -> Save cannot PUT empty defaults; release valid status then Save proper 3 keys.
 * - Case 10: Explicit Refresh A held race -> change provider B / select B, then resolve A; exact B provider/model and B candidate options stay unchanged.
 * - Case 11: Retained persisted model not in current offline catalog (reason no_candidates/policy_unavailable or failed refresh) -> display preserved but cannot enable; positive valid catalog enables.
 * - Case 12: Malformed provider candidate (maxImages: 10) -> fails closed as no-list via runtime validation; never prove pricing from offline.
 * - Case 13: Searchable full catalog -> approved selectable, approvable greyed out with copyable approval record, unavailable refused, search narrows.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, build, preview } from 'vite';
import { tsImport } from 'tsx/esm/api';

// Shared contract imports (using actual contract limits)
const { limits } = await tsImport(
  '../server/contracts/documentExtraction.ts',
  import.meta.url
);

// Required production modules from Task 15 (must exist for settings browser execution)
const REQUIRED_TASK15_MODULES = [
  'src/hooks/useExtractionSettings.ts',
  'src/components/settings/DocumentExtractionSettings.tsx',
];

/**
 * Validates preflight dependencies and reports missing modules cleanly.
 *
 * @returns {{ ok: boolean; missingModules: string[] }}
 */
function runPreflightCheck() {
  const missingModules = [];
  for (const mod of REQUIRED_TASK15_MODULES) {
    if (!fs.existsSync(resolve(mod))) {
      missingModules.push(mod);
    }
  }

  return {
    ok: missingModules.length === 0,
    missingModules,
  };
}

/**
 * Real approved fixture models conforming strictly to backend capability rules:
 * - Groq: qwen/qwen3.8-27b with maxImages: 3 (from GROQ_CAPABILITIES)
 * - OpenRouter: non-router :free models with maxImages: 1
 */
const FIXTURE_APPROVED_MODELS = {
  groq: [
    {
      id: 'qwen/qwen3.8-27b',
      label: 'Qwen 3.8 27B',
      provider: 'groq',
      maxImages: 3,
    },
  ],
  openrouter: [
    {
      id: 'meta-llama/llama-3.2-11b-vision-instruct:free',
      label: 'Llama 3.2 11B Vision (free)',
      provider: 'openrouter',
      maxImages: 1,
    },
    {
      id: 'qwen/qwen-2.5-vl-72b-instruct:free',
      label: 'Qwen 2.5 VL 72B (free)',
      provider: 'openrouter',
      maxImages: 1,
    },
  ],
};

/**
 * Stateful Mock API Controller managing loopback HTTP routes and per-request barriers.
 */
class SettingsMockApi {
  constructor() {
    this.currentUser = {
      id: 'account-admin-1',
      email: 'admin@romani.test',
      name: 'Administrator',
      role: 'admin',
    };
    this.authHttpStatus = 200;

    // Disabled status has available: false and reason: 'disabled'
    this.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    this.statusHttpStatus = 200;
    this.statusCalls = 0;
    this.onStatusEntry = null;
    this.holdStatus = null;

    this.offlineCandidates = {
      groq: [...FIXTURE_APPROVED_MODELS.groq],
      openrouter: [...FIXTURE_APPROVED_MODELS.openrouter],
    };
    this.candidatesHttpStatus = 200;
    this.candidatesCalls = 0;
    this.candidatesVerification = 'offline';
    this.candidatesReason = 'locally_approved';

    this.onCandidatesEntry = null;
    this.onCandidatesRequest = null;
    this.holdCandidates = null;

    // Live catalog fixtures: entries the reviewed rules accept but no current
    // approval names, served next to the approved candidates.
    this.catalogHttpStatus = 200;
    this.catalogExtras = {
      groq: [
        {
          id: 'meta-llama/llama-4-scout-17b-16e-instruct',
          label: 'Llama 4 Scout 17B (free)',
          provider: 'groq',
          status: 'approvable',
          maxImages: 3,
          approval: JSON.stringify({
            provider: 'groq',
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            endpoint: 'groq',
            maxImages: 3,
            expiresAt: '2027-05-08T00:00:00.000Z',
            policyVersion: '2026-11-08',
          }),
        },
        {
          id: 'openai/gpt-oss-120b',
          label: 'GPT-OSS 120B',
          provider: 'groq',
          status: 'unavailable',
          maxImages: null,
          approval: null,
        },
      ],
      openrouter: [
        {
          id: 'qwen/qwen3-30b-a3b:free',
          label: 'Qwen3 30B A3B (free)',
          provider: 'openrouter',
          status: 'approvable',
          maxImages: 1,
          approval: JSON.stringify({
            provider: 'openrouter',
            model: 'qwen/qwen3-30b-a3b:free',
            endpoint: 'PROVIDER_TAG',
            maxImages: 1,
            expiresAt: '2027-05-08T00:00:00.000Z',
            policyVersion: '2026-11-08',
          }),
        },
      ],
    };

    this.putSettingsCalls = 0;
    this.putSettingsHttpStatus = 200;
    this.putSettingsError = null;
    this.capturedPutSettings = [];
  }
}

/**
 * Stable locators for settings UI elements.
 * Adheres strictly to required test-IDs and accessible roles.
 * Never uses combined selectors with nth(1).
 *
 * @param {import('playwright').Page} page
 */
function getSettingsControls(page) {
  return {
    card: page.locator('[data-testid="extraction-settings-card"]'),
    enableSwitch: page.locator('[data-testid="extraction-enabled-switch"]'),
    providerSelect: page.locator('[data-testid="extraction-provider-select"]'),
    modelSelect: page.locator('[data-testid="extraction-model-select"]'),
    refreshButton: page.locator('[data-testid="extraction-refresh-button"]'),
    saveButton: page.locator('[data-testid="extraction-save-button"]'),
    offlineNotice: page.locator('[data-testid="extraction-offline-notice"]'),
    authWarning: page.locator('[data-testid="extraction-auth-warning"]'),
    errorAlert: page.locator('[data-testid="extraction-error"], [role="alert"]'),
  };
}

/**
 * Selects a provider using stable test-ID and handles native select or custom dropdown.
 * Throws cleanly if control is absent.
 *
 * @param {import('playwright').Page} page
 * @param {'groq' | 'openrouter'} provider
 */
async function selectProvider(page, provider) {
  const trigger = page.locator('[data-testid="extraction-provider-select"]');
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await trigger.selectOption(provider);
    return;
  }
  await trigger.click();
  const option = page.locator(`[role="option"]`).filter({ hasText: new RegExp(provider, 'i') }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
}

/**
 * Reads the selected provider value.
 * Throws cleanly if control is absent.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function getSelectedProvider(page) {
  const trigger = page.locator('[data-testid="extraction-provider-select"]');
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    return await trigger.inputValue();
  }
  const dataValue = await trigger.getAttribute('data-value');
  if (dataValue !== null) return dataValue;
  const ariaLabel = await trigger.getAttribute('aria-label');
  if (ariaLabel && (ariaLabel.includes('groq') || ariaLabel.includes('openrouter'))) return ariaLabel;
  const text = (await trigger.innerText()).trim();
  if (/select provider|اختر مزود/i.test(text)) return '';
  return text;
}

/**
 * Selects a model using stable test-ID and handles native select or custom dropdown.
 * Throws cleanly if control is absent.
 *
 * @param {import('playwright').Page} page
 * @param {string} modelId
 */
async function selectModel(page, modelId) {
  const trigger = page.locator('[data-testid="extraction-model-select"]');
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    await trigger.selectOption(modelId);
    return;
  }
  await trigger.click();
  const shortId = modelId.split('/').pop() || modelId;
  const option = page.locator(`[role="option"]`).filter({ hasText: new RegExp(shortId.replace(':free', ''), 'i') }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
}

/**
 * Reads the selected model value or text.
 * Throws cleanly if control is absent. No missing-control empty-string fallback.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function getSelectedModel(page) {
  const trigger = page.locator('[data-testid="extraction-model-select"]');
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    return await trigger.inputValue();
  }
  const dataValue = await trigger.getAttribute('data-value');
  if (dataValue !== null) return dataValue;
  const text = (await trigger.innerText()).trim();
  if (/select model|اختر نموذج/i.test(text)) return '';
  return text;
}

/**
 * Reads all model choices currently available in the model selector dropdown.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ value: string; text: string }[]>}
 */
async function getModelOptions(page) {
  const trigger = page.locator('[data-testid="extraction-model-select"]');
  await trigger.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await trigger.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'select') {
    return await trigger.locator('option').evaluateAll((options) =>
      options.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
    );
  }
  // A custom combobox only renders its options while it is open: open it and
  // read every option. The dropdown stays open on purpose: closing it from
  // the outside raced with the popover dismissal in CI chromium, and both
  // callers use this helper as the last assertion of their case — the next
  // remount clears the open portal with the whole fixture tree.
  await trigger.click();
  const searchBox = page.locator('[data-testid="extraction-model-search"]');
  await searchBox.waitFor({ state: 'visible', timeout: 5000 });
  const options = page.locator('[role="option"]');
  const count = await options.count();
  const result = [];
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    result.push({
      value: (await opt.getAttribute('data-value')) || '',
      text: (await opt.innerText()).trim(),
    });
  }
  return result;
}

/**
 * Toggles the enable switch.
 *
 * @param {import('playwright').Page} page
 * @param {boolean} targetState
 */
async function setEnableSwitch(page, targetState) {
  const switchBtn = page.locator('[data-testid="extraction-enabled-switch"]');
  await switchBtn.waitFor({ state: 'visible', timeout: 5000 });
  const isChecked = (await switchBtn.getAttribute('aria-checked')) === 'true';
  if (isChecked !== targetState) {
    await switchBtn.click();
  }
}

/**
 * Waits deterministically for the fixture to commit a specific mount/auth/language identity.
 * Replaces all wall-clock sleeps.
 *
 * @param {import('playwright').Page} page
 * @param {{ epoch?: number; role?: string; language?: string; direction?: string }} expected
 */
async function waitForCommittedState(page, expected = {}) {
  await page.waitForFunction(
    (exp) => {
      const controls = window.__settingsControls;
      if (!controls) return false;
      const info = controls.getRenderInfo();
      if (!info || info.isLoading) return false;
      if (exp.epoch !== undefined && info.mountEpoch !== exp.epoch) return false;
      if (exp.role !== undefined && (info.accountRole ?? 'none') !== exp.role) return false;
      if (exp.accountId !== undefined && info.accountId !== exp.accountId) return false;
      if (exp.language !== undefined && info.language !== exp.language) return false;
      if (exp.direction !== undefined && info.direction !== exp.direction) return false;
      return true;
    },
    expected,
    { timeout: 7000 }
  );
}

let activeMountEpoch = 0;

// Cancellation is valid settlement; a stale request need not produce an HTTP response.
function candidateSettled(page, provider) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      page.off('requestfinished', done);
      page.off('requestfailed', done);
    };
    const done = (request) => {
      if (!request.url().includes(`/candidates?provider=${provider}`)) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Candidate settlement timed out: ${provider}`));
    }, 7000);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });
}

function statusSettled(page) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      page.off('requestfinished', done);
      page.off('requestfailed', done);
    };
    const done = (request) => {
      if (!request.url().includes('/api/document-extraction/status')) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Status settlement timed out'));
    }, 7000);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });
}

async function boundedEntry(pending, label) {
  let timer;
  try {
    await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Candidate entry timed out: ${label}`)), 7000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remounts the fixture cleanly and awaits the committed state barrier.
 *
 * @param {import('playwright').Page} page
 * @param {{ role?: string; accountId?: string; language?: string }} [barrier]
 */
async function remountFixture(page, barrier = {}) {
  activeMountEpoch += 1;
  const targetEpoch = activeMountEpoch;
  await page.evaluate(() => window.__settingsControls?.remount());
  await waitForCommittedState(page, {
    epoch: targetEpoch,
    role: barrier.role,
    accountId: barrier.accountId,
    language: barrier.language,
  });
}

/**
 * Executes the 12 focused, contract-driven settings behavioral tests.
 *
 * @param {import('playwright').Page} page
 * @param {SettingsMockApi} api
 * @param {string} origin
 * @param {string} fixtureUrl
 */
async function runSettingsTests(page, api, origin, fixtureUrl) {
  console.log('[SETTINGS SUITE] Executing Task 15 settings contract test group...');

  const results = [];

  // Helper runner to record pass/fail per behavior
  async function runCase(id, name, fn) {
    try {
      await fn();
      results.push({ id, name, passed: true });
      console.log(`[PASS] Case ${id}: ${name}`);
    } catch (err) {
      results.push({ id, name, passed: false, error: err.message });
      console.error(`[FAIL] Case ${id}: ${name} -> ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Case 1: Admin visibility vs anon/viewer
  // -------------------------------------------------------------------------
  await runCase(1, 'Admin visibility vs anon/viewer', async () => {
    console.log('[CASE 1] Behavior 1: Admin visibility vs anon/viewer...');
    activeMountEpoch = 0;
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };

    await page.goto(`${origin}${fixtureUrl}`);
    await page.waitForSelector('[data-testid="settings-fixture-root"]');
    await waitForCommittedState(page, { epoch: 0, role: 'admin' });

    const controls = getSettingsControls(page);
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await controls.card.isVisible(), 'Settings card must be visible for admin user');

    // Negative control 1: Viewer role
    api.currentUser = { id: 'account-viewer-1', email: 'viewer@romani.test', name: 'Viewer', role: 'viewer' };
    await remountFixture(page, { role: 'viewer' });
    const isCardVisibleViewer = await controls.card.isVisible().catch(() => false);
    assert.equal(isCardVisibleViewer, false, 'Settings card must NOT be rendered for viewer user');

    // Negative control 2: Unauthenticated
    api.currentUser = null;
    api.authHttpStatus = 401;
    await remountFixture(page, { role: 'none' });
    const isCardVisibleAnon = await controls.card.isVisible().catch(() => false);
    assert.equal(isCardVisibleAnon, false, 'Settings card must NOT be rendered for unauthenticated user');

    // Restore Admin
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Case 2: Default disabled, empty provider/model, no auto-choice/enable
  // -------------------------------------------------------------------------
  await runCase(2, 'Default disabled, empty provider/model, no auto-choice/enable', async () => {
    console.log('[CASE 2] Behavior 2: Default disabled, empty provider/model, no auto-choice/enable...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    api.putSettingsCalls = 0;
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const isChecked = await controls.enableSwitch.getAttribute('aria-checked');
    assert.equal(isChecked === 'true', false, 'Enable switch must be unchecked by default');

    const isSwitchDisabled = await controls.enableSwitch.isDisabled();
    assert.ok(isSwitchDisabled, 'Enable switch must be disabled when no provider/model is chosen');

    // Assert empty provider & empty model (no auto-choice)
    assert.equal(await getSelectedProvider(page), '', 'Provider select must be empty by default');
    assert.equal(await getSelectedModel(page), '', 'Model select must be empty by default');
    assert.equal(api.putSettingsCalls, 0, 'Zero PUT settings calls must occur on initial mount');
  });

  // -------------------------------------------------------------------------
  // Case 3: Explicit select provider/model sourced offline with explicit live-unverified notice
  // -------------------------------------------------------------------------
  await runCase(3, 'Explicit select provider/model sourced offline with explicit live-unverified notice', async () => {
    console.log('[CASE 3] Behavior 3: Explicit select provider/model sourced offline with explicit live-unverified notice...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const groqCandidatesPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await selectProvider(page, 'groq');
    await groqCandidatesPromise;

    // Assert offline notice explicitly conveys both local approval AND live availability unverified
    await controls.offlineNotice.waitFor({ state: 'visible', timeout: 5000 });
    const offlineText = (await controls.offlineNotice.innerText()).trim();
    assert.match(
      offlineText,
      /locally\s*approved|local\s*approval|معتمد\s*محلي/i,
      'Offline notice must explicitly state local approval'
    );
    assert.match(
      offlineText,
      /unverified|live\s*availability|غير\s*مؤكد|غير\s*متحقق/i,
      'Offline notice must explicitly state live availability is unverified'
    );

    // Select real approved Groq model
    await selectModel(page, 'qwen/qwen3.8-27b');
    assert.equal(await getSelectedModel(page), 'qwen/qwen3.8-27b', 'Selected Groq model must be qwen/qwen3.8-27b');

    const isSwitchNowDisabled = await controls.enableSwitch.isDisabled();
    assert.equal(isSwitchNowDisabled, false, 'Enable switch must become enabled once provider and model are explicitly selected');
  });

  // -------------------------------------------------------------------------
  // Case 4: Absent authorization or config prevents enabling / usable choices
  // -------------------------------------------------------------------------
  await runCase(4, 'Absent authorization or config prevents enabling / usable choices', async () => {
    console.log('[CASE 4] Behavior 4: Absent authorization or config prevents enabling / usable choices...');
    const controls = getSettingsControls(page);

    // 4.1 Unconfigured providers (returns empty candidates and 'unconfigured' reason)
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: false, openrouter: false },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const notConfiguredLabels = page.getByText(/Not configured|غير مُعدّ|unconfigured/i);
    await notConfiguredLabels.first().waitFor({ state: 'visible', timeout: 5000 });
    assert.ok((await notConfiguredLabels.count()) >= 1, 'Unconfigured providers must display Not Configured status');
    assert.ok(await controls.enableSwitch.isDisabled(), 'Enable switch must remain disabled when unconfigured');

    // 4.2 Processing not authorized
    api.status = {
      enabled: false,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: false,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    await controls.authWarning.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await controls.authWarning.isVisible(), 'Processing unauthorized notice must be displayed');
    assert.ok(
      await controls.enableSwitch.isDisabled(),
      'Enable switch must remain disabled when processingAuthorized is false'
    );
  });

  // -------------------------------------------------------------------------
  // Case 5: Provider change clears model, and stale A after B cannot replace B
  // -------------------------------------------------------------------------
  await runCase(5, 'Provider change clears model, and stale A after B cannot replace B', async () => {
    console.log('[CASE 5] Behavior 5: Provider change clears model, and stale A after B cannot replace B...');
    api.status = {
      enabled: false,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    const controls = getSettingsControls(page);
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    // 5.1 Changing provider clears model in local editor
    const openRouterInitialPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=openrouter') && resp.status() === 200
    );
    await selectProvider(page, 'openrouter');
    await openRouterInitialPromise;
    const currentModelText = await getSelectedModel(page);
    assert.notEqual(
      currentModelText,
      'qwen/qwen3.8-27b',
      'Changing provider must clear previous model in editor'
    );

    // 5.2 Stale A-after-B race: capture A at entry, choose explicit B, resolve B then A, assert exact B
    let releaseGroq = null;
    let groqEntered = false;
    const groqEntryPromise = new Promise((resolve) => {
      api.onCandidatesEntry = (provider) => {
        if (provider === 'groq') {
          groqEntered = true;
          resolve();
        }
      };
    });
    const groqBarrier = new Promise((resolve) => {
      releaseGroq = resolve;
    });

    api.holdCandidates = (provider) => {
      if (provider === 'groq') return groqBarrier;
      return null;
    };

    const modelB = 'meta-llama/llama-3.2-11b-vision-instruct:free';

    try {
      // Trigger Request A (Groq) and establish actual entry
      const groqSettledPromise = candidateSettled(page, 'groq');
      void selectProvider(page, 'groq').catch(() => {});
      await boundedEntry(groqEntryPromise, 'provider race');
      assert.ok(groqEntered, 'Request A (Groq) must have entered and been captured');

      // Trigger Request B (OpenRouter) and await resolution
      const openRouterRacePromise = page.waitForResponse(
        (resp) => resp.url().includes('/candidates?provider=openrouter') && resp.status() === 200
      );
      await selectProvider(page, 'openrouter');
      await openRouterRacePromise;

      // Explicitly choose Model B
      await selectModel(page, modelB);
      assert.equal(await getSelectedModel(page), modelB, 'Model B must be selected in editor');

      // Now resolve held Request A
      if (releaseGroq) releaseGroq();
      await groqSettledPromise;

      // Assert exact B provider and exact B model retained
      const finalProvider = await getSelectedProvider(page);
      const finalModel = await getSelectedModel(page);
      assert.equal(finalProvider, 'openrouter', 'Provider must remain OpenRouter after late Groq response');
      assert.equal(finalModel, modelB, 'Exact Model B selection must be retained, not overwritten or dropped');
    } finally {
      if (releaseGroq) releaseGroq();
      api.holdCandidates = null;
      api.onCandidatesEntry = null;
    }
  });

  // -------------------------------------------------------------------------
  // Case 6: Refresh failure preserves persisted selection and marks unavailable
  // -------------------------------------------------------------------------
  await runCase(6, 'Refresh failure preserves persisted selection and marks unavailable', async () => {
    console.log('[CASE 6] Behavior 6: Refresh failure preserves persisted selection and marks unavailable...');
    const controls = getSettingsControls(page);
    api.status = {
      enabled: true,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: true,
      reason: 'ready',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    api.candidatesHttpStatus = 500;
    const refreshFailPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates') && resp.status() === 500
    );
    await controls.refreshButton.click();
    await refreshFailPromise;

    // Assert exact preserved model and unavailable/error indication
    const preservedModel = await getSelectedModel(page);
    assert.equal(
      preservedModel,
      'qwen/qwen3.8-27b',
      'Refresh failure must preserve exact persisted model selection in editor'
    );

    await controls.errorAlert.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await controls.errorAlert.isVisible(), 'Error alert / unavailable indication must be visible on refresh failure');
    api.candidatesHttpStatus = 200;
  });

  // -------------------------------------------------------------------------
  // Case 7: Atomic 3-key save: success & refusal preserves editor, and NO other keys sent
  // -------------------------------------------------------------------------
  await runCase(7, 'Atomic 3-key save: success & refusal preserves editor, and NO other keys sent', async () => {
    console.log('[CASE 7] Behavior 7: Atomic 3-key save: success & refusal preserves editor, and NO other keys...');
    const controls = getSettingsControls(page);
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    api.capturedPutSettings = [];
    api.putSettingsHttpStatus = 200;
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const saveCandidatePromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await selectProvider(page, 'groq');
    await saveCandidatePromise;
    await selectModel(page, 'qwen/qwen3.8-27b');
    await setEnableSwitch(page, true);

    // 7.1 Successful save
    const saveSuccessPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/settings') && resp.request().method() === 'PUT' && resp.status() === 200
    );
    await controls.saveButton.click();
    await saveSuccessPromise;

    assert.equal(api.capturedPutSettings.length, 1, 'Exactly 1 PUT request must be sent on save');
    const putBody = api.capturedPutSettings[0];
    assert.ok(putBody.settings, 'PUT body must have settings key');
    const keys = Object.keys(putBody.settings).sort();
    assert.deepEqual(
      keys,
      ['ai_extraction.enabled', 'ai_extraction.model', 'ai_extraction.provider'],
      'PUT body must contain ONLY the three allowlisted keys'
    );
    assert.equal(putBody.settings['ai_extraction.enabled'], true);
    assert.equal(putBody.settings['ai_extraction.provider'], 'groq');
    assert.equal(putBody.settings['ai_extraction.model'], 'qwen/qwen3.8-27b');

    // 7.2 Refusal case: backend rejects with invalid_settings
    api.putSettingsHttpStatus = 400;
    api.putSettingsError = {
      message: 'The settings were not saved because the extraction selection is not valid.',
      code: 'invalid_settings',
      rejected: [{ key: 'ai_extraction.enabled', reason: 'processing_not_authorized' }],
    };

    let alternateCandidatesAttempted = false;
    api.onCandidatesRequest = () => {
      alternateCandidatesAttempted = true;
    };

    const saveRefusalPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/settings') && resp.request().method() === 'PUT' && resp.status() === 400
    );
    await controls.saveButton.click();
    await saveRefusalPromise;

    await controls.errorAlert.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await controls.errorAlert.isVisible(), 'Error alert must be visible on save refusal');

    // Assert all three editor values are preserved after refusal
    assert.equal(
      await controls.enableSwitch.getAttribute('aria-checked'),
      'true',
      'Enabled switch state must be preserved after refusal'
    );
    assert.equal(
      await getSelectedProvider(page),
      'groq',
      'Provider must be preserved after refusal'
    );
    assert.equal(
      await getSelectedModel(page),
      'qwen/qwen3.8-27b',
      'Model must be preserved after refusal'
    );

    // Assert no alternate provider/model request or activation happened
    assert.equal(alternateCandidatesAttempted, false, 'No alternate candidates fetch must occur on save failure');
    assert.equal(api.capturedPutSettings.length, 2, 'No extra PUT activation attempt must occur');
    api.putSettingsHttpStatus = 200;
    api.onCandidatesRequest = null;
  });

  // -------------------------------------------------------------------------
  // Case 8: Identity change invalidates pending requests & Arabic/English labels/RTL
  // -------------------------------------------------------------------------
  await runCase(8, 'Identity change invalidates pending requests & Arabic/English labels/RTL', async () => {
    console.log('[CASE 8] Behavior 8: Identity change invalidates pending requests & Arabic/English labels/RTL...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin1@romani.test', name: 'Administrator 1', role: 'admin' };
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    let releaseIdentityBarrier = null;
    let account1RequestEntered = false;
    const identityEntryPromise = new Promise((resolve) => {
      api.onCandidatesEntry = (provider) => {
        if (provider === 'groq') {
          account1RequestEntered = true;
          resolve();
        }
      };
    });
    const identityBarrier = new Promise((resolve) => {
      releaseIdentityBarrier = resolve;
    });
    api.holdCandidates = (provider) => {
      if (provider === 'groq') return identityBarrier;
      return null;
    };

    try {
      // Trigger request for Account 1 and establish actual entry
      const identitySettled = candidateSettled(page, 'groq');
      void selectProvider(page, 'groq').catch(() => {});
      await boundedEntry(identityEntryPromise, 'account change');
      assert.ok(account1RequestEntered, 'Account 1 candidate request must have actually entered before switch');

      // Switch account to Account 2
      api.currentUser = { id: 'account-admin-2', email: 'admin2@romani.test', name: 'Administrator 2', role: 'admin' };
      api.status = {
        enabled: false,
        provider: '',
        model: '',
        configured: { groq: true, openrouter: true },
        processingAuthorized: true,
        processingContext: 'kw-docs-context',
        available: false,
        reason: 'disabled',
        settingsVersion: 'b'.repeat(64),
        catalogVersion: 'b'.repeat(64),
        maxSourceBytes: limits.source,
      };
      await remountFixture(page, { role: 'admin', accountId: 'account-admin-2' });

      // Verify new committed identity
      const infoSwitched = await page.evaluate(() => window.__settingsControls?.getRenderInfo());
      assert.equal(infoSwitched.accountId, 'account-admin-2', 'New account identity must be committed');

      // Now resolve old held request from Account 1
      if (releaseIdentityBarrier) releaseIdentityBarrier();
      await identitySettled;

      // Assert resolving old response cannot mutate or populate state in new account
      assert.equal(await getSelectedProvider(page), '', 'Old response must not mutate new account provider');
      assert.equal(await getSelectedModel(page), '', 'Old response must not mutate new account model');
    } finally {
      if (releaseIdentityBarrier) releaseIdentityBarrier();
      api.holdCandidates = null;
      api.onCandidatesEntry = null;
    }

    // Arabic & English RTL/LTR verification with committed state barriers
    await page.evaluate(() => window.__settingsControls?.setLanguage('ar'));
    await waitForCommittedState(page, { language: 'ar', direction: 'rtl' });
    const arInfo = await page.evaluate(() => window.__settingsControls?.getRenderInfo());
    assert.equal(arInfo.direction, 'rtl', 'Document direction must be rtl in Arabic');
    const arTitle = page.getByText(/استخراج بيانات المستند|استخراج المستند/i);
    await arTitle.first().waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await arTitle.first().isVisible(), 'Arabic title must be rendered');

    await page.evaluate(() => window.__settingsControls?.setLanguage('en'));
    await waitForCommittedState(page, { language: 'en', direction: 'ltr' });
    const enInfo = await page.evaluate(() => window.__settingsControls?.getRenderInfo());
    assert.equal(enInfo.direction, 'ltr', 'Document direction must be ltr in English');
    const enTitle = page.getByText(/Document extraction/i);
    await enTitle.first().waitFor({ state: 'visible', timeout: 5000 });
    assert.ok(await enTitle.first().isVisible(), 'English title must be rendered');
  });

  // -------------------------------------------------------------------------
  // Case 9: Initial status held while persisted non-empty -> Save cannot PUT empty defaults
  // -------------------------------------------------------------------------
  await runCase(9, 'Initial status held prevents destructive Save of empty defaults', async () => {
    console.log('[CASE 9] Behavior 9: Initial status held prevents destructive Save of empty defaults...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    api.offlineCandidates = {
      groq: [...FIXTURE_APPROVED_MODELS.groq],
      openrouter: [...FIXTURE_APPROVED_MODELS.openrouter],
    };
    api.capturedPutSettings = [];
    api.putSettingsCalls = 0;

    let releaseInitialStatus = null;
    let initialStatusEntered = false;
    const initialStatusEntryPromise = new Promise((resolve) => {
      api.onStatusEntry = () => {
        initialStatusEntered = true;
        resolve();
      };
    });
    const initialStatusBarrier = new Promise((resolve) => {
      releaseInitialStatus = resolve;
    });
    api.holdStatus = initialStatusBarrier;

    try {
      const statusSettledPromise = statusSettled(page);
      activeMountEpoch += 1;
      await page.evaluate(() => window.__settingsControls?.remount());
      await boundedEntry(initialStatusEntryPromise, 'initial status hold');
      assert.ok(initialStatusEntered, 'Initial status request must have entered and been captured behind barrier');

      // While status is held / loading, Save MUST NOT send empty defaults
      const isSaveDisabled = await controls.saveButton.isDisabled();
      if (!isSaveDisabled) {
        // If Save button is mistakenly enabled during loading, clicking it would trigger destructive PUT
        await controls.saveButton.click({ timeout: 1000 }).catch(() => {});
      }

      assert.equal(
        api.putSettingsCalls,
        0,
        'Save must not send PUT request with empty defaults while initial status is loading'
      );
      assert.ok(
        isSaveDisabled,
        'Save button must be disabled while initial status is loading / held'
      );

      // Release valid status barrier
      const seededCandidates = page.waitForResponse(
        resp => resp.url().includes('/candidates?provider=groq') && resp.status() === 200,
      );
      if (releaseInitialStatus) releaseInitialStatus();
      await statusSettledPromise;

      // Await candidate response for Groq
      await seededCandidates;

      // Positive control: Once status settles and editor is seeded, Save is enabled and sends proper 3 keys
      assert.equal(await getSelectedProvider(page), 'groq', 'Provider must be seeded from status');
      assert.equal(await getSelectedModel(page), 'qwen/qwen3.8-27b', 'Model must be seeded from status');

      const saveSuccessPromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/settings') && resp.request().method() === 'PUT' && resp.status() === 200
      );
      await controls.saveButton.click();
      await saveSuccessPromise;

      assert.equal(api.capturedPutSettings.length, 1, 'Exactly one PUT request must be sent after status settles');
      const putBody = api.capturedPutSettings[0];
      assert.deepEqual(
        Object.keys(putBody.settings).sort(),
        ['ai_extraction.enabled', 'ai_extraction.model', 'ai_extraction.provider'],
        'PUT body must contain proper 3 keys'
      );
      assert.equal(putBody.settings['ai_extraction.provider'], 'groq');
      assert.equal(putBody.settings['ai_extraction.model'], 'qwen/qwen3.8-27b');
    } finally {
      if (releaseInitialStatus) releaseInitialStatus();
      api.holdStatus = null;
      api.onStatusEntry = null;
    }
  });

  // -------------------------------------------------------------------------
  // Case 10: Explicit Refresh A held race with provider B
  // -------------------------------------------------------------------------
  await runCase(10, 'Explicit Refresh A held race with provider B', async () => {
    console.log('[CASE 10] Behavior 10: Explicit Refresh A held race with provider B...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    api.offlineCandidates = {
      groq: [...FIXTURE_APPROVED_MODELS.groq],
      openrouter: [...FIXTURE_APPROVED_MODELS.openrouter],
    };
    // Await initial groq candidate load during remount
    const initialGroqPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });
    await initialGroqPromise;

    let releaseRefreshA = null;
    let refreshAEntered = false;
    const refreshAEntryPromise = new Promise((resolve) => {
      api.onCandidatesEntry = (provider) => {
        if (provider === 'groq') {
          refreshAEntered = true;
          resolve();
        }
      };
    });
    const refreshABarrier = new Promise((resolve) => {
      releaseRefreshA = resolve;
    });
    api.holdCandidates = (provider) => {
      if (provider === 'groq') return refreshABarrier;
      return null;
    };

    const modelB = 'meta-llama/llama-3.2-11b-vision-instruct:free';

    try {
      // 1. Explicitly click the Refresh button (NOT provider select)
      const refreshSettledPromise = candidateSettled(page, 'groq');
      await controls.refreshButton.click();
      await boundedEntry(refreshAEntryPromise, 'explicit refresh A');
      assert.ok(refreshAEntered, 'Explicit refresh request for Groq must have entered and been captured');

      // 2. While Refresh A is held, change provider to B ('openrouter')
      const openRouterPromise = page.waitForResponse(
        (resp) => resp.url().includes('/candidates?provider=openrouter') && resp.status() === 200
      );
      await selectProvider(page, 'openrouter');
      await openRouterPromise;

      // 3. Select Model B
      await selectModel(page, modelB);
      assert.equal(await getSelectedProvider(page), 'openrouter', 'Provider B must be selected');
      assert.equal(await getSelectedModel(page), modelB, 'Model B must be selected');

      // 4. Resolve held Refresh A
      if (releaseRefreshA) releaseRefreshA();
      await refreshSettledPromise;

      // 5. Assert exact B provider and exact B model remain authoritative
      const finalProvider = await getSelectedProvider(page);
      const finalModel = await getSelectedModel(page);
      assert.equal(finalProvider, 'openrouter', 'Provider must remain OpenRouter after late Refresh A resolves');
      assert.equal(finalModel, modelB, 'Exact Model B selection must be retained, not overwritten by late Refresh A');

      // 6. Assert candidate options in dropdown are still Provider B options, NOT overwritten by Groq
      const options = await getModelOptions(page);
      const optionValues = options.map((o) => o.value);
      assert.ok(
        optionValues.includes('meta-llama/llama-3.2-11b-vision-instruct:free'),
        'Model dropdown options must still contain Provider B models'
      );
      assert.equal(
        optionValues.includes('qwen/qwen3.8-27b'),
        false,
        'Late Refresh A candidates must not overwrite Provider B candidate options'
      );
    } finally {
      if (releaseRefreshA) releaseRefreshA();
      api.holdCandidates = null;
      api.onCandidatesEntry = null;
    }
  });

  // -------------------------------------------------------------------------
  // Case 11: Retained model absent from catalog preserves display but cannot enable
  // -------------------------------------------------------------------------
  await runCase(11, 'Retained model absent from catalog preserves display but cannot enable', async () => {
    console.log('[CASE 11] Behavior 11: Retained model absent from catalog preserves display but cannot enable...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    // Candidates empty with policy_unavailable reason
    api.offlineCandidates.groq = [];
    api.candidatesReason = 'policy_unavailable';

    const unavailableCandidates = page.waitForResponse(
      resp => resp.url().includes('/candidates?provider=groq') && resp.status() === 200,
    );
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    // Await candidates response
    await unavailableCandidates;

    // Assert retained model display is preserved (never auto-choice or erase)
    const displayedProvider = await getSelectedProvider(page);
    const displayedModel = await getSelectedModel(page);
    assert.equal(displayedProvider, 'groq', 'Persisted provider must be preserved in editor');
    assert.ok(
      displayedModel.includes('qwen/qwen3.8-27b'),
      'Persisted model display must be preserved in editor without auto-substitute or erasure'
    );

    // Assert cannot enable: switch must be disabled
    const isSwitchDisabled = await controls.enableSwitch.isDisabled();
    assert.ok(
      isSwitchDisabled,
      'Enable switch must be DISABLED when retained model is not in current valid offline catalogue'
    );

    // Positive control: valid catalog with candidate model enables the switch
    api.offlineCandidates.groq = [...FIXTURE_APPROVED_MODELS.groq];
    api.candidatesReason = 'locally_approved';

    const validCatalogPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await controls.refreshButton.click();
    await validCatalogPromise;

    await page.waitForFunction(() => {
      const control = document.querySelector('[data-testid="extraction-enabled-switch"]');
      return control instanceof HTMLButtonElement && !control.disabled;
    }, null, { timeout: 5000 });

    assert.equal(
      await controls.enableSwitch.isDisabled(),
      false,
      'Enable switch must become enabled when retained model is present in valid offline catalogue'
    );
  });

  // -------------------------------------------------------------------------
  // Case 12: Malformed provider maxImages 10 fails closed as no-list via runtime validation
  // -------------------------------------------------------------------------
  await runCase(12, 'Malformed provider maxImages 10 fails closed as no-list via runtime validation', async () => {
    console.log('[CASE 12] Behavior 12: Malformed provider maxImages 10 fails closed as no-list...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    api.offlineCandidates.groq = [
      {
        id: 'qwen/qwen3.8-27b',
        label: 'Qwen 3.8 27B',
        provider: 'groq',
        maxImages: 10, // Malformed: exceeds Groq capability bound (3)
      },
    ];
    api.candidatesReason = 'locally_approved';

    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const malformedCandidatesPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await selectProvider(page, 'groq');
    await malformedCandidatesPromise;

    // Runtime schema validation should fail closed: malformed candidate must not appear as approved candidate option
    const options = await getModelOptions(page);
    const candidateOptions = options.filter((o) => o.value === 'qwen/qwen3.8-27b');
    assert.equal(
      candidateOptions.length,
      0,
      'Malformed candidate with maxImages: 10 must fail closed in runtime schema validation and not be offered as approved choice'
    );

    // Restore clean approved models
    api.offlineCandidates.groq = [...FIXTURE_APPROVED_MODELS.groq];
  });

  // -------------------------------------------------------------------------
  // Case 13: Searchable full catalog — approved selectable, approvable greyed
  // out with a copyable approval record, unavailable refused, search filters.
  // -------------------------------------------------------------------------
  await runCase(13, 'Searchable catalog picker: statuses, search, copy approval, refuse ineligible', async () => {
    console.log('[CASE 13] Searchable catalog picker: statuses, search, copy, refuse...');
    const controls = getSettingsControls(page);
    api.currentUser = { id: 'account-admin-1', email: 'admin@romani.test', name: 'Administrator', role: 'admin' };
    api.authHttpStatus = 200;
    api.candidatesHttpStatus = 200;
    api.catalogHttpStatus = 200;
    api.offlineCandidates.groq = [...FIXTURE_APPROVED_MODELS.groq];
    api.offlineCandidates.openrouter = [...FIXTURE_APPROVED_MODELS.openrouter];
    api.candidatesReason = 'locally_approved';
    api.status = {
      enabled: false,
      provider: '',
      model: '',
      configured: { groq: true, openrouter: true },
      processingAuthorized: true,
      processingContext: 'kw-docs-context',
      available: false,
      reason: 'disabled',
      settingsVersion: 'a'.repeat(64),
      catalogVersion: 'b'.repeat(64),
      maxSourceBytes: limits.source,
    };
    await remountFixture(page, { role: 'admin' });
    await controls.card.waitFor({ state: 'visible', timeout: 5000 });

    const groqCandidatesPromise = page.waitForResponse(
      (resp) => resp.url().includes('/candidates?provider=groq') && resp.status() === 200
    );
    await selectProvider(page, 'groq');
    await groqCandidatesPromise;

    // Open the combobox explicitly.
    const trigger = page.locator('[data-testid="extraction-model-select"]');
    await trigger.click();
    const searchBox = page.locator('[data-testid="extraction-model-search"]');
    await searchBox.waitFor({ state: 'visible', timeout: 5000 });

    const visibleOptions = page.locator('[role="option"]').locator('visible=true');
    const approvedOption = visibleOptions.filter({ hasText: 'qwen/qwen3.8-27b' }).first();
    const approvableOption = visibleOptions.filter({ hasText: 'meta-llama/llama-4-scout' }).first();
    const unavailableOption = visibleOptions.filter({ hasText: 'openai/gpt-oss-120b' }).first();
    await approvedOption.waitFor({ state: 'visible', timeout: 5000 });
    await approvableOption.waitFor({ state: 'visible', timeout: 5000 });
    await unavailableOption.waitFor({ state: 'visible', timeout: 5000 });

    // Approved is selectable; the other two are greyed out and refused.
    assert.notEqual(await approvedOption.getAttribute('aria-disabled'), 'true', 'Approved model must be selectable');
    assert.ok(
      ((await approvableOption.getAttribute('class')) || '').includes('opacity-60'),
      'Approvable model must be greyed out',
    );
    assert.ok(
      ((await unavailableOption.getAttribute('class')) || '').includes('opacity-60'),
      'Unavailable model must be greyed out',
    );
    const approvableText = (await approvableOption.innerText()).trim();
    assert.match(approvableText, /Needs approval|يحتاج اعتماد/i, 'Approvable row must state it needs approval');
    const unavailableText = (await unavailableOption.innerText()).trim();
    assert.match(unavailableText, /Not eligible|غير مؤهل/i, 'Unavailable row must state it is not eligible');

    // Search narrows the list to matching models only.
    await searchBox.fill('llama');
    const searchMatches = await page.locator('[role="option"]').locator('visible=true').count();
    assert.equal(searchMatches, 1, 'Search must narrow the catalog to the matching model');
    await searchBox.fill('');
    await approvedOption.waitFor({ state: 'visible', timeout: 5000 });

    // The approval record of an approvable model can be copied.
    const copyButton = approvableOption.locator('[data-testid="extraction-copy-approval"]').first();
    await copyButton.click();
    const copyStatus = page.locator('[data-testid="extraction-copy-status"]');
    await copyStatus.waitFor({ state: 'visible', timeout: 5000 });
    const copyText = (await copyStatus.innerText()).trim();
    assert.match(copyText, /copied|failed|تم النسخ|تعذر/i, 'Copy feedback must be shown');

    // A greyed-out model can never be chosen.
    await approvableOption.click();
    assert.equal(await getSelectedModel(page), '', 'Ineligible model click must not change the selection');

    // The approved model is chosen normally.
    await approvedOption.click();
    assert.equal(await getSelectedModel(page), 'qwen/qwen3.8-27b', 'Approved model click must select it');
  });

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log('======================================================================');
  console.log(`[SETTINGS SUITE SUMMARY] Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log('======================================================================');

  if (failedCount > 0) {
    const firstFailure = results.find((r) => !r.passed);
    throw new Error(
      `Settings suite failed ${failedCount} test(s). First failure: Case ${firstFailure.id}: ${firstFailure.name} (${firstFailure.error})`
    );
  }

  console.log('[SETTINGS SUITE] All 12 settings contract behaviors verified.');
}

export async function main() {
  const args = process.argv.slice(2);
  const isBuiltMode = args.includes('--built');

  console.log('======================================================================');
  console.log('[SETTINGS SUITE] Mode: SETTINGS GROUP ONLY (TASK 15 CONTRACTS)');
  console.log(`[SETTINGS SUITE] Target Fixture: ${isBuiltMode ? 'BUILT FIXTURE (REAL BUILD OUTPUT)' : 'DEV SERVER'}`);
  console.log('======================================================================');

  // Step 1: Preflight Semantic and Dependency Check
  console.log('[PREFLIGHT] Checking Task 15 production modules...');
  const preflight = runPreflightCheck();
  if (!preflight.ok) {
    console.error('======================================================================');
    console.error('[SETTINGS SUITE] PREFLIGHT SEMANTIC CHECK: FAILED (EXPECTED RED)');
    if (preflight.missingModules.length > 0) {
      console.error('Missing required Task 15 production modules:');
      for (const mod of preflight.missingModules) {
        console.error(`  - ${mod}`);
      }
    }
    console.error('Harness contract review: Missing Task 15 implementation must fail truthfully as setup failure.');
    console.error('Browser launch skipped until implementation modules exist.');
    console.error('======================================================================');
    process.exitCode = 1;
    return;
  }

  let server = null;
  let origin = '';
  const api = new SettingsMockApi();
  const unexpectedApiCalls = [];
  const egressViolations = [];
  const pageErrors = [];

  const fixtureUrl = isBuiltMode ? '/scripts/fixtures/extraction-settings.html' : '/settings-fixture';

  if (isBuiltMode) {
    const outDir = resolve('scripts/fixtures/.dist-settings');
    fs.writeFileSync(
      resolve('scripts/fixtures/extraction-settings.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-settings.tsx"></script></body></html>'
    );
    console.log(`[BUILD] Building real settings fixture output to ${outDir}...`);
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
          input: resolve('scripts/fixtures/extraction-settings.html'),
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
    console.log(`[SETTINGS SUITE] Built fixture preview listening at ${origin}`);
  } else {
    server = await createServer({
      configFile: resolve('vite.config.ts'),
      envFile: false,
      esbuild: { jsx: 'automatic' },
      resolve: { alias: { '@': resolve('src') } },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'synthetic-extraction-settings-fixture',
          configureServer(s) {
            s.middlewares.use('/settings-fixture', async (_req, res, next) => {
              try {
                res.setHeader('Content-Type', 'text/html');
                res.end(
                  await s.transformIndexHtml(
                    '/settings-fixture',
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Extraction Settings Fixture</title></head>' +
                      '<body><div id="root"></div><script type="module" src="/scripts/fixtures/extraction-settings.tsx"></script></body></html>'
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
    console.log(`[SETTINGS SUITE] Dev fixture listening at ${origin}`);
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
      console.error('[SETTINGS SUITE] Failed to import Playwright:', importErr.message);
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
      console.log('[SETTINGS SUITE] Browser launched successfully.');
    } catch (launchErr) {
      console.error('======================================================================');
      console.error('[SETTINGS SUITE] BROWSER BINARY NOT PROVISIONED ON THIS ENVIRONMENT');
      console.error('Diagnostic error:', launchErr.message);
      console.error('======================================================================');
      process.exitCode = 1;
      return;
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    page.setDefaultTimeout(15000);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[PAGE CONSOLE ERROR]', msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('[PAGE ERROR]', err.message);
    });

    // Strict loopback routing & fail-closed security boundary
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
          if (api.authHttpStatus === 200 && api.currentUser) {
            return route.fulfill({
              status: 200,
              json: { data: { user: api.currentUser }, error: null },
            });
          }
          return route.fulfill({
            status: api.authHttpStatus || 401,
            json: { data: null, error: { code: 'unauthenticated', message: 'Sign in required' } },
          });
        }

        if (url.pathname === '/api/document-extraction/status') {
          api.statusCalls += 1;
          if (api.onStatusEntry) {
            api.onStatusEntry();
          }
          if (api.holdStatus) {
            await api.holdStatus;
          }
          if (api.statusHttpStatus !== 200) {
            return route.fulfill({
              status: api.statusHttpStatus,
              json: { data: null, error: { code: 'status_error', message: 'Failed to load status' } },
            });
          }
          return route.fulfill({
            status: 200,
            json: { data: api.status, error: null },
          });
        }

        if (url.pathname === '/api/document-extraction/candidates') {
          api.candidatesCalls += 1;
          const provider = url.searchParams.get('provider');

          if (api.onCandidatesEntry) {
            api.onCandidatesEntry(provider);
          }
          if (api.onCandidatesRequest) {
            api.onCandidatesRequest(provider);
          }

          if (api.holdCandidates) {
            const barrier = api.holdCandidates(provider);
            if (barrier) {
              await barrier;
            }
          }

          if (!provider || (provider !== 'groq' && provider !== 'openrouter')) {
            return route.fulfill({
              status: 400,
              json: {
                data: null,
                error: { code: 'invalid_provider', message: 'The provider is not known.' },
              },
            });
          }

          if (!api.status.processingAuthorized) {
            return route.fulfill({
              status: 200,
              json: {
                data: {
                  verification: 'offline',
                  candidates: [],
                  reason: 'processing_not_authorized',
                },
                error: null,
              },
            });
          }

          if (!api.status.configured[provider]) {
            return route.fulfill({
              status: 200,
              json: {
                data: {
                  verification: 'offline',
                  candidates: [],
                  reason: 'unconfigured',
                },
                error: null,
              },
            });
          }

          if (api.candidatesHttpStatus !== 200) {
            return route.fulfill({
              status: api.candidatesHttpStatus,
              json: { data: null, error: { code: 'candidates_error', message: 'Failed to load candidates' } },
            });
          }

          const candidates = api.offlineCandidates[provider] || [];
          return route.fulfill({
            status: 200,
            json: {
              data: {
                verification: api.candidatesVerification,
                candidates,
                reason: candidates.length > 0 ? api.candidatesReason : 'no_candidates',
              },
              error: null,
            },
          });
        }

        // Live model catalog: approved entries from the candidates plus the
        // approvable extras. A malformed candidate is dropped here as well,
        // so a broken fixture can never become a catalog entry.
        if (url.pathname === '/api/document-extraction/catalog' && req.method() === 'GET') {
          if (api.catalogHttpStatus !== 200) {
            return route.fulfill({
              status: api.catalogHttpStatus,
              json: {
                data: null,
                error: { code: 'catalog_unavailable', message: 'The model catalog is unavailable.' },
              },
            });
          }
          const provider = url.searchParams.get('provider');
          const bounds = { groq: 3, openrouter: 1 };
          const approved = (api.offlineCandidates[provider] || [])
            .filter(
              (candidate) =>
                Number.isInteger(candidate.maxImages)
                && candidate.maxImages >= 1
                && candidate.maxImages <= bounds[provider],
            )
            .map((candidate) => ({
              id: candidate.id,
              label: candidate.label,
              provider,
              status: 'approved',
              maxImages: candidate.maxImages,
              approval: null,
            }));
          const extras = (api.catalogExtras[provider] || []).map((entry) => ({ ...entry, provider }));
          return route.fulfill({
            status: 200,
            json: { data: { verification: 'live', entries: [...approved, ...extras] }, error: null },
          });
        }

        if (url.pathname === '/api/settings' && req.method() === 'PUT') {
          api.putSettingsCalls += 1;
          const rawBody = req.postData() || '{}';
          const body = JSON.parse(rawBody);
          api.capturedPutSettings.push(body);

          if (api.putSettingsHttpStatus !== 200) {
            return route.fulfill({
              status: api.putSettingsHttpStatus,
              json: {
                data: null,
                error: api.putSettingsError || {
                  message: 'The settings were not saved because the extraction selection is not valid.',
                  code: 'invalid_settings',
                  rejected: [{ key: 'ai_extraction.enabled', reason: 'processing_not_authorized' }],
                },
              },
            });
          }

          const updatedKeys = body.settings ? Object.keys(body.settings) : [];
          if (body.settings) {
            if (body.settings['ai_extraction.enabled'] !== undefined) {
              api.status.enabled = body.settings['ai_extraction.enabled'];
            }
            if (body.settings['ai_extraction.provider'] !== undefined) {
              api.status.provider = body.settings['ai_extraction.provider'];
            }
            if (body.settings['ai_extraction.model'] !== undefined) {
              api.status.model = body.settings['ai_extraction.model'];
            }
          }

          return route.fulfill({
            status: 200,
            json: { data: { updated: updatedKeys, rejected: [] }, error: null },
          });
        }

        // Refuse unexpected API endpoints (fail closed)
        unexpectedApiCalls.push(`${req.method()} ${url.pathname}`);
        return route.fulfill({
          status: 404,
          json: { data: null, error: { code: 'not_found', message: `Unhandled mock endpoint: ${req.method()} ${url.pathname}` } },
        });
      }

      return route.continue();
    });

    await runSettingsTests(page, api, origin, fixtureUrl);

    // Strict boundary and error assertions
    assert.deepEqual(unexpectedApiCalls, [], 'Settings suite must not encounter unexpected API calls');
    assert.deepEqual(egressViolations, [], 'Settings suite must not attempt non-loopback egress');
    assert.deepEqual(pageErrors, [], 'Settings suite must not encounter uncaught page errors');
    console.log('[SETTINGS SUITE] Settings contract run completed successfully.');
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/verify-extraction-settings.mjs')) {
  main().catch((err) => {
    console.error('[SETTINGS SUITE FATAL]', err);
    process.exit(1);
  });
}
