import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB } from './fixtures/workspace-b.mjs';
import { startFakeSmtp } from './fixtures/fake-smtp-server.mjs';
import { APP_ENCRYPTION_KEY } from './fixtures/member-smtp.mjs';
import { loadConfig } from '../server/config.ts';
import { assertAllowedSmtpDestination } from '../server/services/smtpDestination.ts';

/**
 * The routes of the relay of the member that is signed in.
 *
 * The password is write-only: it reaches the database sealed and it never
 * leaves the server again. The test message only ever goes to the account
 * email of the caller.
 */

const RELAY = {
  host: 'smtp.example.invalid',
  port: 587,
  secure: false,
  username: 'member',
  password: 'relay-secret-value',
  sender_address: 'member@example.invalid',
  sender_name: 'Member',
};

/** A server that accepts the loopback relay and never asks for a secure session. */
function environment(extra = {}) {
  return {
    APP_ENCRYPTION_KEY,
    SMTP_ALLOWED_HOSTS: 'smtp.example.invalid,127.0.0.1',
    SMTP_ALLOW_PLAINTEXT_HOSTS: '127.0.0.1',
    ...extra,
  };
}

test('a saved relay is sealed and never returned', () => reminderApi(async f => {
  const saved = await f.request('/api/me/smtp', { method: 'PUT', body: RELAY });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.data.configured, true);
  assert.equal(saved.json.data.hasPassword, true);
  assert.equal(JSON.stringify(saved.json).includes(RELAY.password), false, 'the answer never carries the password');
  assert.equal(JSON.stringify(saved.json).includes('password_ciphertext'), false);

  const row = f.db.prepare('SELECT * FROM member_smtp_settings WHERE workspace_id=? AND account_id=?')
    .get('ws_legacy', 'admin');
  assert.notEqual(row.password_ciphertext, RELAY.password, 'the password is not stored as it was typed');
  assert.equal(JSON.stringify(row).includes(RELAY.password), false, 'no column of the row holds the plaintext');

  const read = await f.request('/api/me/smtp');
  assert.equal(read.status, 200);
  assert.equal(read.json.data.hasPassword, true);
  assert.equal(read.json.data.host, RELAY.host);
  assert.equal(read.json.data.port, RELAY.port);
  assert.equal(read.json.data.secure, false);
  assert.equal(read.json.data.username, RELAY.username);
  assert.equal(read.json.data.senderAddress, RELAY.sender_address);
  assert.equal(read.json.data.senderName, RELAY.sender_name);
  assert.equal(JSON.stringify(read.json).includes(RELAY.password), false, 'the read never carries the password');
}, undefined, environment()));

test('a deleted relay is gone', () => reminderApi(async f => {
  await f.request('/api/me/smtp', { method: 'PUT', body: RELAY });
  const deleted = await f.request('/api/me/smtp', { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.data.deleted, true);

  const read = await f.request('/api/me/smtp');
  assert.equal(read.json.data.configured, false);
  assert.equal(read.json.data.hasPassword, false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM member_smtp_settings').get().n, 0);
}, undefined, environment()));

test('a member relay alone never advertises the workspace relay as configured', () => reminderApi(async f => {
  const saved = await f.request('/api/me/smtp', { method: 'PUT', body: RELAY });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const status = await f.request('/api/email/smtp');
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.data.configured, false, 'the workspace card must not claim a relay its own test cannot use');
}, undefined, environment()));

test('the test message goes to the account email of the caller only', async t => {
  const relay = await startFakeSmtp(t);
  await reminderApi(async f => {
    await f.request('/api/me/smtp', { method: 'PUT', body: { ...RELAY, host: '127.0.0.1', port: relay.port } });

    const refused = await f.request('/api/me/smtp/test', { method: 'POST', body: { to: 'someone@example.invalid' } });
    assert.equal(refused.status, 400, JSON.stringify(refused.json));
    assert.equal(refused.json.error.code, 'recipient_forbidden', 'the recipient cannot be chosen by the client');
    assert.equal(relay.messages.length, 0, 'a refused test sends nothing');

    const tested = await f.request('/api/me/smtp/test', { method: 'POST', body: {} });
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.equal(tested.json.data.sent, true);
    assert.equal(relay.messages.length, 1, 'exactly one message left');
    assert.deepEqual(relay.messages[0].to, ['admin@example.invalid'], 'the message went to the account email');
    assert.equal(relay.messages[0].from, 'member@example.invalid', 'the message left through the relay of the member');
  }, undefined, environment());
});

test('a private relay host is refused with smtp_destination_not_allowed', async () => {
  // The destination policy names the refusal: the code travels with the error.
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-secret', DATA_DIR: os.tmpdir() });
  for (const host of ['127.0.0.1', 'localhost', '10.0.0.5']) {
    await assert.rejects(
      () => assertAllowedSmtpDestination(config, host),
      error => error.code === 'smtp_destination_not_allowed' && error.status === 400,
      `${host} is refused by the destination policy`,
    );
  }

  await reminderApi(async f => {
    for (const host of ['127.0.0.1', 'localhost', '10.0.0.5']) {
      const refused = await f.request('/api/me/smtp', { method: 'PUT', body: { ...RELAY, host } });
      // The route refuses the relay and stores nothing. The answer carries the
      // code of the refusal, so the operator sees why and not a server fault.
      assert.equal(refused.status, 400, `${host} answered ${JSON.stringify(refused.json)}`);
      assert.equal(refused.json.data, null, `${host} answered ${JSON.stringify(refused.json)}`);
      assert.equal(refused.json.error.code, 'smtp_destination_not_allowed', `${host} answered ${JSON.stringify(refused.json)}`);
    }
    const read = await f.request('/api/me/smtp');
    assert.equal(read.json.data.configured, false, 'a refused relay is never stored');
    assert.equal(f.db.prepare('SELECT count(*) n FROM member_smtp_settings').get().n, 0);
  }, undefined, { APP_ENCRYPTION_KEY, SMTP_ALLOWED_HOSTS: 'smtp.example.invalid' });
});

test('the save endpoint is rate limited', () => reminderApi(async f => {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const saved = await f.request('/api/me/smtp', { method: 'PUT', body: RELAY });
    assert.equal(saved.status, 200, `save ${attempt} answered ${JSON.stringify(saved.json)}`);
  }
  const limited = await f.request('/api/me/smtp', { method: 'PUT', body: RELAY });
  assert.equal(limited.status, 429, JSON.stringify(limited.json));
  assert.equal(limited.json.error.code, 'rate_limited');
}, undefined, environment()));

test('the test endpoint is rate limited', async t => {
  const relay = await startFakeSmtp(t);
  await reminderApi(async f => {
    await f.request('/api/me/smtp', { method: 'PUT', body: { ...RELAY, host: '127.0.0.1', port: relay.port } });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const tested = await f.request('/api/me/smtp/test', { method: 'POST', body: {} });
      assert.equal(tested.status, 200, `test ${attempt} answered ${JSON.stringify(tested.json)}`);
    }
    const limited = await f.request('/api/me/smtp/test', { method: 'POST', body: {} });
    assert.equal(limited.status, 429, JSON.stringify(limited.json));
    assert.equal(limited.json.error.code, 'rate_limited');
    assert.equal(relay.messages.length, 5, 'the refused test sent nothing');
  }, undefined, environment());
});

test('the designated sender must be an account of the same workspace', () => reminderApi(async f => {
  addWorkspaceB(f);

  const refused = await f.request('/api/workspace/notification-sender', { method: 'PUT', body: { account_id: 'admin-b' } });
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, 'notification_sender_ineligible', 'an account of another workspace is refused');

  const chosen = await f.request('/api/workspace/notification-sender', { method: 'PUT', body: { account_id: 'admin' } });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
  assert.equal(chosen.json.data.accountId, 'admin');

  const read = await f.request('/api/workspace/notification-sender');
  assert.equal(read.json.data.accountId, 'admin');
  assert.deepEqual(read.json.data.members.map(member => member.accountId), ['admin', 'viewer']);

  const cleared = await f.request('/api/workspace/notification-sender', { method: 'PUT', body: { account_id: null } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal(cleared.json.data.accountId, null);
  assert.equal((await f.request('/api/workspace/notification-sender')).json.data.accountId, null);
}, undefined, environment()));
