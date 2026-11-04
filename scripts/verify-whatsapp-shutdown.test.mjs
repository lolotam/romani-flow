import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {drainApplication,SHUTDOWN_DEADLINE_MS} from '../server/shutdown.ts';
import {reminderFixture,MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';

test('shutdown stops claims before slow HTTP drain and retains DB until the active handoff settles',async()=>{
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
  const shutdown=drainApplication({server,stopReminders:()=>reminders.stop(),closeDatabase:()=>{dbClosed=true;},exit:code=>exits.push(code)});
  assert.ok(SHUTDOWN_DEADLINE_MS>15_000);releaseHttp();await request;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(dbClosed,false);assert.deepEqual(exits,[]);
  releaseSend();await draining;await shutdown;
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
  const shutdown=drainApplication({server,stopReminders:async()=>{},closeDatabase:()=>{closed=true;},exit:code=>exits.push(code)});
  t.mock.timers.tick(SHUTDOWN_DEADLINE_MS-1);assert.deepEqual(exits,[]);
  t.mock.timers.tick(1);assert.deepEqual(exits,[1]);assert.equal(closed,false);
  t.mock.timers.reset();releaseHttp();await request;await shutdown;
 }finally{t.mock.timers.reset();releaseHttp();await request;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
