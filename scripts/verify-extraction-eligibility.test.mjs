import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionApi } from './fixtures/extraction-api.mjs';
import { makeMockApproval, makeMockModel, MOCK_ENDPOINT_TAG } from './fixtures/extraction-data.mjs';

const ROOT = 'https://openrouter.ai/api/v1';
const CATALOG = '/api/document-extraction/catalog?provider=openrouter';
const CORE = { prompt: '0', completion: '0' };
const LEGACY = { ...CORE, image: '0', request: '0' };
const NVIDIA = 'nvidia/nemotron-3.5-super-vl:free';
const REASONS = [
  'none', 'unsupported_images', 'unsupported_json', 'pricing_unverified', 'nonzero_pricing',
  'approval_required', 'privacy_policy', 'authorization_required', 'provider_unconfigured',
  'unsupported_model', 'not_free', 'router_model',
];
const OPTIONS = { enabled: false, authorized: true, provider: 'openrouter' };
const json = data => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' },
});
const snapshot = f => f.db.prepare("SELECT key, value FROM settings UNION ALL SELECT workspace_id || ':' || key, value FROM workspace_settings ORDER BY 1").all();

// Synthetic projections of the owner's 2026-11-10 public metadata captures.
// image/request are omitted at both levels; endpoint discount is metadata.
// The arbitrary fourth name prevents turning the production fix into a whitelist.
const PUBLISHED = [
  ['google/gemma-4-31b-it:free', 'Gemma 4 31B (free)'],
  ['google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B A4B (free)'],
  [NVIDIA, 'Nemotron 3.5 Super VL (free)'],
  ['synthetic/arbitrary-vision-2026:free', 'Arbitrary vision'],
].map(([id, name]) => makeMockModel({ id, name, pricing: { ...CORE } }));

function assertEntry(entry, status, reason) {
  assert.ok(entry, 'The provider model stays visible');
  assert.equal(entry.status, status, `${entry.id}: status`);
  assert.equal(entry.reason, reason, `${entry.id}: reason`);
  assert.ok(REASONS.includes(entry.reason), 'No provider text can become a reason');
  assert.deepEqual(Object.keys(entry).sort(),
    ['approval', 'id', 'label', 'maxImages', 'provider', 'reason', 'status']);
  assert.equal(entry.provider, 'openrouter');
  if (status === 'unverified' || status === 'unavailable') {
    assert.equal(entry.approval, null);
    assert.equal(entry.maxImages, null);
  } else {
    assert.equal(entry.maxImages, 1);
    if (status === 'approved') assert.equal(entry.approval, null);
    else assert.equal(JSON.parse(entry.approval).model, entry.id);
  }
}

function assertMetadataOnly(f, onlyModels = false) {
  assert.ok(f.calls.length > 0, 'Positive transport control');
  const allowed = new Set([`${ROOT}/models`, `${ROOT}/endpoints/zdr`, `${ROOT}/byok?limit=1&offset=0`]);
  assert.ok(f.calls.every(({ url, init }) =>
    (init.method ?? 'GET') === 'GET' && !init.body &&
    (onlyModels ? url === `${ROOT}/models` : allowed.has(url) ||
      /^https:\/\/openrouter\.ai\/api\/v1\/models\/[^/]+\/[^/]+\/endpoints$/.test(url))),
  'Only allowlisted metadata GETs; never chat, inference or image payloads');
  assert.equal(f.sendTextCalls.length, 0);
}

for (const model of PUBLISHED) {
  test(`public optional-fee metadata remains approved without inference: ${model.id}`, () =>
    extractionApi(async f => {
      const before = snapshot(f);
      const response = await f.request(CATALOG);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['data', 'error']);
      assert.deepEqual(Object.keys(response.json.data).sort(), ['entries', 'verification']);
      assert.equal(response.json.error, null);
      assert.equal(response.json.data.verification, 'live');
      assertMetadataOnly(f, true);
      assert.deepEqual(snapshot(f), before, 'Catalog never enables or changes settings');
      assertEntry(response.json.data.entries[0], 'approved', 'none');
    }, { ...OPTIONS, approvals: [makeMockApproval({ model: model.id })],
      transport: async () => json({ data: [model] }) }));
}

const OPTIONAL = ['image', 'request', 'audio', 'audio_output', 'image_output', 'image_token',
  'input_audio_cache', 'input_cache_read', 'input_cache_write', 'input_cache_write_1h',
  'internal_reasoning', 'web_search'];
const PRICING_CASES = [
  ['core-only', CORE, 'approvable', 'approval_required'],
  ['optional-zeros', { ...CORE, ...Object.fromEntries(OPTIONAL.map(k => [k, '0'])) }, 'approvable', 'approval_required'],
  ...[0, 0.5, 1].map(discount => [`discount-${discount}`, { ...LEGACY, discount }, 'approvable', 'approval_required']),
  ['empty-overrides', { ...CORE, overrides: [] }, 'approvable', 'approval_required'],
  ...['prompt', 'completion', ...OPTIONAL].map(k => [`paid-${k}`, { ...LEGACY, [k]: '0.001' }, 'unavailable', 'nonzero_pricing']),
  ['tiny-decimal-positive', { ...LEGACY, prompt: `0.${'0'.repeat(400)}1` }, 'unavailable', 'nonzero_pricing'],
  ...[0, 0.5, 1].map(discount => [`paid-discount-${discount}`, { ...LEGACY, prompt: '0.01', discount }, 'unavailable', 'nonzero_pricing']),
  ...[
    ['absent', undefined], ['null', null], ['empty', {}], ['array', []],
    ['missing-prompt', { completion: '0' }], ['missing-completion', { prompt: '0' }],
    ['null-core', { ...LEGACY, prompt: null }], ['null-optional', { ...LEGACY, image: null }],
    ['exponent', { ...LEGACY, prompt: '0e0' }], ['underflow', { ...LEGACY, prompt: '1e-400' }],
    ['negative', { ...LEGACY, prompt: '-1' }], ['boolean', { ...LEGACY, prompt: false }],
    ['unknown-zero', { ...LEGACY, undocumented_fee: '0' }],
    ['unknown-positive', { ...LEGACY, undocumented_fee: '0.01' }],
    ['overrides', { ...LEGACY, overrides: [{ prompt: '0', completion: '0' }] }],
    ['bad-overrides', { ...LEGACY, overrides: {} }],
    ['negative-discount', { ...LEGACY, discount: -1 }],
    ['excess-discount', { ...LEGACY, discount: 1.01 }],
    ['string-discount', { ...LEGACY, discount: '0' }],
  ].map(([name, pricing]) => [name, pricing, 'unverified', 'pricing_unverified']),
];

test('HTTP catalogue classifies charges and unknown pricing independently with sanitized reasons', t =>
  extractionApi(async f => {
    const response = await f.request(CATALOG);
    assert.equal(response.status, 200);
    assertMetadataOnly(f, true);
    const entries = new Map(response.json.data.entries.map(entry => [entry.id, entry]));
    assert.equal(entries.size, PRICING_CASES.length);
    // Subtests preserve every named result even when an earlier case is RED.
    for (const [name, , status, reason] of PRICING_CASES) {
      await t.test(`pricing catalogue: ${name}`, () => assertEntry(entries.get(`synthetic/${name}:free`), status, reason));
    }
    const raw = JSON.stringify(response.json);
    for (const secret of ['synthetic-private-provider-message', 'synthetic-policy-secret', f.config.extraction.openRouterKey]) {
      assert.ok(!raw.includes(secret), 'No raw transport/config payload in the catalogue');
    }
  }, { ...OPTIONS, approvals: [], transport: async () => json({ data: PRICING_CASES.map(([name, pricing]) =>
    makeMockModel({ id: `synthetic/${name}:free`, pricing,
      provider_message: 'synthetic-private-provider-message', policy: 'synthetic-policy-secret' })) }) }));

const REASON_CASES = [
  ['missing approval', {}, { approvals: [] }, 'approvable', 'approval_required'],
  ['missing images', { architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] } }, {}, 'unavailable', 'unsupported_images'],
  ['missing JSON', { supported_parameters: ['max_tokens'] }, {}, 'unavailable', 'unsupported_json'],
  ['missing max_tokens', { supported_parameters: ['response_format'] }, {}, 'unavailable', 'unsupported_json'],
  ['data controls unattested', {}, { dataControlsApproved: false }, 'unverified', 'privacy_policy'],
  ['ZDR unattested', {}, { openRouterZdrOnly: false }, 'unverified', 'privacy_policy'],
  ['no BYOK unattested', {}, { openRouterNoByok: false }, 'unverified', 'privacy_policy'],
];
for (const [name, overrides, options, status, reason] of REASON_CASES) {
  test(`catalogue distinguishes ${name} without claiming a live privacy probe`, () =>
    extractionApi(async f => {
      const response = await f.request(CATALOG);
      assert.equal(response.status, 200);
      assertMetadataOnly(f, true);
      assertEntry(response.json.data.entries[0], status, reason);
    }, { ...OPTIONS, ...options, transport: async () => json({ data: [makeMockModel(overrides)] }) }));
}

// Catalogue capability/price metadata never substitutes for fresh exact endpoint
// privacy proof. Gate the real provider transport while a real enabling PUT waits.
for (const [name, pricing, refusal, modelId = NVIDIA] of [
  ['unchanged legacy eligible control', LEGACY, null],
  ['public core-only eligible control', CORE, null],
  ['arbitrary core-only eligible control', CORE, null, 'synthetic/arbitrary-vision-2026:free'],
  ['Nvidia absent ZDR proof', LEGACY, 'absent-zdr'],
  ['Nvidia safety retention', LEGACY, 'retention'],
  ['Nvidia public core-only absent ZDR', CORE, 'absent-zdr'],
  ['paid endpoint optional fee', LEGACY, 'paid-endpoint'],
  ['unknown endpoint pricing', LEGACY, 'unknown-endpoint'],
  ['BYOK attached', LEGACY, 'byok'],
]) {
  test(`atomic enabling: ${name}`, () => {
    let entered;
    let release;
    let hold = false;
    const entry = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const transport = async url => {
      if (url === `${ROOT}/models`) return json({ data: [makeMockModel({ id: modelId, pricing })] });
      if (url.endsWith('/endpoints')) return json({ data: { id: modelId, endpoints: [{
        model_id: modelId, tag: MOCK_ENDPOINT_TAG, status: 0,
        pricing: { ...pricing, discount: 0,
          ...(refusal === 'paid-endpoint' ? { web_search: '0.01' } : {}),
          ...(refusal === 'unknown-endpoint' ? { new_fee: '0' } : {}) },
      }] } });
      if (url === `${ROOT}/endpoints/zdr`) {
        if (hold) { entered(); await gate; }
        return json({ data: refusal === 'absent-zdr' ? [] : [{ model_id: modelId,
          tag: MOCK_ENDPOINT_TAG, status: 0, safety_retention: refusal === 'retention' }] });
      }
      if (url === `${ROOT}/byok?limit=1&offset=0`) return json(refusal === 'byok'
        ? { total_count: 1, data: [{ id: 'synthetic-key' }] } : { total_count: 0, data: [] });
      throw new Error(`Unexpected metadata/inference transport: ${url}`);
    };
    return extractionApi(async f => {
      const before = snapshot(f);
      const listed = await f.request(CATALOG);
      assert.equal(listed.status, 200);
      assertMetadataOnly(f, true);
      hold = true;
      const controller = new AbortController();
      const pending = f.request('/api/settings', { method: 'PUT', signal: controller.signal, body: { settings: {
        'email.enabled': true,
        'ai_extraction.enabled': true, 'ai_extraction.provider': 'openrouter', 'ai_extraction.model': modelId,
      } } });
      let timer;
      try {
        await Promise.race([entry, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('ZDR metadata entry timed out')), 2500);
        })]);
        assert.deepEqual(snapshot(f), before, 'No partial write while privacy proof is pending');
        release();
        const result = await pending;
        assertMetadataOnly(f);
        if (refusal) {
          assert.equal(result.status, 400);
          assert.equal(result.json.error.code, 'invalid_settings');
          assert.deepEqual(snapshot(f), before, 'Refused selection must roll back all settings including email');
        } else {
          assert.equal(result.status, 200);
          assert.equal(result.json.error, null);
          const values = new Map(snapshot(f).map(row => [row.key, JSON.parse(row.value)]));
          assert.equal(values.get('ws_legacy:ai_extraction.enabled'), true);
          assert.equal(values.get('ws_legacy:ai_extraction.model'), modelId);
          assert.equal(values.get('ws_legacy:ai_extraction.provider'), 'openrouter');
          assert.equal(values.get('ws_legacy:email.enabled'), true);
        }
      } finally {
        clearTimeout(timer);
        release();
        const cleanupTimer = setTimeout(() => controller.abort(), 3000);
        try { await pending; } finally { clearTimeout(cleanupTimer); }
      }
    }, { ...OPTIONS, provider: '', model: '',
      openRouterKey: 'synthetic-openrouter-key', approvals: [makeMockApproval({ model: modelId })], transport });
  });
}
