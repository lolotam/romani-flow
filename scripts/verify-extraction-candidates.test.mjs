import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionApi } from './fixtures/extraction-api.mjs';
import {
  MOCK_MODEL_ID,
  MOCK_ENDPOINT_TAG,
  MOCK_GROQ_MODEL_ID,
  makeMockModel,
  makeMockByok,
  makeMockApproval,
  makeMockGroqApproval,
} from './fixtures/extraction-data.mjs';

// ---------------------------------------------------------------------------
// Helpers: exact sanitized shapes, leak detection, settings & egress checks
// ---------------------------------------------------------------------------

function assertSanitizedCandidate(candidate, expectedId, expectedProvider, expectedMaxImages) {
  assert.equal(candidate.id, expectedId);
  assert.equal(candidate.label, expectedId);
  assert.equal(candidate.provider, expectedProvider);
  assert.equal(candidate.maxImages, expectedMaxImages);
  assert.deepEqual(Object.keys(candidate).sort(), ['id', 'label', 'maxImages', 'provider']);
}

function assertSanitizedEnvelope(res, expectedReason, f) {
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['data', 'error']);
  assert.equal(res.json.error, null);
  assert.ok(res.json.data, 'Response must have data object');
  assert.deepEqual(Object.keys(res.json.data).sort(), ['candidates', 'reason', 'verification']);
  assert.equal(res.json.data.verification, 'offline');
  assert.equal(res.json.data.reason, expectedReason);
  assert.ok(Array.isArray(res.json.data.candidates), 'Candidates must be an array');

  const raw = JSON.stringify(res.json);
  const ext = f?.config?.extraction;
  if (ext) {
    if (ext.openRouterKey) assert.ok(!raw.includes(ext.openRouterKey), 'Must not leak OpenRouter key');
    if (ext.groqKey) assert.ok(!raw.includes(ext.groqKey), 'Must not leak Groq key');
    for (const app of ext.approvals ?? []) {
      for (const field of [app.endpoint, app.policyVersion, app.expiresAt]) {
        if (field) assert.ok(!raw.includes(field), `Must not leak ${field}`);
      }
    }
  }
}

function getAllSettings(db) {
  return db.prepare("SELECT key, value FROM settings UNION ALL SELECT workspace_id || ':' || key, value FROM workspace_settings ORDER BY 1 ASC").all();
}

function getExtractionSettings(db) {
  const parseVal = (raw) => {
    try { return JSON.parse(raw); } catch { return raw; }
  };
  return {
    enabled: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.enabled'").get()?.value),
    provider: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.provider'").get()?.value),
    model: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.model'").get()?.value),
  };
}

function assertEgressRules(calls, candidateModel = MOCK_MODEL_ID, requireAll = false) {
  const expectedEndpointsUrl = `https://openrouter.ai/api/v1/models/${candidateModel}/endpoints`;
  const allowedUrls = new Set([
    'https://openrouter.ai/api/v1/models',
    expectedEndpointsUrl,
    'https://openrouter.ai/api/v1/endpoints/zdr',
    'https://openrouter.ai/api/v1/byok?limit=1&offset=0',
  ]);
  assert.ok(calls.some(c => c.url === 'https://openrouter.ai/api/v1/models'), 'Models catalog entered');
  if (requireAll) {
    assert.ok(calls.some(c => c.url === expectedEndpointsUrl), 'Exact model endpoints URL called');
    assert.ok(calls.some(c => c.url === 'https://openrouter.ai/api/v1/endpoints/zdr'), 'ZDR called');
    assert.ok(calls.some(c => c.url === 'https://openrouter.ai/api/v1/byok?limit=1&offset=0'), 'BYOK called');
  }
  assert.ok(calls.every(c => allowedUrls.has(c.url)), 'All egress to allowed destinations');
  assert.ok(calls.every(c => !c.url.includes('/chat/completions')), 'Zero inference egress');
  assert.ok(calls.every(c => !c.url.includes('groq.com')), 'No fallback to other provider');
  const urls = calls.map(c => c.url);
  assert.equal(new Set(urls).size, urls.length, 'No duplicate or retry requests');
}

function createOpenRouterTransport(opts = {}) {
  const jsonHdr = { 'content-type': 'application/json' };
  return async (url) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      const overrides = opts.isPaid?.()
        ? { pricing: { prompt: '0.01', completion: '0', image: '0', request: '0' } }
        : {};
      return new Response(JSON.stringify({ data: [makeMockModel(overrides)] }), { status: 200, headers: jsonHdr });
    }
    if (url.startsWith('https://openrouter.ai/api/v1/models/') && url.endsWith('/endpoints')) {
      const payload = {
        data: {
          id: MOCK_MODEL_ID,
          endpoints: [{
            model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, status: 0,
            pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
          }],
        },
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: jsonHdr });
    }
    if (url === 'https://openrouter.ai/api/v1/endpoints/zdr') {
      const payload = { data: [{ model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, status: 0, safety_retention: false }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: jsonHdr });
    }
    if (url.startsWith('https://openrouter.ai/api/v1/byok')) {
      return new Response(JSON.stringify(makeMockByok()), { status: 200, headers: jsonHdr });
    }
    throw new Error('unexpected_provider_url: ' + url);
  };
}

const BASE_OR_OPTS = {
  enabled: false, provider: '', model: '', authorized: true, context: 'kw-docs',
  openRouterKey: 'mock-openrouter-key', dataControlsApproved: true,
  openRouterNoByok: true, openRouterZdrOnly: true, approvals: [makeMockApproval()],
};

// ---------------------------------------------------------------------------
// 1. Authentication & Role Authorization Middleware Controls
// ---------------------------------------------------------------------------

test('anonymous request to candidates is rejected with 401 before any logic', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=openrouter', { userId: null, role: null });
    assert.equal(res.status, 401);
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true }));

test('viewer role request to candidates is rejected with 403 before any logic', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=openrouter', { userId: 'viewer', role: 'viewer' });
    assert.equal(res.status, 403);
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true }));

test('missing or invalid provider parameter returns 400 invalid_provider', () =>
  extractionApi(async (f) => {
    for (const url of [
      '/api/document-extraction/candidates',
      '/api/document-extraction/candidates?provider=',
      '/api/document-extraction/candidates?provider=unknown',
      '/api/document-extraction/candidates?provider=invalid_provider',
    ]) {
      const res = await f.request(url);
      assert.equal(res.status, 400);
      assert.deepEqual(Object.keys(res.json).sort(), ['data', 'error']);
      assert.equal(res.json.data, null);
      assert.equal(res.json.error?.code, 'invalid_provider');
      assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
    }
  }, { enabled: false, authorized: true }));

// ---------------------------------------------------------------------------
// 2. Existing /models Gate Preservation (Positive Regression Control)
// ---------------------------------------------------------------------------

test('existing GET /api/document-extraction/models while disabled retains 403 and zero egress', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/models?provider=openrouter');
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'extraction_disabled');
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true, provider: 'openrouter' }));

// ---------------------------------------------------------------------------
// 3. Positive Offline Candidate Controls (Default Disabled State)
// ---------------------------------------------------------------------------

test('default disabled state yields offline OpenRouter candidate with zero calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(res, 'locally_approved', f);
    assert.equal(res.json.data.candidates.length, 1);
    assertSanitizedCandidate(res.json.data.candidates[0], MOCK_MODEL_ID, 'openrouter', 1);
    assert.equal(f.calls.length, 0, 'Must make zero external transport calls');
    assert.equal(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.enabled'").get().value, 'false');
  }, { ...BASE_OR_OPTS, provider: 'openrouter' }));

test('default disabled state yields offline Groq candidate with known capability and zero calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=groq');
    assertSanitizedEnvelope(res, 'locally_approved', f);
    assert.equal(res.json.data.candidates.length, 1);
    assertSanitizedCandidate(res.json.data.candidates[0], MOCK_GROQ_MODEL_ID, 'groq', 3);
    assert.equal(f.calls.length, 0, 'Must make zero external transport calls');
    assert.equal(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.enabled'").get().value, 'false');
  }, {
    enabled: false, authorized: true, provider: 'groq', groqKey: 'mock-groq-key',
    groqFreeAccount: true, approvals: [makeMockGroqApproval()],
  }));

test('offline candidate query followed by extraction POST while disabled still refuses with 403 and zero calls', () =>
  extractionApi(async (f) => {
    const candRes = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(candRes, 'locally_approved', f);
    const postRes = await f.request('/api/document-extraction', {
      method: 'POST', body: f.validRequest, headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(postRes.status, 403);
    assert.equal(postRes.json?.error?.code, 'extraction_disabled');
    assert.equal(f.calls.length, 0, 'Must produce zero calls when extraction is disabled');
  }, { ...BASE_OR_OPTS, provider: 'openrouter' }));

// ---------------------------------------------------------------------------
// 4. Candidate Filtering Rules (Capability, Expiry, Router models, maxImages)
// ---------------------------------------------------------------------------

test('filters out router, non-free suffix, bad maxImages and expired OpenRouter approvals against valid positive control', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(res, 'locally_approved', f);
    assert.equal(res.json.data.candidates.length, 1);
    assertSanitizedCandidate(res.json.data.candidates[0], MOCK_MODEL_ID, 'openrouter', 1);
    assert.equal(f.calls.length, 0, 'Zero egress on filtered candidate query');
  }, {
    ...BASE_OR_OPTS, provider: 'openrouter',
    approvals: [
      makeMockApproval({ model: MOCK_MODEL_ID, maxImages: 1 }),
      makeMockApproval({ model: 'openrouter/auto:free', maxImages: 1 }),
      makeMockApproval({ model: 'meta-llama/llama-3.2-11b-vision-instruct', maxImages: 1 }),
      makeMockApproval({ model: 'vendor/custom-vision:free', maxImages: 2 }),
      makeMockApproval({ model: 'legacy/vision-model:free', maxImages: 1, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ],
  }));

test('filters out unknown capability and expired Groq approvals against valid positive control', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=groq');
    assertSanitizedEnvelope(res, 'locally_approved', f);
    assert.equal(res.json.data.candidates.length, 1);
    assertSanitizedCandidate(res.json.data.candidates[0], MOCK_GROQ_MODEL_ID, 'groq', 3);
    assert.equal(f.calls.length, 0, 'Zero egress on filtered Groq candidates');
  }, {
    enabled: false, authorized: true, provider: 'groq', groqKey: 'mock-groq-key',
    groqFreeAccount: true,
    approvals: [
      makeMockGroqApproval({ model: MOCK_GROQ_MODEL_ID, maxImages: 3 }),
      makeMockGroqApproval({ model: 'groq/unknown-unreviewed-model', maxImages: 3 }),
      makeMockGroqApproval({ model: 'groq/expired-model', maxImages: 3, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ],
  }));

test('filters out Groq approval with maxImages mismatch against reviewed capability', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/candidates?provider=groq');
    assertSanitizedEnvelope(res, 'no_candidates', f);
    assert.deepEqual(res.json.data.candidates, []);
    assert.equal(f.calls.length, 0, 'Zero egress on maxImages mismatch');
  }, {
    enabled: false, authorized: true, provider: 'groq', groqKey: 'mock-groq-key',
    groqFreeAccount: true, approvals: [makeMockGroqApproval({ model: MOCK_GROQ_MODEL_ID, maxImages: 1 })],
  }));

test('approval expiry is rechecked on subsequent requests via controlled clock', () => {
  let simulatedNow = Date.parse('2026-11-07T10:00:00.000Z');
  const clock = {
    now: () => simulatedNow,
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  return extractionApi(async (f) => {
    const firstRes = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(firstRes, 'locally_approved', f);
    assert.equal(firstRes.json.data.candidates.length, 1);

    simulatedNow = Date.parse('2026-11-07T13:00:00.000Z');

    const secondRes = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(secondRes, 'no_candidates', f);
    assert.deepEqual(secondRes.json.data.candidates, []);
    assert.equal(f.calls.length, 0, 'Zero egress across subsequent requests');
  }, {
    ...BASE_OR_OPTS, provider: 'openrouter', clock,
    approvals: [makeMockApproval({ model: MOCK_MODEL_ID, expiresAt: '2026-11-07T12:00:00.000Z' })],
  });
});

// ---------------------------------------------------------------------------
// 5. Fixed Reason Codes for Missing Authorization, Config & Attestations
// ---------------------------------------------------------------------------

const PREDICATE_CASES = [
  { name: 'unauthorized', provider: 'openrouter', opts: { authorized: false }, reason: 'processing_not_authorized' },
  { name: 'missing context', provider: 'openrouter', opts: { context: '' }, reason: 'processing_not_authorized' },
  { name: 'missing OpenRouter key', provider: 'openrouter', opts: { openRouterKey: null }, reason: 'unconfigured' },
  { name: 'missing Groq key', provider: 'groq', opts: { groqKey: null }, reason: 'unconfigured' },
  { name: 'missing OR data controls', provider: 'openrouter', opts: { dataControlsApproved: false }, reason: 'policy_unavailable' },
  { name: 'missing OR no-BYOK', provider: 'openrouter', opts: { openRouterNoByok: false }, reason: 'policy_unavailable' },
  { name: 'missing OR ZDR-only', provider: 'openrouter', opts: { openRouterZdrOnly: false }, reason: 'policy_unavailable' },
  { name: 'missing Groq free account', provider: 'groq', opts: { groqFreeAccount: false }, reason: 'policy_unavailable' },
  { name: 'missing Groq data controls', provider: 'groq', opts: { dataControlsApproved: false }, reason: 'policy_unavailable' },
  { name: 'empty OR approvals', provider: 'openrouter', opts: { approvals: [] }, reason: 'no_candidates' },
  { name: 'empty Groq approvals', provider: 'groq', opts: { approvals: [] }, reason: 'no_candidates' },
];

for (const c of PREDICATE_CASES) {
  test(`predicate: ${c.name} returns empty candidates with ${c.reason}`, () => {
    const isGroq = c.provider === 'groq';
    const baseOpts = isGroq
      ? {
          enabled: false, authorized: true, context: 'kw-docs', provider: 'groq',
          groqKey: 'mock-groq-key', groqFreeAccount: true, dataControlsApproved: true,
          approvals: [makeMockGroqApproval()],
        }
      : { ...BASE_OR_OPTS, provider: 'openrouter' };
    return extractionApi(async (f) => {
      const res = await f.request(`/api/document-extraction/candidates?provider=${c.provider}`);
      assertSanitizedEnvelope(res, c.reason, f);
      assert.deepEqual(res.json.data.candidates, []);
      assert.equal(f.calls.length, 0, 'Zero egress on predicate check');
    }, { ...baseOpts, ...c.opts });
  });
}

// ---------------------------------------------------------------------------
// 6. Full Bootstrap Lifecycle & Atomic Enabling Sequence
// ---------------------------------------------------------------------------

test('full sequence: default empty bootstrap to offline candidate to explicit enabling PUT', () =>
  extractionApi(async (f) => {
    // 1. Initial state: disabled, provider and model are empty strings
    assert.deepEqual(getExtractionSettings(f.db), { enabled: false, provider: '', model: '' });

    // 2. Query offline candidates with backend-only keys & approvals configured
    const candRes = await f.request('/api/document-extraction/candidates?provider=openrouter');
    assertSanitizedEnvelope(candRes, 'locally_approved', f);
    assert.equal(candRes.json.data.candidates.length, 1);
    const candidateModel = candRes.json.data.candidates[0].id;
    assert.equal(candidateModel, MOCK_MODEL_ID);
    assert.equal(f.calls.length, 0, 'Zero external calls during candidate query');

    // 3. Candidate query cannot modify settings
    assert.deepEqual(getExtractionSettings(f.db), { enabled: false, provider: '', model: '' });

    // 4. Extraction POST while disabled still refuses before transport with zero calls
    const extPostRes = await f.request('/api/document-extraction', {
      method: 'POST', body: f.validRequest, headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(extPostRes.status, 403);
    assert.equal(extPostRes.json?.error?.code, 'extraction_disabled');
    assert.equal(f.calls.length, 0, 'Zero calls on disabled extraction POST');

    // 5. Intentional enabling uses UI { settings: ... } envelope
    const putRes = await f.request('/api/settings', {
      method: 'PUT',
      body: {
        settings: {
          'ai_extraction.enabled': true,
          'ai_extraction.provider': 'openrouter',
          'ai_extraction.model': candidateModel,
        },
      },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.json.error, null);

    // 6. Assert exact model endpoints URL independent of /endpoints/zdr, no retry/fallback/inference
    assertEgressRules(f.calls, candidateModel, true);

    // 7. Settings persisted only after remote verification succeeds
    assert.deepEqual(getExtractionSettings(f.db), { enabled: true, provider: 'openrouter', model: candidateModel });
  }, { ...BASE_OR_OPTS }));

// ---------------------------------------------------------------------------
// 7. Mixed PUT Atomic Rollback & Live Refusal / Deferred Revocation
// ---------------------------------------------------------------------------

test('mixed settings PUT fails atomically on live paid refusal leaving entire settings table untouched', () => {
  let livePaid = false;
  const transport = createOpenRouterTransport({ isPaid: () => livePaid });

  return extractionApi(async (f) => {
    // 1. Enabling positive control: prove actual enable against valid live metadata
    const enableRes = await f.request('/api/settings', {
      method: 'PUT',
      body: {
        settings: {
          'ai_extraction.enabled': true,
          'ai_extraction.provider': 'openrouter',
          'ai_extraction.model': MOCK_MODEL_ID,
        },
      },
    });
    assert.equal(enableRes.status, 200);
    assert.deepEqual(getExtractionSettings(f.db), {
      enabled: true, provider: 'openrouter', model: MOCK_MODEL_ID,
    });

    // 2. Disable/reset intentionally before mixed refusal
    const disableRes = await f.request('/api/settings', {
      method: 'PUT',
      body: {
        settings: {
          'ai_extraction.enabled': false,
          'ai_extraction.provider': '',
          'ai_extraction.model': '',
        },
      },
    });
    assert.equal(disableRes.status, 200);
    assert.deepEqual(getExtractionSettings(f.db), { enabled: false, provider: '', model: '' });

    const preSettings = getAllSettings(f.db);
    const callsBeforeMixed = f.calls.length;

    // 3. Alter live transport pricing only before mixed PUT
    livePaid = true;

    const putRes = await f.request('/api/settings', {
      method: 'PUT',
      body: {
        settings: {
          'email.enabled': true,
          'ai_extraction.enabled': true,
          'ai_extraction.provider': 'openrouter',
          'ai_extraction.model': MOCK_MODEL_ID,
        },
      },
    });

    assert.equal(putRes.status, 400);
    assert.equal(putRes.json.error?.code, 'invalid_settings');

    // 4. Compare all settings snapshots: every row remains exactly unchanged
    assert.deepEqual(getAllSettings(f.db), preSettings, 'Complete settings table must be rolled back');

    // 5. Assert live metadata check was executed and no disallowed calls occurred
    const mixedCalls = f.calls.slice(callsBeforeMixed);
    assertEgressRules(mixedCalls, MOCK_MODEL_ID, false);
  }, { ...BASE_OR_OPTS, transport });
});

const DEFERRED_REVOCATION_CASES = [
  { name: 'valid unchanged control', expectSuccess: true, mutate: () => {} },
  { name: 'approvals revocation', expectSuccess: false, mutate: (f) => { f.config.extraction.approvals = []; } },
  { name: 'empty context revocation', expectSuccess: false, mutate: (f) => { f.config.extraction.context = ''; } },
  { name: 'changed nonempty context revocation', expectSuccess: false, mutate: (f) => { f.config.extraction.context = 'tenant-two-context'; } },
  { name: 'data controls revocation', expectSuccess: false, mutate: (f) => { f.config.extraction.dataControlsApproved = false; } },
  { name: 'admin role revocation to viewer', expectSuccess: false, mutate: (f) => { f.db.prepare("UPDATE admin_users SET role = 'viewer' WHERE id = 'admin'").run(); } },
];

for (const c of DEFERRED_REVOCATION_CASES) {
  test(`deferred transport: ${c.name}`, () =>
    extractionApi(async (f) => {
      const preSettings = getAllSettings(f.db);
      const putBody = c.expectSuccess
        ? {
            settings: {
              'ai_extraction.enabled': true,
              'ai_extraction.provider': 'openrouter',
              'ai_extraction.model': MOCK_MODEL_ID,
            },
          }
        : {
            settings: {
              'email.enabled': true,
              'ai_extraction.enabled': true,
              'ai_extraction.provider': 'openrouter',
              'ai_extraction.model': MOCK_MODEL_ID,
            },
          };

      const putPromise = f.request('/api/settings', { method: 'PUT', body: putBody });

      await f.waitForTransportCall(call => call.url === 'https://openrouter.ai/api/v1/models');
      c.mutate(f);
      f.release();

      const putRes = await putPromise;

      if (c.expectSuccess) {
        assert.equal(putRes.status, 200);
        assert.equal(putRes.json.error, null);
        assert.deepEqual(getExtractionSettings(f.db), {
          enabled: true, provider: 'openrouter', model: MOCK_MODEL_ID,
        });
      } else {
        assert.equal(putRes.status, 400);
        assert.equal(putRes.json.error?.code, 'invalid_settings');
        assert.deepEqual(getAllSettings(f.db), preSettings, 'Complete settings table must be rolled back');
      }

      assertEgressRules(f.calls, MOCK_MODEL_ID, false);
    }, { ...BASE_OR_OPTS, deferTransport: true }));
}
