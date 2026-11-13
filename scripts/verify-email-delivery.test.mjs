import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { setSetting, getString } from '../server/repositories/settings.ts';
import { startEmailAttempt } from '../server/services/emailLog.ts';
import { sendExpiryReport } from '../server/services/expiryService.ts';
import { validEmailSettings, writeLoadedEmailSettings } from '../src/lib/emailSettingsWrite.ts';
import { insertRow } from '../server/repositories/base.ts';

const TO = ['first@example.invalid', 'second@example.invalid'], CC = 'copy@example.invalid';
test('an explicit empty To override never restores saved recipients', t => withMail(t, async (f, calls) => {
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', TO); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: [], cc: [CC] } })).status, 200);
  assert.deepEqual(calls[0].to, []); assert.deepEqual(calls[0].cc, [CC]);
  assert.equal((await f.request('/api/email/test', { method: 'POST', body: { to: [], cc: [] } })).status, 400);
  assert.equal(calls.length, 1);
}));

test('different per-recipient item histories do not receive a cross-product of old notifications', t => withMail(t, async (f, calls) => {
  const expiry = new Date().toISOString().slice(0, 10);
  f.db.prepare('UPDATE documents SET title=?,expiry_date=?').run('Synthetic A', expiry);
  f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO[0]]); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', []);
  assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).sent, true);
  insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Synthetic B', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: expiry });
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
  assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).sent, true);
  assert.equal(calls.length, 3);
  const primary = calls.slice(1).find(message => message.to.includes(TO[0]));
  const copy = calls.slice(1).find(message => message.cc?.includes(CC));
  assert.ok(primary.text.includes('Synthetic B')); assert.equal(primary.text.includes('Synthetic A'), false);
  assert.ok(copy.text.includes('Synthetic A')); assert.ok(copy.text.includes('Synthetic B'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM expiry_notifications').get().n, 4);
  assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).skipped, 'nothing_due'); assert.equal(calls.length, 3);
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
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO[0]]); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
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
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO[0]]); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
  for (const disabled of [true, false]) {
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.enabled', !disabled);
    if (!disabled) setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.notification_intervals', []);
    const result = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron');
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
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO[0]]); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', []);
    await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron');
    insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Synthetic B', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: expiry });
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
    const result = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron', { budgetMs: 25, minimumSendMs: 1 });
    assert.equal(result.sent, false); assert.match(result.error, /unknown/); assert.equal(calls.length, 2);
    assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='unknown'").get().n, 1);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='unknown'").get().n, 1);
    assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).sent, true);
    assert.equal(calls.length, 3); assert.deepEqual(calls[2].to, []); assert.deepEqual(calls[2].cc, [CC]);
    assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).skipped, 'nothing_due');
    assert.equal(calls.length, 3);
  }, (addresses, attempt) => attempt === 2 ? new Promise(resolve => { finish = () => resolve({ accepted: addresses, rejected: [] }); }) : { accepted: addresses, rejected: [] });
});

for (const pending of [TO[1], CC]) test(`cron retries only the relay-rejected recipient ${pending === CC ? 'CC' : 'To'} without repeating accepted recipients`, t => withMail(t, async (f, calls) => {
  f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0, 10));
  f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', TO); setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
  const first = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron');
  assert.equal(first.sent, false); assert.deepEqual(calls[0].to, TO); assert.deepEqual(calls[0].cc, [CC]);
  const second = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron');
  assert.equal(second.sent, true);
  assert.deepEqual(calls[1].to, pending === CC ? [] : [pending]);
  assert.deepEqual(calls[1].cc, pending === CC ? [CC] : undefined);
  assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).skipped, 'nothing_due');
  assert.equal(calls.length, 2);
  assert.deepEqual(f.db.prepare('SELECT recipient,count(*) n FROM expiry_notifications GROUP BY recipient ORDER BY recipient').all().map(row => ({ ...row })), [CC, ...TO].sort().map(recipient => ({ recipient, n: 1 })));
  const logs = f.db.prepare("SELECT details FROM email_log WHERE kind='expiry_report' AND status!='skipped' ORDER BY rowid").all();
  assert.deepEqual(JSON.parse(logs[1].details).accepted, [pending]);
}, (addresses, attempt) => ({ accepted: attempt === 1 ? addresses.filter(address => address !== pending) : addresses, rejected: attempt === 1 ? [pending] : [] })));

test('a failed settings load cannot send default configuration writes; successful reload permits an explicit save', t => reminderApi(async f => {
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.language', 'en');
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
  assert.ok(blocked.error); assert.equal(writes, 0); assert.equal(getString(f.db, { workspaceId: 'ws_legacy' }, 'email.language'), 'en');
  const saved = await writeLoadedEmailSettings({ 'email.language': 'ar' }, true);
  assert.equal(saved.error, null); assert.equal(writes, 1); assert.equal(getString(f.db, { workspaceId: 'ws_legacy' }, 'email.language'), 'ar');
}));

for (const code of ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EDNS','ESOCKET','ECONNECTION']) test('SMTP failure '+code+' preserves uncertainty classification', t => withMail(t, async f => {
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');
 assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='expiry_report' ORDER BY rowid DESC LIMIT 1").get().status,['ECONNREFUSED','EDNS'].includes(code)?'failed':'unknown');
},()=>{throw Object.assign(new Error('Synthetic failure'),{code});}));
test('insufficient SMTP admission budget leaves identities pending', t => withMail(t,async(f,calls)=>{
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);
 const result=await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron',{budgetMs:5});
 assert.equal(result.sent,false);assert.equal(calls.length,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status IN ('sending','unknown')").get().n,0);
}));
test('explicit null CC never falls back to saved recipients', t=>withMail(t,async(f,calls)=>{
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc',[CC]);
 await f.request('/api/email/test',{method:'POST',body:{to:[TO[0]],cc:null}});
 assert.equal(calls.some(mail=>mail.cc?.includes(CC)),false);
}));

test('blank CC and BCC entries cannot turn acceptance into partial', t=>withMail(t,async f=>{const result=await f.mailer.send({to:[TO[0]],cc:[' '],bcc:[''],subject:'Synthetic',text:'Synthetic'});assert.equal(result.status,'sent');assert.deepEqual(result.rejected,[]);}));

test('case variants share retained notification history and accepted audit identities',t=>withMail(t,async(f,calls)=>{
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0].toUpperCase()]);setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc',[' '+TO[0]+' ']);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,1);assert.deepEqual(calls[0].to,[TO[0].toUpperCase()]);assert.equal(calls[0].cc,undefined);
 const details=JSON.parse(f.db.prepare("SELECT details FROM email_log WHERE status='sent'").get().details);assert.deepEqual(details.recipients,[TO[0].toUpperCase()]);assert.equal(details.identities.length,1);
 f.db.prepare('UPDATE expiry_notifications SET recipient=upper(recipient)').run();
 assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron')).skipped,'nothing_due');assert.equal(calls.length,1);
}));
test('deferred groups remain visible in result and audit without an SMTP attempt',t=>withMail(t,async(f,calls)=>{
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));
 const result=await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron',{budgetMs:1});assert.equal(result.sent,false);assert.deepEqual(result.recipients,[TO[0]]);assert.ok(result.itemCount>0);assert.equal(calls.length,0);
 const row=f.db.prepare("SELECT recipients,details FROM email_log WHERE status='deferred'").get();assert.ok(row.recipients.includes(TO[0]));assert.ok(JSON.parse(row.details).documents>0);
}));

test('test email keeps first spelling while response audit and envelope share deduplicated recipients',t=>withMail(t,async(f,calls)=>{
 const original='User@Example.invalid';const response=await f.request('/api/email/test',{method:'POST',body:{to:[original],cc:['user@example.invalid']}});
 assert.equal(response.status,200);assert.deepEqual(response.json.data.recipients,[original]);assert.deepEqual(calls[0].to,[original]);assert.deepEqual(calls[0].cc,[]);
 const row=f.db.prepare("SELECT recipients FROM email_log WHERE kind='test'").get();assert.equal(row.recipients,original);
}));
test('Unicode retained history uses the same mailbox comparison as current recipients',t=>withMail(t,async(f,calls)=>{
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 const address='\u00c9xample@example.invalid';setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[address]);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.deepEqual(calls[0].to,[address]);
 f.db.prepare('UPDATE expiry_notifications SET recipient=?').run('\u2003'+address+'\u2003');
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[address.toLowerCase()]);
 assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron')).skipped,'nothing_due');assert.equal(calls.length,1);
}));

for (const code of ['EAUTH','EENVELOPE']) test('definitive SMTP rejection '+code+' stays pending after configuration is corrected',t=>withMail(t,async(f,calls)=>{
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);
 const first=await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(first.sent,false);
 assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='expiry_report' ORDER BY rowid DESC LIMIT 1").get().status,'failed');
 assert.equal(f.db.prepare('SELECT count(*) n FROM expiry_notifications').get().n,0);
 const corrected=await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(corrected.sent,true);assert.equal(calls.length,2);
 assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron')).skipped,'nothing_due');assert.equal(calls.length,2);
},(addresses,attempt)=>{if(attempt===1)throw Object.assign(new Error('Synthetic pre-content rejection'),{code});return {accepted:addresses,rejected:[]};}));

test('legacy interrupted reports block recorded recipients until operator resolution',t=>withMail(t,async(f,calls)=>{
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc',[CC]);
 const id=startEmailAttempt(f.db, { workspaceId: 'ws_legacy' },{kind:'expiry_report',recipients:[TO[0]],subject:'Legacy',triggerSource:'cron',details:{documents:1}});
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,1);assert.deepEqual(calls[0].to,[]);assert.deepEqual(calls[0].cc,[CC]);
 assert.equal(f.db.prepare('SELECT status FROM email_log WHERE id=?').get(id).status,'unknown');
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,1);
 f.db.prepare("UPDATE email_log SET status='failed' WHERE id=?").run(id);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,2);assert.deepEqual(calls[1].to,[TO[0]]);
}));
test('canonical Unicode equivalents share history without folding distinct local spellings',t=>withMail(t,async(f,calls)=>{
 f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0,10));f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 const decomposed='E\u0301xample@example.invalid';setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[decomposed]);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.deepEqual(calls[0].to,[decomposed]);
 f.db.prepare('UPDATE expiry_notifications SET recipient=?').run(decomposed);
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',['\u00c9xample@example.invalid']);
 assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron')).skipped,'nothing_due');assert.equal(calls.length,1);
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',['stra\u00dfe@example.invalid','strasse@example.invalid']);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls[1].to.length,2);
}));

for(const mode of ['structured','empty','non-string','invalid-identity']) test('interrupted report '+mode+' is recovered without duplicate delivery',t=>withMail(t,async(f,calls)=>{
 const expiry=new Date().toISOString().slice(0,10);f.db.prepare('UPDATE documents SET expiry_date=?').run(expiry);f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 const document=f.db.prepare('SELECT id FROM documents LIMIT 1').get();
 const details=mode==='structured'?{recipients:[TO[0]],identities:[JSON.stringify(['document',document.id,expiry,1])],employees:0,documents:1}:mode==='empty'?{recipients:[],identities:[]}:mode==='non-string'?{recipients:[7],identities:[null]}:{recipients:[TO[0]],identities:['not-a-tuple']};
 const id=startEmailAttempt(f.db, { workspaceId: 'ws_legacy' },{kind:'expiry_report',recipients:[TO[0]],subject:'Interrupted',triggerSource:'cron',details});setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);
 const result=await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(result.sent,false);assert.equal(calls.length,0);assert.equal(f.db.prepare('SELECT status FROM email_log WHERE id=?').get(id).status,'unknown');
 assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron')).sent,false);assert.equal(calls.length,0);
}));

for(const variant of ['invalid-date','partial-identities','partial-recipients','comma-mailbox']) test('damaged audit '+variant+' falls back conservatively',t=>withMail(t,async(f,calls)=>{
 const expiry=new Date().toISOString().slice(0,10);f.db.prepare('UPDATE documents SET expiry_date=?').run(expiry);f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 const doc=f.db.prepare('SELECT id FROM documents LIMIT 1').get();const recipients=variant==='comma-mailbox'?['"first,last"@example.invalid']:[TO[0]];
 const details=variant==='comma-mailbox'?{}:{recipients:variant==='partial-recipients'?[CC]:recipients,identities:[JSON.stringify(['document',doc.id,variant==='invalid-date'?'2026-02-30':expiry,1])],employees:0,documents:variant==='partial-identities'?2:1};
 startEmailAttempt(f.db, { workspaceId: 'ws_legacy' },{kind:'expiry_report',recipients,subject:'Damaged legacy audit',triggerSource:'cron',details});setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',recipients);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,0);
}));
test('formatted structured identities suppress only the matching item',t=>withMail(t,async(f,calls)=>{
 const expiry=new Date().toISOString().slice(0,10);f.db.prepare('UPDATE documents SET title=?,expiry_date=?').run('Already attempted',expiry);f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
 const doc=f.db.prepare('SELECT id FROM documents LIMIT 1').get();
 startEmailAttempt(f.db, { workspaceId: 'ws_legacy' },{kind:'expiry_report',recipients:[TO[0]],subject:'Uncertain structured audit',triggerSource:'cron',details:{recipients:[TO[0]],identities:[JSON.stringify(['document',doc.id,expiry,1],null,2)],employees:0,documents:1}});
 insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents',{title:'New eligible document',employee_id:f.employee.id,document_type_id:f.type.id,expiry_date:expiry});setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',[TO[0]]);
 await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' },f.mailer,'cron');assert.equal(calls.length,1);assert.ok(calls[0].text.includes('New eligible document'));assert.equal(calls[0].text.includes('Already attempted'),false);
}));

test('suspension before the next expiry handoff stops the remaining groups', t => {
  const calls = [];
  let database = null;
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async message => {
      calls.push(message);
      if (calls.length === 2 && database) {
        database.prepare("UPDATE workspaces SET suspended_at=? WHERE id='ws_legacy'").run(new Date().toISOString());
      }
      return { messageId: 'synthetic-' + calls.length, accepted: [...(message.to ?? []), ...(message.cc ?? [])], rejected: [] };
    },
  }));
  return reminderApi(async f => {
    database = f.db;
    const expiry = new Date().toISOString().slice(0, 10);
    f.db.prepare('UPDATE documents SET title=?,expiry_date=?').run('Synthetic A', expiry);
    f.db.prepare('UPDATE employees SET residency_expiry_date=NULL').run();
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients', [TO[0]]);
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', []);
    assert.equal((await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron')).sent, true);
    insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Synthetic B', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: expiry });
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.cc', [CC]);
    const result = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, f.mailer, 'cron');
    assert.equal(result.sent, false, JSON.stringify(result));
    assert.equal(calls.length, 2, 'the group that has not been handed to SMTP is stopped');
    assert.deepEqual(calls[1].to, [TO[0]]);
    assert.equal(calls[1].cc, undefined);
    assert.equal(f.db.prepare('SELECT count(*) n FROM expiry_notifications WHERE recipient=?').get(CC).n, 0);
  }, undefined, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'synthetic', SMTP_PASS: randomBytes(24).toString('hex'), SMTP_FROM: 'synthetic@example.invalid',
  });
});
