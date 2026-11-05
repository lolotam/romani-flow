import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { setSetting, getString } from '../server/repositories/settings.ts';
import { sendExpiryReport } from '../server/services/expiryService.ts';
import { validEmailSettings, writeLoadedEmailSettings } from '../src/lib/emailSettingsWrite.ts';
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
      return { messageId: 'synthetic-' + calls.length, ...await outcome([...(message.to ?? []), ...(message.cc ?? [])], calls.length) };
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

test('malformed successful settings reads cannot unlock default writes', t => reminderApi(async f => {
  const response = await f.request('/api/settings');
  const settings = response.json.data.settings;
  assert.equal(validEmailSettings(settings), true);
  assert.equal(validEmailSettings({...settings, 'email.enabled':'false', 'cron.enabled':'true'}), true);
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async () => { writes++; throw new Error('Unexpected write'); });
  for (const malformed of [{}, [], null, { ...settings, 'email.cc': [7] },
    { ...settings, 'cron.enabled': 'yes' }, { ...settings, 'cron.days': null },
    { ...settings, 'email.language': 'xx' }, { ...settings, 'email.notification_intervals': [{}] }]) {
    assert.equal(validEmailSettings(malformed), false);
    const result = await writeLoadedEmailSettings({ 'email.language': 'en' }, validEmailSettings(malformed));
    assert.ok(result.error); assert.equal(writes, 0);
  }
}));

test('skipped email audits retain To and CC in disabled and no-interval runs', t => withMail(t, async (f, calls) => {
  setSetting(f.db, 'email.recipients', [TO[0]]); setSetting(f.db, 'email.cc', [CC]);
  for (const disabled of [true, false]) {
    setSetting(f.db, 'email.enabled', !disabled);
    if (!disabled) setSetting(f.db, 'email.notification_intervals', []);
    const result = await sendExpiryReport(f.db, f.mailer, 'cron');
    assert.deepEqual(result.recipients, [TO[0], CC]);
    const row = f.db.prepare('SELECT recipients FROM email_log ORDER BY rowid DESC LIMIT 1').get();
    assert.ok(row.recipients.includes(TO[0])); assert.ok(row.recipients.includes(CC));
  }
  assert.equal(calls.length, 0);
}));

test('a timed-out grouped handoff is unknown, stops subsequent groups and never repeats on late completion', async t => {
  let finish;
  await withMail(t, async (f, calls) => {
    const expiry = new Date().toISOString().slice(0, 10);
    f.db.prepare('UPDATE documents SET title=?,expiry_date=?').run('Synthetic A', expiry);
    f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
    setSetting(f.db, 'email.recipients', [TO[0]]); setSetting(f.db, 'email.cc', []);
    await sendExpiryReport(f.db, f.mailer, 'cron');
    insertRow(f.db, 'documents', { title: 'Synthetic B', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: expiry });
    setSetting(f.db, 'email.cc', [CC]);
    const result = await sendExpiryReport(f.db, f.mailer, 'cron', { budgetMs: 25, minimumSendMs: 1 });
    assert.equal(result.sent, false); assert.match(result.error, /unknown/); assert.equal(calls.length, 2);
    assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='unknown'").get().n, 1);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='unknown'").get().n, 1);
    assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).sent, true);
    assert.equal(calls.length, 3); assert.deepEqual(calls[2].to, []); assert.deepEqual(calls[2].cc, [CC]);
    assert.equal((await sendExpiryReport(f.db, f.mailer, 'cron')).skipped, 'nothing_due');
    assert.equal(calls.length, 3);
  }, (addresses, attempt) => attempt === 2 ? new Promise(resolve => { finish = () => resolve({ accepted: addresses, rejected: [] }); }) : { accepted: addresses, rejected: [] });
});

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

for (const code of ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EDNS','ESOCKET','ECONNECTION']) test('SMTP failure '+code+' preserves uncertainty classification', t => withMail(t, async f => {
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));
 setSetting(f.db,'email.recipients',[TO[0]]);
 await sendExpiryReport(f.db,f.mailer,'cron');
 assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='expiry_report' ORDER BY rowid DESC LIMIT 1").get().status,['ECONNREFUSED','EDNS'].includes(code)?'failed':'unknown');
},()=>{throw Object.assign(new Error('Synthetic failure'),{code});}));
test('insufficient SMTP admission budget leaves identities pending', t => withMail(t,async(f,calls)=>{
 setSetting(f.db,'email.recipients',[TO[0]]);
 const result=await sendExpiryReport(f.db,f.mailer,'cron',{budgetMs:5});
 assert.equal(result.sent,false);assert.equal(calls.length,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status IN ('sending','unknown')").get().n,0);
}));
test('explicit null CC never falls back to saved recipients', t=>withMail(t,async(f,calls)=>{
 setSetting(f.db,'email.cc',[CC]);
 await f.request('/api/email/test',{method:'POST',body:{to:[TO[0]],cc:null}});
 assert.equal(calls.some(mail=>mail.cc?.includes(CC)),false);
}));

test('blank CC and BCC entries cannot turn acceptance into partial', t=>withMail(t,async f=>{const result=await f.mailer.send({to:[TO[0]],cc:[' '],bcc:[''],subject:'Synthetic',text:'Synthetic'});assert.equal(result.status,'sent');assert.deepEqual(result.rejected,[]);}));
