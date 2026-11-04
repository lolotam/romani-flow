import test from 'node:test';import assert from 'node:assert/strict';
import {loopbackEvolution} from './fixtures/evolution.mjs';
import {reminderApi} from './fixtures/whatsapp-api.mjs';
import {MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {MessageClient} from '../server/whatsapp/messageClient.ts';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {setSetting} from '../server/repositories/settings.ts';

test('assembled API/cron/SQLite/real HTTP adapter hands off fixed text once; days/restart/reconnect do not duplicate',()=>loopbackEvolution(async e=>reminderApi(async f=>{
 setSetting(f.db,'whatsapp.enabled',false);setSetting(f.db,'email.enabled',false);
 assert.equal((await f.request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':true}}})).status,200);
 assert.equal((await f.request('/api/whatsapp/status')).json.data.state,'connected');
 await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true}});
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.cron.run();assert.equal(await f.reminders.drain(),2);assert.equal(e.sends.length,2);
 const log=await f.request('/api/whatsapp/log');assert.equal(log.json.data.total,2);assert.ok(log.json.data.items.every(job=>job.state==='provider_accepted'&&job.attempts[0].text===e.sends.find(s=>s.number===job.recipient.slice(1)).text));assert.equal(JSON.stringify(log.json).includes(e.config.apiKey),false);
 const restarted=new WhatsAppReminders(f.db,e.config.instance,new MessageClient(e.config),()=>f.clock.now);restarted.store.recover();
 for(const [date,state] of [['2026-01-03','close'],['2026-01-04','open']]){f.clock.now=new Date(date+'T08:00:00Z');e.mode.state=state;assert.equal(await restarted.schedule(),0);assert.equal(await restarted.drain(),0);}
 assert.equal(e.sends.length,2);assert.ok(e.requests.every(r=>r.path.startsWith('/message/sendText/')||r.path.startsWith('/instance/connectionState/')));
},new MessageClient(e.config),e.env)));

test('correcting a zero-fetch invalid-text failure permits only an explicit bounded retry and preserves the failed attempt',()=>loopbackEvolution(async e=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 assert.equal((await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{title:'Synthetic '.repeat(500)}})).status,200);
 await f.reminders.schedule();assert.equal(await f.reminders.drain(),0);assert.equal(e.sends.length,0);
 const job=f.db.prepare('SELECT id,state,error_code FROM whatsapp_jobs').get();assert.equal(job.state,'permanent_failed');assert.equal(job.error_code,'invalid_text');
 assert.equal((await f.request('/api/whatsapp/log')).json.data.items[0].retry_allowed,false);
 assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST',body:{}})).status,409);
 assert.equal((await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{title:'Corrected synthetic document'}})).status,200);
 assert.equal((await f.request('/api/whatsapp/log')).json.data.items[0].retry_allowed,true);
 assert.equal(await f.reminders.drain(),0);assert.equal(e.sends.length,0);
 assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST',body:{}})).status,200);
 assert.equal(await f.reminders.drain(),1);assert.equal(e.sends.length,1);
 const attempts=f.db.prepare('SELECT text,error_code,state FROM whatsapp_attempts WHERE job_id=? ORDER BY attempt').all(job.id);
 assert.equal(attempts.length,2);assert.ok(attempts[0].text.length>4096);assert.equal(attempts[0].error_code,'invalid_text');
 assert.equal(attempts[1].state,'provider_accepted');assert.equal(attempts[1].text,e.sends[0].text);assert.match(attempts[1].text,/Corrected synthetic document/);
 assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST',body:{}})).status,409);
},new MessageClient(e.config),e.env)));

test('disconnected pending job survives day rollover and sends once on reconnect; lost response never retries',()=>loopbackEvolution(async e=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 e.mode.state='close';await f.reminders.schedule();const job=f.db.prepare('SELECT id FROM whatsapp_jobs').get();assert.equal(await f.reminders.drain(),0);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_attempts').get().n,0);
 f.clock.now=new Date('2026-01-03T08:00:00Z');assert.equal(await f.reminders.schedule(),0);assert.equal(f.db.prepare('SELECT id FROM whatsapp_jobs').get().id,job.id);
 e.mode.state='open';e.mode.loseResponse=true;assert.equal(await f.reminders.drain(),0);assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs').get().state,'unknown');assert.equal(e.sends.length,1);
 e.mode.loseResponse=false;f.clock.now=new Date('2026-01-04T08:00:00Z');await f.reminders.schedule();assert.equal(await f.reminders.drain(),0);assert.equal(e.sends.length,1);
 assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST',body:{}})).status,409);
},new MessageClient(e.config),e.env)));
