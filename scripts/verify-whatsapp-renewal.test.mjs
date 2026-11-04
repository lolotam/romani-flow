import test from 'node:test';import assert from 'node:assert/strict';
import {reminderApi} from './fixtures/whatsapp-api.mjs';
import {EMPLOYEE_PHONE,MANAGER_PHONE} from './fixtures/whatsapp.mjs';

test('employee writes reject canonical opt-in collisions atomically, including concurrent creation',()=>reminderApi(async f=>{
 const first='/api/employees/'+f.employee.id;
 assert.equal((await f.request(first,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}})).status,200);
 await f.reminders.schedule();const job=f.db.prepare('SELECT id,state FROM whatsapp_jobs').get();
 const duplicate=await f.request('/api/employees',{method:'POST',body:{name:'Duplicate synthetic',mobile_no:'00999 0000-0001',whatsapp_notifications_enabled:true}});
 assert.equal(duplicate.status,409);assert.equal(duplicate.json.error.code,'duplicate_employee_whatsapp_phone');
 const added=await f.request('/api/employees',{method:'POST',body:{name:'Separate synthetic',mobile_no:MANAGER_PHONE}});
 assert.equal(added.status,201);const second='/api/employees/'+added.json.data[0].id;
 const rejected=await f.request(second,{method:'PATCH',body:{mobile_no:EMPLOYEE_PHONE,whatsapp_notifications_enabled:true}});
 assert.equal(rejected.status,409);
 const unchanged=(await f.request(second)).json.data;assert.equal(unchanged.mobile_no,MANAGER_PHONE);assert.equal(unchanged.whatsapp_notifications_enabled,false);
 assert.equal((await f.request(second,{method:'PATCH',body:{whatsapp_notifications_enabled:true}})).status,200);
 assert.equal((await f.request(second,{method:'PATCH',body:{mobile_no:EMPLOYEE_PHONE}})).status,409);
 const concurrent=await Promise.all([1,2].map(n=>f.request('/api/employees',{method:'POST',body:{name:'Concurrent synthetic '+n,mobile_no:'+99900000004',whatsapp_notifications_enabled:true}})));
 assert.deepEqual(concurrent.map(response=>response.status).sort(),[201,409]);
 assert.equal(f.db.prepare("SELECT count(*) n FROM employees WHERE mobile_no='+99900000004' AND whatsapp_notifications_enabled=1").get().n,1);
 assert.deepEqual(f.db.prepare('SELECT id,state FROM whatsapp_jobs WHERE id=?').get(job.id),job);assert.equal(f.calls.length,0);
}));

test('legacy opted-in mobile collisions cancel employee work but preserve explicit management routing',()=>reminderApi(async f=>{
 const {insertRow}=await import('../server/repositories/base.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.reminders.schedule();const first=f.db.prepare('SELECT id FROM whatsapp_jobs').get().id;
 await f.reminders.mutate(()=>{
  const other=insertRow(f.db,'employees',{name:'Legacy synthetic',mobile_no:'00999 0000-0001',whatsapp_notifications_enabled:true,residency_expiry_date:'2026-01-01'});
  insertRow(f.db,'documents',{title:'Legacy synthetic document',employee_id:other.id,document_type_id:f.type.id,expiry_date:'2026-01-01'});
 });
 assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(first).state,'cancelled');
 assert.equal(await f.reminders.drain(),0);assert.equal(f.calls.length,0);
 const manager=await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Explicit synthetic manager',phone:EMPLOYEE_PHONE,enabled:true}});
 assert.equal(manager.status,201);f.clock.now=new Date('2026-01-03T08:00:00Z');await f.reminders.schedule();
 const pending=f.db.prepare("SELECT audience FROM whatsapp_jobs WHERE state='pending'").all();assert.equal(pending.length,3);assert.ok(pending.every(job=>job.audience==='management'));
 assert.equal(await f.reminders.drain(),3);assert.equal(f.calls.length,3);
}));

test('disconnected already-enabled settings save succeeds; false-to-true still refuses atomically',()=>reminderApi(async f=>{
 const {getBoolean}=await import('../server/repositories/settings.ts');
 assert.equal((await f.request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':true,'cron.include_documents':false}}})).status,200);
 assert.equal(getBoolean(f.db,'cron.include_documents'),false);
 assert.equal((await f.request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':false}}})).status,200);
 const rejected=await f.request('/api/settings',{method:'PUT',body:{settings:{'whatsapp.enabled':true,'cron.include_documents':true}}});
 assert.equal(rejected.status,409);assert.equal(rejected.json.error.code,'whatsapp_not_connected');
 assert.equal(getBoolean(f.db,'whatsapp.enabled'),false);assert.equal(getBoolean(f.db,'cron.include_documents'),false);
 assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,0);
},{status:async()=>({configured:true,state:'disconnected'}),sendText:async()=>{throw Error('Unexpected synthetic send');}}));

test('owner phone-change policy replaces only prepared unsent work on the same day, including A-to-B-to-A',()=>reminderApi(async f=>{
 const employeePath='/api/employees/'+f.employee.id;
 await f.request(employeePath,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.reminders.schedule();
 const first=f.db.prepare('SELECT id FROM whatsapp_jobs').get().id;
 for(const phone of [MANAGER_PHONE,EMPLOYEE_PHONE]){
  assert.equal((await f.request(employeePath,{method:'PATCH',body:{mobile_no:phone}})).status,200);
  const pending=f.db.prepare("SELECT recipient FROM whatsapp_jobs WHERE state='pending'").all();
  assert.deepEqual(pending.map(row=>row.recipient),[phone]);
 }
 assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(first).state,'cancelled');
 assert.equal(await f.reminders.drain(),1);assert.equal(f.calls[0].phone,EMPLOYEE_PHONE);
 await f.request(employeePath,{method:'PATCH',body:{mobile_no:MANAGER_PHONE}});
 assert.equal(await f.reminders.drain(),0);assert.equal(f.calls.length,1);
 // New audiences and new documents still wait for scheduled selection.
 assert.equal((await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'New synthetic',phone:'+99900000003',enabled:true}})).status,201);
 assert.equal((await f.request('/api/documents',{method:'POST',body:{title:'New synthetic',employee_id:f.employee.id,document_type_id:f.type.id,expiry_date:'2026-01-01'}})).status,201);
 assert.equal(f.reminders.store.due().length,0);
}));

test('management number replacement is atomic; unknown outcomes never create replacements',()=>reminderApi(async f=>{
 const recipient=await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true}});
 const recipientPath='/api/whatsapp/recipients/'+recipient.json.data.id;
 await f.reminders.schedule();const old=f.reminders.store.due()[0];
 f.db.exec("CREATE TRIGGER reject_replacement BEFORE INSERT ON whatsapp_jobs BEGIN SELECT RAISE(ABORT,'Synthetic replacement rejection'); END;");
 assert.equal((await f.request(recipientPath,{method:'PATCH',body:{phone:EMPLOYEE_PHONE}})).status,500);
 assert.equal(f.db.prepare('SELECT phone FROM whatsapp_recipients').get().phone,MANAGER_PHONE);
 assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(old.id).state,'pending');
 f.db.exec('DROP TRIGGER reject_replacement');
 assert.equal((await f.request(recipientPath,{method:'PATCH',body:{phone:EMPLOYEE_PHONE}})).status,200);
 assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='pending'").get().n,2);
 const job=f.reminders.store.due()[0],claim=f.reminders.store.claim(job.id);
 f.reminders.store.finish(claim.job,claim.attemptId,{kind:'unknown',code:'transport_interrupted'});
 // Both document and residency jobs have distinct prepared identities.
 const other=f.reminders.store.due()[0],second=f.reminders.store.claim(other.id);
 f.reminders.store.finish(second.job,second.attemptId,{kind:'unknown',code:'transport_interrupted'});
 await f.request(recipientPath,{method:'PATCH',body:{phone:MANAGER_PHONE}});
 assert.equal(f.reminders.store.due().length,0);assert.equal(f.calls.length,0);
}));

test('log retry availability matches queue capacity for permanent requeue but not an already queued retry',()=>reminderApi(async f=>{
 const {selectReminders}=await import('../server/notifications/whatsapp/selection.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.reminders.schedule();
 const claim=f.reminders.store.claim(f.reminders.store.due()[0].id);
 f.reminders.store.finish(claim.job,claim.attemptId,{kind:'permanent_failed',code:'provider_unauthorized'});
 // Fill with valid business recipients so the real retry reconciliation retains them.
 const insert=f.db.prepare("INSERT INTO whatsapp_recipients(id,label,phone,enabled,created_at,updated_at) VALUES(?,?,?,1,'2026-01-01','2026-01-01')");
 for(let n=0;n<2000;n++)insert.run('synthetic-'+n,'Synthetic '+n,'+999'+String(n+10).padStart(8,'0'));
 f.reminders.store.enqueue(selectReminders(f.db,'romani',f.clock.now));
 const queued=f.reminders.store.due()[0],retry=f.reminders.store.claim(queued.id);
 f.reminders.store.finish(retry.job,retry.attemptId,{kind:'retryable_failed',code:'provider_connection_failed'});
 const permanent=(await f.request('/api/whatsapp/log?state=permanent_failed')).json.data.items[0];
 const retryable=(await f.request('/api/whatsapp/log?state=retryable_failed')).json.data.items[0];
 assert.equal(permanent.retry_allowed,false);assert.equal(retryable.retry_allowed,true);
 assert.equal((await f.request('/api/whatsapp/jobs/'+claim.job.id+'/retry',{method:'POST',body:{}})).status,409);
 assert.equal((await f.request('/api/whatsapp/jobs/'+queued.id+'/retry',{method:'POST',body:{}})).status,200);
 assert.equal(f.calls.length,0);
}));

test('real API validates current merged opt-in/mobile and keeps new-person defaults private',()=>reminderApi(async f=>{
 const url='/api/employees/'+f.employee.id;
 assert.equal((await f.request(url,{method:'PATCH',body:{whatsapp_notifications_enabled:true}})).status,200);
 const invalid=await f.request(url,{method:'PATCH',body:{mobile_no:'national'}});assert.equal(invalid.status,400);assert.equal(invalid.json.error.code,'invalid_whatsapp_phone');
 assert.equal(f.db.prepare('SELECT mobile_no FROM employees WHERE id=?').get(f.employee.id).mobile_no,EMPLOYEE_PHONE);
 const edited=await f.request(url,{method:'PATCH',body:{name:'Updated synthetic'}});assert.equal(edited.json.data.whatsapp_notifications_enabled,true);
 const added=await f.request('/api/employees',{method:'POST',body:{name:'New synthetic',mobile_no:MANAGER_PHONE,whatsapp_notifications_enabled:true}});assert.equal(added.status,201);
 const defaults=await f.request('/api/form-defaults/employees');assert.equal('mobile_no' in defaults.json.data,false);assert.equal('whatsapp_notifications_enabled' in defaults.json.data,false);
 const disabled=await f.request('/api/employees',{method:'POST',body:{name:'No opt-in',mobile_no:'legacy'}});assert.equal(disabled.status,201);assert.equal(disabled.json.data[0].whatsapp_notifications_enabled,false);
}));

test('viewer and foreign-origin writes deny before jobs, provider calls or configuration changes',()=>reminderApi(async f=>{
 const before=f.db.prepare('SELECT total_changes() n').get().n;
 for(const [path,method,body] of [['/api/whatsapp/recipients','GET'],['/api/whatsapp/log','GET'],['/api/whatsapp/recipients','POST',{label:'Synthetic',phone:MANAGER_PHONE,enabled:true}],['/api/whatsapp/recipients/missing','PATCH',{enabled:false}],['/api/whatsapp/recipients/missing','DELETE'],['/api/whatsapp/jobs/missing/retry','POST',{}]]){
  assert.equal((await f.request(path,{method,body,role:'viewer'})).status,403);
  assert.equal((await f.request(path,{method,body,role:null})).status,401);
 }
 assert.equal((await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic',phone:MANAGER_PHONE},headers:{origin:'https://foreign.example.invalid'}})).status,403);
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.calls.length,0);
}));

test('recipient CRUD canonical duplicates, audience reconciliation, log snapshots and retry denial',()=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});await f.reminders.schedule();
 const created=await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic manager',phone:EMPLOYEE_PHONE,enabled:true}});assert.equal(created.status,201);
 const duplicate=await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Duplicate',phone:'00999 0000-0001',enabled:true}});assert.equal(duplicate.status,409);
 assert.equal(f.db.prepare('SELECT audience FROM whatsapp_jobs').get().audience,'management');
 assert.equal((await f.request('/api/whatsapp/recipients/'+created.json.data.id,{method:'DELETE'})).status,200);
 assert.equal(f.db.prepare('SELECT audience FROM whatsapp_jobs').get().audience,'employee');
 await f.reminders.drain();const log=await f.request('/api/whatsapp/log?state=provider_accepted&limit=1');assert.equal(log.status,200);assert.equal(log.json.data.total,1);assert.equal(log.json.data.items[0].attempts[0].text,f.calls[0].text);
 const id=log.json.data.items[0].id;assert.equal((await f.request('/api/whatsapp/jobs/'+id+'/retry',{method:'POST',body:{}})).status,409);
 assert.equal((await f.request('/api/whatsapp/log?limit=500')).status,400);
}));

test('W6 document renewal and cancellation share one transaction; rejected cancellation rolls both back',()=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});await f.reminders.schedule();
 f.db.exec("CREATE TRIGGER reject_cancel BEFORE UPDATE ON whatsapp_jobs WHEN NEW.state='cancelled' BEGIN SELECT RAISE(ABORT,'Synthetic cancellation rejection'); END;");
 const failed=await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{expiry_date:'2027-01-01'}});assert.equal(failed.status,500);
 assert.equal(f.db.prepare('SELECT expiry_date FROM documents WHERE id=?').get(f.document.id).expiry_date,'2026-01-01');assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs').get().state,'pending');
 f.db.exec('DROP TRIGGER reject_cancel');assert.equal((await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{expiry_date:'2027-01-01'}})).status,200);
 assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs').get().state,'cancelled');assert.equal(await f.reminders.drain(),0);
 assert.equal((await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{expiry_date:'2026-01-01'}})).status,200);
 f.clock.now=new Date('2026-01-03T08:00:00Z');await f.reminders.schedule();assert.equal(await f.reminders.drain(),1);
}));

test('employee opt-out/deletion and business erase cancel pending work; export retains audits without credentials',()=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true}});await f.reminders.schedule();
 assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:false}})).status,200);assert.equal(await f.reminders.drain(),0);
 const exported=await f.request('/api/backup/export');assert.ok(Array.isArray(exported.json.data.whatsapp_jobs));assert.ok(Array.isArray(exported.json.data.whatsapp_attempts));
 await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic manager',phone:MANAGER_PHONE,enabled:true}});f.clock.now=new Date('2026-01-03T08:00:00Z');await f.reminders.schedule();
 assert.equal((await f.request('/api/backup/erase',{method:'POST',body:{}})).status,200);assert.equal(await f.reminders.drain(),0);assert.equal(f.calls.length,0);
}));

test('W5 real CronService selects WhatsApp when email is disabled or already completed',()=>reminderApi(async f=>{
 const {setSetting}=await import('../server/repositories/settings.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 setSetting(f.db,'email.enabled',false);setSetting(f.db,'cron.last_run_date',new Date().toISOString().slice(0,10));
 assert.equal((await f.cron.run()).skipped,'already_run_today');assert.equal(f.reminders.store.due().length,1);assert.equal(await f.reminders.drain(),1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_log').get().n,0);
}));

test('PR8 manual email report never enqueues WhatsApp or consumes its daily selection checkpoint',()=>reminderApi(async f=>{
 const {setSetting}=await import('../server/repositories/settings.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 setSetting(f.db,'email.enabled',false);setSetting(f.db,'cron.enabled',false);
 const response=await f.request('/api/email/expiry-report',{method:'POST',body:{}});assert.equal(response.status,200);
 assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n,0);
 assert.equal(f.db.prepare("SELECT value FROM settings WHERE key='whatsapp.last_enqueue_date'").get(),undefined);assert.equal(f.calls.length,0);
 await f.cron.run('cron');assert.equal(f.reminders.store.due().length,1);
}));

test('a real isolated cron timer enqueues reminders without changing production cadence',()=>reminderApi(async f=>{
 const {setSetting}=await import('../server/repositories/settings.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 setSetting(f.db,'email.enabled',false);setSetting(f.db,'cron.schedule','* * * * * *');f.cron.reschedule();
 const deadline=Date.now()+3500;while(!f.reminders.store.due().length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 f.cron.stop();assert.equal(f.reminders.store.due().length,1);assert.equal(f.calls.length,0);
}));

test('a scheduled firing still selects WhatsApp while a manual email report is in flight',()=>reminderApi(async f=>{
 const {CronService}=await import('../server/services/cronService.ts');const {setSetting}=await import('../server/repositories/settings.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 setSetting(f.db,'email.enabled',true);setSetting(f.db,'email.recipients',['synthetic@example.invalid']);
 let release,entered;const blocked=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const cron=new CronService(f.db,{send:async()=>{entered();await blocked;return{status:'sent',accepted:['synthetic@example.invalid'],rejected:[],messageId:'synthetic-overlap'};}});
 cron.setReminderEnqueue(()=>f.reminders.schedule());const manual=cron.run('manual');
 try{await started;assert.equal(f.reminders.store.due().length,0);
  assert.equal((await cron.run('cron')).skipped,'already_running');assert.equal(f.reminders.store.due().length,1);assert.equal(f.calls.length,0);
 }finally{release();await manual;cron.stop();}
 assert.equal(f.db.prepare('SELECT count(*) n FROM email_log').get().n,1);
}));

test('W5 an email configuration failure cannot suppress a successful independent WhatsApp attempt',()=>reminderApi(async f=>{
 const {setSetting}=await import('../server/repositories/settings.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 setSetting(f.db,'email.enabled',true);setSetting(f.db,'email.recipients',['synthetic@example.invalid']);
 const result=await f.cron.run();assert.equal(result.sent,false);assert.ok(result.error);
 assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE status='failed'").get().n,1);
 assert.equal(await f.reminders.drain(),1);assert.equal(f.calls.length,1);
}));

test('deleting a document or employee cancels its queued work before another handoff',()=>reminderApi(async f=>{
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true}});await f.reminders.schedule();
 assert.equal((await f.request('/api/documents/'+f.document.id,{method:'DELETE'})).status,200);
 assert.equal(f.db.prepare("SELECT state FROM whatsapp_jobs WHERE item_type='document'").get().state,'cancelled');
 assert.equal((await f.request('/api/employees/'+f.employee.id,{method:'DELETE'})).status,200);
 assert.equal(await f.reminders.drain(),0);assert.equal(f.calls.length,0);assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE state='cancelled'").get().n,2);
}));

test('cross-project browser authority cannot select an instance or forge an authenticated actor',()=>reminderApi(async f=>{
 const {randomBytes}=await import('node:crypto');const {signSession}=await import('../server/middleware/auth.ts');
 const token=signSession({...f.config,jwtSecret:randomBytes(32).toString('hex')},{id:'admin',role:'admin',name:'Foreign synthetic',email:'foreign@example.invalid'});
 const before=f.db.prepare('SELECT total_changes() n').get().n;
 assert.equal((await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic',phone:MANAGER_PHONE},headers:{cookie:f.config.cookieName+'='+token,'x-role':'admin'}})).status,401);
 assert.equal((await f.request('/api/whatsapp/log?instance=curemed')).status,400);
 assert.equal((await f.request('/api/whatsapp/recipients',{method:'POST',body:{label:'Synthetic',phone:MANAGER_PHONE,instance:'curemed'}})).status,400);
 assert.equal((await f.request('/api/whatsapp/jobs/missing/retry',{method:'POST',body:{},headers:{'x-instance-name':'curemed'}})).status,400);
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.calls.length,0);
}));

test('W6 attachment-only replacement preserves accepted identity; failed upload cannot renew or requeue',()=>reminderApi(async f=>{
 const {signSession}=await import('../server/middleware/auth.ts');
 await f.request('/api/employees/'+f.employee.id,{method:'PATCH',body:{whatsapp_notifications_enabled:true,residency_expiry_date:null}});
 await f.reminders.schedule();await f.reminders.drain();
 const before=f.db.prepare('SELECT id,state,expiry_date FROM whatsapp_jobs').get();
 const form=new FormData();form.append('files',new Blob(['%PDF-1.4\nSynthetic attachment\n%%EOF'],{type:'application/pdf'}),'synthetic.pdf');
 const cookie=f.config.cookieName+'='+signSession(f.config,{id:'admin',name:'Synthetic',email:'admin@example.invalid',role:'admin'});
 const upload=await fetch(f.base+'/api/files/upload',{method:'POST',headers:{cookie},body:form});assert.equal(upload.status,201);
 const uploadId=(await upload.json()).data[0].upload_id;
 assert.equal((await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{upload_id:uploadId}})).status,200);
 const failed=await f.request('/api/documents/'+f.document.id,{method:'PATCH',body:{upload_id:'unknown',expiry_date:'2027-01-01'}});assert.equal(failed.status,400);
 assert.equal(f.db.prepare('SELECT expiry_date FROM documents WHERE id=?').get(f.document.id).expiry_date,before.expiry_date);
 f.clock.now=new Date('2026-01-03T08:00:00Z');await f.reminders.schedule();assert.equal(await f.reminders.drain(),0);
 assert.deepEqual(f.db.prepare('SELECT id,state,expiry_date FROM whatsapp_jobs').get(),before);assert.equal(f.calls.length,1);
}));
