import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {drainApplication,SHUTDOWN_DEADLINE_MS} from '../server/shutdown.ts';
import {reminderFixture,MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {reminderApi} from './fixtures/whatsapp-api.mjs';
import {CronService} from '../server/services/cronService.ts';
import {setSetting,getString} from '../server/repositories/settings.ts';

test('shutdown waits for active scheduled SMTP beyond the old deadline and rejects new cron/manual work',t=>reminderApi(async f=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
 setSetting(f.db,'email.enabled',true);setSetting(f.db,'email.recipients',['synthetic@example.invalid']);
 const cron=new CronService(f.db,{send:async()=>{entered();await blocked;return{status:'sent',accepted:['synthetic@example.invalid'],rejected:[],messageId:'synthetic-shutdown-email'};}});
 cron.setReminderEnqueue(()=>f.reminders.schedule());
 const server=http.createServer((_req,res)=>res.end('synthetic'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const run=cron.run('cron');let dbClosed=false;const exits=[];
 try{
  await started;
  t.mock.timers.enable({apis:['setTimeout']});
  const shutdown=drainApplication({server,stopCron:()=>cron.shutdown(),stopReminders:()=>f.reminders.stop(),closeDatabase:()=>{
   assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='sent'").get().n,1);
   assert.ok(getString(f.db,'cron.last_run_date'));dbClosed=true;
  },exit:code=>exits.push(code)});
  for(const source of ['cron','manual'])assert.equal((await cron.run(source)).skipped,'shutting_down');
  assert.equal(cron.reschedule().nextRun,null);
  t.mock.timers.tick(20_001);
  assert.equal(dbClosed,false);assert.deepEqual(exits,[]);assert.equal(cron.status().running,true);
  // SMTP phase/idle timeouts are not a whole-operation bound; the application has its own ceiling.
  assert.ok(SHUTDOWN_DEADLINE_MS>60_000);
  release();assert.equal((await run).sent,true);await shutdown;
  assert.equal(dbClosed,true);assert.deepEqual(exits,[0]);assert.equal(cron.status().running,false);
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
  const shutdown=drainApplication({server,stopReminders:()=>reminders.stop(),stopCron:async()=>{},closeDatabase:()=>{dbClosed=true;},exit:code=>exits.push(code)});
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
  const shutdown=drainApplication({server,stopReminders:async()=>{},stopCron:async()=>{},closeDatabase:()=>{closed=true;},exit:code=>exits.push(code)});
  t.mock.timers.tick(SHUTDOWN_DEADLINE_MS-1);assert.deepEqual(exits,[]);
  t.mock.timers.tick(1);assert.deepEqual(exits,[1]);assert.equal(closed,false);
  t.mock.timers.reset();releaseHttp();await request;await shutdown;
 }finally{t.mock.timers.reset();releaseHttp();await request;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
