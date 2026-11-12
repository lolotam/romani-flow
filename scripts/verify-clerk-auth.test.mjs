import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { loadConfig, validateConfig } from '../server/config.ts';
import { SETTING_DEFINITIONS, isTenantSetting } from '../server/repositories/settings.ts';
import { STARTER_MINISTRIES, STARTER_POSITIONS } from '../server/db/starterCatalog.ts';

const identities = {
  owner: { userId: 'clerk-owner', orgId: 'org-a', orgRole: 'org:owner', orgName: 'Organization A', email: 'owner@example.invalid', emailVerified: true, name: 'Owner A' },
  other: { userId: 'clerk-other', orgId: 'org-b', orgRole: 'org:owner', orgName: 'Organization B', email: 'other@example.invalid', emailVerified: true, name: 'Owner B' },
  viewer: { userId: 'clerk-viewer', orgId: 'org-a', orgRole: 'org:viewer', email: 'viewer@example.invalid', emailVerified: true, name: 'Viewer A' },
  editor: { userId: 'clerk-editor', orgId: 'org-a', orgRole: 'org:editor', email: 'editor@example.invalid', emailVerified: true, name: 'Editor A' },
  noOrg: { userId: 'clerk-no-org', orgId: null, orgRole: null, email: 'no-org@example.invalid', emailVerified: true, name: 'No Org' },
  unverified: { userId: 'clerk-unverified', orgId: 'org-unverified', orgRole: 'org:owner', email: 'legacy@example.invalid', emailVerified: false, name: 'Unverified' },
  nonOwner: { userId: 'clerk-non-owner', orgId: 'org-non-owner', orgRole: 'org:editor', email: 'legacy@example.invalid', emailVerified: true, name: 'Editor' },
  unknownRole: { userId: 'clerk-unknown-role', orgId: 'org-unknown-role', orgRole: 'org:admin', email: 'unknown@example.invalid', emailVerified: true, name: 'Unknown' },
  platform: { userId: 'clerk-platform', orgId: null, orgRole: null, email: ' Platform@Example.invalid ', emailVerified: true, name: 'Platform' },
  platformUnverified: { userId: 'clerk-platform-unverified', orgId: null, orgRole: null, email: 'platform@example.invalid', emailVerified: false, name: 'Platform Unverified' },
  legacyOwner: { userId: 'clerk-legacy-owner', orgId: 'org-legacy', orgRole: 'org:owner', email: 'legacy@example.invalid', emailVerified: true, name: 'Legacy Owner' },
  secondLegacy: { userId: 'clerk-second-legacy', orgId: 'org-second-legacy', orgRole: 'org:owner', email: 'legacy@example.invalid', emailVerified: true, name: 'Second Legacy' },
  multiOrgA: { userId: 'clerk-multi-org', orgId: 'org-a', orgRole: 'org:owner', orgName: 'Organization A', email: 'multi@example.invalid', emailVerified: true, name: 'Multi Org' },
  multiOrgB: { userId: 'clerk-multi-org', orgId: 'org-b', orgRole: 'org:owner', orgName: 'Organization B', email: 'multi@example.invalid', emailVerified: true, name: 'Multi Org' },
};
const clerkEnv = {
  AUTH_PROVIDER: 'clerk',
  CLERK_SECRET_KEY: 'sk_test_synthetic',
  CLERK_PUBLISHABLE_KEY: 'pk_test_c3ludGhldGljLmludmFsaWQk',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_c3ludGhldGlj',
  PLATFORM_ADMIN_EMAILS: 'platform@example.invalid',
};

/** Only the identity boundary is faked; every application and database path is real. */
function clerkApi(run) {
  const identityResolver = req => identities[req.get('x-synthetic-identity')] ?? null;
  return reminderApi(run, undefined, clerkEnv, { identityResolver });
}

const workspaceFor = (f, orgId) => f.db.prepare('SELECT * FROM workspaces WHERE clerk_org_id=?').get(orgId) ?? null;

test('clerk requests without an identity answer 401 unauthenticated', () => clerkApi(async f => {
  const response = await f.request('/api/companies', { role: null });
  assert.equal(response.status, 401);
  assert.equal(response.json.error.code, 'unauthenticated');
}));

test('a signed-in user without an organization answers 403 workspace_required', () => clerkApi(async f => {
  const response = await f.request('/api/companies', { identity: 'noOrg' });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'workspace_required');
}));

test('an unknown organization gets one fully initialized workspace and no legacy rows', () => clerkApi(async f => {
  const response = await f.request('/api/companies', { identity: 'owner' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.data, []);

  const workspace = workspaceFor(f, 'org-a');
  assert.match(workspace.id, /^ws_[A-Za-z0-9_-]+$/);
  assert.equal(workspace.name, 'Organization A');
  assert.equal(workspace.legacy_claim_email, null);
  const settings = f.db.prepare('SELECT key FROM workspace_settings WHERE workspace_id=?').all(workspace.id);
  assert.equal(settings.length, SETTING_DEFINITIONS.filter(definition => isTenantSetting(definition.key)).length);
  assert.equal(f.db.prepare('SELECT count(*) n FROM ministries WHERE workspace_id=?').get(workspace.id).n, STARTER_MINISTRIES.length);
  assert.equal(f.db.prepare('SELECT count(*) n FROM positions WHERE workspace_id=?').get(workspace.id).n, STARTER_POSITIONS.length);
  assert.equal(f.db.prepare('SELECT count(*) n FROM documents WHERE workspace_id=?').get(workspace.id).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users WHERE clerk_user_id=? AND email_verified=1').get('clerk-owner').n, 1);

  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM workspaces WHERE clerk_org_id=?').get('org-a').n, 1, 'the second request reuses the workspace');
}));

test('two Clerk organizations cannot read each other\'s tenant rows', () => clerkApi(async f => {
  const created = await f.request('/api/companies', { method: 'POST', identity: 'owner', body: { name: 'Organization A company' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const companyId = created.json.data[0].id;

  const bList = await f.request('/api/companies', { identity: 'other' });
  assert.equal(bList.status, 200);
  assert.deepEqual(bList.json.data, []);
  assert.equal((await f.request(`/api/companies/${companyId}`, { identity: 'other' })).status, 404);
  assert.equal((await f.request(`/api/companies/${companyId}`, { identity: 'owner' })).status, 200);
}));

test('a client-sent workspace_id is refused on a Clerk write, as in legacy mode', () => clerkApi(async f => {
  const response = await f.request('/api/companies', {
    method: 'POST', identity: 'owner', body: { name: 'Server scoped', workspace_id: 'ws_legacy' },
  });
  assert.equal(response.status, 400, JSON.stringify(response.json));
  assert.equal(response.json.error.code, 'unknown_column');
  assert.equal(f.db.prepare("SELECT count(*) n FROM companies WHERE name='Server scoped'").get().n, 0);
}));


test('a viewer reads but cannot write tenant rows', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  assert.equal((await f.request('/api/companies', { identity: 'viewer' })).status, 200);
  const response = await f.request('/api/companies', { method: 'POST', identity: 'viewer', body: { name: 'Viewer write' } });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'forbidden');
  assert.equal(f.db.prepare("SELECT count(*) n FROM companies WHERE name='Viewer write'").get().n, 0);
}));

test('an editor writes ordinary resources but not owner-only settings', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const created = await f.request('/api/companies', { method: 'POST', identity: 'editor', body: { name: 'Editor write' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const settings = await f.request('/api/settings', { method: 'PUT', identity: 'editor', body: { 'email.enabled': false } });
  assert.equal(settings.status, 403);
  assert.equal(settings.json.error.code, 'forbidden');
}));

test('an unrecognized organization role is forbidden', () => clerkApi(async f => {
  const response = await f.request('/api/companies', { identity: 'unknownRole' });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'forbidden');
}));

test('a verified owner claims legacy data once and a second organization cannot claim it', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email=' Legacy@Example.invalid ' WHERE id='ws_legacy'").run();
  const claimed = await f.request('/api/documents', { identity: 'legacyOwner' });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.ok(claimed.json.data.some(row => row.id === f.document.id), 'the legacy document is visible after claiming');
  assert.equal(f.db.prepare("SELECT clerk_org_id,legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().clerk_org_id, 'org-legacy');
  assert.equal(f.db.prepare("SELECT legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().legacy_claim_email, null);

  const second = await f.request('/api/documents', { identity: 'secondLegacy' });
  assert.equal(second.status, 200);
  assert.deepEqual(second.json.data, []);
  assert.equal(workspaceFor(f, 'org-second-legacy').id === 'ws_legacy', false);
}));

for (const identity of ['unverified', 'nonOwner']) {
  test(`${identity} cannot claim the legacy workspace`, () => clerkApi(async f => {
    f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
    const response = await f.request('/api/documents', { identity });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.deepEqual(response.json.data, []);
    const legacy = f.db.prepare("SELECT clerk_org_id,legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get();
    assert.equal(legacy.clerk_org_id, null);
    assert.equal(legacy.legacy_claim_email, 'legacy@example.invalid');
  }));
}

test('a suspended linked workspace answers 403 workspace_suspended', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  f.db.prepare('UPDATE workspaces SET suspended_at=? WHERE clerk_org_id=?').run(new Date().toISOString(), 'org-a');
  const response = await f.request('/api/companies', { identity: 'owner' });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'workspace_suspended');
}));

test('platform/me is true only for a verified allowlisted email, even without an org', () => clerkApi(async f => {
  for (const [identity, expected] of [['platform', true], ['platformUnverified', false], ['owner', false]]) {
    const response = await f.request('/api/platform/me', { identity });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.data.isPlatformAdmin, expected, identity);
  }
}));


/** Signs the exact raw body with the Standard Webhooks scheme used by Clerk. */
async function sendWebhook(f, event, { id = `evt_${crypto.randomUUID()}`, signatureMode = 'valid' } = {}) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(clerkEnv.CLERK_WEBHOOK_SIGNING_SECRET.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const response = await fetch(`${f.base}/api/webhooks/clerk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      ...(signatureMode === 'missing' ? {} : { 'svix-signature': signatureMode === 'bad' ? 'v1,invalid' : `v1,${signature}` }),
    },
    body,
  });
  return { status: response.status, json: (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() : null };
}

const userEvent = (type = 'user.created', email = 'webhook@example.invalid') => ({
  type,
  data: {
    id: 'clerk-webhook-user',
    primary_email_address_id: 'email-primary',
    email_addresses: [{ id: 'email-primary', email_address: email, verification: { status: 'verified' } }],
    first_name: 'Web',
    last_name: 'Hook',
  },
});

for (const signatureMode of ['bad', 'missing']) {
  test(`a webhook with a ${signatureMode} signature answers 400 and has no side effects`, () => clerkApi(async f => {
    const response = await sendWebhook(f, userEvent(), { signatureMode });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'invalid_signature');
    assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM clerk_webhook_events').get().n, 0);
  }));
}

test('a valid user webhook upserts the primary verified email and a replay is idempotent', () => clerkApi(async f => {
  const id = 'evt_user_created';
  const first = await sendWebhook(f, userEvent(), { id });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const stored = f.db.prepare("SELECT * FROM users WHERE clerk_user_id='clerk-webhook-user'").get();
  assert.equal(stored.email, 'webhook@example.invalid');
  assert.equal(stored.email_verified, 1);
  assert.equal(stored.name, 'Web Hook');

  const replay = await sendWebhook(f, userEvent('user.updated', 'changed@example.invalid'), { id });
  assert.equal(replay.status, 200);
  assert.equal(f.db.prepare("SELECT email FROM users WHERE clerk_user_id='clerk-webhook-user'").get().email, 'webhook@example.invalid');
  assert.equal(f.db.prepare('SELECT count(*) n FROM clerk_webhook_events WHERE id=?').get(id).n, 1);

  const deleted = await sendWebhook(f, { type: 'user.deleted', data: { id: 'clerk-webhook-user', deleted: true } });
  assert.equal(deleted.status, 200);
  assert.ok(f.db.prepare("SELECT deleted_at FROM users WHERE clerk_user_id='clerk-webhook-user'").get().deleted_at);
}));

test('organization webhooks only rename linked workspaces and suspend without deleting tenant data', () => clerkApi(async f => {
  const created = await sendWebhook(f, { type: 'organization.created', data: { id: 'org-a', name: 'Webhook Workspace' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(workspaceFor(f, 'org-a'), null, 'an unlinked organization webhook is a no-op');

  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const workspace = workspaceFor(f, 'org-a');
  assert.equal(f.db.prepare('SELECT count(*) n FROM ministries WHERE workspace_id=?').get(workspace.id).n, STARTER_MINISTRIES.length);

  const updated = await sendWebhook(f, { type: 'organization.updated', data: { id: 'org-a', name: 'Renamed Workspace' } });
  assert.equal(updated.status, 200);
  assert.equal(workspaceFor(f, 'org-a').name, 'Renamed Workspace');

  const deleted = await sendWebhook(f, { type: 'organization.deleted', data: { id: 'org-a', deleted: true } });
  assert.equal(deleted.status, 200);
  assert.ok(workspaceFor(f, 'org-a').suspended_at);
  assert.equal(f.db.prepare('SELECT count(*) n FROM ministries WHERE workspace_id=?').get(workspace.id).n, STARTER_MINISTRIES.length);

  const ignored = await sendWebhook(f, { type: 'session.created', data: { id: 'session-ignored' } });
  assert.equal(ignored.status, 200);
}));

test('organization.created cannot provision or claim before the verified owner signs in', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
  const webhook = await sendWebhook(f, { type: 'organization.created', data: { id: 'org-legacy', name: 'Legacy Organization' } });
  assert.equal(webhook.status, 200, JSON.stringify(webhook.json));
  assert.equal(workspaceFor(f, 'org-legacy'), null);
  assert.equal(f.db.prepare("SELECT legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().legacy_claim_email, 'legacy@example.invalid');

  const signedIn = await f.request('/api/documents', { identity: 'legacyOwner' });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  assert.ok(signedIn.json.data.some(row => row.id === f.document.id));
  const legacy = f.db.prepare("SELECT clerk_org_id,legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get();
  assert.equal(legacy.clerk_org_id, 'org-legacy');
  assert.equal(legacy.legacy_claim_email, null);
}));

test('one Clerk user keeps independent drafts and form defaults in two organizations', () => clerkApi(async f => {
  const companyA = await f.request('/api/companies', { method: 'POST', identity: 'multiOrgA', body: { name: 'Defaults A' } });
  const account = f.db.prepare('SELECT id FROM users WHERE clerk_user_id=?').get('clerk-multi-org').id;
  const draftHeaders = { 'x-draft-account': account };
  const draftA = await f.request('/api/document-drafts/new', {
    method: 'PUT', identity: 'multiOrgA', headers: draftHeaders,
    body: { revision: 'none', values: { title: 'Draft A', notes: 'Private A' } },
  });
  const companyB = await f.request('/api/companies', { method: 'POST', identity: 'multiOrgB', body: { name: 'Defaults B' } });
  const draftB = await f.request('/api/document-drafts/new', {
    method: 'PUT', identity: 'multiOrgB', headers: draftHeaders,
    body: { revision: 'none', values: { title: 'Draft B', notes: 'Private B' } },
  });

  const defaultsA = await f.request('/api/form-defaults/companies', { identity: 'multiOrgA' });
  const defaultsB = await f.request('/api/form-defaults/companies', { identity: 'multiOrgB' });
  const readDraftA = await f.request('/api/document-drafts/new', { identity: 'multiOrgA', headers: draftHeaders });
  const readDraftB = await f.request('/api/document-drafts/new', { identity: 'multiOrgB', headers: draftHeaders });
  for (const response of [companyA, companyB, draftA, draftB, defaultsA, defaultsB, readDraftA, readDraftB]) {
    assert.ok(response.status < 400, JSON.stringify(response.json));
  }
  assert.equal(defaultsA.json.data.name, 'Defaults A');
  assert.equal(defaultsB.json.data.name, 'Defaults B');
  assert.deepEqual(readDraftA.json.data.values, { title: 'Draft A', notes: 'Private A' });
  assert.deepEqual(readDraftB.json.data.values, { title: 'Draft B', notes: 'Private B' });
}));

for (const missing of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']) {
  test(`clerk boot validation names missing ${missing}`, () => {
    const env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), ...clerkEnv };
    delete env[missing];
    assert.throws(() => validateConfig(loadConfig(env)), new RegExp(missing));
  });
}
