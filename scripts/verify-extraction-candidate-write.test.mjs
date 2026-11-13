import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionApi } from './fixtures/extraction-api.mjs';
import {
  MOCK_MODEL_ID,
  makeMockApproval,
} from './fixtures/extraction-data.mjs';

// ---------------------------------------------------------------------------
// Helpers: complete multi-table snapshots and egress assertion
// ---------------------------------------------------------------------------

function getDbSnapshot(db) {
  return {
    settings: db.prepare("SELECT key, value FROM settings UNION ALL SELECT workspace_id || ':' || key, value FROM workspace_settings ORDER BY 1 ASC").all(),
    whatsapp_jobs: db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id ASC').all(),
    whatsapp_attempts: db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id ASC').all(),
    whatsapp_recipients: db.prepare('SELECT * FROM whatsapp_recipients ORDER BY id ASC').all(),
    expiry_notifications: db.prepare('SELECT * FROM expiry_notifications ORDER BY id ASC').all(),
    email_log: db.prepare('SELECT * FROM email_log ORDER BY id ASC').all(),
  };
}

function getExtractionSettings(db) {
  const parseVal = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  return {
    enabled: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.enabled'").get()?.value),
    provider: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.provider'").get()?.value),
    model: parseVal(db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='ai_extraction.model'").get()?.value),
  };
}

function assertZeroInferenceAndSendText(f) {
  assert.ok(
    f.calls.every((c) => !c.url.includes('/chat/completions')),
    'Zero inference egress during settings save'
  );
  assert.equal(f.sendTextCalls?.length ?? 0, 0, 'Zero sendText calls');
}

const BASE_OR_OPTS = {
  enabled: false,
  provider: '',
  model: '',
  authorized: true,
  context: 'kw-docs',
  openRouterKey: 'mock-openrouter-key',
  dataControlsApproved: true,
  openRouterNoByok: true,
  openRouterZdrOnly: true,
  approvals: [makeMockApproval()],
};

const REVOCATION_CASES = [
  {
    name: 'admin role revocation to viewer',
    mutate: (f) => {
      f.db.prepare("UPDATE admin_users SET role = 'viewer' WHERE id = 'admin'").run();
    },
  },
  {
    name: 'empty context revocation',
    mutate: (f) => {
      f.config.extraction.context = '';
    },
  },
  {
    name: 'changed nonempty context revocation',
    mutate: (f) => {
      f.config.extraction.context = 'tenant-two-context';
    },
  },
  {
    name: 'approvals revocation',
    mutate: (f) => {
      f.config.extraction.approvals = [];
    },
  },
  {
    name: 'data controls revocation',
    mutate: (f) => {
      f.config.extraction.dataControlsApproved = false;
    },
  },
];

// ---------------------------------------------------------------------------
// Group 1: Queued behind held NotificationCoordinator
// Proves precise late boundary: mutating after validation and recheck while
// actual save is queued behind held coordinator must refuse with 400 invalid_settings.
// ---------------------------------------------------------------------------

async function runQueuedCoordinatorTest({ name, expectSuccess, mutate }) {
  return extractionApi(
    async (f) => {
      const preSnapshot = getDbSnapshot(f.db);

      // 1. Hold real coordinator lock first
      let releaseHold;
      const holdGate = new Promise((resolve) => {
        releaseHold = resolve;
      });
      const holdPromise = f.coordinator.runExclusive(async () => {
        await holdGate;
      });

      // 2. Wrap real coordinator.runExclusive solely to emit entry event
      // and delegate immediately to original bound method unchanged.
      const origRunExclusive = f.coordinator.runExclusive.bind(f.coordinator);
      let signalQueued;
      const queuedPromise = new Promise((resolve) => {
        signalQueued = resolve;
      });

      f.coordinator.runExclusive = function (action) {
        const res = origRunExclusive(action);
        signalQueued();
        return res;
      };

      let putPromise;
      try {
        const putBody = {
          settings: {
            'email.enabled': true,
            'ai_extraction.enabled': true,
            'ai_extraction.provider': 'openrouter',
            'ai_extraction.model': MOCK_MODEL_ID,
          },
        };

        putPromise = f.request('/api/settings', { method: 'PUT', body: putBody });

        // Bounded wait for saveSettings to enter coordinator.runExclusive (queued behind holdGate)
        await Promise.race([
          queuedPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout waiting for queued entry in ${name}`)), 2500)
          ),
        ]);

        // 3. Mutate after validation while actual save is queued behind held coordinator
        if (mutate) {
          mutate(f);
        }

        // 4. Release held lock to let queued write proceed
        releaseHold();

        // 5. Await request to settle
        const res = await putPromise;

        if (expectSuccess) {
          assert.equal(res.status, 200, `Expected 200 OK for ${name}`);
          assert.equal(res.json.error, null);
          assert.deepEqual(getExtractionSettings(f.db), {
            enabled: true,
            provider: 'openrouter',
            model: MOCK_MODEL_ID,
          });
          assert.equal(
            f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.enabled'").get()?.value,
            'true'
          );
        } else {
          // Expected RED boundary: expected 400 invalid_settings vs current 200 OK
          assert.equal(
            res.status,
            400,
            `Expected 400 invalid_settings for ${name} when revoked while queued behind coordinator`
          );
          assert.equal(res.json?.error?.code, 'invalid_settings');
          const postSnapshot = getDbSnapshot(f.db);
          assert.deepEqual(
            postSnapshot,
            preSnapshot,
            `DB snapshot must remain completely unchanged for ${name}`
          );
        }

        assertZeroInferenceAndSendText(f);
      } finally {
        if (releaseHold) releaseHold();
        if (holdPromise) await holdPromise.catch(() => {});
        if (putPromise) await putPromise.catch(() => {});
      }
    },
    { ...BASE_OR_OPTS }
  );
}

// Positive control: queued save executes and persists when lock released without revocation
test('positive control: queued saveSettings executes and persists when coordinator lock is released without revocation', () =>
  runQueuedCoordinatorTest({ name: 'positive control', expectSuccess: true }));

// Revocation cases while queued behind held coordinator
for (const c of REVOCATION_CASES) {
  test(`queued coordinator: ${c.name} after validation while queued behind lock refuses with 400 invalid_settings`, () =>
    runQueuedCoordinatorTest({ name: c.name, expectSuccess: false, mutate: c.mutate }));
}

// ---------------------------------------------------------------------------
// Group 2: While assertCanEnable awaits genuine injected status transport
// Proves second late boundary: mutating after entry while assertCanEnable
// awaits status transport must refuse with 400 invalid_settings before applySettings.
// ---------------------------------------------------------------------------

async function runWhatsAppEnableTest({ name, expectSuccess, mutate }) {
  let signalStatusEntered;
  const statusEnteredPromise = new Promise((resolve) => {
    signalStatusEntered = resolve;
  });
  let resolveStatusDeferred;
  const statusDeferred = new Promise((resolve) => {
    resolveStatusDeferred = resolve;
  });

  const whatsappTransport = {
    status: async () => {
      signalStatusEntered();
      await statusDeferred;
      return { configured: true, state: 'connected' };
    },
    sendText: async () => ({ kind: 'permanent_failed', error: 'disabled' }),
  };

  return extractionApi(
    async (f) => {
      const preSnapshot = getDbSnapshot(f.db);
      let putPromise;

      try {
        const putBody = {
          settings: {
            'whatsapp.enabled': true,
            'ai_extraction.enabled': true,
            'ai_extraction.provider': 'openrouter',
            'ai_extraction.model': MOCK_MODEL_ID,
          },
        };

        putPromise = f.request('/api/settings', { method: 'PUT', body: putBody });

        // Bounded wait for status transport entry inside assertCanEnable
        await Promise.race([
          statusEnteredPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout waiting for status entry in ${name}`)), 2500)
          ),
        ]);

        // Revoke after entry while assertCanEnable awaits status transport
        if (mutate) {
          mutate(f);
        }

        // Return legitimate connected/configured status
        resolveStatusDeferred();

        // Await request to settle
        const res = await putPromise;

        if (expectSuccess) {
          assert.equal(res.status, 200, `Expected 200 OK for ${name}`);
          assert.equal(res.json.error, null);
          assert.deepEqual(getExtractionSettings(f.db), {
            enabled: true,
            provider: 'openrouter',
            model: MOCK_MODEL_ID,
          });
          assert.equal(
            f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='whatsapp.enabled'").get()?.value,
            'true'
          );
        } else {
          // Expected RED boundary: expected 400 invalid_settings vs current 200 OK
          assert.equal(
            res.status,
            400,
            `Expected 400 invalid_settings for ${name} when revoked during assertCanEnable wait`
          );
          assert.equal(res.json?.error?.code, 'invalid_settings');
          const postSnapshot = getDbSnapshot(f.db);
          assert.deepEqual(
            postSnapshot,
            preSnapshot,
            `DB snapshot must remain completely unchanged for ${name}`
          );
        }

        assertZeroInferenceAndSendText(f);
      } finally {
        if (resolveStatusDeferred) resolveStatusDeferred();
        if (putPromise) await putPromise.catch(() => {});
      }
    },
    { ...BASE_OR_OPTS, whatsappTransport }
  );
}

// Positive control: WhatsApp enable executes and persists when status returns connected without revocation
test('positive control: WhatsApp enable saveSettings executes and persists when transport status returns connected without revocation', () =>
  runWhatsAppEnableTest({ name: 'positive control', expectSuccess: true }));

// Revocation cases while assertCanEnable awaits status transport
for (const c of REVOCATION_CASES) {
  test(`whatsapp enable wait: ${c.name} while assertCanEnable awaits status transport refuses with 400 invalid_settings`, () =>
    runWhatsAppEnableTest({ name: c.name, expectSuccess: false, mutate: c.mutate }));
}
