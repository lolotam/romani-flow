import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {reminderFixture,MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {setSetting} from '../server/repositories/settings.ts';
import {selectReminders} from '../server/notifications/whatsapp/selection.ts';
import {createReminderRuntime} from '../server/whatsapp/runtime.ts';

test('invalid-runtime startup writes nothing and valid recovery is confined to its own jobs and attempts',async()=>{
 const f=reminderFixture();let providerCalls=0;
 const transport={status:async()=>{providerCalls++;return{configured:false,state:'unconfigured'};},sendText:async()=>{throw Error('No handoff allowed');}};
 try{
  const own=new WhatsAppReminders(f.db,'romani',transport,()=>f.clock.now);
  own.store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true});await own.schedule();
  const other=new WhatsAppReminders(f.db,'other-isolated-fixture',transport,()=>f.clock.now);
  other.store.enqueue(selectReminders(f.db,other.instance,f.clock.now));
  const ownClaim=own.store.claim(own.store.due()[0].id),otherClaim=other.store.claim(other.store.due()[0].id);
  const rows=()=>({jobs:f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all(),attempts:f.db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id').all()});
  const before=rows(),changes=f.db.prepare('SELECT total_changes() n').get().n;
  const invalid=createReminderRuntime(f.db,{url:'',apiKey:'',instance:'',webhookSecret:''});invalid.start();await invalid.stop();invalid.store.recover();
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);assert.deepEqual(rows(),before);
  own.start();await own.stop();
  assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(ownClaim.job.id).state,'unknown');
  assert.equal(f.db.prepare('SELECT state FROM whatsapp_attempts WHERE id=?').get(ownClaim.attemptId).state,'unknown');
  assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(otherClaim.job.id).state,'sending');
  assert.equal(f.db.prepare('SELECT state FROM whatsapp_attempts WHERE id=?').get(otherClaim.attemptId).state,'sending');
  assert.equal(providerCalls,0);
 }finally{f.close();}
});

test('W8 full SQLite/attachment recovery retains outbox/attempt snapshots and restarts disabled without provider access',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'romani-wa-recovery-'));const data=path.join(root,'source');fs.mkdirSync(data);
 const f=reminderFixture(path.join(data,'romani.db'));let restored;
 try{
  const pdf=Buffer.from('%PDF-1.4\nSynthetic WhatsApp recovery fixture\n%%EOF');fs.mkdirSync(path.join(data,'uploads'));fs.writeFileSync(path.join(data,'uploads','proof.pdf'),pdf);
  f.db.prepare("UPDATE documents SET file_path='proof.pdf',file_name='proof.pdf',mime_type='application/pdf'").run();f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1,residency_expiry_date=NULL').run();
  let calls=0;const transport={status:async()=>{calls++;return{configured:false,state:'unconfigured'};},sendText:async()=>{throw Error('No restored provider handoff allowed');}};
  const original=new WhatsAppReminders(f.db,'romani-fixture',transport,()=>f.clock.now);
  original.store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true});await original.schedule();
  const jobs=original.store.due();const first=original.store.claim(jobs[0].id);original.store.finish(first.job,first.attemptId,{kind:'provider_accepted',messageId:'synthetic-recorded-acceptance'});original.store.claim(jobs[1].id);
  const backup=path.join(root,'backup'),target=path.join(root,'isolated');
  const python=process.platform==='win32'?'python':'python3';const run=args=>JSON.parse(execFileSync(python,[path.resolve('scripts/recovery.py'),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(run(['backup','--data-dir',data,'--output',backup]).verified,true);assert.equal(run(['restore','--backup',backup,'--target',target]).restored,true);
  assert.throws(()=>run(['restore','--backup',backup,'--target',data]));
  restored=new DatabaseSync(path.join(target,'romani.db'));restored.exec('PRAGMA foreign_keys=ON');assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(fs.readFileSync(path.join(target,'uploads','proof.pdf')),pdf);assert.equal(restored.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,2);assert.equal(restored.prepare('SELECT count(*) n FROM whatsapp_attempts').get().n,2);assert.equal(restored.prepare('SELECT count(*) n FROM whatsapp_recipients').get().n,1);
  // Explicitly disable only the verified isolated tree, never the source/production DB.
  assert.ok(target.startsWith(root+path.sep));setSetting(restored,'whatsapp.enabled',false);
  const recovered=new WhatsAppReminders(restored,'romani-fixture',transport,()=>f.clock.now);recovered.start();assert.equal(await recovered.drain(),0);await recovered.stop();
  assert.equal(calls,0);assert.equal(restored.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='unknown'").get().n,1);assert.equal(restored.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='provider_accepted'").get().n,1);
  assert.equal(restored.prepare('SELECT text FROM whatsapp_attempts WHERE id=?').get(first.attemptId).text,first.job.text);
  assert.equal(f.db.prepare("SELECT state FROM whatsapp_jobs WHERE id=?").get(jobs[1].id).state,'sending');
 }finally{restored?.close();f.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'romani-wa-recovery-')));fs.rmSync(root,{recursive:true,force:true});}
});
