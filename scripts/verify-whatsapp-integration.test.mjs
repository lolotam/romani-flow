import test from 'node:test';import assert from 'node:assert/strict';
import {loopbackEvolution} from './fixtures/evolution.mjs';
import {reminderApi} from './fixtures/whatsapp-api.mjs';
import {MANAGER_PHONE} from './fixtures/whatsapp.mjs';
import {MessageClient} from '../server/whatsapp/messageClient.ts';
import {WhatsAppReminders} from '../server/notifications/whatsapp/service.ts';
import {setSetting} from '../server/repositories/settings.ts';
import {createReminderRuntime} from '../server/whatsapp/runtime.ts';
import {createApp} from '../server/app.ts';
import {signSession} from '../server/middleware/auth.ts';
import {whatsappReminders} from '../src/lib/api/whatsapp.ts';
import {api} from '../src/lib/api/client.ts';
import {buildEmployeePayload} from '../src/components/employees/employeeHelpers.ts';
import {EMPTY_EMPLOYEE_FORM} from '../src/components/employees/employeeTypes.ts';

test('stale metadata forms preserve another admin consent and destination changes unless explicitly edited',t=>reminderApi(async f=>{
 f.db.prepare("INSERT INTO admin_users(id,email,name,role,password_hash,created_at,updated_at) VALUES('second-admin','second@example.invalid','Synthetic','admin','unused','2026-01-01','2026-01-01')").run();
 const cookie=f.config.cookieName+'='+signSession(f.config,{id:'second-admin',role:'admin',name:'Synthetic',email:'second@example.invalid'});
 const nativeFetch=globalThis.fetch;
 // Only browser-relative URL/auth resolution is adapted; both admins use the real API/SQLite.
 t.mock.method(globalThis,'fetch',(url,options)=>typeof url==='string'&&url.startsWith('/')
  ?nativeFetch(f.base+url,{...options,headers:{...options?.headers,cookie}}):nativeFetch(url,options));
 try{
  const created=await whatsappReminders.saveRecipient({label:'Synthetic',phone:MANAGER_PHONE,enabled:false});assert.equal(created.error,null);
  const id=created.data.id;
  for(const stale of [true,false]){
   assert.equal((await whatsappReminders.toggleRecipient(id,stale)).error,null);
   const {label,phone,enabled}=(await whatsappReminders.recipients()).data.items.find(row=>row.id===id);
   const snapshot={label,phone,enabled};
   assert.equal((await f.request('/api/whatsapp/recipients/'+id,{method:'PATCH',body:{enabled:!stale}})).status,200);
   assert.equal((await whatsappReminders.saveRecipient({...snapshot,label:'Changed label'},id)).error,null);
   assert.equal(f.db.prepare('SELECT enabled FROM whatsapp_recipients WHERE id=?').get(id).enabled,Number(!stale));
   assert.equal((await whatsappReminders.saveRecipient(snapshot,id,{enabled:true})).error,null);
   assert.equal(f.db.prepare('SELECT enabled FROM whatsapp_recipients WHERE id=?').get(id).enabled,Number(stale));

   assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:stale}})).status,200);
   const form={...EMPTY_EMPLOYEE_FORM,...f.employee,name:'Changed name',whatsapp_notifications_enabled:stale};
   assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:!stale}})).status,200);
   assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload(form,{name:true}))).error,null);
   assert.equal(f.db.prepare('SELECT whatsapp_notifications_enabled FROM employees WHERE id=?').get(f.employee.id).whatsapp_notifications_enabled,Number(!stale));
   assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload(form,{whatsapp_notifications_enabled:true}))).error,null);
   assert.equal(f.db.prepare('SELECT whatsapp_notifications_enabled FROM employees WHERE id=?').get(f.employee.id).whatsapp_notifications_enabled,Number(stale));
  }
  for(const [oldPhone,newPhone] of [[MANAGER_PHONE,'+99900000003'],['+99900000003',MANAGER_PHONE]]){
   assert.equal((await f.request('/api/whatsapp/recipients/'+id,{method:'PATCH',body:{phone:oldPhone,enabled:true}})).status,200);
   const snapshot={label:'Changed label',phone:oldPhone,enabled:true};
   assert.equal((await f.request('/api/whatsapp/recipients/'+id,{method:'PATCH',body:{phone:newPhone}})).status,200);
   assert.equal((await whatsappReminders.saveRecipient(snapshot,id,{label:true})).error,null);
   assert.equal(f.db.prepare('SELECT phone FROM whatsapp_recipients WHERE id=?').get(id).phone,newPhone);
   assert.equal((await whatsappReminders.saveRecipient(snapshot,id,{phone:true})).error,null);
   assert.equal(f.db.prepare('SELECT phone FROM whatsapp_recipients WHERE id=?').get(id).phone,oldPhone);

   assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{mobile_no:oldPhone,whatsapp_notifications_enabled:true}})).status,200);
   const form={...EMPTY_EMPLOYEE_FORM,...f.employee,name:'Changed name',mobile_no:oldPhone,whatsapp_notifications_enabled:true};
   assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{mobile_no:newPhone}})).status,200);
   assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload(form,{name:true}))).error,null);
   assert.equal(f.db.prepare('SELECT mobile_no FROM employees WHERE id=?').get(f.employee.id).mobile_no,newPhone);
   assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload(form,{mobile_no:true}))).error,null);
   assert.equal(f.db.prepare('SELECT mobile_no FROM employees WHERE id=?').get(f.employee.id).mobile_no,oldPhone);
  }
  const cleared={...EMPTY_EMPLOYEE_FORM,...f.employee,mobile_no:'',whatsapp_notifications_enabled:false};
  assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload(cleared,{mobile_no:true,whatsapp_notifications_enabled:true}))).error,null);
  assert.equal(f.db.prepare('SELECT mobile_no FROM employees WHERE id=?').get(f.employee.id).mobile_no,null);
  assert.equal((await api.update('employees',f.employee.id,{driving_license:true,driving_license_expiry_date:'2030-01-01'})).error,null);
  assert.equal((await api.update('employees',f.employee.id,buildEmployeePayload({...cleared,driving_license:false,driving_license_expiry_date:'2030-01-01'},{driving_license:true}))).error,null);
  const licence=f.db.prepare('SELECT driving_license,driving_license_expiry_date FROM employees WHERE id=?').get(f.employee.id);
  assert.equal(licence.driving_license,0);assert.equal(licence.driving_license_expiry_date,null);
  assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,0);
 }finally{t.mock.restoreAll();}
}));

test('business erase with invalid sending config cancels only its unsent namespace and rolls back on failure',()=>reminderApi(async f=>{
 await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true}});
 await f.request('/api/documents',{method:'POST',body:{title:'Another synthetic document',employee_id:f.employee.id,document_type_id:f.type.id,expiry_date:'2026-01-01'}});
 await f.reminders.schedule();
 for(const outcome of [{kind:'unknown',code:'transport_interrupted'},{kind:'provider_accepted',messageId:'synthetic-retained'}]){
  const claim=f.reminders.store.claim(f.reminders.store.due()[0].id);f.reminders.store.finish(claim.job,claim.attemptId,outcome);
 }
 const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 const other=new WhatsAppReminders(f.db,'other-isolated-fixture',{status:async()=>({configured:false,state:'unconfigured'}),sendText:async()=>{throw Error('No handoff allowed');}},()=>f.clock.now);
 other.store.enqueue(selectReminders(f.db,other.instance,f.clock.now));
 const original=f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all(),attempts=f.db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id').all();
 const invalid=createReminderRuntime(f.db,{url:'',apiKey:'',instance:'',webhookSecret:''});
 const app=createApp({config:f.config,db:f.db,mailer:f.mailer,cron:f.cron,storage:f.storage,documents:f.documents,reminders:invalid,staticDir:f.config.dataDir});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
 const cookie=f.config.cookieName+'='+signSession(f.config,{id:'admin',role:'admin',name:'Synthetic',email:'admin@example.invalid'});
 const erase=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/backup/erase',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
 try{
  f.db.exec("CREATE TRIGGER reject_invalid_erase BEFORE UPDATE ON whatsapp_jobs BEGIN SELECT RAISE(ABORT,'Synthetic cancellation rejection'); END;");
  assert.equal((await erase()).status,500);assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all(),original);
  assert.equal(f.db.prepare('SELECT count(*) n FROM employees').get().n,1);
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='whatsapp.enabled'").get().value,'true');
  f.db.exec('DROP TRIGGER reject_invalid_erase');
  assert.equal((await erase()).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM employees').get().n,0);
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='whatsapp.enabled'").get().value,'false');
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='cancelled'").get().n,1);
  assert.deepEqual(f.db.prepare("SELECT * FROM whatsapp_jobs WHERE instance!='romani' OR state IN ('provider_accepted','unknown') ORDER BY id").all(),original.filter(job=>job.instance!=='romani'||['provider_accepted','unknown'].includes(job.state)));
  assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id').all(),attempts);
  assert.equal(f.calls.length,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

test('missing employee PATCH returns 404 before WhatsApp validation or write hooks',()=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true}});
 const before=f.db.prepare('SELECT total_changes() n').get().n;
 for(const mobile_no of ['',f.employee.mobile_no]){
  const result=await f.request('/api/employees/nonexistent-synthetic-id',{method:'PATCH',body:{whatsapp_notifications_enabled:true,mobile_no}});
  assert.equal(result.status,404);assert.equal(result.json.error.code,'not_found');
 }
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.calls.length,0);
}));

for(const initialState of ['pending','permanent_failed'])test(`invalid configuration preserves ${initialState} history without admission or usable retries`,()=>loopbackEvolution(async e=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.reminders.schedule();const original=f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all();assert.equal(original.length,1);
 if(initialState==='permanent_failed'){
  const failed=f.reminders.store.claim(original[0].id);f.reminders.store.finish(failed.job,failed.attemptId,{kind:'permanent_failed',code:'invalid_text'});
 }
 const retained=f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all();
 assert.equal((await f.request('/api/whatsapp/log')).json.data.items[0].retry_allowed,initialState==='permanent_failed');
 f.db.prepare("DELETE FROM settings WHERE key='whatsapp.last_enqueue_date'").run();
 for(const config of [{...e.config,instance:'romani_test'},{...e.config,url:e.config.url+'/prefix'}]){
  const invalid=createReminderRuntime(f.db,config);assert.equal(invalid.instance,'');
  assert.equal(await invalid.schedule(),0);
  await invalid.mutate(()=>f.db.prepare('UPDATE employees SET mobile_no=?').run(MANAGER_PHONE));
  assert.equal(await invalid.drain(),0);
  const app=createApp({config:f.config,db:f.db,mailer:f.mailer,cron:f.cron,storage:f.storage,documents:f.documents,reminders:invalid,staticDir:f.config.dataDir});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  try{
   const cookie=f.config.cookieName+'='+signSession(f.config,{id:'admin',role:'admin',name:'Synthetic',email:'admin@example.invalid'});
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/whatsapp/log',{headers:{cookie}});
   assert.equal(response.status,200);const audit=(await response.json()).data;
   assert.equal(audit.total,original.length);assert.deepEqual(audit.items.map(job=>job.id),original.map(job=>job.id));
   assert.ok(audit.items.every(job=>job.retry_allowed===false));
   const before=f.db.prepare('SELECT total_changes() n').get().n;
   const retry=await fetch('http://127.0.0.1:'+server.address().port+'/api/whatsapp/jobs/'+original[0].id+'/retry',{method:'POST',headers:{cookie}});
   assert.equal(retry.status,409);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='whatsapp.last_enqueue_date'").get(),undefined);
  assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all(),retained);
 }
 assert.equal(e.requests.length,0);assert.equal(e.sends.length,0);
 const corrected=createReminderRuntime(f.db,e.config);assert.equal(await corrected.schedule(),1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE instance!='romani'").get().n,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='pending' AND recipient=?").get(MANAGER_PHONE).n,1);
})));

test('reminder enablement refuses pairing-compatible prefixes, aliases and noncanonical URL spelling before provider access',()=>loopbackEvolution(async e=>{
 for(const config of [{...e.config,url:e.config.url+'/prefix'},{...e.config,instance:'romani_test'},{...e.config,url:e.config.url.replace('http:','HTTP:')}]){
  const transport=new MessageClient(config);
  await reminderApi(async f=>{
   setSetting(f.db,'whatsapp.enabled',false);
   assert.deepEqual(await transport.status(),{configured:false,state:'unconfigured'});
   const response=await f.request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':true}}});
   assert.equal(response.status,409);
   assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='whatsapp.enabled'").get().value,'false');
   assert.deepEqual(await transport.sendText(MANAGER_PHONE,'Synthetic'),{kind:'permanent_failed',code:'whatsapp_not_configured'});
   assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,0);
  },transport,e.env);
 }
 assert.equal(e.requests.length,0);assert.equal(e.sends.length,0);
}));

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
 const beforeRetry=f.db.prepare('SELECT total_changes() n').get().n;
 for(const body of [null,[],{instance:'foreign'},{text:'override'}])assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST',body})).status,400);
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,beforeRetry);
 assert.equal((await f.request('/api/whatsapp/jobs/'+job.id+'/retry',{method:'POST'})).status,200);
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
