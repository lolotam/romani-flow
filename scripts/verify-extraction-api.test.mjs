import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { extractionApi } from './fixtures/extraction-api.mjs';
import { signSession } from '../server/middleware/auth.ts';
import {
  OVERSIZED_PIXELS_PNG_BASE64,
  OVERSIZED_DIMENSION_PNG_BASE64,
  TRUNCATED_PNG_BASE64,
  TEXT_FILE_BASE64,
  VALID_PNG_BASE64,
  makeRawPage,
  MOCK_GROQ_MODEL_ID,
  MOCK_MODEL_ID,
  makeMockGroqModels,
} from './fixtures/extraction-data.mjs';
import { DocumentDraftSession } from '../src/lib/documentDraftSession.ts';
import { ApiRequestError } from '../src/lib/api/http.ts';
import sharp from 'sharp';
import { extractionRequest } from '../server/contracts/documentExtraction.ts';


function boundedBarrier(promise, label, timeoutMs = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout waiting for ${label}`)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// 1. Authorization & Processing Permission Gates
// ---------------------------------------------------------------------------

test('UI enablement cannot authorize external processing', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'processing_not_authorized');
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM pending_uploads').get().n, 0);
  }, { enabled: true, authorized: false }));

test('anonymous request is rejected with 401 before body parsing or provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: null,
      role: null,
    });
    assert.equal(res.status, 401);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('viewer role is rejected with 403 forbidden before body parsing or inference', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'viewer',
      role: 'viewer',
      headers: { 'x-draft-account': 'viewer' },
    });
    assert.equal(res.status, 403);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('account-header mismatch returns 409 conflict', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'different-user-account' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'account_mismatch');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('missing or deleted draft scope returns 409 conflict', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, scope: 'non-existent-or-deleted-scope-uuid' },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'invalid_scope');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('foreign origin is rejected with 403 forbidden', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin', Origin: 'https://malicious-foreign-origin.invalid' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'invalid_origin');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 2. Pre-body Limits, Headers & Encoding
// ---------------------------------------------------------------------------

test('compressed/encoded body with content-encoding is rejected with 415', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: JSON.stringify(f.validRequest),
      headers: { 'x-draft-account': 'admin', 'content-encoding': 'gzip', 'content-type': 'application/json' },
    });
    assert.equal(res.status, 415);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('non-JSON content-type is rejected before body decoding', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: 'raw-text-not-json',
      headers: { 'x-draft-account': 'admin', 'content-type': 'text/plain' },
    });
    assert.ok([400, 415].includes(res.status));
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('request payload exceeding 10 MiB limit returns 413 payload too large', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: 'a'.repeat(11 * 1024 * 1024) }] },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 413);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 3. Image Count, Order, Signatures & Sizing Proofs
// ---------------------------------------------------------------------------

test('incomplete page sequence or count mismatch returns 400 bad request', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, pageCount: 2 },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('non-sequential page numbers return 400 bad request', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: {
        ...f.validRequest,
        pageCount: 2,
        images: [
          { page: 2, mime: 'image/png', base64: f.validRequest.images[0].base64 },
          { page: 1, mime: 'image/png', base64: f.validRequest.images[0].base64 },
        ],
      },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('oversized image pixels reject before expensive provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: OVERSIZED_PIXELS_PNG_BASE64 }] },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_image');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('oversized image dimensions reject before expensive provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: OVERSIZED_DIMENSION_PNG_BASE64 }] },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_image');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('truncated image bytes reject before expensive provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: TRUNCATED_PNG_BASE64 }] },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_image');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('non-image file payload rejects at validation stage', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: TEXT_FILE_BASE64 }] },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_image');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 4. Versioning & Context Gates
// ---------------------------------------------------------------------------

test('stale settingsVersion is rejected with 409 conflict without provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, settingsVersion: 'f'.repeat(64) },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'stale_settings');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('stale catalogVersion is rejected with 409 conflict without provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, catalogVersion: 'f'.repeat(64) },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'stale_catalog');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

test('request context mismatch is rejected with 409 conflict without provider calls', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, context: 'different-unauthorized-context' },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'context_mismatch');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 5. Concurrency & Deterministic Barriers (2 Global, 1 Per-Account)
// ---------------------------------------------------------------------------

test('single account concurrency limit rejects second overlapping request with 429', () =>
  extractionApi(async (f) => {
    const p1 = f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });

    await f.waitForTransportCall();

    const r2 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });

    assert.equal(r2.status, 429);
    assert.equal(r2.json.error.code, 'concurrency_limit');

    f.release();
    const res1 = await p1;
    assert.equal(res1.status, 200);
  }, { enabled: true, authorized: true, deferTransport: true }));

test('global concurrency limit allows max 2 concurrent requests and rejects third with 429', () =>
  extractionApi(async (f) => {
    f.seedUser('admin2', 'admin');
    f.seedUser('admin3', 'admin');

    const p1 = f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'admin' },
    });
    await f.waitForTransportCall();

    const p2 = f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin2',
      role: 'admin',
      headers: { 'x-draft-account': 'admin2' },
    });
    await f.waitForTransportCall(() => f.calls.length >= 2);

    const r3 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin3',
      role: 'admin',
      headers: { 'x-draft-account': 'admin3' },
    });

    assert.equal(r3.status, 429);
    assert.equal(r3.json.error.code, 'concurrency_limit');

    f.release();
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
  }, { enabled: true, authorized: true, deferTransport: true }));

// ---------------------------------------------------------------------------
// 6. In-flight Abort, Transport Cancellation & Slot Release
// ---------------------------------------------------------------------------

test('client abort in flight cancels transport and releases concurrency slot for next request', () =>
  extractionApi(async (f) => {
    const clientController = new AbortController();

    const p1 = f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
      signal: clientController.signal,
    });

    const call1 = await f.waitForTransportCall();

    clientController.abort();
    await assert.rejects(p1, (err) => err.name === 'AbortError');

    await f.waitForTransportSettlement((c) => c === call1);
    assert.equal(call1.init?.signal?.aborted, true);
    f.release();

    const r2 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });

    assert.equal(r2.status, 200);
    assert.equal(r2.json.error, null);
    assert.equal(r2.json.data.requestId, f.validRequest.requestId);
  }, { enabled: true, authorized: true, deferTransport: true }));

// ---------------------------------------------------------------------------
// 7. Positive Full Extraction Path
// ---------------------------------------------------------------------------

test('positive full extraction path succeeds under mock transport', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.error, null);
    assert.equal(res.json.data.requestId, f.validRequest.requestId);
    assert.equal(res.json.data.pageCount, 1);
    assert.ok(res.json.data.fields);
    assert.ok(f.calls.length >= 1);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 8. Discovery Endpoints (Status & Models)
// ---------------------------------------------------------------------------

test('GET /api/document-extraction/status returns public status without leaking keys', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/status', {
      method: 'GET',
      userId: 'admin',
      role: 'admin',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.error, null);
    assert.equal(typeof res.json.data.enabled, 'boolean');
    assert.equal(typeof res.json.data.available, 'boolean');
    assert.equal(typeof res.json.data.settingsVersion, 'string');
    assert.equal(typeof res.json.data.catalogVersion, 'string');

    const bodyText = JSON.stringify(res.json);
    assert.equal(bodyText.includes('mock-openrouter-key'), false);
    assert.equal(bodyText.includes('mock-groq-key'), false);
  }, { enabled: true, authorized: true }));

test('GET /api/document-extraction/models lists approved models for admin and denies viewer', () =>
  extractionApi(async (f) => {
    const viewerRes = await f.request('/api/document-extraction/models?provider=openrouter', {
      method: 'GET',
      userId: 'viewer',
      role: 'viewer',
    });
    assert.equal(viewerRes.status, 403);

    const adminRes = await f.request('/api/document-extraction/models?provider=openrouter', {
      method: 'GET',
      userId: 'admin',
      role: 'admin',
    });
    assert.equal(adminRes.status, 200);
    assert.ok(Array.isArray(adminRes.json.data));
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 9. Sanitization of Diagnostics & Errors
// ---------------------------------------------------------------------------

test('diagnostics and error responses never leak keys, account IDs, document numbers or image bytes', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, images: [{ page: 1, mime: 'image/png', base64: OVERSIZED_PIXELS_PNG_BASE64 }] },
      headers: { 'x-draft-account': 'admin' },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_image');

    const responseText = JSON.stringify(res.json);
    assert.equal(responseText.includes('mock-openrouter-key'), false);
    assert.equal(responseText.includes('290010112345'), false);
    assert.equal(responseText.includes(OVERSIZED_PIXELS_PNG_BASE64), false);

    const logsText = JSON.stringify(f.logs);
    assert.equal(logsText.includes('mock-openrouter-key'), false);
    assert.equal(logsText.includes(OVERSIZED_PIXELS_PNG_BASE64), false);
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 10. Targeted Task 8/9 Regression: Zero Egress, Scope, Cooldown, Atomic Settings, Stalled Body & Native Settlement
// ---------------------------------------------------------------------------

test('GET /api/document-extraction/models rejects when processing is unauthorized with 403 and zero egress', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/models?provider=openrouter', {
      method: 'GET',
      userId: 'admin',
      role: 'admin',
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'processing_not_authorized');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: false, provider: 'openrouter' }));

test('GET /api/document-extraction/models rejects when context is missing with 403 and zero egress', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/models?provider=openrouter', {
      method: 'GET',
      userId: 'admin',
      role: 'admin',
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'processing_not_authorized');
    assert.equal(f.calls.length, 0);
  }, { enabled: true, authorized: true, context: '', provider: 'openrouter' }));

test('GET /api/document-extraction/models rejects when feature is disabled with 403 and zero egress', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/document-extraction/models?provider=openrouter', {
      method: 'GET',
      userId: 'admin',
      role: 'admin',
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'extraction_disabled');
    assert.equal(f.calls.length, 0);
  }, { enabled: false, authorized: true, provider: 'openrouter' }));

test('POST /api/document-extraction fails closed with zero egress when privacy attestations are false', async () => {
  const privacyVariations = [
    { dataControlsApproved: false },
    { openRouterNoByok: false },
    { openRouterZdrOnly: false },
  ];
  for (const variation of privacyVariations) {
    await extractionApi(async (f) => {
      const res = await f.request('/api/document-extraction', {
        method: 'POST',
        body: f.validRequest,
        headers: { 'x-draft-account': 'admin' },
      });
      assert.ok([403, 502].includes(res.status));
      assert.equal(f.calls.length, 0, `Egress must be 0 when ${JSON.stringify(variation)} is false`);
    }, { enabled: true, authorized: true, provider: 'openrouter', ...variation });
  }
});

test('real new scope without draft succeeds before first autosave', () =>
  extractionApi(async (f) => {
    f.db.prepare("DELETE FROM document_drafts WHERE scope = 'new'").run();
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, scope: 'new' },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.error, null);
    assert.equal(res.json.data.requestId, f.validRequest.requestId);
  }, { enabled: true, authorized: true }));

test('real entity scope without draft succeeds before first autosave', () =>
  extractionApi(async (f) => {
    const comp = f.db.prepare("SELECT id FROM companies LIMIT 1").get();
    const entityScope = `company:${comp.id}`;
    f.db.prepare("DELETE FROM document_drafts WHERE scope = ?").run(entityScope);
    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, scope: entityScope },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.error, null);
  }, { enabled: true, authorized: true }));

test('deleted entity with leftover draft row rejects and makes zero provider calls', () =>
  extractionApi(async (f) => {
    const comp = f.db.prepare("SELECT id FROM companies LIMIT 1").get();
    const entityScope = `company:${comp.id}`;
    f.seedDraftScope('admin', entityScope);
    f.db.prepare("DELETE FROM companies WHERE id = ?").run(comp.id);

    const res = await f.request('/api/document-extraction', {
      method: 'POST',
      body: { ...f.validRequest, scope: entityScope },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.ok([404, 409].includes(res.status));
    assert.ok(['not_found', 'invalid_scope'].includes(res.json.error.code));
    assert.equal(f.calls.length, 0, 'Zero provider calls when entity is deleted');
  }, { enabled: true, authorized: true }));

test('provider 429 enforces per-account cooldown blocking later calls before transport until clock expiry while other account is unaffected', async () => {
  const timers = new Map();
  let timerId = 0, now = Date.now();
  const clock = {
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    now: () => now,
  };

  let chatCalls = 0;
  const transport = async (url) => {
    if (url.includes('/models')) {
      return new Response(JSON.stringify(makeMockGroqModels()), { status: 200 });
    }
    if (url.endsWith('/endpoints') || url.includes('/endpoints/zdr') || url.includes('/byok')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.includes('/chat/completions')) {
      chatCalls++;
      if (chatCalls === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Retry-After': '30', 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ pages: [makeRawPage(1)] }) }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    throw new Error('unexpected: ' + url);
  };

  await extractionApi(async (f) => {
    f.seedUser('admin2', 'admin');

    const r1 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r1.status, 429);
    assert.equal(r1.json.error.code, 'provider_rate_limit');
    assert.equal(r1.json.error.retryAfterSeconds, 30);
    const chatCallsAfterR1 = chatCalls;
    assert.equal(chatCallsAfterR1, 1);

    const r2 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r2.status, 429);
    assert.equal(r2.json.error.code, 'provider_rate_limit');
    assert.equal(chatCalls, chatCallsAfterR1, 'Admin request 2 must be blocked by cooldown before chat transport');

    const r3 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin2',
      role: 'admin',
      headers: { 'x-draft-account': 'admin2' },
    });
    assert.equal(r3.status, 200);
    assert.equal(chatCalls, chatCallsAfterR1 + 1, 'Independent account must proceed to transport');

    now += 31000;

    const r4 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r4.status, 200);
    assert.equal(chatCalls, chatCallsAfterR1 + 2);
  }, { enabled: true, authorized: true, provider: 'groq', model: MOCK_GROQ_MODEL_ID, clock, transport });
});

test('PUT /api/settings with mixed settings and invalid candidate rejects atomically without writing notification or settings changes', () =>
  extractionApi(async (f) => {
    const initialSettings = f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.enabled'").get();
    assert.equal(initialSettings?.value, 'false');

    const res = await f.request('/api/settings', {
      method: 'PUT',
      userId: 'admin',
      role: 'admin',
      body: {
        'email.enabled': true,
        'ai_extraction.enabled': true,
        'ai_extraction.provider': 'openrouter',
        'ai_extraction.model': 'unapproved/model-candidate:paid',
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_settings');

    const afterSettings = f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.enabled'").get();
    assert.equal(afterSettings?.value, 'false', 'Unrelated settings must not be written when candidate validation fails');
  }, { enabled: false, authorized: true }));

test('PUT /api/settings updating non-AI settings succeeds without requiring remote extraction transport', () =>
  extractionApi(async (f) => {
    const res = await f.request('/api/settings', {
      method: 'PUT',
      userId: 'admin',
      role: 'admin',
      body: {
        'email.enabled': true,
        'email.language': 'ar',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.error, null);
    assert.equal(f.calls.length, 0, 'No remote extraction transport calls for non-AI settings');
  }, { enabled: false, authorized: true }));

test('mixed settings require fresh zero-price eligibility before any write, with valid positive control', async () => {
  for (const paid of [false, true]) {
    await extractionApi(async f => {
      const response = await f.request('/api/settings', {
        method: 'PUT',
        body: { 'email.enabled': true, 'ai_extraction.enabled': true, 'ai_extraction.provider': 'openrouter', 'ai_extraction.model': MOCK_MODEL_ID },
      });
      assert.equal(response.status, paid ? 400 : 200);
      assert.ok(f.calls.some(call => call.url === 'https://openrouter.ai/api/v1/models'), 'Eligibility must use fresh provider metadata');
      assert.equal(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.enabled'").get().value, paid ? 'false' : 'true');
      assert.equal(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.enabled'").get().value, paid ? 'false' : 'true');
    }, { enabled: false, authorized: true, provider: 'openrouter', model: MOCK_MODEL_ID,
      modelOverrides: paid ? { pricing: { prompt: '0.01', completion: '0', image: '0', request: '0' } } : {} });
  }
});

test('stalled body 15s timeout via real loopback partial HTTP closes connection and settles admission slot', async () => {
  const timers = new Map();
  let timerId = 0, now = Date.now();
  let bodyTimerScheduled;
  const bodyScheduled = new Promise(resolve => { bodyTimerScheduled = resolve; });
  const clock = {
    setTimeout(callback, ms) {
      const id = ++timerId;
      timers.set(id, { callback, ms });
      if (ms === 15000) bodyTimerScheduled([id, { callback, ms }]);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    now: () => now,
  };

  await extractionApi(async (f) => {
    const port = f.server.address().port;
    const cookieHeader = f.config.cookieName + '=' + signSession(f.config, {
      id: 'admin',
      name: 'Synthetic admin',
      email: 'admin@example.invalid',
      role: 'admin',
    });

    const socket = net.connect(port, '127.0.0.1');
    let socketClosed = false;
    let responseData = '';
    let responded;
    const responseArrived = new Promise(resolve => { responded = resolve; });
    socket.on('data', (chunk) => { responseData += chunk.toString(); responded(); });
    socket.on('close', () => { socketClosed = true; responded(); });
    socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });

    try {
    await boundedBarrier(new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }), 'socket connect');

    const partialHeaders = [
      'POST /api/document-extraction HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Content-Type: application/json',
      'Content-Length: 5000',
      'x-draft-account: admin',
      `Origin: http://127.0.0.1:${port}`,
      `Cookie: ${cookieHeader}`,
      '',
      '{"requestId":"stalled-input',
    ].join('\r\n');

    socket.write(partialHeaders);

    const bodyTimer = await boundedBarrier(bodyScheduled, 'bodyScheduled');
    assert.ok(bodyTimer, '15-second body deadline must be scheduled upon request admission');

    timers.delete(bodyTimer[0]);
    now += 15000;
    bodyTimer[1].callback();

    await boundedBarrier(responseArrived, 'responseArrived');

    assert.ok(
      responseData.includes('504') || responseData.includes('extraction_timeout') || socketClosed,
      'Server must terminate stalled body with sanitized timeout or close connection',
    );
    socket.destroy();

    const r2 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      userId: 'admin',
      role: 'admin',
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r2.status, 200, 'Admission slot must be settled and released after stalled body timeout');
    assert.equal(r2.json.error, null);
    } finally { socket.destroy(); }
  }, { enabled: true, authorized: true, clock });
});

test('aborted native pending retains request slot until underlying native settles and never releases via 5s timeout', async () => {
  let resolveNative;
  const nativePending = new Promise((resolve) => { resolveNative = resolve; });
  let enteredNative, destroyedNative;
  const entered = new Promise(resolve => { enteredNative = resolve; });
  const destroyed = new Promise(resolve => { destroyedNative = resolve; });
  let rawStarted = false, rawSettled = false;

  const customDecoderFactory = () => ({
    metadata: async () => ({ width: 1, height: 1, channels: 3, format: 'png' }),
    timeout() { return this; },
    raw() { return this; },
    toBuffer: async () => {
      rawStarted = true;
      enteredNative();
      await nativePending;
      rawSettled = true;
      return { data: Buffer.from([255, 0, 0]), info: { width: 1, height: 1, size: 3 } };
    },
    destroy: () => { if (rawStarted && !rawSettled) destroyedNative(); },
  });

  try { await extractionApi(async (f) => {
    const clientController = new AbortController();

    const p1 = f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
      signal: clientController.signal,
    });

    // Retain the request settlement before fixture teardown even if a barrier fails.
    void p1.catch(() => {});
    try {
    await boundedBarrier(entered, 'entered');

    clientController.abort();
    await assert.rejects(p1, (err) => err.name === 'AbortError');
    await boundedBarrier(destroyed, 'destroyed');

    const r2 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r2.status, 429, 'Slot must be held while native decode is pending despite caller abort');
    assert.equal(r2.json.error.code, 'concurrency_limit');

    resolveNative();
    await new Promise((r) => setImmediate(r));

    const r3 = await f.request('/api/document-extraction', {
      method: 'POST',
      body: f.validRequest,
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(r3.status, 200, 'Slot must be released only when underlying native decode truly settles');
    } finally {
      resolveNative();
      clientController.abort();
      await Promise.allSettled([p1, nativePending]);
    }
  }, { enabled: true, authorized: true, decoderFactory: customDecoderFactory });
  } finally { resolveNative(); }
});

// ---------------------------------------------------------------------------
// 10. Plan Matrix Gaps: Late Versions, Account Cookie Switch, Save Retries
// ---------------------------------------------------------------------------

function makeDraftTransport(f, userId = 'admin', interceptor = null) {
  return async (url, options = {}) => {
    let onDone = null;
    if (interceptor) {
      const intercepted = await interceptor(url, options);
      if (typeof intercepted === 'function') {
        onDone = intercepted;
      } else if (intercepted !== undefined) {
        return intercepted;
      }
    }
    const res = await f.request(url, {
      method: options.method ?? 'GET',
      body: options.body,
      userId,
      headers: {
        'x-draft-account': userId,
        ...(options.headers ?? {}),
      },
    });
    if (onDone) {
      await onDone(res);
    }

    return {
      data: res.status >= 200 && res.status < 300 ? res.json.data : null,
      error:
        res.status >= 400
          ? new ApiRequestError(
              res.json?.error?.message ?? 'Request failed',
              res.json?.error?.code ?? 'unknown',
              res.status,
            )
          : null,
    };
  };
}

test('late catalog and settings changes between form admission and extraction reject with 409 stale version', () =>
  extractionApi(async (f) => {
    // 1. Settings version mismatch (valid 64-char hex format)
    const staleSettingsRequest = {
      ...f.validRequest,
      settingsVersion: '0'.repeat(64),
    };
    const resSettings = await f.request('/api/document-extraction', {
      method: 'POST',
      body: staleSettingsRequest,
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(resSettings.status, 409);
    assert.equal(resSettings.json.error.code, 'stale_settings');

    // 2. Catalog version mismatch (valid 64-char hex format)
    const staleCatalogRequest = {
      ...f.validRequest,
      catalogVersion: '0'.repeat(64),
    };
    const resCatalog = await f.request('/api/document-extraction', {
      method: 'POST',
      body: staleCatalogRequest,
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(resCatalog.status, 409);
    assert.equal(resCatalog.json.error.code, 'stale_catalog');
  }, { enabled: true, authorized: true }));

test('account cookie switch mid-operation rejects with 409 conflict and prevents cross-account leakage', () =>
  extractionApi(async (f) => {
    f.seedUser('admin2', 'admin');

    const res = await f.request('/api/document-drafts/' + encodeURIComponent(f.validScope), {
      method: 'GET',
      userId: 'admin2',
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'draft_conflict');
  }, { enabled: true, authorized: true }));

test('document save transaction rejects stale draft revision with 409 and succeeds upon reference refresh retry', () =>
  extractionApi(async (f) => {
    const scope = f.validScope;
    const initialDraft = (await f.request(`/api/document-drafts/${encodeURIComponent(scope)}`, {
      headers: { 'x-draft-account': 'admin' },
    })).json.data;

    const putRes = await f.request(`/api/document-drafts/${encodeURIComponent(scope)}`, {
      method: 'PUT',
      body: { revision: initialDraft.revision, values: { title: 'First Revision' } },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(putRes.status, 200);
    const rev1 = putRes.json.data.revision;

    const putRes2 = await f.request(`/api/document-drafts/${encodeURIComponent(scope)}`, {
      method: 'PUT',
      body: { revision: rev1, values: { title: 'Second Revision' } },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(putRes2.status, 200);
    const rev2 = putRes2.json.data.revision;

    const beforeStale = f.db.prepare('SELECT id FROM documents ORDER BY id').all();
    // Stale save attempt using rev1
    const staleDocSave = await f.request('/api/documents', {
      method: 'POST',
      body: {
        title: 'New Stale Document',
        document_type_id: 'type-civil-id',
        company_id: f.validScope.replace('company:', ''),
        draft: { scope, revision: rev1, account: 'admin' },
      },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(staleDocSave.status, 409);
    assert.equal(staleDocSave.json.error.code, 'draft_conflict');
    assert.deepEqual(f.db.prepare('SELECT id FROM documents ORDER BY id').all(), beforeStale);

    // Retry with fresh revision rev2 succeeds
    const freshDocSave = await f.request('/api/documents', {
      method: 'POST',
      body: {
        title: 'New Fresh Document',
        document_type_id: 'type-civil-id',
        company_id: f.validScope.replace('company:', ''),
        draft: { scope, revision: rev2, account: 'admin' },
      },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(freshDocSave.status, 201);
    assert.ok(freshDocSave.json.data?.[0]?.id);
  }, { enabled: true, authorized: true }));

test('repeated save attempt with committed draft reference rejects replay without duplicate document creation', () =>
  extractionApi(async (f) => {
    const scope = f.validScope;
    const initialDraft = (await f.request(`/api/document-drafts/${encodeURIComponent(scope)}`, {
      headers: { 'x-draft-account': 'admin' },
    })).json.data;

    const putRes = await f.request(`/api/document-drafts/${encodeURIComponent(scope)}`, {
      method: 'PUT',
      body: { revision: initialDraft.revision, values: { title: 'Commit Once' } },
      headers: { 'x-draft-account': 'admin' },
    });
    const rev = putRes.json.data.revision;

    const save1 = await f.request('/api/documents', {
      method: 'POST',
      body: {
        title: 'Doc Commit 1',
        document_type_id: 'type-civil-id',
        company_id: f.validScope.replace('company:', ''),
        draft: { scope, revision: rev, account: 'admin' },
      },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(save1.status, 201);

    const beforeReplay = f.db.prepare('SELECT id FROM documents ORDER BY id').all();
    const save2 = await f.request('/api/documents', {
      method: 'POST',
      body: {
        title: 'Doc Commit 2',
        document_type_id: 'type-civil-id',
        company_id: f.validScope.replace('company:', ''),
        draft: { scope, revision: rev, account: 'admin' },
      },
      headers: { 'x-draft-account': 'admin' },
    });
    assert.equal(save2.status, 409);
    assert.equal(save2.json.error.code, 'draft_conflict');
    assert.deepEqual(f.db.prepare('SELECT id FROM documents ORDER BY id').all(), beforeReplay);
  }, { enabled: true, authorized: true }));


// ---------------------------------------------------------------------------
// 11. Part C: Pure-Class Draft Session CAS Characterization
// ---------------------------------------------------------------------------

test('pure-class DocumentDraftSession: retiring session held PUT characterization with deterministic barriers', () =>
  extractionApi(async (f) => {
    let releasePut;
    const putGate = new Promise((resolve) => {
      releasePut = resolve;
    });
    let enteredPutResolve;
    const enteredPut = new Promise((resolve) => {
      enteredPutResolve = resolve;
    });
    let settledPutResolve;
    const settledPut = new Promise((resolve) => {
      settledPutResolve = resolve;
    });

    const session1Transport = makeDraftTransport(f, 'admin', async (url, options) => {
      if (options.method === 'PUT') {
        enteredPutResolve();
        await putGate;
        return () => {
          settledPutResolve();
        };
      }
    });

    const session2Transport = makeDraftTransport(f, 'admin');
    let s1;
    let s2;

    try {
      // 1. Session 1 mounts and loads initial draft revision
      s1 = new DocumentDraftSession(f.validScope, () => {}, () => {}, session1Transport);
      await s1.flush();

      // 2. Session 1 user types an edit
      s1.change({ title: 'Draft from Retiring Session 1' });

      // 3. Session 1 unmounts: dispose(true) initiates unawaited flush()
      s1.dispose(true);
      await boundedBarrier(enteredPut, 'enteredPut');

      // 4. Session 2 mounts in the same scope and same account ('admin') while s1's PUT is held
      s2 = new DocumentDraftSession(f.validScope, () => {}, () => {}, session2Transport);
      await s2.flush();

      // 5. Release Session 1's held PUT so it commits to the server
      releasePut();
      await boundedBarrier(settledPut, 'settledPut');

      const dbRow = f.db
        .prepare('SELECT user_id, revision, values_json FROM document_drafts WHERE user_id=? AND scope=?')
        .get('admin', f.validScope);
      assert.equal(dbRow.user_id, 'admin');
      assert.ok(dbRow.values_json.includes('Draft from Retiring Session 1'));

      // 6. Session 2 user edits a field
      s2.change({ title: 'New Form Session 2 User Edit' });

      // 7. Explicit CAS characterization: Two direct class instances without shared owner/context
      // correctly report 409 draft_conflict on stale revision and retain unsaved manual edits.
      await assert.rejects(
        () => s2.prepare({ title: 'New Form Session 2 User Edit' }),
        (err) => {
          assert.equal(err.status, 409);
          assert.equal(err.code, 'draft_conflict');
          return true;
        },
      );

      // Verify unsaved manual edit is retained in memory for user recovery
      assert.equal(s2.pending?.title, 'New Form Session 2 User Edit');
    } finally {
      releasePut?.();
      if (s1) {
        try { s1.dispose(); } catch {}
      }
      if (s2) {
        try { s2.dispose(); } catch {}
      }
    }
  }, { enabled: true, authorized: true }));

// ---------------------------------------------------------------------------
// 12. Top-Level Shape & Cardinality Allocation Guard (PR16 Pre-Zod Rejection)
// ---------------------------------------------------------------------------

function createTrackingDecoderFactory() {
  let decodersCreated = 0;
  let nativeCalls = 0;

  const decoderFactory = (bytes, options) => {
    decodersCreated += 1;
    const real = sharp(bytes, options);
    const wrapper = {
      metadata: async () => {
        nativeCalls += 1;
        return real.metadata();
      },
      timeout: (settings) => {
        real.timeout(settings);
        return wrapper;
      },
      raw: () => {
        real.raw();
        return wrapper;
      },
      toBuffer: async (settings) => {
        nativeCalls += 1;
        return real.toBuffer(settings);
      },
      destroy: () => {
        real.destroy();
      },
    };
    return wrapper;
  };

  return {
    decoderFactory,
    get decodersCreated() {
      return decodersCreated;
    },
    get nativeCalls() {
      return nativeCalls;
    },
    reset() {
      decodersCreated = 0;
      nativeCalls = 0;
    },
  };
}

// Each case owns a real HTTP fixture, so one RED cannot suppress later cases.
const requestGuardCases = [
  ['images string', f => ({ ...f.validRequest, images: 'raw-payload-marker' }), true],
  ['images number', f => ({ ...f.validRequest, images: 12345 }), true],
  ['images null', f => ({ ...f.validRequest, images: null }), true],
  ['images object', f => ({ ...f.validRequest, images: { 0: f.validRequest.images[0] } }), true],
  ['zero images', f => ({ ...f.validRequest, pageCount: 0, images: [] }), true],
  ['11 images', f => ({ ...f.validRequest, pageCount: 11, images: Array.from({ length: 11 }, (_, i) => ({ ...f.validRequest.images[0], page: i + 1 })) }), true],
  ['1000 null images', f => ({ ...f.validRequest, pageCount: 1000, images: Array(1000).fill(null) }), true],
  ['1000 valid-looking images', f => ({ ...f.validRequest, pageCount: 1000, images: Array.from({ length: 1000 }, (_, i) => ({ ...f.validRequest.images[0], page: i + 1 })) }), true],
  ['top-level array', () => [], true],
  ['top-level null', () => null, true],
  ['top-level string', () => JSON.stringify('raw-payload-marker'), true],
  ['top-level number', () => 12345, true],
  ['null requestId strict schema control', f => ({ ...f.validRequest, requestId: null }), false],
  ['object pageCount strict schema control', f => ({ ...f.validRequest, pageCount: { value: 1 } }), false],
  ['unknown key strict schema control', f => ({ ...f.validRequest, unexpectedKey: 'raw-payload-marker' }), false],
];

for (const [name, bodyOf, guarded] of requestGuardCases) {
  test(`PR16 HTTP pre-Zod: ${name}`, { timeout: 15000 }, async () => {
    const tracker = createTrackingDecoderFactory();
    const originalParse = extractionRequest.parse;
    let parseCalls = 0;
    // Call-through observation only: the real schema, route and service still run.
    extractionRequest.parse = function (...args) {
      parseCalls++;
      return originalParse.apply(this, args);
    };
    try {
      await extractionApi(async f => {
        const send = body => f.request('/api/document-extraction', {
          method: 'POST', body, headers: { 'x-draft-account': 'admin' },
          signal: AbortSignal.timeout(5000),
        });
        const valid = await send(f.validRequest);
        assert.equal(valid.status, 200);
        assert.equal(valid.json.data.requestId, f.validRequest.requestId);
        assert.equal(parseCalls, 1);
        assert.ok(tracker.nativeCalls > 0 && tracker.decodersCreated > 0);
        assert.ok(f.calls.length > 0);

        tracker.reset();
        f.calls.length = 0;
        f.logs.length = 0;
        parseCalls = 0;
        const rejected = await send(bodyOf(f));
        const rejectedParseCalls = parseCalls;
        const rejectedObservations = {
          decoders: tracker.decodersCreated, native: tracker.nativeCalls,
          transport: f.calls.length, logs: JSON.stringify(f.logs),
        };
        // Recovery executes even if either public error vocabulary or allocation
        // guard assertions below are currently RED.
        parseCalls = 0;
        const recovery = await send(f.validRequest);
        assert.equal(recovery.status, 200);
        assert.equal(recovery.json.error, null);
        assert.equal(parseCalls, 1);
        assert.equal(rejected.status, 400);
        assert.deepEqual(rejected.json, { data: null, error: {
          code: 'invalid_request', message: 'The extraction request is not valid.',
          requestId: rejected.json.error.requestId,
        } });
        assert.equal(typeof rejected.json.error.requestId, 'string');
        assert.equal(rejectedObservations.decoders, 0);
        assert.equal(rejectedObservations.native, 0);
        assert.equal(rejectedObservations.transport, 0);
        assert.doesNotMatch(JSON.stringify(rejected.json) + rejectedObservations.logs, /raw-payload-marker|"issues"|"base64"/);
        assert.equal(rejectedParseCalls, guarded ? 0 : 1,
          guarded ? 'Shape/cardinality rejection must precede extractionRequest.parse' : 'Bounded strict-schema control must still enter the real parser');
      }, { enabled: true, authorized: true, decoderFactory: tracker.decoderFactory });
    } finally {
      extractionRequest.parse = originalParse;
    }
  });
}

// MergePilot fixture regressions: exercise real status and extraction, not just defaults.
for (const [provider, expectedModel] of [['groq', MOCK_GROQ_MODEL_ID], ['openrouter', MOCK_MODEL_ID]]) {
  test(`${provider} fixture isolates keys and preserves the complete default extraction path`, () =>
    extractionApi(async f => {
      const status = await f.request('/api/document-extraction/status');
      assert.equal(status.status, 200);
      assert.equal(status.json.data.available, true);
      assert.equal(status.json.data.model, expectedModel);
      assert.deepEqual(status.json.data.configured, { groq: provider === 'groq', openrouter: provider === 'openrouter' });
      const result = await f.request('/api/document-extraction', {
        method: 'POST', body: f.validRequest, headers: { 'x-draft-account': 'admin' },
      });
      assert.equal(result.status, 200);
      assert.equal(result.json.data.fields.document_number.value, '290010112345');
      const inference = f.calls.find(call => call.url.endsWith('/chat/completions'));
      assert.equal(JSON.parse(inference.init.body).model, expectedModel);
      assert.ok(f.calls.every(call => new URL(call.url).hostname === (provider === 'groq' ? 'api.groq.com' : 'openrouter.ai')));
    }, { enabled: true, authorized: true, provider }));
}

test('fixture blocks userinfo and unrelated loopback origins before transport, permits its owned origin', () =>
  extractionApi(async f => {
    for (const target of [
      'http://localhost:80@example.invalid/', 'http://127.0.0.1:80@example.invalid/',
      'http://127.0.0.1:1/', 'http://localhost:' + new URL(f.base).port + '/',
      f.base.replace('http:', 'https:'), f.base.replace('http://', 'http://user:pass@'),
    ]) await assert.rejects(fetch(target), /external_inference_forbidden/);
    const response = await fetch(f.base + '/api/health');
    assert.ok(response instanceof Response, 'Owned-origin control reaches the fixture server');
    assert.equal(f.calls.length, 0);
  }));
