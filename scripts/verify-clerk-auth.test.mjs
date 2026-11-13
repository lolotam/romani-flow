import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { loadConfig, validateConfig } from '../server/config.ts';
import { applyLegacyClaimEmail } from '../server/repositories/workspaces.ts';
import { SETTING_DEFINITIONS, isTenantSetting, setSetting } from '../server/repositories/settings.ts';
import { STARTER_MINISTRIES, STARTER_POSITIONS } from '../server/db/starterCatalog.ts';
import { clerkClient } from '@clerk/express';
import { createClerkIdentityResolver } from '../server/auth/clerkIdentity.ts';

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
  legacyViewer: { userId: 'clerk-legacy-viewer', orgId: 'org-legacy', orgRole: 'org:viewer', email: 'viewer@example.invalid', emailVerified: true, name: 'Legacy Viewer' },
  secondLegacy: { userId: 'clerk-second-legacy', orgId: 'org-second-legacy', orgRole: 'org:owner', email: 'legacy@example.invalid', emailVerified: true, name: 'Second Legacy' },
  multiOrgA: { userId: 'clerk-multi-org', orgId: 'org-a', orgRole: 'org:owner', orgName: 'Organization A', email: 'multi@example.invalid', emailVerified: true, name: 'Multi Org' },
  multiOrgB: { userId: 'clerk-multi-org', orgId: 'org-b', orgRole: 'org:owner', orgName: 'Organization B', email: 'multi@example.invalid', emailVerified: true, name: 'Multi Org' },
  staleLegacyOwner: { userId: 'clerk-stale-legacy', orgId: 'org-stale-legacy', orgRole: 'org:owner', email: 'legacy@example.invalid', emailVerified: true, name: 'Stale Legacy', profileFresh: false },
  stalePlatform: { userId: 'clerk-stale-platform', orgId: null, orgRole: null, email: 'platform@example.invalid', emailVerified: true, name: 'Stale Platform', profileFresh: false },
  staleLinked: { userId: 'clerk-owner', orgId: 'org-a', orgRole: 'org:owner', orgName: 'Organization A', email: 'owner@example.invalid', emailVerified: true, name: 'Owner A', profileFresh: false },
};
const clerkEnv = {
  AUTH_PROVIDER: 'clerk',
  CLERK_SECRET_KEY: 'sk_test_synthetic',
  CLERK_PUBLISHABLE_KEY: 'pk_test_c3ludGhldGljLmludmFsaWQk',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_c3ludGhldGlj',
  PLATFORM_ADMIN_EMAILS: 'platform@example.invalid',
};

// The Clerk client is only built once it has a key, and it is built once per
// process. The synthetic key lets the tests replace the backend reads instead
// of reaching the network.
process.env.CLERK_SECRET_KEY = clerkEnv.CLERK_SECRET_KEY;

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

test('an unverified owner cannot claim the legacy workspace', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
  const response = await f.request('/api/documents', { identity: 'unverified' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.data, []);
  const legacy = f.db.prepare("SELECT clerk_org_id,legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get();
  assert.equal(legacy.clerk_org_id, null);
  assert.equal(legacy.legacy_claim_email, 'legacy@example.invalid');
}));

for (const identity of ['nonOwner', 'legacyViewer']) {
  test(`${identity} cannot claim or provision an unlinked organization`, () => clerkApi(async f => {
    f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
    const response = await f.request('/api/documents', { identity });
    assert.equal(response.status, 403, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'workspace_not_ready');
    assert.equal(workspaceFor(f, identities[identity].orgId), null);
    assert.equal(f.db.prepare("SELECT clerk_org_id FROM workspaces WHERE id='ws_legacy'").get().clerk_org_id, null);
  }));
}

test('a viewer first on an unlinked legacy organization leaves it for the verified owner to claim', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
  assert.equal((await f.request('/api/documents', { identity: 'legacyViewer' })).status, 403);
  assert.equal(workspaceFor(f, 'org-legacy'), null);

  const claimed = await f.request('/api/documents', { identity: 'legacyOwner' });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.ok(claimed.json.data.some(row => row.id === f.document.id));
  assert.equal(f.db.prepare("SELECT clerk_org_id FROM workspaces WHERE id='ws_legacy'").get().clerk_org_id, 'org-legacy');
}));

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

test('auth/config publishes only the provider and Clerk publishable key', () => clerkApi(async f => {
  const response = await f.request('/api/auth/config', { role: null });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.data, { provider: 'clerk', publishableKey: clerkEnv.CLERK_PUBLISHABLE_KEY });
  const serialized = JSON.stringify(response.json);
  assert.equal(serialized.includes(clerkEnv.CLERK_SECRET_KEY), false);
  assert.equal(serialized.includes(clerkEnv.CLERK_WEBHOOK_SIGNING_SECRET), false);
}));

test('legacy auth/config never publishes Clerk keys', () => reminderApi(async f => {
  const response = await f.request('/api/auth/config', { role: null });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.data, { provider: 'legacy', publishableKey: null });
  const serialized = JSON.stringify(response.json);
  assert.equal(serialized.includes(clerkEnv.CLERK_SECRET_KEY), false);
  assert.equal(serialized.includes(clerkEnv.CLERK_PUBLISHABLE_KEY), false);
  assert.equal(serialized.includes(clerkEnv.CLERK_WEBHOOK_SIGNING_SECRET), false);
}, undefined, { ...clerkEnv, AUTH_PROVIDER: 'legacy' }));

test('clerk auth/me returns the local user id and organization role', () => clerkApi(async f => {
  // The organization is provisioned by its owner; the editor only joins it.
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const response = await f.request('/api/auth/me', { identity: 'editor' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const local = f.db.prepare("SELECT id FROM users WHERE clerk_user_id='clerk-editor'").get();
  assert.deepEqual(response.json.data.user, {
    id: local.id, email: 'editor@example.invalid', name: 'Editor A', role: 'editor',
  });
}));

test('clerk auth/me requires an active organization', () => clerkApi(async f => {
  const response = await f.request('/api/auth/me', { identity: 'noOrg' });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'workspace_required');
}));

test('clerk mode disables legacy login', () => clerkApi(async f => {
  const response = await f.request('/api/auth/login', {
    method: 'POST', role: null, body: { email: 'admin@example.invalid', password: 'not-a-real-password' },
  });
  assert.equal(response.status, 410);
  assert.equal(response.json.error.code, 'legacy_login_disabled');
}));

test('legacy auth/me keeps the existing session response', () => reminderApi(async f => {
  const response = await f.request('/api/auth/me');
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.data.user, {
    id: 'admin', email: 'admin@example.invalid', name: 'Synthetic', role: 'admin',
  });
  assert.equal(response.json.data.workspaceId, 'ws_legacy');
  assert.equal(response.json.data.expiryWarningDays, 30);
  assert.equal(response.json.data.scheduleEditable, true);
  assert.equal(response.json.data.whatsappAvailable, true);
}));

test('auth/me returns the database workspace id for a claimed legacy org', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
  const response = await f.request('/api/auth/me', { identity: 'legacyOwner' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.workspaceId, 'ws_legacy');
  assert.notEqual(response.json.data.workspaceId, 'org-legacy');
}));

test('auth/me exposes expiryWarningDays to every role', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const workspace = workspaceFor(f, 'org-a');
  setSetting(f.db, { workspaceId: workspace.id }, 'expiry_warning_days', 14);
  const editor = await f.request('/api/auth/me', { identity: 'editor' });
  assert.equal(editor.status, 200, JSON.stringify(editor.json));
  assert.equal(editor.json.data.expiryWarningDays, 14);
  assert.equal(editor.json.data.workspaceId, workspace.id);
  assert.notEqual(editor.json.data.workspaceId, 'org-a');
}));

test('a stale profile cannot claim or provision a workspace', () => clerkApi(async f => {
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();
  const before = f.db.prepare('SELECT count(*) n FROM workspaces').get().n;
  const response = await f.request('/api/documents', { identity: 'staleLegacyOwner' });
  assert.equal(response.status, 503, JSON.stringify(response.json));
  assert.equal(response.json.error.code, 'workspace_not_ready');
  assert.equal(f.db.prepare("SELECT clerk_org_id, legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().clerk_org_id, null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM workspaces').get().n, before);
  assert.equal(workspaceFor(f, 'org-stale-legacy'), null);
}));

test('a stale profile is not a platform admin', () => clerkApi(async f => {
  const response = await f.request('/api/platform/me', { identity: 'stalePlatform' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.data.isPlatformAdmin, false);
}));

test('a stale profile still serves an already-linked workspace', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const workspace = workspaceFor(f, 'org-a');
  const response = await f.request('/api/companies', { identity: 'staleLinked' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(workspaceFor(f, 'org-a').id, workspace.id);
}));

test('auth/me hides the schedule and WhatsApp outside the legacy workspace', () => clerkApi(async f => {
  assert.equal((await f.request('/api/companies', { identity: 'owner' })).status, 200);
  const response = await f.request('/api/auth/me', { identity: 'owner' });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const workspace = workspaceFor(f, 'org-a');
  assert.notEqual(workspace.id, 'ws_legacy');
  assert.equal(response.json.data.scheduleEditable, false);
  assert.equal(response.json.data.whatsappAvailable, false);
}));

test('the legacy claim address is stored only while the workspace is unlinked', () => reminderApi(async f => {
  assert.equal(applyLegacyClaimEmail(f.db, ' Legacy@Example.invalid '), true);
  assert.equal(f.db.prepare("SELECT legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().legacy_claim_email, 'legacy@example.invalid');
  assert.equal(applyLegacyClaimEmail(f.db, 'other@example.invalid'), false, 'an address already stored is left alone');
  assert.equal(f.db.prepare("SELECT legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().legacy_claim_email, 'legacy@example.invalid');

  f.db.prepare("UPDATE workspaces SET clerk_org_id='org-legacy', legacy_claim_email=NULL WHERE id='ws_legacy'").run();
  assert.equal(applyLegacyClaimEmail(f.db, 'legacy@example.invalid'), false);
  assert.equal(f.db.prepare("SELECT clerk_org_id, legacy_claim_email FROM workspaces WHERE id='ws_legacy'").get().legacy_claim_email, null);
}));

test('a legacy claim moves drafts and form defaults onto the new user', () => clerkApi(async f => {
  const adminId = 'legacy-admin';
  const stamp = '2026-01-01T00:00:00.000Z';
  f.db.prepare("INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_legacy',?,'legacy@example.invalid','Legacy','admin','not-a-login-fixture',?,?)").run(adminId, stamp, stamp);
  f.db.prepare("INSERT INTO document_drafts(workspace_id,user_id,scope,revision,values_json,updated_at) VALUES('ws_legacy',?,'new','r1','{\"title\":\"Kept\"}',?)").run(adminId, stamp);
  f.db.prepare("INSERT INTO form_defaults(workspace_id,user_id,form_key,source_id,values_json,updated_at) VALUES('ws_legacy',?,'companies','c1','{\"name\":\"Kept\"}',?)").run(adminId, stamp);
  f.db.prepare("UPDATE workspaces SET legacy_claim_email='legacy@example.invalid' WHERE id='ws_legacy'").run();

  const claimed = await f.request('/api/documents', { identity: 'legacyOwner' });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const userId = f.db.prepare("SELECT id FROM users WHERE clerk_user_id='clerk-legacy-owner'").get().id;
  assert.notEqual(userId, adminId);
  assert.equal(f.db.prepare("SELECT user_id, values_json FROM document_drafts WHERE workspace_id='ws_legacy' AND scope='new'").get().user_id, userId);
  assert.equal(f.db.prepare("SELECT values_json FROM document_drafts WHERE workspace_id='ws_legacy' AND user_id=?").get(userId).values_json, '{"title":"Kept"}');
  assert.equal(f.db.prepare("SELECT user_id, values_json FROM form_defaults WHERE workspace_id='ws_legacy' AND form_key='companies'").get().user_id, userId);
  assert.equal(f.db.prepare("SELECT values_json FROM form_defaults WHERE workspace_id='ws_legacy' AND user_id=?").get(userId).values_json, '{"name":"Kept"}');
  assert.equal(f.db.prepare('SELECT count(*) n FROM document_drafts WHERE user_id=?').get(adminId).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM form_defaults WHERE user_id=?').get(adminId).n, 0);
}));

for (const missing of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']) {
  test(`clerk boot validation names missing ${missing}`, () => {
    const env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), ...clerkEnv };
    delete env[missing];
    assert.throws(() => validateConfig(loadConfig(env)), new RegExp(missing));
  });
}


const clerkRequest = (userId, orgId = null) => {
  const auth = () => ({ tokenType: 'session_token', userId, orgId, orgRole: orgId ? 'org:owner' : null });
  auth[Symbol.for('@clerk/express.auth')] = true;
  return { auth };
};

test('Clerk identity reads use stale cached profiles and organizations when the backend fails', async t => {
  let now = 1_800_000_000_000;
  let unavailable = false;
  t.mock.method(Date, 'now', () => now);
  const getUser = t.mock.method(clerkClient.users, 'getUser', async userId => {
    if (unavailable) throw new Error('Clerk backend unavailable');
    return {
      primaryEmailAddress: { emailAddress: `${userId}@example.invalid`, verification: { status: 'verified' } },
      fullName: 'Cached User', username: null,
    };
  });
  const getOrganization = t.mock.method(clerkClient.organizations, 'getOrganization', async ({ organizationId }) => {
    if (unavailable) throw new Error('Clerk backend unavailable');
    return { name: `Organization ${organizationId}` };
  });
  const resolve = createClerkIdentityResolver();

  const fresh = await resolve(clerkRequest('cache-user', 'cache-org'));
  assert.equal(fresh.email, 'cache-user@example.invalid');
  assert.equal(fresh.orgName, 'Organization cache-org');
  assert.equal(getUser.mock.callCount(), 1);
  assert.equal(getOrganization.mock.callCount(), 1);

  // Inside the lifetime of the entry the backend is not read at all.
  now += 30_000;
  assert.deepEqual(await resolve(clerkRequest('cache-user', 'cache-org')), fresh);
  assert.equal(getUser.mock.callCount(), 1);
  assert.equal(getOrganization.mock.callCount(), 1);

  // Past its lifetime the backend is read again, and its failure falls back to
  // the profile and the organization that were read before.
  now += 31_000;
  unavailable = true;
  const stale = await resolve(clerkRequest('cache-user', 'cache-org'));
  assert.equal(fresh.profileFresh, true);
  assert.equal(stale.profileFresh, false);
  assert.equal(stale.email, fresh.email);
  assert.equal(stale.orgName, fresh.orgName);
  assert.equal(getUser.mock.callCount(), 2);
  assert.equal(getOrganization.mock.callCount(), 2);
  await assert.rejects(() => resolve(clerkRequest('cache-user', 'uncached-org')), /Clerk backend unavailable/);
  await assert.rejects(() => createClerkIdentityResolver()(clerkRequest('uncached-user')), /Clerk backend unavailable/);
});

test('Clerk identity refreshes share one in-flight read per key', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let release = () => {};
  let gate = Promise.resolve();
  const getUser = t.mock.method(clerkClient.users, 'getUser', async userId => {
    await gate;
    return {
      primaryEmailAddress: { emailAddress: `${userId}@example.invalid`, verification: { status: 'verified' } },
      fullName: 'Cached User', username: null,
    };
  });
  t.mock.method(clerkClient.organizations, 'getOrganization', async ({ organizationId }) => ({ name: `Organization ${organizationId}` }));
  const resolve = createClerkIdentityResolver();
  await resolve(clerkRequest('flight-user', 'flight-org'));
  assert.equal(getUser.mock.callCount(), 1);

  now += 61_000;
  gate = new Promise(resolveGate => { release = resolveGate; });
  const first = resolve(clerkRequest('flight-user', 'flight-org'));
  const second = resolve(clerkRequest('flight-user', 'flight-org'));
  await new Promise(resolveWait => setImmediate(resolveWait));
  assert.equal(getUser.mock.callCount(), 2, 'the second caller waits on the refresh already in flight');
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.profileFresh, true);
  assert.equal(right.email, left.email);
  assert.equal(getUser.mock.callCount(), 2);
});

test('Clerk identity user and organization caches drop expired and oldest entries', async t => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const getUser = t.mock.method(clerkClient.users, 'getUser', async userId => ({
    primaryEmailAddress: { emailAddress: `${userId}@example.invalid`, verification: { status: 'verified' } },
    fullName: userId, username: null,
  }));
  const getOrganization = t.mock.method(clerkClient.organizations, 'getOrganization', async ({ organizationId }) => ({ name: organizationId }));
  const resolve = createClerkIdentityResolver();

  for (let index = 0; index < 1005; index += 1) await resolve(clerkRequest(`user-${index}`, `org-${index}`));
  assert.equal(getUser.mock.callCount(), 1005);
  assert.equal(getOrganization.mock.callCount(), 1005);
  await resolve(clerkRequest('user-0', 'org-0'));
  assert.equal(getUser.mock.callCount(), 1006, 'the oldest user was evicted');
  assert.equal(getOrganization.mock.callCount(), 1006, 'the oldest organization was evicted');
  await resolve(clerkRequest('user-1004', 'org-1004'));
  assert.equal(getUser.mock.callCount(), 1006, 'the newest user remains cached');
  assert.equal(getOrganization.mock.callCount(), 1006, 'the newest organization remains cached');
});
