import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { plantLegacyFiles } from './fixtures/workspace-b.mjs';
import { APP_ENCRYPTION_KEY } from './fixtures/member-smtp.mjs';
import { setSetting } from '../server/repositories/settings.ts';
import { saveMemberSmtp } from '../server/repositories/memberSmtp.ts';
import { resolveSenderName, DEFAULT_SENDER_NAME } from '../server/services/senderName.ts';

/**
 * The name an email is signed with belongs to the person who sends it.
 *
 * The resolution order is: the personal relay name of the member, then the
 * account's own name, then the workspace `email.from_name` setting — and the
 * default subject and the footer of the document email follow it, so a
 * message never reads like it came from the product when the sender can be
 * named instead.
 */

const RELAY = {
  host: 'smtp.example.invalid',
  port: 587,
  secure: false,
  username: 'member',
  senderAddress: 'member@example.invalid',
  senderName: 'Waleed',
};

const TO = 'first@example.invalid';

/** A request stand-in with the tenant and session of the signed-in admin of the legacy workspace. */
const asRequest = name => ({ tenant: { workspaceId: 'ws_legacy', accountId: 'admin' }, user: { name } });

function saveRelay(f, senderName) {
  saveMemberSmtp(f.db, { workspaceId: 'ws_legacy', accountId: 'admin' }, { ...RELAY, senderName }, 'sealed-password');
}

/** Stores a complete member relay through the API so the password is sealed for real. */
async function saveRelayOverApi(f, senderName) {
  const saved = await f.request('/api/me/smtp', {
    method: 'PUT',
    body: {
      host: RELAY.host, port: RELAY.port, secure: RELAY.secure, username: RELAY.username,
      password: 'relay-secret-value', sender_address: RELAY.senderAddress, sender_name: senderName,
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
}

function withMail(t, run) {
  const calls = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async message => {
      calls.push(message);
      return { messageId: 'synthetic-' + calls.length, accepted: [...(message.to ?? []), ...(message.cc ?? [])], rejected: [] };
    },
  }));
  return reminderApi(f => run(f, calls), undefined, {
    APP_ENCRYPTION_KEY, SMTP_ALLOWED_HOSTS: RELAY.host,
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'synthetic', SMTP_PASS: randomBytes(24).toString('hex'), SMTP_FROM: 'synthetic@example.invalid',
  });
}

test('the personal relay name of the member wins over the account and workspace names', () =>
  reminderApi(f => {
    saveRelay(f, '  Waleed  ');
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.from_name', 'Curemed Workspace');
    assert.equal(resolveSenderName(f.db, asRequest('Synthetic')), 'Waleed', 'a padded relay name is trimmed and wins');
  }));

test('the account name is used when the member has no personal relay name', () =>
  reminderApi(f => {
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.from_name', 'Curemed Workspace');
    assert.equal(resolveSenderName(f.db, asRequest('  Synthetic  ')), 'Synthetic');
    saveRelay(f, null);
    assert.equal(resolveSenderName(f.db, asRequest('Synthetic')), 'Synthetic', 'a null relay name falls through');
    saveRelay(f, '   ');
    assert.equal(resolveSenderName(f.db, asRequest('Synthetic')), 'Synthetic', 'a blank relay name falls through');
  }));

test('the workspace from_name is the last resort and a blank one keeps the default', () =>
  reminderApi(f => {
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.from_name', ' Curemed Workspace ');
    assert.equal(resolveSenderName(f.db, asRequest('')), 'Curemed Workspace', 'a blank account name falls through');
    assert.equal(resolveSenderName(f.db, { tenant: { workspaceId: 'ws_legacy', accountId: 'admin' } }), 'Curemed Workspace', 'a missing account falls through too');
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.from_name', '   ');
    assert.equal(resolveSenderName(f.db, asRequest('')), DEFAULT_SENDER_NAME, 'a blank workspace name never ships');
  }));

test('the sender-name endpoint resolves per caller', () =>
  reminderApi(async f => {
    const before = await f.request('/api/email/sender-name');
    assert.equal(before.status, 200, JSON.stringify(before.json));
    assert.equal(before.json.data.senderName, 'Synthetic', 'the account name answers when nothing else is set');

    saveRelay(f, 'Waleed');
    const after = await f.request('/api/email/sender-name');
    assert.equal(after.json.data.senderName, 'Waleed', 'the relay name of the member answers once saved');

    const anonymous = await f.request('/api/email/sender-name', { role: null });
    assert.equal(anonymous.status, 401, 'the resolution needs a signed-in account');
  }));

test('the document email subject and footer carry the member name, in either language', t =>
  withMail(t, async (f, calls) => {
    plantLegacyFiles(f);
    await saveRelayOverApi(f, 'Waleed');

    for (const language of ['en', 'ar']) {
      setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.language', language);
      const sent = await f.request('/api/email/send-documents', {
        method: 'POST',
        body: { document_ids: [f.document.id], to: [TO] },
      });
      assert.equal(sent.status, 200, `${language} answered ${JSON.stringify(sent.json)}`);
      const message = calls[calls.length - 1];
      const expectedSubject = language === 'ar' ? 'مستندات من Waleed' : 'Documents from Waleed';
      assert.equal(message.subject, expectedSubject, 'the default subject names the member');
      const footer = language === 'ar' ? 'تم الإرسال من Waleed' : 'Sent from Waleed';
      assert.ok(message.text.includes(footer), 'the text footer names the member');
      assert.ok(message.html.includes(footer), 'the html footer names the member');
      const heading = language === 'ar' ? 'مستندات من نظام روماني فلو' : 'Documents from ROMANI Flow';
      assert.ok(message.html.includes(heading), 'the heading copy is untouched');
    }

    const logged = f.db.prepare("SELECT subject FROM email_log WHERE kind='documents' ORDER BY created_at DESC LIMIT 2").all();
    assert.deepEqual(logged.map(row => row.subject).sort(), ['Documents from Waleed', 'مستندات من Waleed'].sort(), 'the audit carries the sent subject');
  }));

test('an explicit subject is sent as typed; the test emails name the sender', t =>
  withMail(t, async (f, calls) => {
    plantLegacyFiles(f);
    await saveRelayOverApi(f, 'Waleed');
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.language', 'en');

    const explicit = await f.request('/api/email/send-documents', {
      method: 'POST',
      body: { document_ids: [f.document.id], to: [TO], subject: 'Contract for signing' },
    });
    assert.equal(explicit.status, 200, JSON.stringify(explicit.json));
    assert.equal(calls[calls.length - 1].subject, 'Contract for signing', 'a typed subject is never rewritten');

    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO]);
    const workspaceTest = await f.request('/api/email/test', { method: 'POST', body: {} });
    assert.equal(workspaceTest.status, 200, JSON.stringify(workspaceTest.json));
    assert.equal(calls[calls.length - 1].subject, 'SMTP test — Waleed', 'the workspace test names the sender');
    const workspaceLog = f.db.prepare("SELECT subject FROM email_log WHERE kind='test' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(workspaceLog.subject, 'SMTP test — Waleed', 'the workspace test audit matches the sent subject');

    const memberTest = await f.request('/api/me/smtp/test', { method: 'POST', body: {} });
    assert.equal(memberTest.status, 200, JSON.stringify(memberTest.json));
    assert.equal(calls[calls.length - 1].subject, 'SMTP test — Waleed', 'the member test names the sender');
    const memberLog = f.db.prepare("SELECT subject FROM email_log WHERE kind='member_smtp_test' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(memberLog.subject, 'SMTP test — Waleed', 'the member test audit matches the sent subject');
  }));
