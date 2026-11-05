import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/db/migrator.ts';
import { normalizeWhatsAppPhone } from '../server/notifications/whatsapp/phone.ts';
import { getBoolean } from '../server/repositories/settings.ts';

test('international destinations normalize without guessing a country or accepting JIDs', () => {
 assert.equal(normalizeWhatsAppPhone('00999 0000-0001'), '+99900000001');
 for(const phone of ['00000001','+099900000001','123@g.us','+99900000001@s.whatsapp.net','+99900000001x','']) assert.equal(normalizeWhatsAppPhone(phone),null);
});

test('additive 007 upgrades existing employees with opt-in false and default global disabled', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'romani-wa-migration-'));
 const db=new DatabaseSync(':memory:');
 try {
  for(const f of fs.readdirSync('server/db/migrations').filter(f=>f.endsWith('.sql')&&f<'007')) fs.copyFileSync(path.join('server/db/migrations',f),path.join(dir,f));
  runMigrations(db,dir);
  db.prepare("INSERT INTO employees(id,name,created_at,updated_at) VALUES('existing','Synthetic','2026-01-01','2026-01-01')").run();
  const result=runMigrations(db,path.resolve('server/db/migrations'));
  assert.deepEqual(result.applied,['007_whatsapp_notifications.sql']);
  assert.equal(db.prepare('SELECT whatsapp_notifications_enabled enabled FROM employees WHERE id=?').get('existing').enabled,0);
  assert.equal(getBoolean(db,'whatsapp.enabled'),false);
  assert.throws(()=>db.prepare('UPDATE employees SET whatsapp_notifications_enabled=2').run(),/CHECK/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {db.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'romani-wa-migration-')));fs.rmSync(dir,{recursive:true,force:true});}
});

test('canonical recipient uniqueness and job identity are enforced in SQLite',async()=>{
 const {reminderFixture,MANAGER_PHONE}=await import('./fixtures/whatsapp.mjs');
 const {ReminderStore}=await import('../server/notifications/whatsapp/repository.ts');
 const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 const f=reminderFixture();try{
  const store=new ReminderStore(f.db,'romani-fixture',()=>f.clock.now);
  store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true});
  assert.throws(()=>store.saveRecipient({label:'Duplicate',phone:'00999 0000-0002',enabled:true}),/already exists/);
  assert.throws(()=>f.db.prepare("INSERT INTO whatsapp_recipients VALUES('bad','Bad','national',1,'x','x')").run(),/CHECK/);
  const rows=selectReminders(f.db,'romani-fixture',f.clock.now);assert.equal(store.enqueue(rows),2);assert.equal(store.enqueue(rows),0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_jobs').get().n,2);
 }finally{f.close();}
});

test('queue capacity commits what fits and selects deferred work after next-day capacity returns without duplicates',async t=>{
 const {reminderFixture}=await import('./fixtures/whatsapp.mjs');const {ReminderStore}=await import('../server/notifications/whatsapp/repository.ts');const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 const f=reminderFixture();try{f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();const base=selectReminders(f.db,'romani-fixture',f.clock.now)[0];const store=new ReminderStore(f.db,'romani-fixture',()=>f.clock.now);
  const candidates=Array.from({length:2001},(_,n)=>({...base,recipient:'+999'+String(n).padStart(8,'0')}));
  const warnings=[];t.mock.method(console,'warn',message=>warnings.push(message));
  assert.equal(store.enqueue(candidates),2000);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,2000);
  assert.equal(store.enqueue(candidates),0);assert.equal(warnings.length,2);assert.ok(warnings.every(message=>!message.includes('+999')));
  const claim=store.claim(store.due()[0].id);store.finish(claim.job,claim.attemptId,{kind:'provider_accepted',messageId:'synthetic-capacity'});
  f.clock.now=new Date('2026-01-03T08:00:00Z');assert.equal(store.enqueue(candidates),1);assert.equal(store.enqueue(candidates),0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='pending'").get().n,2000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,2001);assert.equal(warnings.length,2);
  assert.ok(f.db.prepare('SELECT id FROM whatsapp_jobs WHERE recipient=?').get(candidates.at(-1).recipient));
 }finally{f.close();}
});

test('seeded near-full queue keeps existing rows, commits only remaining capacity and logs the overflow count',async t=>{
 const {reminderFixture}=await import('./fixtures/whatsapp.mjs');const {ReminderStore}=await import('../server/notifications/whatsapp/repository.ts');const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 const f=reminderFixture();try{f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();const base=selectReminders(f.db,'romani-fixture',f.clock.now)[0];const store=new ReminderStore(f.db,'romani-fixture',()=>f.clock.now);
  const candidates=Array.from({length:2003},(_,n)=>({...base,recipient:'+999'+String(n).padStart(8,'0')}));
  assert.equal(store.enqueue(candidates.slice(0,1998)),1998);
  const seeded=f.db.prepare('SELECT id FROM whatsapp_jobs').all();assert.equal(seeded.length,1998);
  const warnings=[];t.mock.method(console,'warn',message=>warnings.push(message));
  assert.equal(store.enqueue(candidates),2);
  const rows=f.db.prepare('SELECT id,recipient FROM whatsapp_jobs').all(),ids=new Set(rows.map(row=>row.id));
  assert.equal(rows.length,2000);assert.ok(seeded.every(row=>ids.has(row.id)));
  for(const candidate of candidates.slice(1998,2000))assert.ok(rows.some(row=>row.recipient===candidate.recipient));
  for(const candidate of candidates.slice(2000))assert.equal(rows.some(row=>row.recipient===candidate.recipient),false);
  assert.equal(warnings.length,1);assert.match(warnings[0],/\b3 eligible jobs deferred\b/);
  assert.equal(warnings[0].includes('+999'),false);assert.equal(warnings[0].includes(base.owner_name),false);
  const claim=store.claim(store.due()[0].id);store.finish(claim.job,claim.attemptId,{kind:'permanent_failed',code:'provider_unauthorized'});
  assert.equal(store.enqueue(candidates),1);
  assert.throws(()=>store.retry(claim.job.id),error=>error.code==='whatsapp_queue_full'&&error.status===409);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state IN ('pending','retryable_failed','sending')").get().n,2000);
 }finally{f.close();}
});
