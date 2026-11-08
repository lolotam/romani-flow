import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionApi } from './fixtures/extraction-api.mjs';
import {
  MOCK_MODEL_ID,
  MOCK_ENDPOINT_TAG,
  MOCK_GROQ_MODEL_ID,
  makeMockApproval,
  makeMockGroqApproval,
} from './fixtures/extraction-data.mjs';
import { TEMPLATE_POLICY_VERSION } from '../server/extraction/modelCatalog.ts';

// ---------------------------------------------------------------------------
// Shared shapes: the catalog of one provider never leaks a key, an endpoint
// tag or the policy data of a configured approval. An approvable entry carries
// a template record, which is a proposal and never an activation.
// ---------------------------------------------------------------------------

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

function assertEntryShape(entry, provider) {
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['approval', 'id', 'label', 'maxImages', 'provider', 'status'],
    'Every entry carries exactly the contract fields',
  );
  assert.equal(entry.provider, provider, 'Every entry belongs to the requested provider');
  assert.ok(['approved', 'approvable', 'unavailable'].includes(entry.status), 'Known status only');
  if (entry.status === 'approved') {
    assert.equal(entry.approval, null, 'An approved entry carries no template');
    assert.ok(Number.isInteger(entry.maxImages) && entry.maxImages >= 1, 'Approved entries carry an image count');
  }
  if (entry.status === 'unavailable') {
    assert.equal(entry.approval, null, 'An unavailable entry carries no template');
    assert.equal(entry.maxImages, null, 'An unavailable entry carries no image count');
  }
}

function assertNoSecrets(raw, f) {
  const ext = f.config.extraction;
  if (ext.openRouterKey) assert.ok(!raw.includes(ext.openRouterKey), 'Must not leak OpenRouter key');
  if (ext.groqKey) assert.ok(!raw.includes(ext.groqKey), 'Must not leak Groq key');
  for (const approval of ext.approvals ?? []) {
    if (approval.endpoint) assert.ok(!raw.includes(approval.endpoint), 'Must not leak a configured endpoint tag');
    if (approval.policyVersion) assert.ok(!raw.includes(approval.policyVersion), 'Must not leak a configured policy version');
    if (approval.expiresAt) assert.ok(!raw.includes(approval.expiresAt), 'Must not leak a configured expiry');
  }
}

function assertCatalogEnvelope(res, expectedVerification) {
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['data', 'error']);
  assert.equal(res.json.error, null);
  assert.deepEqual(Object.keys(res.json.data).sort(), ['entries', 'verification']);
  assert.equal(res.json.data.verification, expectedVerification);
  assert.ok(Array.isArray(res.json.data.entries), 'Entries must be an array');
}

function groqModel(id) {
  return { id, object: 'model', owned_by: 'groq' };
}

/** A free, vision, non-router OpenRouter record. */
function freeVisionModel(id, name) {
  return {
    id,
    name,
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    },
    pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
    context_length: 128000,
    supported_parameters: ['max_tokens', 'response_format'],
  };
}

// ---------------------------------------------------------------------------
// 1. Authority gates
// ---------------------------------------------------------------------------

test('anonymous catalog request is rejected with 401 and zero transport calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq', { userId: null, role: null });
    assert.equal(res.status, 401);
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true, provider: 'groq' }));

test('viewer catalog request is rejected with 403 and zero transport calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq', { userId: 'viewer', role: 'viewer' });
    assert.equal(res.status, 403);
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true, provider: 'groq' }));

test('missing or invalid provider parameter returns 400 invalid_provider with zero calls', () =>
  extractionApi(async (f) => {
    for (const url of [
      '/api/document-extraction/catalog',
      '/api/document-extraction/catalog?provider=',
      '/api/document-extraction/catalog?provider=unknown',
    ]) {
      const res = await f.request(url);
      assert.equal(res.status, 400);
      assert.equal(res.json.data, null);
      assert.equal(res.json.error?.code, 'invalid_provider');
    }
    assert.equal(f.calls.length, 0, 'Must produce zero external transport calls');
  }, { enabled: false, authorized: true, provider: 'groq' }));

// ---------------------------------------------------------------------------
// 2. The catalog works while the extraction is disabled
// ---------------------------------------------------------------------------

test('disabled extraction still serves the live Groq catalog from the provider', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq');
    assertCatalogEnvelope(res, 'live');
    assert.equal(res.json.data.entries.length, 1);
    const [entry] = res.json.data.entries;
    assertEntryShape(entry, 'groq');
    assert.equal(entry.id, MOCK_GROQ_MODEL_ID);
    assert.equal(entry.status, 'approved');
    assert.equal(entry.maxImages, 3);
    assertNoSecrets(JSON.stringify(res.json), f);
    assert.ok(f.calls.every((c) => c.url === GROQ_MODELS_URL), 'Only the model list is read');
    assert.ok(f.calls.every((c) => !c.url.includes('/chat/completions')), 'Zero inference egress');
  }, {
    enabled: false, authorized: true, provider: 'groq',
    groqKey: 'mock-groq-key', approvals: [makeMockGroqApproval()],
  }));

// ---------------------------------------------------------------------------
// 3. Live listing statuses
// ---------------------------------------------------------------------------

test('Groq models outside the reviewed capabilities are offered as unavailable', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq');
    assertCatalogEnvelope(res, 'live');
    const byId = new Map(res.json.data.entries.map((entry) => [entry.id, entry]));
    assert.equal(byId.get(MOCK_GROQ_MODEL_ID).status, 'approved');
    const other = byId.get('llama-3.3-70b-versatile');
    assert.ok(other, 'The served model must be listed');
    assertEntryShape(other, 'groq');
    assert.equal(other.status, 'unavailable');
    assert.equal(other.maxImages, null);
    assertNoSecrets(JSON.stringify(res.json), f);
  }, {
    enabled: false, authorized: true, provider: 'groq',
    groqKey: 'mock-groq-key', approvals: [makeMockGroqApproval()],
    transport: async () =>
      new Response(
        JSON.stringify({ data: [groqModel(MOCK_GROQ_MODEL_ID), groqModel('llama-3.3-70b-versatile')] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  }));

test('OpenRouter catalog marks approved, approvable and unavailable models and templates stay proposals', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=openrouter');
    assertCatalogEnvelope(res, 'live');
    const byId = new Map(res.json.data.entries.map((entry) => [entry.id, entry]));

    const approved = byId.get(MOCK_MODEL_ID);
    assert.ok(approved, 'The approved model must be listed');
    assertEntryShape(approved, 'openrouter');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.maxImages, 1);

    const approvable = byId.get('qwen/qwen3-30b-a3b:free');
    assert.ok(approvable, 'The unapproved but eligible model must be listed');
    assertEntryShape(approvable, 'openrouter');
    assert.equal(approvable.status, 'approvable');
    assert.equal(approvable.maxImages, 1);
    assert.ok(approvable.approval, 'An approvable entry carries a template record');
    const template = JSON.parse(approvable.approval);
    assert.deepEqual(Object.keys(template).sort(), ['endpoint', 'expiresAt', 'maxImages', 'model', 'policyVersion', 'provider']);
    assert.equal(template.provider, 'openrouter');
    assert.equal(template.model, 'qwen/qwen3-30b-a3b:free');
    assert.equal(template.endpoint, 'PROVIDER_TAG', 'A routed template names the tag to replace');
    assert.equal(template.maxImages, 1);
    assert.equal(template.policyVersion, TEMPLATE_POLICY_VERSION);
    const lifetime = Date.parse(template.expiresAt) - Date.now();
    assert.ok(lifetime > 179 * 86_400_000 && lifetime < 181 * 86_400_000, 'The template expires inside its lifetime');

    const paid = byId.get('vendor/paid-vision:free');
    assertEntryShape(paid, 'openrouter');
    assert.equal(paid.status, 'unavailable');
    const router = byId.get('openrouter/auto:free');
    assertEntryShape(router, 'openrouter');
    assert.equal(router.status, 'unavailable');
    const notFree = byId.get('vendor/paid-vision');
    assertEntryShape(notFree, 'openrouter');
    assert.equal(notFree.status, 'unavailable');
    assertNoSecrets(JSON.stringify(res.json), f);
    assert.ok(f.calls.every((c) => c.url === OPENROUTER_MODELS_URL), 'Only the model list is read');
  }, {
    enabled: false, authorized: true, provider: 'openrouter',
    openRouterKey: 'mock-openrouter-key', approvals: [makeMockApproval()],
    transport: async () =>
      new Response(
        JSON.stringify({
          data: [
            freeVisionModel(MOCK_MODEL_ID, 'Llama 3.2 11B Vision Instruct (free)'),
            freeVisionModel('qwen/qwen3-30b-a3b:free', 'Qwen3 30B A3B (free)'),
            {
              ...freeVisionModel('vendor/paid-vision:free', 'Paid vision (free suffix)'),
              pricing: { prompt: '0.01', completion: '0', image: '0', request: '0' },
            },
            freeVisionModel('openrouter/auto:free', 'Router auto'),
            { ...freeVisionModel('vendor/paid-vision', 'Paid vision') },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  }));

test('live entries outside the client bounds are dropped or truncated, never the whole listing', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq');
    assertCatalogEnvelope(res, 'live');
    const byId = new Map(res.json.data.entries.map((entry) => [entry.id, entry]));
    assert.ok(!byId.has('x'.repeat(129)), 'An oversized id must not enter the listing');
    assert.ok(!byId.has('y'.repeat(129)), 'An oversized id is dropped, not truncated');
    assert.ok(byId.has(MOCK_GROQ_MODEL_ID), 'The well-formed model stays listed');
    const labeled = byId.get(MOCK_GROQ_MODEL_ID);
    assertEntryShape(labeled, 'groq');
    assert.equal(labeled.label.length, 128, 'An oversized label is truncated, not refused');
  }, {
    enabled: false, authorized: true, provider: 'groq',
    groqKey: 'mock-groq-key', approvals: [makeMockGroqApproval()],
    transport: async () =>
      new Response(
        JSON.stringify({
          data: [
            groqModel('x'.repeat(129)),
            { ...groqModel('y'.repeat(129)), name: 'n'.repeat(300) },
            { ...groqModel(MOCK_GROQ_MODEL_ID), name: 'Q'.repeat(300) },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  }));

// ---------------------------------------------------------------------------
// 4. Local fallback
// ---------------------------------------------------------------------------

test('a routed provider without a key answers the local catalog with zero calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=openrouter');
    assertCatalogEnvelope(res, 'local');
    const byId = new Map(res.json.data.entries.map((entry) => [entry.id, entry]));

    assert.equal(res.json.data.entries.length, 3);
    const [entry] = [byId.get(MOCK_MODEL_ID)];
    assertEntryShape(entry, 'openrouter');
    assert.equal(entry.id, MOCK_MODEL_ID);
    // Without a key nothing is selectable, so the model is offered as
    // approvable with its template instead of pretending it is approved.
    assert.equal(entry.status, 'approvable');
    assert.ok(entry.approval?.includes('PROVIDER_TAG'), 'The local template names the tag to replace');

    // A paid or router approval is a dead record: the locally checkable ID
    // rules refuse it even before the provider is ever contacted.
    const router = byId.get('openrouter/auto:free');
    assertEntryShape(router, 'openrouter');
    assert.equal(router.status, 'unavailable');
    const notFree = byId.get('vendor/paid-vision');
    assertEntryShape(notFree, 'openrouter');
    assert.equal(notFree.status, 'unavailable');
    assertNoSecrets(JSON.stringify(res.json), f);
    assert.equal(f.calls.length, 0, 'A provider without a key is never contacted');
  }, {
    enabled: false, authorized: true, provider: 'openrouter',
    openRouterKey: null,
    approvals: [
      makeMockApproval({ endpoint: MOCK_ENDPOINT_TAG }),
      makeMockApproval({ model: 'openrouter/auto:free', endpoint: MOCK_ENDPOINT_TAG }),
      makeMockApproval({ model: 'vendor/paid-vision', endpoint: MOCK_ENDPOINT_TAG }),
    ],
  }));

test('an unauthorized environment answers the local Groq catalog with zero calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq');
    assertCatalogEnvelope(res, 'local');
    assert.deepEqual(res.json.data.entries.map((entry) => entry.id), [MOCK_GROQ_MODEL_ID]);
    assert.equal(res.json.data.entries[0].status, 'approvable');
    assert.equal(f.calls.length, 0, 'An unauthorized environment is never contacted');
  }, {
    enabled: false, authorized: false, provider: 'groq',
    groqKey: 'mock-groq-key', approvals: [makeMockGroqApproval()],
  }));

// ---------------------------------------------------------------------------
// 5. Provider failure stays a failure
// ---------------------------------------------------------------------------

test('a failing provider answer is refused and never becomes a catalog', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/catalog?provider=groq');
    assert.ok(res.status >= 400, 'A refused provider answer is an error');
    assert.equal(res.json.data, null);
    assert.ok(typeof res.json.error?.code === 'string' && res.json.error.code.length > 0);
    assertNoSecrets(JSON.stringify(res.json), f);
    assert.equal(f.calls.length, 1, 'Exactly one read attempt is made');
  }, {
    enabled: false, authorized: true, provider: 'groq',
    groqKey: 'mock-groq-key', approvals: [makeMockGroqApproval()],
    mockResponse: async () =>
      new Response(JSON.stringify({ error: 'refused' }), { status: 500, headers: { 'content-type': 'application/json' } }),
  }));
