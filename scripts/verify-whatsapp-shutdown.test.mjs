import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {drainApplication,SHUTDOWN_DEADLINE_MS} from '../server/shutdown.ts';
import {reminderFixture,MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {reminderApi} from './fixtures/whatsapp-api.mjs';
import {CronService} from '../server/services/cronService.ts';
import {setSetting,getString} from '../server/repositories/settings.ts';
import {stopRequestWork} from '../server/middleware/requestWork.ts';
import {signSession} from '../server/middleware/auth.ts';

test('closed async API admission rejects new document sends without an attempt or SMTP call',()=>reminderApi(async f=>{
 let smtpCalls=0;f.mailer.send=async()=>{smtpCalls++;throw Error('SMTP must not be reached');};
 await stopRequestWork(f.app);
 const response=await f.request('/api/email/send-documents',{method:'POST',body:{document_ids:[f.document.id],to:['synthetic@example.invalid']}});
 assert.equal(response.status,503);assert.equal(response.json.error.code,'shutting_down');
 assert.equal(smtpCalls,0);assert.equal(f.db.prepare('SELECT count(*) n FROM email_log').get().n,0);
}));

for(const [outcome,drainFails] of [['sent',false],['failed',false],['sent',true]])test(`detached SMTP persists ${outcome} before shutdown completes (drain failure: ${drainFails})`,()=>reminderApi(async f=>{
 const file=await f.storage.save(Buffer.from('%PDF-1.4\nSynthetic shutdown fixture\n%%EOF'),'synthetic.pdf','application/pdf');
 f.db.prepare('UPDATE documents SET file_path=?,file_name=?,mime_type=? WHERE id=?').run(file.relativePath,file.fileName,file.mimeType,f.document.id);
 let release,entered;
 const blocked=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 // SMTP is the external boundary; the authenticated route, log and SQLite are real.
 f.mailer.send=async()=>{entered();await blocked;if(outcome==='failed')throw Error('Synthetic SMTP failure');return{status:'sent',accepted:['synthetic@example.invalid'],rejected:[],messageId:'synthetic-detached'};};
 const controller=new AbortController();
 const cookie=f.config.cookieName+'='+signSession(f.config,{id:'admin',role:'admin',name:'Synthetic',email:'admin@example.invalid'});
 const request=fetch(f.base+'/api/email/send-documents',{method:'POST',signal:controller.signal,
  headers:{cookie,'content-type':'application/json'},body:JSON.stringify({document_ids:[f.document.id],to:['synthetic@example.invalid']})}).catch(error=>assert.equal(error.name,'AbortError'));
 try{
  await started;controller.abort();await request;
  const socketsClosed=new Promise(resolve=>f.server.once('close',resolve));
  let dbClosed=false;const exits=[];
  const shutdown=drainApplication({server:f.server,stopReminders:async()=>{await f.reminders.stop();if(drainFails)throw Error('Synthetic failed drain');},stopCron:()=>f.cron.shutdown(),
   stopHandlers:()=>stopRequestWork(f.app),closeDatabase:()=>{
    assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='documents'").get().status,outcome);dbClosed=true;
   },exit:code=>exits.push(code)});
  await socketsClosed;
  assert.equal(dbClosed,false);assert.deepEqual(exits,[]);
  assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='documents'").get().status,'sending');
  release();await shutdown;
  assert.equal(f.db.prepare("SELECT status FROM email_log WHERE kind='documents'").get().status,outcome);
  assert.equal(dbClosed,!drainFails);assert.deepEqual(exits,[drainFails?1:0]);
 }finally{release();controller.abort();await request;}
}));

test('shutdown waits for active scheduled SMTP beyond the old deadline and rejects new cron/manual work',t=>reminderApi(async f=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
 setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.enabled',true);setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.recipients',['synthetic@example.invalid']);
 const cron=new CronService(f.db,{send:async()=>{entered();await blocked;return{status:'sent',accepted:['synthetic@example.invalid'],rejected:[],messageId:'synthetic-shutdown-email'};}});
 cron.setReminderEnqueue({ workspaceId: 'ws_legacy' },()=>f.reminders.schedule());
 const server=http.createServer((_req,res)=>res.end('synthetic'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const run=cron.run('cron');let dbClosed=false;const exits=[];
 try{
  await started;
  t.mock.timers.enable({apis:['setTimeout']});
  const shutdown=drainApplication({server,stopHandlers:async()=>{},stopCron:()=>cron.shutdown(),stopReminders:()=>f.reminders.stop(),closeDatabase:()=>{
   assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='sent'").get().n,1);
   assert.ok(getString(f.db, { workspaceId: 'ws_legacy' }, 'cron.last_run_date'));dbClosed=true;
  },exit:code=>exits.push(code)});
  for(const source of ['cron','manual'])assert.equal((await cron.run(source,{workspaceId:'ws_legacy'})).skipped,'shutting_down');
  cron.reschedule();assert.equal(cron.status({ workspaceId: 'ws_legacy' }).nextRun,null);
  t.mock.timers.tick(20_001);
  assert.equal(dbClosed,false);assert.deepEqual(exits,[]);assert.equal(cron.status({ workspaceId: 'ws_legacy' }).running,true);
  // SMTP phase/idle timeouts are not a whole-operation bound; the application has its own ceiling.
  assert.ok(SHUTDOWN_DEADLINE_MS>60_000);
  release();assert.equal((await run).sent,true);await shutdown;
  assert.equal(dbClosed,true);assert.deepEqual(exits,[0]);assert.equal(cron.status({ workspaceId: 'ws_legacy' }).running,false);
 }finally{t.mock.timers.reset();release();await run;await cron.shutdown();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

for(const first of ['send','http'])test(`shutdown stops claims and retains DB with ${first} finishing before the other drain`,async()=>{
 const f=reminderFixture();let releaseSend,sendEntered,releaseHttp,httpEntered;
 const sending=new Promise(resolve=>sendEntered=resolve),sendBlocked=new Promise(resolve=>releaseSend=resolve);
 const httpStarted=new Promise(resolve=>httpEntered=resolve),httpBlocked=new Promise(resolve=>releaseHttp=resolve);
 const calls=[],exits=[];let dbClosed=false;
 const reminders=new WhatsAppReminders(f.db,'romani',{
  status:async()=>({configured:true,state:'connected'}),
  sendText:async phone=>{calls.push(phone);sendEntered();await sendBlocked;return{kind:'provider_accepted',messageId:'synthetic-shutdown'};}
 },()=>f.clock.now);
 const server=http.createServer(async(_req,res)=>{httpEntered();await httpBlocked;res.end('synthetic');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=fetch('http://127.0.0.1:'+server.address().port).then(response=>response.text());
 try{
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1,residency_expiry_date=NULL').run();
  reminders.store.saveRecipient({label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true});await reminders.schedule();
  const draining=reminders.drain();await Promise.all([sending,httpStarted]);
  const shutdown=drainApplication({server,stopHandlers:async()=>{},stopReminders:()=>reminders.stop(),stopCron:async()=>{},closeDatabase:()=>{dbClosed=true;},exit:code=>exits.push(code)});
  assert.ok(SHUTDOWN_DEADLINE_MS>15_000);
  if(first==='send'){
   releaseSend();await draining;
   assert.equal(calls.length,1);assert.equal(dbClosed,false);assert.deepEqual(exits,[]);
   releaseHttp();await request;
  }else{
   releaseHttp();await request;await new Promise(resolve=>setImmediate(resolve));
   assert.equal(dbClosed,false);assert.deepEqual(exits,[]);
   releaseSend();await draining;
  }
  await shutdown;
  assert.equal(calls.length,1);assert.equal(dbClosed,true);assert.deepEqual(exits,[0]);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='pending'").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='provider_accepted'").get().n,1);
 }finally{releaseSend();releaseHttp();await request;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await reminders.stop();f.close();}
});

test('hard shutdown deadline exits unsuccessfully without closing an in-use DB',async t=>{
 const f=reminderFixture();let releaseHttp,httpEntered;
 const httpStarted=new Promise(resolve=>httpEntered=resolve),blocked=new Promise(resolve=>releaseHttp=resolve);
 const server=http.createServer(async(_req,res)=>{httpEntered();await blocked;res.end('synthetic');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=fetch('http://127.0.0.1:'+server.address().port).then(response=>response.text());
 try{
  await httpStarted;const exits=[];let closed=false;
  t.mock.timers.enable({apis:['setTimeout']});
  const shutdown=drainApplication({server,stopHandlers:async()=>{},stopReminders:async()=>{},stopCron:async()=>{},closeDatabase:()=>{closed=true;},exit:code=>exits.push(code)});
  t.mock.timers.tick(SHUTDOWN_DEADLINE_MS-1);assert.deepEqual(exits,[]);
  t.mock.timers.tick(1);assert.deepEqual(exits,[1]);assert.equal(closed,false);
  t.mock.timers.reset();releaseHttp();await request;await shutdown;
 }finally{t.mock.timers.reset();releaseHttp();await request;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
