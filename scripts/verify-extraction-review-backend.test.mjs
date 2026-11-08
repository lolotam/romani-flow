import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractionApi } from './fixtures/extraction-api.mjs';
import {
  MOCK_MODEL_ID, MOCK_GROQ_MODEL_ID, MOCK_ENDPOINT_TAG,
  makeMockApproval, makeMockGroqApproval, makeMockModel, makeMockGroqModels,
  makeMockByok, makeMockChatResponse, makeRawPage,
} from './fixtures/extraction-data.mjs';
import { PROVIDER_URLS, openRouterEndpointsUrl } from '../server/extraction/http.ts';
import { getSetting } from '../server/repositories/settings.ts';

// PR16 MP4504619764/4504622340, MP4504619748/4504622331,
// MP4504622309, MP4504619694/4504622301. Only transport/clock/native boundaries
// are injected. Routes, selection policy, SQLite and coordinator remain real.
const ROUTE = '/api/document-extraction';
const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const OPTIONS = { enabled: true, authorized: true };

function providerOptions(provider) {
  return { ...OPTIONS, provider, model: provider === 'groq' ? MOCK_GROQ_MODEL_ID : MOCK_MODEL_ID };
}

function gate() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Barrier timeout: ${label}`)), 2500);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

// Collect independent assertions so a known RED does not suppress later checks.
function checks() {
  const failures = [];
  return {
    check(label, action) {
      try { action(); } catch (cause) { failures.push(new Error(label, { cause })); }
    },
    finish() {
      if (failures.length) {
        throw new AggregateError(failures, failures.map(e => `${e.message}: ${e.cause.message}`).join('\n'));
      }
    },
  };
}

function clock() {
  let moment = NOW;
  return {
    now: () => moment,
    advance: ms => { moment += ms; },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: timer => clearTimeout(timer),
  };
}

function request(f, path, options = {}) {
  return f.request(path, { ...options, signal: AbortSignal.timeout(5000) });
}

function extract(f, userId = 'admin') {
  return request(f, ROUTE, {
    method: 'POST', body: f.validRequest, userId,
    headers: { 'x-draft-account': userId },
  });
}

function snapshot(db) {
  return Object.fromEntries([
    'settings', 'whatsapp_jobs', 'whatsapp_attempts', 'whatsapp_recipients',
    'expiry_notifications', 'email_log',
  ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'settings' ? 'key' : 'id'}`).all()]));
}

function successful(res) {
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.error, null);
}

function successExtraction(res) {
  successful(res);
  assert.equal(res.json.data.fields.document_number.value, '290010112345');
}

// This is a documented provider wire fixture, not a policy implementation.
function providerResponse(url) {
  let payload;
  if (url === PROVIDER_URLS.groqModels) payload = makeMockGroqModels();
  else if (url === PROVIDER_URLS.openRouterModels) payload = { data: [makeMockModel()] };
  else if (url === openRouterEndpointsUrl(MOCK_MODEL_ID)) {
    payload = { data: { id: MOCK_MODEL_ID, endpoints: [{
      model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, status: 0,
      pricing: { prompt: '0', completion: '0', image: '0', request: '0' },
    }] } };
  } else if (url === PROVIDER_URLS.openRouterZdr) {
    payload = { data: [{ model_id: MOCK_MODEL_ID, tag: MOCK_ENDPOINT_TAG, status: 0, safety_retention: false }] };
  } else if (url === PROVIDER_URLS.openRouterByok) payload = makeMockByok();
  else if (url === PROVIDER_URLS.groqChat || url === PROVIDER_URLS.openRouterChat) {
    payload = makeMockChatResponse([makeRawPage(1)], url === PROVIDER_URLS.groqChat ? MOCK_GROQ_MODEL_ID : MOCK_MODEL_ID);
  } else throw new Error(`Unexpected fixture destination: ${url}`);
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

function expectedCalls(provider) {
  return provider === 'groq'
    ? [PROVIDER_URLS.groqModels, PROVIDER_URLS.groqChat]
    : [PROVIDER_URLS.openRouterModels, openRouterEndpointsUrl(MOCK_MODEL_ID),
      PROVIDER_URLS.openRouterZdr, PROVIDER_URLS.openRouterByok, PROVIDER_URLS.openRouterChat];
}

const RACES = [
  { name: 'unapproved model', patch: { 'ai_extraction.model': 'synthetic/unapproved:free' } },
  { name: 'provider and model switch', patch: { 'ai_extraction.provider': 'groq', 'ai_extraction.model': MOCK_GROQ_MODEL_ID } },
  { name: 'unchanged selection control', patch: { 'ai_extraction.model': MOCK_MODEL_ID }, control: true },
];

for (const variant of RACES) {
  test(`PR16 settings race: ${variant.name}`, async t => {
    await extractionApi(async f => {
      const start = snapshot(f.db);
      const releaseHold = gate();
      const holdEntered = gate();
      const releaseCheckpoint = gate();
      const checkpointEntered = gate();
      const queued = [gate(), gate()];
      const original = f.coordinator.runExclusive;
      const realRun = original.bind(f.coordinator);
      const hold = realRun(async () => { holdEntered.resolve(); await releaseHold.promise; });
      let queuedCount = 0;
      // Passive entry observer: every action still goes unchanged to the real
      // coordinator. No substitute lock, middleware, save or policy behavior.
      f.coordinator.runExclusive = action => {
        const result = realRun(action);
        queued[queuedCount++]?.resolve();
        return result;
      };
      let first, second, checkpoint;
      try {
        await bounded(holdEntered.promise, 'initial real coordinator hold');
        first = request(f, '/api/settings', { method: 'PUT', body: { settings: variant.patch } });
        await bounded(queued[0].promise, 'first HTTP write queued');
        checkpoint = realRun(async () => {
          checkpointEntered.resolve();
          await releaseCheckpoint.promise;
        });
        second = request(f, '/api/settings', { method: 'PUT', body: { settings: {
          'ai_extraction.enabled': true, 'email.enabled': true,
        } } });
        await bounded(queued[1].promise, 'second HTTP write validated and queued');
        assert.deepEqual(snapshot(f.db), start, 'both HTTP writes wait without changing any table');
        assert.deepEqual(f.calls.map(c => c.url), expectedCalls('openrouter').slice(0, -1),
          'partial enable was freshly validated against the original OpenRouter selection');
        releaseHold.resolve();
        await bounded(checkpointEntered.promise, 'first write completed before second write');
        successful(await first);
        const afterFirst = snapshot(f.db);
        assert.equal(getSetting(f.db, 'ai_extraction.enabled'), false);
        for (const [key, value] of Object.entries(variant.patch)) assert.equal(getSetting(f.db, key), value);
        releaseCheckpoint.resolve();
        const res = await second;
        const result = snapshot(f.db);
        t.diagnostic(JSON.stringify({ case: variant.name, secondStatus: res.status,
          secondCode: res.json.error?.code ?? null, enabled: getSetting(f.db, 'ai_extraction.enabled'),
          model: getSetting(f.db, 'ai_extraction.model'), provider: getSetting(f.db, 'ai_extraction.provider') }));
        const c = checks();
        if (variant.control) {
          c.check('unchanged queued enable succeeds', () => successful(res));
          c.check('enable and mixed email update persist', () => {
            assert.equal(getSetting(f.db, 'ai_extraction.enabled'), true);
            assert.equal(getSetting(f.db, 'email.enabled'), true);
          });
          c.check('other complete setting rows unchanged', () => assert.deepEqual(
            result.settings.filter(r => !['ai_extraction.enabled', 'email.enabled'].includes(r.key)),
            afterFirst.settings.filter(r => !['ai_extraction.enabled', 'email.enabled'].includes(r.key)),
          ));
        } else {
          c.check('stale enable refused as invalid_settings', () => {
            assert.equal(res.status, 400);
            assert.equal(res.json.error?.code, 'invalid_settings');
          });
          c.check('entire mixed write leaves complete DB snapshot untouched', () => assert.deepEqual(result, afterFirst));
          c.check('unvalidated combination never enabled', () => assert.equal(getSetting(f.db, 'ai_extraction.enabled'), false));
          c.check('no partial email enable', () => assert.equal(getSetting(f.db, 'email.enabled'), false));
        }
        c.check('all outbox/audit tables unchanged', () => {
          for (const table of Object.keys(start).filter(name => name !== 'settings')) assert.deepEqual(result[table], start[table]);
        });
        c.check('no inference or notification transport', () => {
          assert.equal(f.calls.filter(call => call.url.endsWith('/chat/completions')).length, 0);
          assert.equal(f.sendTextCalls.length, 0);
        });
        c.finish();
      } finally {
        releaseHold.resolve();
        releaseCheckpoint.resolve();
        f.coordinator.runExclusive = original;
        await Promise.allSettled([hold, checkpoint, first, second].filter(Boolean));
      }
    }, { ...OPTIONS, enabled: false, provider: 'openrouter', model: MOCK_MODEL_ID, clock: clock() });
  });
}

const RATE_CASES = [
  { provider: 'groq', name: 'Groq models', url: PROVIDER_URLS.groqModels, retry: '0', seconds: 1 },
  { provider: 'openrouter', name: 'OpenRouter models', url: PROVIDER_URLS.openRouterModels, retry: '99999', seconds: 300 },
  { provider: 'openrouter', name: 'OpenRouter BYOK', url: PROVIDER_URLS.openRouterByok, retry: '37', seconds: 37 },
];

for (const variant of RATE_CASES) {
  test(`PR16 metadata 429: ${variant.name} cooldown is sanitized, per account and expires`, async t => {
    const time = clock();
    let rateLimited = false;
    await extractionApi(async f => {
      f.seedUser('other-admin');
      const before = snapshot(f.db);
      const initial = await extract(f);
      successExtraction(initial);
      assert.deepEqual(f.calls.map(call => call.url), expectedCalls(variant.provider));
      rateLimited = true;
      const rejectedStart = f.calls.length;
      const rejected = await extract(f);
      const rejectedCalls = f.calls.slice(rejectedStart);
      rateLimited = false;
      const cooldownStart = f.calls.length;
      const duringCooldown = await extract(f);
      const cooldownCalls = f.calls.slice(cooldownStart);
      const otherStart = f.calls.length;
      const other = await extract(f, 'other-admin');
      const otherCalls = f.calls.slice(otherStart);
      time.advance(variant.seconds * 1000 + 1);
      const expiryStart = f.calls.length;
      const expired = await extract(f);
      const expiryCalls = f.calls.slice(expiryStart);
      t.diagnostic(JSON.stringify({ case: variant.name, firstStatus: rejected.status,
        firstCode: rejected.json.error?.code, retryAfter: rejected.headers.get('retry-after'),
        cooldownStatus: duringCooldown.status, cooldownTransport: cooldownCalls.length,
        otherStatus: other.status, expiryStatus: expired.status }));
      const c = checks();
      for (const [label, res] of [['metadata response', rejected], ['cooldown response', duringCooldown]]) {
        c.check(`${label}: HTTP 429`, () => assert.equal(res.status, 429));
        c.check(`${label}: no partial result`, () => assert.equal(res.json.data, null));
        c.check(`${label}: provider_rate_limit`, () => assert.equal(res.json.error?.code, 'provider_rate_limit'));
        c.check(`${label}: fixed message`, () => assert.equal(res.json.error?.message, 'The provider is rate limiting this account.'));
        c.check(`${label}: bounded Retry-After header`, () => {
          assert.equal(Number(res.headers.get('retry-after')), variant.seconds);
        });
        c.check(`${label}: bounded retry body`, () => assert.equal(res.json.error?.retryAfterSeconds, variant.seconds));
        c.check(`${label}: sanitized payload`, () => assert.doesNotMatch(res.text, /UPSTREAM_PRIVATE_SENTINEL|mock-openrouter-key|mock-groq-key/));
      }
      c.check('rate limit came from target metadata, never inference', () => {
        assert.deepEqual(rejectedCalls.map(call => call.url), expectedCalls(variant.provider).slice(0, expectedCalls(variant.provider).indexOf(variant.url) + 1));
      });
      c.check('same account cooldown prevents every transport call', () => assert.equal(cooldownCalls.length, 0));
      c.check('other account still performs fresh metadata and inference', () => {
        successExtraction(other);
        assert.deepEqual(otherCalls.map(call => call.url), expectedCalls(variant.provider));
      });
      c.check('expiry allows fresh metadata and inference', () => {
        successExtraction(expired);
        assert.deepEqual(expiryCalls.map(call => call.url), expectedCalls(variant.provider));
      });
      c.check('no mutation or leaked upstream logs', () => {
        assert.deepEqual(snapshot(f.db), before);
        assert.doesNotMatch(JSON.stringify(f.logs), /UPSTREAM_PRIVATE_SENTINEL|mock-openrouter-key|mock-groq-key/);
        assert.equal(f.sendTextCalls.length, 0);
      });
      c.finish();
    }, { ...providerOptions(variant.provider), clock: time, transport: async url => {
      if (rateLimited && url === variant.url) return new Response('UPSTREAM_PRIVATE_SENTINEL', {
        status: 429, headers: { 'Retry-After': variant.retry },
      });
      return providerResponse(url);
    } });
  });
}

for (const provider of ['groq', 'openrouter']) {
  test(`PR16 expired approval: ${provider} refuses before native decoder factory`, async t => {
    const time = clock();
    let nativeFactories = 0;
    const approval = (provider === 'groq' ? makeMockGroqApproval : makeMockApproval)({
      expiresAt: new Date(NOW + 1000).toISOString(),
    });
    await extractionApi(async f => {
      successExtraction(await extract(f));
      assert.ok(nativeFactories > 0, 'unexpired control reaches real Sharp');
      assert.deepEqual(f.calls.map(call => call.url), expectedCalls(provider));
      const before = snapshot(f.db);
      const decoderStart = nativeFactories;
      const transportStart = f.calls.length;
      time.advance(1000); // Equality is expired; request and approval are otherwise unchanged.
      const res = await extract(f);
      t.diagnostic(JSON.stringify({ provider, expiredStatus: res.status, code: res.json.error?.code,
        nativeFactories: nativeFactories - decoderStart, transport: f.calls.length - transportStart }));
      const c = checks();
      c.check('existing provider_policy refusal', () => {
        assert.ok([403, 502].includes(res.status), res.text);
        assert.equal(res.json.data, null);
        assert.equal(res.json.error?.code, 'provider_policy');
      });
      c.check('expired approval does not create a native decoder', () => assert.equal(nativeFactories, decoderStart));
      c.check('expired approval does not reach provider', () => assert.equal(f.calls.length, transportStart));
      c.check('no write or notification', () => {
        assert.deepEqual(snapshot(f.db), before);
        assert.equal(f.sendTextCalls.length, 0);
      });
      c.finish();
    }, { ...providerOptions(provider), clock: time, approvals: [approval], decoderFactory: (bytes, options) => {
      nativeFactories += 1;
      return sharp(bytes, options);
    } });
  });
}

const PRIVACY_CASES = [
  ['groq', 'dataControlsApproved'], ['groq', 'groqFreeAccount'],
  ['openrouter', 'dataControlsApproved'], ['openrouter', 'openRouterNoByok'],
  ['openrouter', 'openRouterZdrOnly'],
];
const STATUS_REASONS = ['disabled', 'not_authorized', 'not_configured', 'provider_not_configured', 'not_approved', 'ready'];

for (const [provider, attestation] of PRIVACY_CASES) {
  test(`PR16 status privacy: ${provider} ${attestation} revocation removes readiness`, async t => {
    await extractionApi(async f => {
      const before = snapshot(f.db);
      const valid = await request(f, `${ROUTE}/status`);
      successful(valid);
      assert.equal(valid.json.data.available, true, 'provider-specific fully attested control');
      assert.equal(valid.json.data.reason, 'ready');
      assert.equal(f.calls.length, 0, 'status control is offline');
      const originalConfig = { ...f.config.extraction };
      try {
        f.config.extraction[attestation] = false;
        assert.deepEqual(f.config.extraction, { ...originalConfig, [attestation]: false });
        const revoked = await request(f, `${ROUTE}/status`);
        t.diagnostic(JSON.stringify({ provider, attestation, available: revoked.json.data?.available,
          reason: revoked.json.data?.reason, transport: f.calls.length }));
        const c = checks();
        c.check('status schema and successful response preserved', () => {
          successful(revoked);
          assert.deepEqual(Object.keys(revoked.json.data).sort(), Object.keys(valid.json.data).sort());
          assert.ok(STATUS_REASONS.includes(revoked.json.data.reason));
        });
        c.check('revoked attestation makes selection unavailable', () => assert.equal(revoked.json.data.available, false));
        c.check('revoked attestation is not advertised ready', () => assert.notEqual(revoked.json.data.reason, 'ready'));
        c.check('status remains offline and read only', () => {
          assert.equal(f.calls.length, 0);
          assert.deepEqual(snapshot(f.db), before);
          assert.equal(f.sendTextCalls.length, 0);
        });
        c.finish();
      } finally { f.config.extraction[attestation] = originalConfig[attestation]; }
    }, { ...providerOptions(provider), clock: clock() });
  });
}
