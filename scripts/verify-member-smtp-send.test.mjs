import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB, B } from './fixtures/workspace-b.mjs';
import { startFakeSmtp } from './fixtures/fake-smtp-server.mjs';
import { APP_ENCRYPTION_KEY } from './fixtures/member-smtp.mjs';
import { saveMemberSmtp } from '../server/repositories/memberSmtp.ts';
import { upsertWorkspaceSmtp } from '../server/repositories/smtpSettings.ts';
import { createCredentialEncryption, MEMBER_SMTP_AAD } from '../server/services/credentialEncryption.ts';

/**
 * The relay a message leaves through.
 *
 * The relay of the member that acts wins over the relay of the workspace, and
 * the relay of the platform belongs to the legacy workspace until that
 * workspace retires it. Every relay in this file is a loopback server that
 * records the message; nothing leaves the machine.
 */

const LEGACY = { workspaceId: 'ws_legacy' };
const MESSAGE = { to: ['recipient@example.invalid'], subject: 'Resolution', text: 'Which relay took this?' };

/** The environment of a server with a platform relay and a loopback allowlist. */
function environment(platform) {
  return {
    APP_ENCRYPTION_KEY,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(platform.port),
    SMTP_USER: 'platform-user',
    SMTP_PASS: 'platform-pass',
    SMTP_FROM: 'platform@example.invalid',
    SMTP_ALLOWED_HOSTS: '127.0.0.1',
    SMTP_ALLOW_PLAINTEXT_HOSTS: '127.0.0.1',
  };
}

/** Stores the relay of the member that acts. */
function saveMemberRelay(db, accountId, relay) {
  saveMemberSmtp(db, { ...LEGACY, accountId }, relay,
    createCredentialEncryption(APP_ENCRYPTION_KEY).encrypt('member-secret', MEMBER_SMTP_AAD));
}

test('a send by a member with a relay leaves through the relay of that member', async t => {
  const member = await startFakeSmtp(t);
  const workspace = await startFakeSmtp(t);
  const platform = await startFakeSmtp(t);
  await reminderApi(async f => {
    saveMemberRelay(f.db, 'admin', { host: '127.0.0.1', port: member.port, secure: false, username: 'member',
      senderAddress: 'member@example.invalid', senderName: 'Member' });
    upsertWorkspaceSmtp(f.db, LEGACY.workspaceId, { host: '127.0.0.1', port: workspace.port, secure: 0,
      user: 'workspace', pass: 'workspace-secret', from: 'workspace@example.invalid' });

    const result = await f.mailer.send(MESSAGE, { ...LEGACY, accountId: 'admin' });
    assert.equal(result.status, 'sent');
    assert.equal(member.messages.length, 1, 'the relay of the member took the message');
    assert.equal(member.messages[0].from, 'member@example.invalid', 'the message left from the address of the member');
    assert.equal(member.messages[0].data.includes('Member <member@example.invalid>'), true, 'the sender name is on the message');
    assert.deepEqual(member.messages[0].to, ['recipient@example.invalid']);
    assert.equal(workspace.messages.length, 0, 'the relay of the workspace stayed idle');
    assert.equal(platform.messages.length, 0, 'the platform relay stayed idle');
  }, undefined, environment(platform));
});

test('a send without a relay of the member leaves through the relay of the workspace', async t => {
  const member = await startFakeSmtp(t);
  const workspace = await startFakeSmtp(t);
  const platform = await startFakeSmtp(t);
  await reminderApi(async f => {
    upsertWorkspaceSmtp(f.db, LEGACY.workspaceId, { host: '127.0.0.1', port: workspace.port, secure: 0,
      user: 'workspace', pass: 'workspace-secret', from: 'workspace@example.invalid' });

    await f.mailer.send(MESSAGE, { ...LEGACY, accountId: 'admin' });
    assert.equal(workspace.messages.length, 1, 'the relay of the workspace took the message');
    assert.equal(workspace.messages[0].from, 'workspace@example.invalid');
    assert.equal(member.messages.length, 0, 'the relay of the member stayed idle');
    assert.equal(platform.messages.length, 0, 'the platform relay stayed idle');
  }, undefined, environment(platform));
});

test('a send without any relay fails outside the legacy workspace', async t => {
  const platform = await startFakeSmtp(t);
  await reminderApi(async f => {
    addWorkspaceB(f);
    await assert.rejects(
      () => f.mailer.send(MESSAGE, { ...B, accountId: 'admin-b' }),
      error => error.code === 'smtp_not_configured' && error.status === 503,
      'the send is refused with the code of a missing relay',
    );
    assert.equal(platform.messages.length, 0, 'the platform relay of another workspace stayed idle');
  }, undefined, environment(platform));
});

test('the legacy workspace falls back to the platform relay until it retires it', async t => {
  const platform = await startFakeSmtp(t);
  await reminderApi(async f => {
    await f.mailer.send(MESSAGE, { ...LEGACY, accountId: 'admin' });
    assert.equal(platform.messages.length, 1, 'the platform relay took the message of the legacy workspace');
    assert.equal(platform.messages[0].from, 'platform@example.invalid');

    // The workspace retires the platform relay with a flag of its own.
    f.db.prepare(`INSERT INTO workspace_settings(workspace_id,key,value,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(LEGACY.workspaceId, 'email.legacy_environment_smtp_retired', 'true', new Date().toISOString());
    await assert.rejects(
      () => f.mailer.send(MESSAGE, { ...LEGACY, accountId: 'admin' }),
      error => error.code === 'smtp_not_configured' && error.status === 503,
      'a retired platform relay is no longer used',
    );
    assert.equal(platform.messages.length, 1, 'the platform relay took no further message');
  }, undefined, environment(platform));
});
