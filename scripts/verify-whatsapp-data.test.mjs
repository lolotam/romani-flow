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

test('queue backpressure rolls back oversized enqueue instead of growing an unbounded pending queue',async()=>{
 const {reminderFixture}=await import('./fixtures/whatsapp.mjs');const {ReminderStore}=await import('../server/notifications/whatsapp/repository.ts');const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 const f=reminderFixture();try{f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();const base=selectReminders(f.db,'romani-fixture',f.clock.now)[0];const store=new ReminderStore(f.db,'romani-fixture',()=>f.clock.now);
  const candidates=Array.from({length:2001},(_,n)=>({...base,recipient:'+999'+String(n).padStart(8,'0')}));
  assert.throws(()=>store.enqueue(candidates),/queue is full/);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,0);
 }finally{f.close();}
});
