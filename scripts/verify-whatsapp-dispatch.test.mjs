import test from 'node:test';import assert from 'node:assert/strict';
import {reminderFixture,EMPLOYEE_PHONE,MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {setSetting} from '../server/repositories/settings.ts';
function service(f,options={}){
 const calls=[];const status={configured:true,state:'connected'};
 const transport={status:async()=>status,sendText:async(phone,text)=>{calls.push({phone,text});return options.send?options.send(phone,text):{kind:'provider_accepted',messageId:'synthetic-'+calls.length};}};
 const reminders=new WhatsAppReminders(f.db,'romani-fixture',transport,()=>f.clock.now);
 return {reminders,calls,status};
}
function optIn(f){f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1,residency_expiry_date=NULL').run();}

test('W5/W8 expired accepted reminder sends once across days, service restart and reconnect',async()=>{
 const f=reminderFixture();try{optIn(f);const a=service(f);
  assert.equal(await a.reminders.schedule(),1);assert.deepEqual(await Promise.all([a.reminders.drain(),a.reminders.drain()]),[1,1]);assert.equal(a.calls.length,1);
  f.clock.now=new Date('2026-01-03T08:00:00Z');assert.equal(await a.reminders.schedule(),0);assert.equal(await a.reminders.drain(),0);
  const b=service(f);b.reminders.store.recover();b.status.state='disconnected';f.clock.now=new Date('2026-01-04T08:00:00Z');await b.reminders.schedule();assert.equal(await b.reminders.drain(),0);
  b.status.state='connected';assert.equal(await b.reminders.drain(),0);assert.equal(a.calls.length+b.calls.length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_jobs').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM whatsapp_attempts').get().n,1);
 }finally{f.close();}
});

test('W6 unsent A-to-B-to-A and remove/re-add create one current identity; accepted stays suppressed',async()=>{
 const f=reminderFixture();try{optIn(f);const {reminders,calls}=service(f);await reminders.schedule();
  await reminders.mutate(()=>f.db.prepare("UPDATE documents SET expiry_date='2027-01-01'").run());
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM whatsapp_jobs WHERE state='cancelled'").get().n,1);
  await reminders.mutate(()=>f.db.prepare("UPDATE documents SET expiry_date='2026-01-01'").run());
  reminders.store.enqueue((await import('../server/notifications/whatsapp/selection.ts')).selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now));
  assert.equal(await reminders.drain(),1);assert.equal(calls.length,1);
  await reminders.mutate(()=>f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=0').run());
  await reminders.mutate(()=>f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run());
  f.clock.now=new Date('2026-01-03T08:00:00Z');await reminders.schedule();assert.equal(await reminders.drain(),0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM whatsapp_jobs WHERE state='provider_accepted'").get().n,1);
 }finally{f.close();}
});

test('W6 employee-to-management-to-employee preserves job, updates template, and records exact handed-off text',async()=>{
 const f=reminderFixture();try{optIn(f);const {reminders,calls}=service(f);await reminders.schedule();
  const job=f.db.prepare('SELECT id FROM whatsapp_jobs').get();
  const id=await reminders.mutate(()=>reminders.store.saveRecipient({label:'الإدارة',phone:EMPLOYEE_PHONE,enabled:true}));
  assert.equal(f.db.prepare('SELECT audience FROM whatsapp_jobs WHERE id=?').get(job.id).audience,'management');
  await reminders.mutate(()=>f.db.prepare('DELETE FROM whatsapp_recipients WHERE id=?').run(id));
  assert.equal(f.db.prepare('SELECT audience FROM whatsapp_jobs WHERE id=?').get(job.id).audience,'employee');
  await reminders.mutate(()=>f.db.prepare("UPDATE employees SET name='اسم جديد'").run());
  assert.equal(await reminders.drain(),1);const attempt=f.db.prepare('SELECT * FROM whatsapp_attempts').get();
  assert.equal(attempt.text,calls[0].text);assert.match(attempt.text,/اسم جديد/);assert.match(attempt.text,/أهلاً بيك/);assert.equal(attempt.job_id,job.id);
 }finally{f.close();}
});

test('restart of sending is unknown and never resent; known rejection retries only failed destination',async()=>{
 const f=reminderFixture();try{optIn(f);const a=service(f);await a.reminders.schedule();
  a.reminders.store.claim(a.reminders.store.due()[0].id);a.reminders.store.recover();assert.equal(await a.reminders.drain(),0);assert.equal(a.calls.length,0);
  await assert.rejects(a.reminders.retry(f.db.prepare('SELECT id FROM whatsapp_jobs').get().id),/cannot be retried/);
  const b=service(f,{send:(phone)=>phone===MANAGER_PHONE?{kind:'retryable_failed',code:'provider_connection_failed'}:{kind:'provider_accepted',messageId:'synthetic-success'}});
  await b.reminders.mutate(()=>b.reminders.store.saveRecipient({label:'الإدارة',phone:MANAGER_PHONE,enabled:true}));
  f.clock.now=new Date('2026-01-03T08:00:00Z');await b.reminders.schedule();await b.reminders.drain();assert.equal(b.calls.length,1);
  f.clock.now=new Date('2026-01-03T08:06:00Z');await b.reminders.drain();assert.equal(b.calls.length,2);assert.ok(b.calls.every(c=>c.phone===MANAGER_PHONE));
 }finally{f.close();}
});

test('mutation commits only after in-flight handoff; failed mutation rolls back cancellation',async()=>{
 const f=reminderFixture();try{optIn(f);let release,entered;const started=new Promise(r=>entered=r);const blocked=new Promise(r=>release=r);
  const a=service(f,{send:async()=>{entered();await blocked;return{kind:'provider_accepted',messageId:'synthetic-inflight'};}});await a.reminders.schedule();
  const drain=a.reminders.drain();await started;let committed=false;
  const mutation=a.reminders.mutate(()=>{f.db.prepare("UPDATE documents SET expiry_date='2027-01-01'").run();committed=true;});
  await new Promise(r=>setImmediate(r));assert.equal(committed,false);release();await drain;await mutation;assert.equal(committed,true);
  assert.equal(await a.reminders.drain(),0);assert.equal(a.calls.length,1);
  await assert.rejects(a.reminders.mutate(()=>{f.db.prepare("UPDATE documents SET expiry_date='2025-01-01'").run();throw Error('Synthetic rejected write');}),/rejected write/);
  assert.equal(f.db.prepare('SELECT expiry_date FROM documents').get().expiry_date,'2027-01-01');
 }finally{f.close();}
});

test('disabled WhatsApp performs no provider access or dispatch regardless of email settings',async()=>{
 const f=reminderFixture();try{optIn(f);const a=service(f);setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.enabled',false);await a.reminders.schedule();assert.equal(await a.reminders.drain(),1);
  await a.reminders.setEnabled(false);f.clock.now=new Date('2026-01-03T08:00:00Z');assert.equal(await a.reminders.schedule(),0);assert.equal(await a.reminders.drain(),0);assert.equal(a.calls.length,1);
 }finally{f.close();}
});

test('W8 actual SQLite close/reopen preserves accepted identity and interrupted uncertainty',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {DatabaseSync}=await import('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'romani-wa-restart-'));const file=path.join(dir,'isolated.db');
 const f=reminderFixture(file);let reopened,closed=false;
 try{optIn(f);const a=service(f);await a.reminders.schedule();await a.reminders.drain();
  await a.reminders.mutate(()=>a.reminders.store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true}));
  f.clock.now=new Date('2026-01-03T08:00:00Z');await a.reminders.schedule();a.reminders.store.claim(a.reminders.store.due()[0].id);
  f.close();closed=true;reopened=new DatabaseSync(file);
  const b=service({db:reopened,clock:f.clock});b.reminders.store.recover();f.clock.now=new Date('2026-01-04T08:00:00Z');await b.reminders.schedule();
  assert.equal(await b.reminders.drain(),0);assert.equal(b.calls.length,0);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM whatsapp_jobs WHERE state='provider_accepted'").get().n,1);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM whatsapp_jobs WHERE state='unknown'").get().n,1);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM whatsapp_attempts').get().n,2);
 }finally{if(reopened)reopened.close();if(!closed)f.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'romani-wa-restart-')));fs.rmSync(dir,{recursive:true,force:true});}
});

test('known pre-handler authorization rejection can be manually retried, never automatically',async()=>{
 const f=reminderFixture();try{optIn(f);let authorized=false;const a=service(f,{send:()=>authorized?{kind:'provider_accepted',messageId:'synthetic-after-fix'}:{kind:'permanent_failed',code:'provider_unauthorized'}});
  await a.reminders.schedule();await a.reminders.drain();assert.equal(a.calls.length,1);assert.equal(await a.reminders.drain(),0);
  const job=f.db.prepare('SELECT id FROM whatsapp_jobs').get();authorized=true;await a.reminders.retry(job.id);assert.equal(await a.reminders.drain(),1);assert.equal(a.calls.length,2);
  await assert.rejects(a.reminders.retry(job.id),/cannot be retried/);
 }finally{f.close();}
});

test('shutdown stops new handoffs after the current bounded request finishes',async()=>{
 const f=reminderFixture();try{optIn(f);let release,entered;const started=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
  const a=service(f,{send:async()=>{entered();await blocked;return{kind:'provider_accepted',messageId:'synthetic-shutdown'};}});
  a.reminders.store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true});await a.reminders.schedule();
  const drain=a.reminders.drain();await started;const stopping=a.reminders.stop();release();await drain;await stopping;
  assert.equal(a.calls.length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='pending'").get().n,1);
 }finally{f.close();}
});

test('known pre-HTTP failures stop after four attempts and cannot be manually restarted',async()=>{
 const f=reminderFixture();try{optIn(f);const a=service(f,{send:()=>({kind:'retryable_failed',code:'provider_connection_failed'})});await a.reminders.schedule();
  for(const date of ['2026-01-02T08:00:00Z','2026-01-02T08:05:00Z','2026-01-02T08:20:00Z','2026-01-02T09:20:00Z']){f.clock.now=new Date(date);assert.equal(await a.reminders.drain(),0);}
  const job=f.db.prepare('SELECT id,state,attempt_count FROM whatsapp_jobs').get();assert.equal(job.state,'permanent_failed');assert.equal(job.attempt_count,4);assert.equal(a.calls.length,4);
  f.clock.now=new Date('2026-01-03T08:00:00Z');await a.reminders.schedule();assert.equal(await a.reminders.drain(),0);assert.equal(a.calls.length,4);await assert.rejects(a.reminders.retry(job.id),/cannot be retried/);
 }finally{f.close();}
});
