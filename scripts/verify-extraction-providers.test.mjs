import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/db/migrator.ts';
import { insertRow } from '../server/repositories/base.ts';
import { setSetting } from '../server/repositories/settings.ts';
import {
  VALID_PNG_BASE64, MOCK_MODEL_ID, MOCK_ENDPOINT_TAG, MOCK_GROQ_MODEL_ID, MOCK_GROQ_ENDPOINT,
  makeRawPage, makeMockModel, makeMockEndpoint, makeMockZdr, makeMockByok,
  makeMockApproval, makeMockGroqApproval, makeMockGroqModels,
} from './fixtures/extraction-data.mjs';
import { settingsVersion } from '../server/extraction/policy.ts';
import { readCatalogs } from '../server/extraction/catalog.ts';
import { extractBatch } from '../server/extraction/provider.ts';
import { createExtractionService } from '../server/extraction/service.ts';
import { readBoundedJson, buildProviderUrl } from '../server/extraction/http.ts';
import { extractionApi } from './fixtures/extraction-api.mjs';

function createServiceTestHarness(provider = 'groq') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  runMigrations(db, path.resolve('server/db/migrations'));

  for (const role of ['admin', 'viewer']) {
    db.prepare("INSERT INTO admin_users(id, email, name, role, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')")
      .run(role, `${role}@example.invalid`, `Synthetic ${role}`, role, 'hash');
  }

  const company = insertRow(db, 'companies', { name: 'Synthetic Company', name_ar: 'شركة اختبار' });
  insertRow(db, 'document_types', { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' });
  insertRow(db, 'ministries', { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' });

  const validScope = `company:${company.id}`;
  const revision = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : '12345678-1234-4234-8234-123456789abc';
  db.prepare("INSERT INTO document_drafts(user_id, scope, revision, values_json, updated_at) VALUES('admin', ?, ?, '{}', '2026-01-01T00:00:00.000Z')").run(validScope, revision);

  const model = provider === 'groq' ? MOCK_GROQ_MODEL_ID : MOCK_MODEL_ID;
  setSetting(db, 'ai_extraction.enabled', true);
  setSetting(db, 'ai_extraction.provider', provider);
  setSetting(db, 'ai_extraction.model', model);

  const config = {
    env: 'test',
    extraction: {
      authorized: true, context: 'kw-docs',
      groqKey: provider === 'groq' ? 'test-groq-key' : null,
      openRouterKey: provider === 'openrouter' ? 'test-openrouter-key' : null,
      groqFreeAccount: true, dataControlsApproved: true, openRouterNoByok: true, openRouterZdrOnly: true,
      approvals: [provider === 'groq' ? makeMockGroqApproval() : makeMockApproval({ model, endpoint: MOCK_ENDPOINT_TAG })],
    },
  };

  const images10 = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, mime: 'image/png', base64: VALID_PNG_BASE64 }));
  const validRequest = {
    requestId: '12345678-1234-4234-8234-123456789abc',
    scope: validScope,
    context: config.extraction.context,
    settingsVersion: settingsVersion(db, config),
    catalogVersion: readCatalogs(db).version,
    pageCount: 10,
    images: images10,
  };

  return { db, config, validRequest, validScope };
}

// ---------------------------------------------------------------------------
// 1. Exact Outbound Wire Protocol & Privacy Bounds (OpenRouter & Groq)
// ---------------------------------------------------------------------------

test('OpenRouter chat completions request enforces strict headers, zero ceilings and privacy fields', async () => {
  const calls = [];
  const mockTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ model: MOCK_MODEL_ID, choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-secret-openrouter-key' };
  const pages = await extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport);
  assert.equal(pages.length, 1);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.cache, 'no-store');

  const headers = new Headers(call.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-secret-openrouter-key');
  assert.equal(headers.get('content-type'), 'application/json');

  const body = JSON.parse(call.init.body);
  assert.equal(body.model, MOCK_MODEL_ID);
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.provider, {
    only: [MOCK_ENDPOINT_TAG], order: [MOCK_ENDPOINT_TAG], allow_fallbacks: false,
    require_parameters: true, data_collection: 'deny', zdr: true,
    max_price: { prompt: 0, completion: 0, image: 0, request: 0 },
  });
  for (const f of ['tools', 'plugins', 'models', 'route', 'user']) assert.equal(body[f], undefined);

  const userMessage = body.messages.find((m) => m.role === 'user');
  const imagePart = userMessage.content.find((p) => p.type === 'image_url');
  assert.equal(imagePart.image_url.url, `data:image/png;base64,${VALID_PNG_BASE64}`);
});

test('Groq completions request enforces fixed endpoint, max_completion_tokens and clean body', async () => {
  const calls = [];
  const mockTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ model: MOCK_GROQ_MODEL_ID, choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1), makeRawPage(2), makeRawPage(3)] }) }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = { provider: 'groq', model: MOCK_GROQ_MODEL_ID, endpoint: MOCK_GROQ_ENDPOINT, maxImages: 3, key: 'test-secret-groq-key' };
  const images = [1, 2, 3].map((page) => ({ page, mime: 'image/png', base64: VALID_PNG_BASE64 }));
  const pages = await extractBatch(selection, images, new AbortController().signal, mockTransport);
  assert.equal(pages.length, 3);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');

  const headers = new Headers(call.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-secret-groq-key');

  const body = JSON.parse(call.init.body);
  assert.equal(body.model, MOCK_GROQ_MODEL_ID);
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, 4096);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.tools, undefined);
  assert.equal(body.provider, undefined);
});

// ---------------------------------------------------------------------------
// 2. Full Service Batching Behavior (Exercising Task 9 Service)
// ---------------------------------------------------------------------------

test('10 pages on Groq yield 4 batches of 3, 3, 3, 1 via extraction service', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const batchImageCounts = [];

  const mockTransport = async (url, init) => {
    if (url === 'https://api.groq.com/openai/v1/models') return new Response(JSON.stringify(makeMockGroqModels()), { status: 200 });
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      const body = JSON.parse(init.body);
      const imageParts = body.messages.find((m) => m.role === 'user').content.filter((p) => p.type === 'image_url');
      batchImageCounts.push(imageParts.length);
      const start = batchImageCounts.reduce((acc, c) => acc + c, 0) - imageParts.length;
      const pages = Array.from({ length: imageParts.length }, (_, i) => makeRawPage(start + i + 1));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages }) }, finish_reason: 'stop' }] }), { status: 200 });
    }
    throw new Error('unexpected: ' + url);
  };
  const service = createExtractionService(config, db, mockTransport);
  const result = await service.run(validRequest, 'admin', new AbortController().signal);
  assert.ok(result);
  assert.equal(result.pageCount, 10);
  assert.deepEqual(batchImageCounts, [3, 3, 3, 1]);
});

test('failure in batch 2 halts service processing immediately and yields no later batches', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  let chatCalls = 0;
  const mockTransport = async (url) => {
    if (url === 'https://api.groq.com/openai/v1/models') return new Response(JSON.stringify(makeMockGroqModels()), { status: 200 });
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      chatCalls++;
      if (chatCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1), makeRawPage(2), makeRawPage(3)] }) }, finish_reason: 'stop' }] }), { status: 200 });
      if (chatCalls === 2) return new Response(JSON.stringify({ error: { message: 'upstream failure' } }), { status: 500 });
      assert.fail('Batch 3 or 4 was called after Batch 2 failed');
    }
    throw new Error('unexpected: ' + url);
  };
  const service = createExtractionService(config, db, mockTransport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'provider_unavailable');
  assert.equal(chatCalls, 2);
});

test('10 pages on OpenRouter yield 10 single-image batches sequentially via service', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  let chatCalls = 0;
  const mockTransport = async (url, init) => {
    if (url === 'https://openrouter.ai/api/v1/models') return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
    if (url.endsWith('/endpoints')) return new Response(JSON.stringify({ data: { id: MOCK_MODEL_ID, endpoints: [{ ...makeMockEndpoint(), model: undefined, model_id: MOCK_MODEL_ID }] } }), { status: 200 });
    if (url.includes('/endpoints/zdr')) return new Response(JSON.stringify({ data: [{ ...makeMockZdr(), model: undefined, model_id: MOCK_MODEL_ID }] }), { status: 200 });
    if (url.includes('/byok')) return new Response(JSON.stringify(makeMockByok()), { status: 200 });
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      chatCalls++;
      const imageParts = JSON.parse(init.body).messages.find((m) => m.role === 'user').content.filter((p) => p.type === 'image_url');
      assert.equal(imageParts.length, 1);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(chatCalls)] }) }, finish_reason: 'stop' }] }), { status: 200 });
    }
    throw new Error('unexpected: ' + url);
  };
  const service = createExtractionService(config, db, mockTransport);
  const result = await service.run(validRequest, 'admin', new AbortController().signal);
  assert.ok(result);
  assert.equal(result.pageCount, 10);
  assert.equal(chatCalls, 10);
});

// ---------------------------------------------------------------------------
// 3. Dynamic Revocation During Batches
// ---------------------------------------------------------------------------

function makeRevocationTransport(onBatch1) {
  let chatCalls = 0;
  const transport = async (url) => {
    if (url.includes('/models')) return new Response(JSON.stringify(makeMockGroqModels()), { status: 200 });
    chatCalls++;
    if (chatCalls === 1) {
      onBatch1();
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1), makeRawPage(2), makeRawPage(3)] }) }, finish_reason: 'stop' }] }), { status: 200 });
    }
    assert.fail('Batch 2 was sent after revocation');
  };
  return { transport, getCalls: () => chatCalls };
}

test('admin role revocation during batches halts extraction with 403', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const h = makeRevocationTransport(() => db.prepare("UPDATE admin_users SET role = 'viewer' WHERE id = 'admin'").run());
  const service = createExtractionService(config, db, h.transport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'forbidden');
  assert.equal(h.getCalls(), 1);
});

test('settings change during batches halts extraction with 409 stale_settings', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const h = makeRevocationTransport(() => setSetting(db, 'ai_extraction.enabled', false));
  const service = createExtractionService(config, db, h.transport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'stale_settings');
  assert.equal(h.getCalls(), 1);
});

test('catalog revocation during batches halts extraction with 409 stale_catalog', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const h = makeRevocationTransport(() => insertRow(db, 'document_types', { id: 'type-driver-license', name: 'Driver License', name_ar: 'رخصة قيادة' }));
  const service = createExtractionService(config, db, h.transport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'stale_catalog');
  assert.equal(h.getCalls(), 1);
});

test('context change during batches halts extraction with 409 context_mismatch', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const h = makeRevocationTransport(() => { config.extraction.context = 'revoked-context'; });
  const service = createExtractionService(config, db, h.transport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'context_mismatch');
  assert.equal(h.getCalls(), 1);
});

test('endpoint eligibility change during batches halts extraction with provider_policy', async () => {
  const { db, config, validRequest } = createServiceTestHarness('groq');
  const h = makeRevocationTransport(() => { config.extraction.approvals = []; });
  const service = createExtractionService(config, db, h.transport);
  await assert.rejects(() => service.run(validRequest, 'admin', new AbortController().signal), (err) => err.code === 'provider_policy' || err.code === 'stale_settings');
  assert.equal(h.getCalls(), 1);
});

// ---------------------------------------------------------------------------
// 4. Upstream Error Mappings, Retry-After & No Auto-Retry
// ---------------------------------------------------------------------------

const errorCases = [
  { status: 401, expectedCode: 'provider_auth' }, { status: 402, expectedCode: 'provider_balance' },
  { status: 403, expectedCode: 'provider_policy' }, { status: 429, expectedCode: 'provider_rate_limit' },
  { status: 500, expectedCode: 'provider_unavailable' }, { status: 503, expectedCode: 'provider_unavailable' },
];

for (const { status, expectedCode } of errorCases) {
  test(`upstream status ${status} maps to ${expectedCode} and does not auto-retry`, async () => {
    let attempts = 0;
    const mockTransport = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: `Simulated error ${status}` } }), {
        status, headers: status === 429 ? { 'Retry-After': '15' } : {},
      });
    };
    const selection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
    await assert.rejects(
      () => extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport),
      (err) => {
        assert.equal(err.code, expectedCode);
        if (status === 429) assert.equal(err.retryAfterSeconds, 15);
        return true;
      }
    );
    assert.equal(attempts, 1);
  });
}

test('Retry-After header variations parse seconds, date, absent and clamp excessive', async () => {
  const sel = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  const img = [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }];
  const sig = new AbortController().signal;

  await assert.rejects(() => extractBatch(sel, img, sig, async () => new Response('{}', { status: 429, headers: { 'Retry-After': '45' } })), (err) => err.retryAfterSeconds === 45);
  const future = new Date(Date.now() + 60000).toUTCString();
  await assert.rejects(() => extractBatch(sel, img, sig, async () => new Response('{}', { status: 429, headers: { 'Retry-After': future } })), (err) => err.retryAfterSeconds >= 58 && err.retryAfterSeconds <= 62);
  await assert.rejects(() => extractBatch(sel, img, sig, async () => new Response('{}', { status: 429 })), (err) => err.retryAfterSeconds === 30);
  await assert.rejects(() => extractBatch(sel, img, sig, async () => new Response('{}', { status: 429, headers: { 'Retry-After': '86400' } })), (err) => err.retryAfterSeconds === 300);
});

// ---------------------------------------------------------------------------
// 5. Response Bounds, Streaming Limits & Malformed Payloads
// ---------------------------------------------------------------------------

test('readBoundedJson rejects chunked response stream exceeding 64 KiB', async () => {
  const response = new Response('x'.repeat(70 * 1024), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => readBoundedJson(response, 64 * 1024, new AbortController().signal), (err) => err.code === 'payload_too_large');
});

test('readBoundedJson aborts promptly when stream hangs and cancels reader', async () => {
  const controller = new AbortController();
  let readerCancelled = false;
  let enteredStream;
  const streamEntered = new Promise((resolve) => { enteredStream = resolve; });

  const stream = new ReadableStream({
    start(controllerStream) {
      controllerStream.enqueue(new TextEncoder().encode('{"partial":'));
      enteredStream();
    },
    cancel() { readerCancelled = true; },
  });

  const response = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
  const readPromise = readBoundedJson(response, 64 * 1024, controller.signal);
  await streamEntered;
  controller.abort();

  await assert.rejects(readPromise, (err) => err.name === 'AbortError');
  assert.equal(readerCancelled, true, 'Stream reader must be cancelled upon abort');
});

test('message content exceeding 16 KiB inside JSON is rejected', async () => {
  const mockTransport = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'a'.repeat(18 * 1024) }, finish_reason: 'stop' }] }), { status: 200 });
  const selection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  await assert.rejects(() => extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport), (err) => err.code === 'payload_too_large');
});

test('malformed JSON response rejects with provider_malformed_response', async () => {
  const mockTransport = async () => new Response('{"not_valid_json: 123', { status: 200 });
  const selection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  await assert.rejects(() => extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport), (err) => err.code === 'provider_malformed_response');
});

test('finish_reason: length rejects with truncated_output', async () => {
  const mockTransport = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"pages":[{"page":1' }, finish_reason: 'length' }] }), { status: 200 });
  const selection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  await assert.rejects(() => extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport), (err) => err.code === 'truncated_output');
});

// ---------------------------------------------------------------------------
// 6. URL Safety & Host Whitelisting (buildProviderUrl)
// ---------------------------------------------------------------------------

test('acquire 45-second production deadline aborts hanging execution with 504 extraction_timeout and releases slot', async () => {
  const timers = new Map();
  let timerId = 0, now = Date.now(), chatCalls = 0;
  const clock = {
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    now: () => now,
  };
  const transport = async (url, init) => {
    if (url === 'https://api.groq.com/openai/v1/models') return new Response(JSON.stringify(makeMockGroqModels()));
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    if (++chatCalls > 1) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) }, finish_reason: 'stop' }] }));
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
    });
  };
  await extractionApi(async f => {
    const options = { method: 'POST', body: f.validRequest, headers: { 'x-draft-account': 'admin' } };
    const pending = f.request('/api/document-extraction', options);
    await f.waitForTransportCall(call => call.url.endsWith('/chat/completions'));
    const deadline = [...timers.entries()].find(([, timer]) => timer.ms === 45000);
    assert.ok(deadline, 'Production admission must schedule its overall deadline');
    timers.delete(deadline[0]);
    now += 45000;
    deadline[1].callback();
    const response = await pending;
    assert.equal(response.status, 504);
    assert.equal(response.json.error.code, 'extraction_timeout');
    const settled = await f.waitForTransportSettlement(call => call.url.endsWith('/chat/completions'));
    assert.equal(settled.init.signal.aborted, true);
    assert.equal(chatCalls, 1, 'Deadline must not trigger retry');
    const retry = await f.request('/api/document-extraction', options);
    assert.equal(retry.status, 200, 'Settled timed-out request must release its admission slot');
    assert.equal(retry.json.error, null);
    assert.equal(chatCalls, 2);
  }, { enabled: true, authorized: true, provider: 'groq', model: MOCK_GROQ_MODEL_ID, clock, transport });
});

test('service and URL builder reject malicious system input before transport with valid control', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  const calls = [];
  const spyTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
  };

  setSetting(db, 'ai_extraction.model', '../../admin/secret');
  validRequest.settingsVersion = settingsVersion(db, config);
  const service = createExtractionService(config, db, spyTransport);
  await assert.rejects(
    () => service.run(validRequest, 'admin', new AbortController().signal),
    (err) => err.code === 'provider_policy' || err.code === 'invalid_model' || /invalid|policy/i.test(err.message)
  );
  assert.equal(calls.length, 0, 'No transport call when system model is malicious traversal');

  const maliciousSelection = { provider: 'openrouter', model: '../../admin/secret', endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  await assert.rejects(
    () => extractBatch(maliciousSelection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, spyTransport),
    (err) => err.code === 'invalid_model' || /invalid_model/i.test(err.message)
  );
  assert.equal(calls.length, 0, 'URL builder must reject malicious model traversal before transport');

  const validSelection = { provider: 'openrouter', model: MOCK_MODEL_ID, endpoint: MOCK_ENDPOINT_TAG, maxImages: 1, key: 'test-key' };
  const positiveTransport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ model: MOCK_MODEL_ID, choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const pages = await extractBatch(validSelection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, positiveTransport);
  assert.equal(pages.length, 1);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.cache, 'no-store');
});

test('buildProviderUrl prohibits path traversal, queries, and fragments in model slug', () => {
  assert.throws(() => buildProviderUrl('openrouter', '/chat/completions', '../../admin/secret'), /invalid_model/);
  assert.throws(() => buildProviderUrl('openrouter', '/chat/completions', 'author/nested/slug'), /invalid_model/);
  assert.throws(() => buildProviderUrl('openrouter', '/chat/completions', 'author/slug?param=1'), /invalid_model/);
  assert.throws(() => buildProviderUrl('openrouter', '/chat/completions', 'author/slug#fragment'), /invalid_model/);
  assert.throws(() => buildProviderUrl('openrouter', '/chat/completions', 'author%2Fslug'), /invalid_model/);
  const validUrl = buildProviderUrl('openrouter', '/chat/completions', 'author/valid-slug');
  assert.ok(validUrl.startsWith('https://openrouter.ai/'));
});

// ---------------------------------------------------------------------------
// 7. Targeted Task 8/9 Regression: 64KiB Envelopes, Revocation & Wire Envelopes
// ---------------------------------------------------------------------------

test('extractBatch rejects chunked response exceeding 64 KiB envelope limit', async () => {
  const stream = new ReadableStream({
    start(controller) {
      const chunk = new TextEncoder().encode('{"extra":"' + 'a'.repeat(66 * 1024) + '"}');
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const mockTransport = async () =>
    new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
  const selection = {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    key: 'test-key',
  };
  await assert.rejects(
    () =>
      extractBatch(
        selection,
        [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }],
        new AbortController().signal,
        mockTransport,
      ),
    (err) => err.code === 'payload_too_large',
  );
});

test('revocation during deferred metadata halts extraction and prevents any following metadata or chat inference', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  let chatCalls = 0;
  let metadataCalls = 0;
  const mockTransport = async (url) => {
    if (url.includes('/models')) {
      metadataCalls++;
      // While first metadata call is resolving, revoke admin role
      db.prepare("UPDATE admin_users SET role = 'viewer' WHERE id = 'admin'").run();
      return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
    }
    if (url.endsWith('/endpoints') || url.includes('/endpoints/zdr') || url.includes('/byok')) {
      metadataCalls++;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.includes('/chat/completions')) {
      chatCalls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error('unexpected: ' + url);
  };
  const service = createExtractionService(config, db, mockTransport);
  await assert.rejects(
    () => service.run(validRequest, 'admin', new AbortController().signal),
    (err) => err.code === 'forbidden',
  );
  assert.equal(chatCalls, 0, 'No chat completion must be called after metadata revocation');
});

test('service integration accepts documented OpenRouter raw envelopes with data.endpoints and model_id', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  let chatCalled = false;
  const mockTransport = async (url) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
    }
    if (url.endsWith('/endpoints')) {
      // Documented OpenRouter wire shape: data object with id and endpoints array containing model_id
      return new Response(
        JSON.stringify({
          data: {
            id: MOCK_MODEL_ID,
            endpoints: [
              {
                model_id: MOCK_MODEL_ID,
                tag: MOCK_ENDPOINT_TAG,
                status: 0,
                pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes('/endpoints/zdr')) {
      // Documented OpenRouter ZDR preview wire shape: data array with model_id, tag, safety_retention
      return new Response(
        JSON.stringify({
          data: [
            {
              model_id: MOCK_MODEL_ID,
              tag: MOCK_ENDPOINT_TAG,
              status: 0,
              safety_retention: false,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/byok')) {
      return new Response(JSON.stringify(makeMockByok()), { status: 200 });
    }
    if (url.includes('/chat/completions')) {
      chatCalled = true;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error('unexpected: ' + url);
  };

  const req = { ...validRequest, pageCount: 1, images: [validRequest.images[0]] };
  const service = createExtractionService(config, db, mockTransport);
  const result = await service.run(req, 'admin', new AbortController().signal);
  assert.ok(result);
  assert.equal(chatCalled, true);
});

test('service integration rejects legacy invented endpoints array without documented structure', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  const mockTransport = async (url) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
    }
    if (url.endsWith('/endpoints')) {
      // Legacy invented shape: data is array of endpoints with internal 'model' key instead of documented object
      return new Response(
        JSON.stringify({
          data: [
            {
              model: MOCK_MODEL_ID,
              tag: MOCK_ENDPOINT_TAG,
              status: 0,
              pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/endpoints/zdr')) {
      return new Response(
        JSON.stringify({
          data: [{ model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, safety_retention: false }],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/byok')) {
      return new Response(JSON.stringify(makeMockByok()), { status: 200 });
    }
    throw new Error('unexpected: ' + url);
  };

  const req = { ...validRequest, pageCount: 1, images: [validRequest.images[0]] };
  const service = createExtractionService(config, db, mockTransport);
  await assert.rejects(
    () => service.run(req, 'admin', new AbortController().signal),
    (err) => err.code === 'provider_policy',
  );
});

test('service integration rejects OpenRouter ZDR preview missing explicit safety_retention false proof', async () => {
  const { db, config, validRequest } = createServiceTestHarness('openrouter');
  const mockTransport = async (url) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      return new Response(JSON.stringify({ data: [makeMockModel()] }), { status: 200 });
    }
    if (url.endsWith('/endpoints')) {
      return new Response(
        JSON.stringify({
          data: {
            id: MOCK_MODEL_ID,
            endpoints: [
              {
                model_id: MOCK_MODEL_ID,
                tag: MOCK_ENDPOINT_TAG,
                status: 0,
                pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes('/endpoints/zdr')) {
      // Missing explicit safety_retention: false (here true)
      return new Response(
        JSON.stringify({
          data: [{ model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, status: 0, safety_retention: true }],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/byok')) {
      return new Response(JSON.stringify(makeMockByok()), { status: 200 });
    }
    throw new Error('unexpected: ' + url);
  };

  const req = { ...validRequest, pageCount: 1, images: [validRequest.images[0]] };
  const service = createExtractionService(config, db, mockTransport);
  await assert.rejects(
    () => service.run(req, 'admin', new AbortController().signal),
    (err) => err.code === 'provider_policy',
  );
});

// ---------------------------------------------------------------------------
// 9. Provider Wire Identity Bounds (Contradictory vs Absent Wire Field)
// ---------------------------------------------------------------------------

test('extractBatch accepts matching model identity (valid positive control)', async () => {
  const mockTransport = async () => {
    return new Response(
      JSON.stringify({
        model: MOCK_MODEL_ID,
        choices: [
          {
            message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    key: 'test-key',
  };

  const pages = await extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 1);
});

test('extractBatch rejects contradictory model identity with provider_identity_mismatch', async () => {
  const mockTransport = async () => {
    return new Response(
      JSON.stringify({
        model: 'rogue-unapproved/model:free',
        choices: [
          {
            message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    key: 'test-key',
  };

  await assert.rejects(
    () => extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport),
    (err) => {
      assert.equal(err.code, 'provider_identity_mismatch');
      return true;
    }
  );
});

test('extractBatch characterization: accepts provider response when model wire field is absent in payload', async () => {
  // Existing code behavior characterization: when model field is omitted by provider, readPages does not enforce presence.
  const mockTransport = async () => {
    return new Response(
      JSON.stringify({
        // model wire field absent (undefined)
        choices: [
          {
            message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    key: 'test-key',
  };

  const pages = await extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 1);
});

test('extractBatch pins endpoint in request body while documenting endpoint identity is unavailable on completion wire response', async () => {
  // The completion wire response schema returns model, id, choices, usage, but does NOT return an endpoint tag.
  // We prove request body correctly pins the endpoint tag, and test valid completion handling without fabricated response fields.
  let capturedBody;
  const mockTransport = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        model: MOCK_MODEL_ID,
        choices: [
          {
            message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const selection = {
    provider: 'openrouter',
    model: MOCK_MODEL_ID,
    endpoint: MOCK_ENDPOINT_TAG,
    maxImages: 1,
    key: 'test-key',
  };

  const pages = await extractBatch(selection, [{ page: 1, mime: 'image/png', base64: VALID_PNG_BASE64 }], new AbortController().signal, mockTransport);
  assert.equal(pages.length, 1);
  assert.deepEqual(capturedBody.provider, {
    only: [MOCK_ENDPOINT_TAG],
    order: [MOCK_ENDPOINT_TAG],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: 'deny',
    zdr: true,
    max_price: { prompt: 0, completion: 0, image: 0, request: 0 },
  });
});

// PR16: bounded provider JSON must be rejected before per-page Zod traversal.
const providerGuardCases = [
  ['top-level null', null, true],
  ['top-level array', [], true],
  ['pages non-array', { pages: { 0: makeRawPage(1) } }, true],
  ['pages empty', { pages: [] }, true],
  ['11 pages', { pages: Array.from({ length: 11 }, (_, i) => makeRawPage(i + 1)) }, true],
  ['1000 null pages', { pages: Array(1000).fill(null) }, true],
  ['count mismatch', { pages: [makeRawPage(1), makeRawPage(2)] }, true],
  ['unknown batch key', { pages: [makeRawPage(1)], unexpected: 'raw-payload-marker' }, false],
  ['unknown page key', { pages: [{ ...makeRawPage(1), unexpected: 'raw-payload-marker' }] }, false],
  ['wrong page ID', { pages: [makeRawPage(2)] }, false],
  ['invalid bounded page', { pages: [null] }, false],
];
for (const [name, payload, guarded] of providerGuardCases) {
  test(`PR16 provider pre-Zod: ${name}`, { timeout: 5000 }, async () => {
    const { rawBatch } = await import('../server/contracts/documentExtraction.ts');
    const original = rawBatch.safeParse;
    let parseCalls = 0;
    rawBatch.safeParse = function (...args) {
      parseCalls++;
      return original.apply(this, args);
    };
    const selection = { provider: 'groq', model: MOCK_GROQ_MODEL_ID, endpoint: MOCK_GROQ_ENDPOINT, maxImages: 3, key: 'synthetic-test-key' };
    const images = count => Array.from({ length: count }, (_, i) => ({ page: i + 1, mime: 'image/png', base64: VALID_PNG_BASE64 }));
    let responsePayload;
    let calls = 0;
    const transport = async () => {
      calls++;
      const content = JSON.stringify(responsePayload);
      const envelope = JSON.stringify({ model: MOCK_GROQ_MODEL_ID, choices: [{ message: { content }, finish_reason: 'stop' }] });
      assert.ok(Buffer.byteLength(content) < 16 * 1024, 'Negative must reach shape guard, not content limit');
      assert.ok(Buffer.byteLength(envelope) < 64 * 1024, 'Negative must reach shape guard, not envelope limit');
      return new Response(envelope, { headers: { 'content-type': 'application/json' } });
    };
    const run = batch => extractBatch(selection, batch, AbortSignal.timeout(2000), transport);
    try {
      responsePayload = { pages: Array.from({ length: 3 }, (_, i) => makeRawPage(i + 1)) };
      const valid = await run(images(3));
      assert.deepEqual(valid.map(page => page.page), [1,2,3]);
      assert.equal(parseCalls, 1, 'Valid maximum-size batch still uses the strict schema');
      parseCalls = 0;
      calls = 0;
      responsePayload = payload;
      await assert.rejects(() => run(images(1)), err => {
        assert.equal(err.code, 'provider_malformed_response');
        assert.doesNotMatch(err.message, /raw-payload-marker|issues|base64/);
        return true;
      });
      const rejectedParseCalls = parseCalls;
      assert.equal(calls, 1, 'Refusal must not retry or fall back');
      responsePayload = { pages: [makeRawPage(1)] };
      parseCalls = 0;
      assert.equal((await run(images(1)))[0].page, 1, 'Next valid batch succeeds');
      assert.equal(parseCalls, 1);
      assert.equal(rejectedParseCalls, guarded ? 0 : 1,
        guarded ? 'Shape/count refusal must precede rawBatch.safeParse' : 'Bounded input must still receive strict schema / exact page-ID validation');
    } finally {
      rawBatch.safeParse = original;
    }
  });
}
