import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zeroPrices,
  eligibleOpenRouter,
} from '../server/extraction/policy.ts';

// ---------------------------------------------------------------------------
// Synthetic test fixtures for policy evaluation
// ---------------------------------------------------------------------------
const MOCK_NOW = '2026-11-07T09:00:00.000Z';
const VALID_POLICY_VERSION = '2026-11-07-v1';
const VALID_MODEL_ID = 'meta-llama/llama-3.2-11b-vision-instruct:free';
const VALID_ENDPOINT_TAG = 'openrouter/free-node';

function makeMockModel(overrides = {}) {
  return {
    id: VALID_MODEL_ID,
    name: 'Llama 3.2 11B Vision Instruct (free)',
    architecture: {
      modality: 'text+image->text',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    },
    pricing: {
      prompt: '0',
      completion: '0',
      image: '0',
      request: '0',
    },
    context_length: 128000,
    supported_parameters: ['max_tokens', 'response_format'],
    ...overrides,
  };
}

function makeMockEndpoint(overrides = {}) {
  return {
    id: 'ep-llama-32-free',
    model: VALID_MODEL_ID,
    tag: VALID_ENDPOINT_TAG,
    status: 0,
    pricing: {
      prompt: '0',
      completion: '0',
      image: '0',
      request: '0',
    },
    ...overrides,
  };
}

function makeMockZdr(overrides = {}) {
  return {
    model: VALID_MODEL_ID,
    tag: VALID_ENDPOINT_TAG,
    safety_retention: false,
    ...overrides,
  };
}

function makeMockByok(overrides = {}) {
  return {
    data: [],
    total_count: 0,
    ...overrides,
  };
}

function makeMockApproval(overrides = {}) {
  return {
    provider: 'openrouter',
    model: VALID_MODEL_ID,
    endpoint: VALID_ENDPOINT_TAG,
    maxImages: 1,
    expiresAt: '2026-12-31T23:59:59.000Z',
    policyVersion: VALID_POLICY_VERSION,
    ...overrides,
  };
}

function makeMockConfig(overrides = {}) {
  const approval = makeMockApproval();
  return {
    authorized: true,
    context: 'kw-docs',
    groqKey: null,
    openRouterKey: 'ephemeral-mock-key',
    groqFreeAccount: false,
    dataControlsApproved: true,
    openRouterNoByok: true,
    openRouterZdrOnly: true,
    approvals: [approval],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. zeroPrices Contract & Exhaustive Price Dimension Tests
// ---------------------------------------------------------------------------
test('zeroPrices accepts valid free pricing formats', () => {
  const standardFree = { prompt: '0', completion: '0.0', image: '0', request: '0' };
  assert.equal(zeroPrices(standardFree), true);

  // Numeric zeros
  const numericFree = { prompt: 0, completion: 0, image: 0, request: 0 };
  assert.equal(zeroPrices(numericFree), true);

  // String zeros with arbitrary decimal precision
  const multiDecimalFree = { prompt: '0.0000', completion: '0.0', image: '0.00', request: '0' };
  assert.equal(zeroPrices(multiDecimalFree), true);

  // Additional dimensions that are explicitly zero
  const zeroExtended = {
    ...standardFree,
    input_cache_read: '0',
    reasoning: '0.0',
    audio: '0.0000',
    tool: 0,
  };
  assert.equal(zeroPrices(zeroExtended), true);
});

test('zeroPrices rejects missing or null required price dimensions', () => {
  const base = { prompt: '0', completion: '0', image: '0', request: '0' };

  for (const dim of ['prompt', 'completion', 'image', 'request']) {
    const copy = { ...base };
    delete copy[dim];
    assert.equal(zeroPrices(copy), false, `Missing ${dim} must be rejected`);

    assert.equal(zeroPrices({ ...base, [dim]: null }), false, `Null ${dim} must be rejected`);
    assert.equal(zeroPrices({ ...base, [dim]: undefined }), false, `Undefined ${dim} must be rejected`);
  }

  // Entirely empty object
  assert.equal(zeroPrices({}), false);
});

test('zeroPrices rejects nonzero, negative, NaN, and string-exponent values', () => {
  const base = { prompt: '0', completion: '0', image: '0', request: '0' };

  // Positive nonzero values
  assert.equal(zeroPrices({ ...base, prompt: '0.001' }), false);
  assert.equal(zeroPrices({ ...base, completion: 0.05 }), false);
  assert.equal(zeroPrices({ ...base, image: '1.0' }), false);
  assert.equal(zeroPrices({ ...base, request: 0.00001 }), false);

  // Negative values
  assert.equal(zeroPrices({ ...base, prompt: '-0.001' }), false);
  assert.equal(zeroPrices({ ...base, prompt: -1 }), false);

  // NaN values
  assert.equal(zeroPrices({ ...base, prompt: NaN }), false);
  assert.equal(zeroPrices({ ...base, prompt: 'NaN' }), false);

  // String-exponent representations fail closed
  assert.equal(zeroPrices({ ...base, prompt: '1e-5' }), false);
  assert.equal(zeroPrices({ ...base, prompt: '0e0' }), false);
  assert.equal(zeroPrices({ ...base, prompt: '0.0e0' }), false);
});

test('zeroPrices rejects additional nonzero or unapproved pricing dimensions', () => {
  const base = { prompt: '0', completion: '0', image: '0', request: '0' };

  assert.equal(zeroPrices({ ...base, input_cache_read: '0.001' }), false);
  assert.equal(zeroPrices({ ...base, reasoning: '0.002' }), false);
  assert.equal(zeroPrices({ ...base, audio: '0.01' }), false);
  assert.equal(zeroPrices({ ...base, tool: '0.005' }), false);
  assert.equal(zeroPrices({ ...base, web_search: '0.02' }), false);
});

test('zeroPrices rejects non-object and malformed inputs', () => {
  assert.equal(zeroPrices(null), false);
  assert.equal(zeroPrices(undefined), false);
  assert.equal(zeroPrices([]), false);
  assert.equal(zeroPrices('free'), false);
  assert.equal(zeroPrices(0), false);
  assert.equal(zeroPrices(true), false);
});

// ---------------------------------------------------------------------------
// 2. eligibleOpenRouter Policy & Admission Gates
// ---------------------------------------------------------------------------
test('eligibleOpenRouter approves valid synthetic model, endpoint, ZDR, BYOK, and config', () => {
  const model = makeMockModel();
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const byok = makeMockByok();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  const eligible = eligibleOpenRouter(model, endpoint, zdr, byok, approval, config, MOCK_NOW);
  assert.equal(eligible, true);
});

test('eligibleOpenRouter validates model-level zero pricing and rejects paid or missing model pricing', () => {
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const byok = makeMockByok();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  // Positive control: valid zero pricing on both model and endpoint passes
  const validModel = makeMockModel();
  assert.equal(
    eligibleOpenRouter(validModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    true,
    'Model with explicit zero pricing must pass as positive control',
  );

  // Model with nonzero prompt price
  const nonzeroPromptModel = makeMockModel({
    pricing: { prompt: '0.001', completion: '0', image: '0', request: '0' },
  });
  assert.equal(
    eligibleOpenRouter(nonzeroPromptModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with nonzero prompt price must be rejected',
  );

  // Model with nonzero completion price
  const nonzeroCompletionModel = makeMockModel({
    pricing: { prompt: '0', completion: '0.002', image: '0', request: '0' },
  });
  assert.equal(
    eligibleOpenRouter(nonzeroCompletionModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with nonzero completion price must be rejected',
  );

  // Model with nonzero image price
  const nonzeroImageModel = makeMockModel({
    pricing: { prompt: '0', completion: '0', image: '0.005', request: '0' },
  });
  assert.equal(
    eligibleOpenRouter(nonzeroImageModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with nonzero image price must be rejected',
  );

  // Model with nonzero request price
  const nonzeroRequestModel = makeMockModel({
    pricing: { prompt: '0', completion: '0', image: '0', request: '0.0001' },
  });
  assert.equal(
    eligibleOpenRouter(nonzeroRequestModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with nonzero request price must be rejected',
  );

  // Model with missing pricing object entirely
  const { pricing: _removed, ...modelWithoutPricing } = validModel;
  assert.equal(
    eligibleOpenRouter(modelWithoutPricing, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model missing pricing object must be rejected',
  );

  // Model with null pricing
  const nullPricingModel = makeMockModel({ pricing: null });
  assert.equal(
    eligibleOpenRouter(nullPricingModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with null pricing must be rejected',
  );

  // Model missing individual required price dimensions
  for (const dim of ['prompt', 'completion', 'image', 'request']) {
    const incompletePricing = { prompt: '0', completion: '0', image: '0', request: '0' };
    delete incompletePricing[dim];
    const incompleteModel = makeMockModel({ pricing: incompletePricing });
    assert.equal(
      eligibleOpenRouter(incompleteModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
      false,
      `Model with missing ${dim} price must be rejected`,
    );

    const nullDimModel = makeMockModel({
      pricing: { prompt: '0', completion: '0', image: '0', request: '0', [dim]: null },
    });
    assert.equal(
      eligibleOpenRouter(nullDimModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
      false,
      `Model with null ${dim} price must be rejected`,
    );
  }

  // Model with nonzero extended price dimension
  const extendedPriceModel = makeMockModel({
    pricing: { prompt: '0', completion: '0', image: '0', request: '0', input_cache_read: '0.001' },
  });
  assert.equal(
    eligibleOpenRouter(extendedPriceModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    false,
    'Model with nonzero extended price dimension must be rejected',
  );
});

test('eligibleOpenRouter rejects endpoint mismatches, nonzero endpoint pricing, and unhealthy status', () => {
  const model = makeMockModel();
  const zdr = makeMockZdr();
  const byok = makeMockByok();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  // Positive control: valid endpoint with zero pricing passes
  const validEndpoint = makeMockEndpoint();
  assert.equal(
    eligibleOpenRouter(model, validEndpoint, zdr, byok, approval, config, MOCK_NOW),
    true,
    'Valid endpoint with zero pricing must pass as positive control',
  );

  // Wrong exact provider tag
  const wrongTagEndpoint = makeMockEndpoint({ tag: 'openrouter/other-node' });
  assert.equal(eligibleOpenRouter(model, wrongTagEndpoint, zdr, byok, approval, config, MOCK_NOW), false);

  // Nonzero endpoint prompt price
  const paidEndpointPrompt = makeMockEndpoint({
    pricing: { prompt: '0.001', completion: '0', image: '0', request: '0' },
  });
  assert.equal(eligibleOpenRouter(model, paidEndpointPrompt, zdr, byok, approval, config, MOCK_NOW), false);

  // Nonzero endpoint completion price
  const paidEndpointCompletion = makeMockEndpoint({
    pricing: { prompt: '0', completion: '0.005', image: '0', request: '0' },
  });
  assert.equal(eligibleOpenRouter(model, paidEndpointCompletion, zdr, byok, approval, config, MOCK_NOW), false);

  // Missing endpoint pricing
  const missingPricingEndpoint = makeMockEndpoint({ pricing: null });
  assert.equal(eligibleOpenRouter(model, missingPricingEndpoint, zdr, byok, approval, config, MOCK_NOW), false);

  // Nonzero extended endpoint price dimension
  const extendedPriceEndpoint = makeMockEndpoint({
    pricing: { prompt: '0', completion: '0', image: '0', request: '0', reasoning: '0.002' },
  });
  assert.equal(eligibleOpenRouter(model, extendedPriceEndpoint, zdr, byok, approval, config, MOCK_NOW), false);

  // Status non-zero (removed or offline)
  const offlineEndpoint = makeMockEndpoint({ status: 1 });
  assert.equal(eligibleOpenRouter(model, offlineEndpoint, zdr, byok, approval, config, MOCK_NOW), false);

  // Removed / null endpoint
  assert.equal(eligibleOpenRouter(model, null, zdr, byok, approval, config, MOCK_NOW), false);
});

test('eligibleOpenRouter rejects models without :free suffix and paid variants', () => {
  const modelIdWithoutFree = 'meta-llama/llama-3.2-11b-vision-instruct';
  const byok = makeMockByok();

  // Positive control: when model has :free suffix and all records align, it passes
  const validModelId = `${modelIdWithoutFree}:free`;
  const validModel = makeMockModel({ id: validModelId });
  const validEndpoint = makeMockEndpoint({ model: validModelId });
  const validZdr = makeMockZdr({ model: validModelId });
  const validApproval = makeMockApproval({ model: validModelId });
  const validConfig = makeMockConfig({ approvals: [validApproval] });
  assert.equal(
    eligibleOpenRouter(validModel, validEndpoint, validZdr, byok, validApproval, validConfig, MOCK_NOW),
    true,
    'Model with aligned :free suffix must pass as positive control',
  );

  // Missing :free suffix: all records aligned to isolate suffix check from identity mismatch
  const paidModel = makeMockModel({ id: modelIdWithoutFree });
  const paidEndpoint = makeMockEndpoint({ model: modelIdWithoutFree });
  const paidZdr = makeMockZdr({ model: modelIdWithoutFree });
  const paidApproval = makeMockApproval({ model: modelIdWithoutFree });
  const paidConfig = makeMockConfig({ approvals: [paidApproval] });
  assert.equal(
    eligibleOpenRouter(paidModel, paidEndpoint, paidZdr, byok, paidApproval, paidConfig, MOCK_NOW),
    false,
    'Model lacking :free suffix must be rejected despite aligned model/endpoint/ZDR/approval',
  );

  // Paid variant suffixes (:nitro, :extended) rejected despite aligned records
  for (const variantSuffix of [':nitro', ':extended']) {
    const variantId = `${modelIdWithoutFree}${variantSuffix}`;
    const variantModel = makeMockModel({ id: variantId });
    const variantEndpoint = makeMockEndpoint({ model: variantId });
    const variantZdr = makeMockZdr({ model: variantId });
    const variantApproval = makeMockApproval({ model: variantId });
    const variantConfig = makeMockConfig({ approvals: [variantApproval] });
    assert.equal(
      eligibleOpenRouter(variantModel, variantEndpoint, variantZdr, byok, variantApproval, variantConfig, MOCK_NOW),
      false,
      `Paid variant ${variantId} must be rejected despite aligned records`,
    );
  }
});

test('eligibleOpenRouter rejects router families and free router meta-IDs even with :free suffix', () => {
  const byok = makeMockByok();

  // Positive control: valid non-router model with :free suffix passes
  const validModel = makeMockModel();
  const validEndpoint = makeMockEndpoint();
  const validZdr = makeMockZdr();
  const validApproval = makeMockApproval();
  const validConfig = makeMockConfig({ approvals: [validApproval] });
  assert.equal(
    eligibleOpenRouter(validModel, validEndpoint, validZdr, byok, validApproval, validConfig, MOCK_NOW),
    true,
    'Valid non-router model must pass as positive control',
  );

  // Router-family IDs with aligned model, endpoint.model, ZDR.model, approval.model, and config approvals.
  // Both plain router IDs and router IDs with :free suffix are included to isolate router rejection from suffix rejection.
  const routerIds = [
    'openrouter/auto',
    'openrouter/auto:free',
    'openrouter/free',
    'openrouter/free:free',
    'openrouter/flavor',
    'openrouter/flavor:free',
  ];

  for (const routerId of routerIds) {
    const routerModel = makeMockModel({ id: routerId });
    const routerEndpoint = makeMockEndpoint({ model: routerId });
    const routerZdr = makeMockZdr({ model: routerId });
    const routerApproval = makeMockApproval({ model: routerId });
    const routerConfig = makeMockConfig({ approvals: [routerApproval] });

    assert.equal(
      eligibleOpenRouter(routerModel, routerEndpoint, routerZdr, byok, routerApproval, routerConfig, MOCK_NOW),
      false,
      `Router meta-model ${routerId} must be rejected despite aligned records and :free suffix`,
    );
  }
});

test('eligibleOpenRouter rejects models without vision input or text output modalities', () => {
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const byok = makeMockByok();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  // Positive control: model with vision input and text output passes
  const validModel = makeMockModel();
  assert.equal(
    eligibleOpenRouter(validModel, endpoint, zdr, byok, approval, config, MOCK_NOW),
    true,
    'Valid model with vision input and text output must pass as positive control',
  );

  // Missing image input capability
  const textOnlyModel = makeMockModel({
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
    },
  });
  assert.equal(eligibleOpenRouter(textOnlyModel, endpoint, zdr, byok, approval, config, MOCK_NOW), false);

  // Missing text output capability
  const nonTextOutputModel = makeMockModel({
    architecture: {
      modality: 'image->image',
      input_modalities: ['image'],
      output_modalities: ['image'],
    },
  });
  assert.equal(eligibleOpenRouter(nonTextOutputModel, endpoint, zdr, byok, approval, config, MOCK_NOW), false);
});

test('eligibleOpenRouter enforces Zero Data Retention (ZDR) and rejects safety retention', () => {
  const model = makeMockModel();
  const endpoint = makeMockEndpoint();
  const byok = makeMockByok();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  // Positive control: valid ZDR with safety_retention false passes
  const validZdr = makeMockZdr();
  assert.equal(
    eligibleOpenRouter(model, endpoint, validZdr, byok, approval, config, MOCK_NOW),
    true,
    'Valid ZDR with safety_retention false must pass as positive control',
  );

  // Safety retention true must be rejected
  const unsafeZdr = makeMockZdr({ safety_retention: true });
  assert.equal(eligibleOpenRouter(model, endpoint, unsafeZdr, byok, approval, config, MOCK_NOW), false);

  // Safety retention missing/undefined must be rejected
  const missingSafetyRetention = makeMockZdr({ safety_retention: undefined });
  assert.equal(eligibleOpenRouter(model, endpoint, missingSafetyRetention, byok, approval, config, MOCK_NOW), false);

  // Missing ZDR record must be rejected
  assert.equal(eligibleOpenRouter(model, endpoint, null, byok, approval, config, MOCK_NOW), false);

  // ZDR tag mismatch
  const mismatchedZdr = makeMockZdr({ tag: 'openrouter/wrong-tag' });
  assert.equal(eligibleOpenRouter(model, endpoint, mismatchedZdr, byok, approval, config, MOCK_NOW), false);
});

test('eligibleOpenRouter rejects non-empty or missing BYOK inventories', () => {
  const model = makeMockModel();
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const approval = makeMockApproval();
  const config = makeMockConfig({ approvals: [approval] });

  // Positive control: empty BYOK inventory passes
  const validByok = makeMockByok();
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, validByok, approval, config, MOCK_NOW),
    true,
    'Empty BYOK inventory must pass as positive control',
  );

  // BYOK key present (total_count > 0)
  const activeByok = makeMockByok({ total_count: 1, data: [{ id: 'byok-key-1' }] });
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, activeByok, approval, config, MOCK_NOW), false);

  // BYOK missing total_count
  const badByok = { data: [] };
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, badByok, approval, config, MOCK_NOW), false);

  // Missing BYOK record
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, null, approval, config, MOCK_NOW), false);
});

test('eligibleOpenRouter rejects expired approvals and policy mismatches', () => {
  const model = makeMockModel();
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const byok = makeMockByok();

  // Positive control: unexpired approval passes
  const validApproval = makeMockApproval();
  const validConfig = makeMockConfig({ approvals: [validApproval] });
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, byok, validApproval, validConfig, MOCK_NOW),
    true,
    'Unexpired approval must pass as positive control',
  );

  // Expired approval
  const expiredApproval = makeMockApproval({ expiresAt: '2026-11-06T23:59:59.000Z' });
  const config1 = makeMockConfig({ approvals: [expiredApproval] });
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, byok, expiredApproval, config1, MOCK_NOW),
    false,
  );

  // Approval expiring exactly at now
  const immediateExpiryApproval = makeMockApproval({ expiresAt: MOCK_NOW });
  const config2 = makeMockConfig({ approvals: [immediateExpiryApproval] });
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, byok, immediateExpiryApproval, config2, MOCK_NOW),
    false,
  );

  // OpenRouter maxImages > 1 must be rejected (initial OpenRouter contract is exactly 1)
  const multiImageApproval = makeMockApproval({ maxImages: 2 });
  const config3 = makeMockConfig({ approvals: [multiImageApproval] });
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, byok, multiImageApproval, config3, MOCK_NOW),
    false,
  );
});

test('eligibleOpenRouter enforces privacy attestations in config', () => {
  const model = makeMockModel();
  const endpoint = makeMockEndpoint();
  const zdr = makeMockZdr();
  const byok = makeMockByok();
  const approval = makeMockApproval();

  // Positive control: fully attested config passes
  const validConfig = makeMockConfig({ approvals: [approval] });
  assert.equal(
    eligibleOpenRouter(model, endpoint, zdr, byok, approval, validConfig, MOCK_NOW),
    true,
    'Fully attested config must pass as positive control',
  );

  // openRouterNoByok must be true
  const noByokFalse = makeMockConfig({ openRouterNoByok: false });
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, byok, approval, noByokFalse, MOCK_NOW), false);

  // openRouterZdrOnly must be true
  const zdrOnlyFalse = makeMockConfig({ openRouterZdrOnly: false });
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, byok, approval, zdrOnlyFalse, MOCK_NOW), false);

  // dataControlsApproved must be true
  const dataControlsFalse = makeMockConfig({ dataControlsApproved: false });
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, byok, approval, dataControlsFalse, MOCK_NOW), false);

  // authorized must be true
  const unauthorized = makeMockConfig({ authorized: false });
  assert.equal(eligibleOpenRouter(model, endpoint, zdr, byok, approval, unauthorized, MOCK_NOW), false);
});
