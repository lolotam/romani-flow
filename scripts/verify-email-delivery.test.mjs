import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { setSetting, getString } from '../server/repositories/settings.ts';
import { sendExpiryReport } from '../server/services/expiryService.ts';
import { writeLoadedEmailSettings } from '../src/lib/emailSettingsWrite.ts';
import { insertRow } from '../server/repositories/base.ts';

const TO = ['first@example.invalid', 'second@example.invalid'], CC = 'copy@example.invalid';
test('an explicit empty To override never restores saved recipients', t => withMail(t, async (f, calls) => {
  setSetting(f.db, 'email.recipients', TO); setSetting(f.db, 'email.cc', [CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: [], cc: [CC] } })).status, 200);
  assert.deepEqual(calls[0].to, []); assert.deepEqual(calls[0].cc, [CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: [], cc: [] } })).status, 400);
  assert.equal(calls.length, 1);
}));

test('different per-recipient item histories do not receive a cross-product of old notifications', t => withMail(t, async (f, calls) => {
  const expiry = new Date().toISOString().slice(0, 10);
  f.db.prepare('UPDATE documents SET title=?,expiry_date=?').run('Synthetic A', expiry);
  f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
  setSetting(f.db, 'email.recipients', [TO[0]]); setSetting(f.db, 'email.cc', []);
  assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).sent, true);
  insertRow(f.db, 'documents', { title: 'Synthetic B', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: expiry });
  setSetting(f.db, 'email.cc', [CC]);
  assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).sent, true);
  assert.equal(calls.length, 3);
  const primary = calls.slice(1).find(message => message.to.includes(TO[0]));
  const copy = calls.slice(1).find(message => message.cc?.includes(CC));
  assert.ok(primary.text.includes('Synthetic B')); assert.equal(primary.text.includes('Synthetic A'), false);
  assert.ok(copy.text.includes('Synthetic A')); assert.ok(copy.text.includes('Synthetic B'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM expiry_notifications').get().n, 4);
  assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).skipped, 'nothing_due'); assert.equal(calls.length, 3);
}));
test('the installed Nodemailer transport builds a CC-only envelope without opening SMTP', async () => {
  const mail = nodemailer.createTransport({ jsonTransport: true });
  const result = await mail.sendMail({ from: 'sender@example.invalid', to: [], cc: [CC], subject: 'Synthetic', text: 'Synthetic' });
  assert.deepEqual(result.envelope.to, [CC]);
});

function withMail(t, run, outcome = addresses => ({ accepted: addresses, rejected: [] })) {
  const calls = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async message => {
      calls.push(message);
      return { messageId: 'synthetic-' + calls.length, ...outcome([...(message.to ?? []), ...(message.cc ?? [])], calls.length) };
    },
  }));
  return reminderApi(f => run(f, calls), undefined, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'synthetic', SMTP_PASS: randomBytes(24).toString('hex'), SMTP_FROM: 'synthetic@example.invalid',
  });
}

test('test email includes configured CC, supports explicit CC and records relay acceptance without viewer side effects', t => withMail(t, async (f, calls) => {
  setSetting(f.db, 'email.recipients', [TO[0]]); setSetting(f.db, 'email.cc', [CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: {}, role: 'viewer' })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: [TO[0]] } })).status, 200);
  assert.deepEqual(calls[0].to, [TO[0]]); assert.deepEqual(calls[0].cc, [CC]);
  const log = f.db.prepare("SELECT recipients,details FROM email_log WHERE kind='test'").get();
  assert.ok(log.recipients.includes(CC)); assert.deepEqual(JSON.parse(log.details).accepted, [TO[0], CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: TO, cc: [] } })).status, 200);
  assert.deepEqual(calls[1].to, TO); assert.deepEqual(calls[1].cc, []);
}));

for (const pending of [TO[1], CC]) test(`cron retries only the relay-rejected recipient ${pending === CC ? 'CC' : 'To'} without repeating accepted recipients`, t => withMail(t, async (f, calls) => {
  f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0, 10));
  f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
  setSetting(f.db, 'email.recipients', TO); setSetting(f.db, 'email.cc', [CC]);
  const first = await sendExpiryReport(f.db, f.mailer, 'cron');
  assert.equal(first.sent, false); assert.deepEqual(calls[0].to, TO); assert.deepEqual(calls[0].cc, [CC]);
  const second = await sendExpiryReport(f.db, f.mailer, 'cron');
  assert.equal(second.sent, true);
  assert.deepEqual(calls[1].to, pending === CC ? [] : [pending]);
  assert.deepEqual(calls[1].cc, pending === CC ? [CC] : undefined);
  assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).skipped, 'nothing_due');
  assert.equal(calls.length, 2);
  assert.deepEqual(f.db.prepare('SELECT recipient,count(*) n FROM expiry_notifications GROUP BY recipient ORDER BY recipient').all().map(row => ({ ...row })), [CC, ...TO].sort().map(recipient => ({ recipient, n: 1 })));
  const logs = f.db.prepare("SELECT details FROM email_log WHERE kind='expiry_report' AND status!='skipped' ORDER BY rowid").all();
  assert.deepEqual(JSON.parse(logs[1].details).accepted, [pending]);
}, (addresses, attempt) => ({ accepted: attempt === 1 ? addresses.filter(address => address !== pending) : addresses, rejected: attempt === 1 ? [pending] : [] })));

test('a failed settings load cannot send default configuration writes; successful reload permits an explicit save', t => reminderApi(async f => {
  setSetting(f.db, 'email.language', 'en');
  const nativeFetch = globalThis.fetch; let writes = 0;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      if (options?.method === 'PUT') writes++;
      return nativeFetch(f.base + url, { ...options, headers: { ...options?.headers, cookie: f.config.cookieName + '=' + token } });
    }
    return nativeFetch(url, options);
  });
  const { signSession } = await import('../server/middleware/auth.ts');
  const token = signSession(f.config, { id: 'admin', role: 'admin', name: 'Synthetic', email: 'admin@example.invalid' });
  const blocked = await writeLoadedEmailSettings({ 'email.language': 'ar' }, false);
  assert.ok(blocked.error); assert.equal(writes, 0); assert.equal(getString(f.db, 'email.language'), 'en');
  const saved = await writeLoadedEmailSettings({ 'email.language': 'ar' }, true);
  assert.equal(saved.error, null); assert.equal(writes, 1); assert.equal(getString(f.db, 'email.language'), 'ar');
}));
