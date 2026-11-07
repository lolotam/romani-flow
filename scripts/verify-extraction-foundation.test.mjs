import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageImage,
  extractionRequest,
  rawPage,
  rawBatch,
  candidate,
  resultSchema,
  calendarDate,
} from '../server/contracts/documentExtraction.ts';
import {
  readExtractionConfig,
} from '../server/extraction/config.ts';
import {
  loadConfig,
} from '../server/config.ts';

// ---------------------------------------------------------------------------
// Synthetic test fixtures
// ---------------------------------------------------------------------------
const VALID_UUID = '12345678-1234-4234-8234-123456789abc';
const SETTINGS_VERSION = 'a'.repeat(64);
const CATALOG_VERSION = 'b'.repeat(64);
const SAMPLE_BASE64 = Buffer.from('synthetic-image-bytes').toString('base64');

function makeRawPage(pageNumber, overrides = {}) {
  return {
    page: pageNumber,
    title: { value: 'Civil ID Card', certainty: 'clear' },
    document_number: { value: '290010112345', certainty: 'clear' },
    document_type_label: { value: 'Civil ID', certainty: 'clear' },
    ministry_label: { value: 'Ministry of Interior', certainty: 'clear' },
    issue_date: { value: '2024-01-15', certainty: 'clear', source: '2024-01-15', calendar: 'gregorian' },
    expiry_date: { value: '2026-01-15', certainty: 'clear', source: '2026-01-15', calendar: 'gregorian' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. pageImage Schema & Boundaries
// ---------------------------------------------------------------------------
test('pageImage validates canonical image payload and rejects bad bounds/types', () => {
  const validPng = { page: 1, mime: 'image/png', base64: SAMPLE_BASE64 };
  const validJpeg = { page: 10, mime: 'image/jpeg', base64: SAMPLE_BASE64 };
  assert.doesNotThrow(() => pageImage.parse(validPng));
  assert.doesNotThrow(() => pageImage.parse(validJpeg));

  // Invalid page bounds
  assert.equal(pageImage.safeParse({ ...validPng, page: 0 }).success, false);
  assert.equal(pageImage.safeParse({ ...validPng, page: 11 }).success, false);
  assert.equal(pageImage.safeParse({ ...validPng, page: 1.5 }).success, false);

  // Invalid mime types
  assert.equal(pageImage.safeParse({ ...validPng, mime: 'image/webp' }).success, false);
  assert.equal(pageImage.safeParse({ ...validPng, mime: 'application/pdf' }).success, false);

  // Base64 bounds (min 4, max limits.body)
  assert.equal(pageImage.safeParse({ ...validPng, base64: 'abc' }).success, false);

  // Strict: rejects unknown keys
  assert.equal(pageImage.safeParse({ ...validPng, extraField: 'injection' }).success, false);
});

// ---------------------------------------------------------------------------
// 2. extractionRequest Schema & Page Incompleteness Refinement
// ---------------------------------------------------------------------------
test('extractionRequest enforces strict schema and all-pages completeness', () => {
  const validRequest = {
    requestId: VALID_UUID,
    scope: 'employee-documents',
    context: 'kw-docs',
    settingsVersion: SETTINGS_VERSION,
    catalogVersion: CATALOG_VERSION,
    pageCount: 2,
    images: [
      { page: 1, mime: 'image/png', base64: SAMPLE_BASE64 },
      { page: 2, mime: 'image/jpeg', base64: SAMPLE_BASE64 },
    ],
  };
  assert.doesNotThrow(() => extractionRequest.parse(validRequest));

  // Incomplete pages: count mismatch
  assert.equal(extractionRequest.safeParse({ ...validRequest, pageCount: 3 }).success, false);
  assert.equal(extractionRequest.safeParse({ ...validRequest, images: [validRequest.images[0]] }).success, false);

  // Out-of-order or skipped page sequence
  assert.equal(extractionRequest.safeParse({
    ...validRequest,
    images: [
      { page: 1, mime: 'image/png', base64: SAMPLE_BASE64 },
      { page: 3, mime: 'image/png', base64: SAMPLE_BASE64 },
    ],
  }).success, false);

  // Duplicate page numbers
  assert.equal(extractionRequest.safeParse({
    ...validRequest,
    images: [
      { page: 1, mime: 'image/png', base64: SAMPLE_BASE64 },
      { page: 1, mime: 'image/jpeg', base64: SAMPLE_BASE64 },
    ],
  }).success, false);

  // Invalid UUID requestId
  assert.equal(extractionRequest.safeParse({ ...validRequest, requestId: 'not-a-uuid' }).success, false);

  // Empty or overlong context
  assert.equal(extractionRequest.safeParse({ ...validRequest, context: '' }).success, false);
  assert.equal(extractionRequest.safeParse({ ...validRequest, context: 'x'.repeat(129) }).success, false);

  // Version hashes must be exactly 64 hex characters
  assert.equal(extractionRequest.safeParse({ ...validRequest, settingsVersion: 'short' }).success, false);
  assert.equal(extractionRequest.safeParse({ ...validRequest, catalogVersion: 'short' }).success, false);

  // Strict rejection of extra fields / injection
  assert.equal(extractionRequest.safeParse({ ...validRequest, employee_id: 'emp-123' }).success, false);
  assert.equal(extractionRequest.safeParse({ ...validRequest, notes: 'admin override' }).success, false);
  assert.equal(extractionRequest.safeParse({ ...validRequest, status: 'approved' }).success, false);
});

// ---------------------------------------------------------------------------
// 3. rawPage and rawBatch Schemas
// ---------------------------------------------------------------------------
test('rawPage and rawBatch enforce strict wire structure and reject extra fields', () => {
  const page1 = makeRawPage(1);
  assert.doesNotThrow(() => rawPage.parse(page1));
  assert.doesNotThrow(() => rawBatch.parse({ pages: [page1] }));

  // Strict rejection of extra fields on rawPage
  assert.equal(rawPage.safeParse({ ...page1, notes: 'extra note' }).success, false);
  assert.equal(rawPage.safeParse({ ...page1, employee_id: 'override' }).success, false);
  assert.equal(rawPage.safeParse({ ...page1, path: '/etc/passwd' }).success, false);

  // Overlong value in raw field (> 128 chars)
  const overlong = { ...page1, title: { value: 'x'.repeat(129), certainty: 'clear' } };
  assert.equal(rawPage.safeParse(overlong).success, false);

  // Invalid certainty enum
  const badCertainty = { ...page1, title: { value: 'Civil ID', certainty: 'maybe' } };
  assert.equal(rawPage.safeParse(badCertainty).success, false);

  // Invalid date calendar enum
  const badCalendar = {
    ...page1,
    issue_date: { value: '2024-01-01', certainty: 'clear', source: '2024-01-01', calendar: 'hijri' },
  };
  assert.equal(rawPage.safeParse(badCalendar).success, false);

  // rawBatch must contain at least 1 page and at most 10 pages
  assert.equal(rawBatch.safeParse({ pages: [] }).success, false);
  const elevenPages = Array.from({ length: 11 }, (_, i) => makeRawPage(i + 1));
  assert.equal(rawBatch.safeParse({ pages: elevenPages }).success, false);
});

// ---------------------------------------------------------------------------
// 4. candidate Schema & SuperRefine Constraints
// ---------------------------------------------------------------------------
test('candidate enforces state-reason invariants for clear, review, and missing', () => {
  // Clear candidate requires non-empty trimmed value and reason 'none'
  assert.doesNotThrow(() => candidate.parse({
    value: '290010112345',
    state: 'clear',
    alternatives: [],
    reason: 'none',
  }));
  assert.equal(candidate.safeParse({ value: null, state: 'clear', alternatives: [], reason: 'none' }).success, false);
  assert.equal(candidate.safeParse({ value: '   ', state: 'clear', alternatives: [], reason: 'none' }).success, false);
  assert.equal(candidate.safeParse({ value: '290010112345', state: 'clear', alternatives: [], reason: 'uncertain' }).success, false);

  // Review candidate requires value === null
  assert.doesNotThrow(() => candidate.parse({
    value: null,
    state: 'review',
    alternatives: ['290010112345', '290010112346'],
    reason: 'conflict',
  }));
  assert.equal(candidate.safeParse({
    value: '290010112345',
    state: 'review',
    alternatives: [],
    reason: 'conflict',
  }).success, false);

  // Missing candidate requires value === null, alternatives empty, and reason 'none'
  assert.doesNotThrow(() => candidate.parse({
    value: null,
    state: 'missing',
    alternatives: [],
    reason: 'none',
  }));
  assert.equal(candidate.safeParse({
    value: null,
    state: 'missing',
    alternatives: ['unexpected'],
    reason: 'none',
  }).success, false);
  assert.equal(candidate.safeParse({
    value: null,
    state: 'missing',
    alternatives: [],
    reason: 'invalid',
  }).success, false);

  // Strict: rejects extra properties
  assert.equal(candidate.safeParse({
    value: '290010112345',
    state: 'clear',
    alternatives: [],
    reason: 'none',
    extra: 'bad',
  }).success, false);
});

// ---------------------------------------------------------------------------
// 5. resultSchema Refinements (Title length, Date order, Trimmed document_number)
// ---------------------------------------------------------------------------
test('resultSchema validates full extraction result and semantic refinements', () => {
  const validResult = {
    requestId: VALID_UUID,
    context: 'kw-docs',
    settingsVersion: SETTINGS_VERSION,
    catalogVersion: CATALOG_VERSION,
    pageCount: 1,
    fields: {
      title: { value: 'Civil ID Card', state: 'clear', alternatives: [], reason: 'none' },
      document_number: { value: '290010112345', state: 'clear', alternatives: [], reason: 'none' },
      document_type_id: { value: 'type-civil-id', state: 'clear', alternatives: [], reason: 'none' },
      ministry_id: { value: 'min-moi', state: 'clear', alternatives: [], reason: 'none' },
      issue_date: { value: '2024-01-15', state: 'clear', alternatives: [], reason: 'none' },
      expiry_date: { value: '2026-01-15', state: 'clear', alternatives: [], reason: 'none' },
    },
  };
  assert.doesNotThrow(() => resultSchema.parse(validResult));

  // Overlong title (> 120 chars) rejected by refinement
  const longTitleResult = structuredClone(validResult);
  longTitleResult.fields.title.value = 'x'.repeat(121);
  assert.equal(resultSchema.safeParse(longTitleResult).success, false);

  // Untrimmed document_number rejected by refinement
  const untrimmedNumberResult = structuredClone(validResult);
  untrimmedNumberResult.fields.document_number.value = ' 290010112345 ';
  assert.equal(resultSchema.safeParse(untrimmedNumberResult).success, false);

  // Expiry date before issue date rejected by refinement
  const invalidDateOrderResult = structuredClone(validResult);
  invalidDateOrderResult.fields.issue_date.value = '2026-01-15';
  invalidDateOrderResult.fields.expiry_date.value = '2024-01-15';
  assert.equal(resultSchema.safeParse(invalidDateOrderResult).success, false);

  // Strict: rejects unexpected fields
  assert.equal(resultSchema.safeParse({ ...validResult, employee_id: 'emp-1' }).success, false);
});

// ---------------------------------------------------------------------------
// 6. calendarDate Pure Parsing & Gregorian Leap Validation
// ---------------------------------------------------------------------------
test('calendarDate enforces strict YYYY-MM-DD Gregorian leap rules and rejects ambiguous dates', () => {
  // Valid explicit ISO Gregorian dates
  assert.equal(calendarDate('2026-11-07'), '2026-11-07');
  assert.equal(calendarDate('2024-02-29'), '2024-02-29'); // Leap year

  // Impossible leap days in non-leap years
  assert.equal(calendarDate('2023-02-29'), null);
  assert.equal(calendarDate('2027-02-29'), null);

  // Ambiguous slash / reverse / dot formats
  assert.equal(calendarDate('03/04/2027'), null);
  assert.equal(calendarDate('2027/03/04'), null);
  assert.equal(calendarDate('04-03-2027'), null);
  assert.equal(calendarDate('2027.03.04'), null);

  // Missing year or day components
  assert.equal(calendarDate('--04-05'), null);
  assert.equal(calendarDate('04-05'), null);
  assert.equal(calendarDate('2027-04'), null);

  // Out of bound months and days
  assert.equal(calendarDate('2026-13-01'), null);
  assert.equal(calendarDate('2026-00-10'), null);
  assert.equal(calendarDate('2026-04-31'), null); // April has 30 days
  assert.equal(calendarDate('2026-02-30'), null);

  // Non-string / garbage inputs
  assert.equal(calendarDate(null), null);
  assert.equal(calendarDate(undefined), null);
  assert.equal(calendarDate(1730970000000), null);
  assert.equal(calendarDate('not-a-date'), null);
});

// ---------------------------------------------------------------------------
// 7. Configuration Defaults and Fail-Closed Validation
// ---------------------------------------------------------------------------
test('loadConfig in test env defaults to unconfigured, unauthorized extraction', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  assert.equal(config.extraction.authorized, false);
  assert.equal(config.extraction.context, '');
  assert.equal(config.extraction.groqKey, null);
  assert.equal(config.extraction.openRouterKey, null);
  assert.equal(config.extraction.groqFreeAccount, false);
  assert.equal(config.extraction.dataControlsApproved, false);
  assert.equal(config.extraction.openRouterNoByok, false);
  assert.equal(config.extraction.openRouterZdrOnly, false);
  assert.deepEqual(config.extraction.approvals, []);
});

test('readExtractionConfig fails closed on malformed approvals JSON or duplicate models', () => {
  const validApproval = {
    provider: 'openrouter',
    model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    endpoint: 'openrouter/free-node',
    maxImages: 1,
    expiresAt: '2026-12-31T23:59:59.000Z',
    policyVersion: 'v1',
  };

  // Positive control: valid environment produces authorized extraction config
  const validEnv = {
    AI_EXTRACTION_PROCESSING_AUTHORIZED: 'true',
    AI_EXTRACTION_CONTEXT: 'kw-docs',
    AI_EXTRACTION_APPROVALS_JSON: JSON.stringify([validApproval]),
  };
  const validConfig = readExtractionConfig(validEnv);
  assert.equal(validConfig.authorized, true);
  assert.equal(validConfig.approvals.length, 1);

  // Malformed JSON string in approvals
  const badJsonEnv = {
    AI_EXTRACTION_PROCESSING_AUTHORIZED: 'true',
    AI_EXTRACTION_CONTEXT: 'kw-docs',
    AI_EXTRACTION_APPROVALS_JSON: '{ not-valid-json }',
  };
  const badJsonConfig = readExtractionConfig(badJsonEnv);
  assert.equal(badJsonConfig.authorized, false);
  assert.deepEqual(badJsonConfig.approvals, []);

  // Duplicate provider/model records in approvals must invalidate configuration
  const dupApprovals = [
    {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      endpoint: 'groq/main',
      maxImages: 3,
      expiresAt: '2026-12-31T23:59:59.000Z',
      policyVersion: 'v1',
    },
    {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      endpoint: 'groq/alt',
      maxImages: 3,
      expiresAt: '2026-12-31T23:59:59.000Z',
      policyVersion: 'v1',
    },
  ];
  const dupEnv = {
    AI_EXTRACTION_PROCESSING_AUTHORIZED: 'true',
    AI_EXTRACTION_CONTEXT: 'kw-docs',
    AI_EXTRACTION_APPROVALS_JSON: JSON.stringify(dupApprovals),
  };
  const dupConfig = readExtractionConfig(dupEnv);
  assert.equal(dupConfig.authorized, false);
  assert.deepEqual(dupConfig.approvals, []);
});

test('readExtractionConfig requires explicit context and processing authorized flag', () => {
  const validApproval = {
    provider: 'openrouter',
    model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    endpoint: 'openrouter/free-node',
    maxImages: 1,
    expiresAt: '2026-12-31T23:59:59.000Z',
    policyVersion: 'v1',
  };

  // Missing AI_EXTRACTION_PROCESSING_AUTHORIZED
  const noAuthEnv = {
    AI_EXTRACTION_CONTEXT: 'kw-docs',
    AI_EXTRACTION_APPROVALS_JSON: JSON.stringify([validApproval]),
  };
  assert.equal(readExtractionConfig(noAuthEnv).authorized, false);

  // Empty AI_EXTRACTION_CONTEXT
  const emptyContextEnv = {
    AI_EXTRACTION_PROCESSING_AUTHORIZED: 'true',
    AI_EXTRACTION_CONTEXT: '',
    AI_EXTRACTION_APPROVALS_JSON: JSON.stringify([validApproval]),
  };
  assert.equal(readExtractionConfig(emptyContextEnv).authorized, false);

  // Overlong AI_EXTRACTION_CONTEXT (> 128 chars)
  const longContextEnv = {
    AI_EXTRACTION_PROCESSING_AUTHORIZED: 'true',
    AI_EXTRACTION_CONTEXT: 'x'.repeat(129),
    AI_EXTRACTION_APPROVALS_JSON: JSON.stringify([validApproval]),
  };
  assert.equal(readExtractionConfig(longContextEnv).authorized, false);
});
