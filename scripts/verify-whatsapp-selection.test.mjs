import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderFixture,EMPLOYEE_PHONE,MANAGER_PHONE } from './fixtures/whatsapp.mjs';
import { selectReminders } from '../server/notifications/whatsapp/selection.ts';
import { reminderText } from '../server/notifications/whatsapp/templates.ts';
import { setSetting } from '../server/repositories/settings.ts';
import { insertRow } from '../server/repositories/base.ts';

test('targeted claim selection matches full selection through audience, legacy collision and expiry changes',()=>{
 const f=reminderFixture();try{
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();
  f.db.prepare("INSERT INTO whatsapp_recipients VALUES('manager','ws_legacy','Synthetic manager',?,1,'x','x')").run(MANAGER_PHONE);
  const companyDoc=insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents',{title:'Company synthetic',company_id:f.company.id,document_type_id:f.type.id,expiry_date:'2026-01-01'});
  const scopes=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani',f.clock.now);
  const compare=()=>{
   const all=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani',f.clock.now);
   for(const job of scopes)assert.deepEqual(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani',f.clock.now,job),all.filter(row=>row.item_type===job.item_type&&row.item_id===job.item_id&&row.recipient===job.recipient));
  };
  compare();
  insertRow(f.db, { workspaceId: 'ws_legacy' }, 'employees',{name:'Legacy collision',mobile_no:'00999 0000-0001',whatsapp_notifications_enabled:true});compare();
  f.db.prepare("UPDATE whatsapp_recipients SET phone=? WHERE id='manager'").run(EMPLOYEE_PHONE);compare();
  f.db.prepare('UPDATE documents SET expiry_date=? WHERE id=?').run('2030-01-01',f.document.id);compare();
  f.db.prepare('DELETE FROM documents WHERE id=?').run(companyDoc.id);compare();
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'cron.include_employees',false);compare();setSetting(f.db, { workspaceId: 'ws_legacy' }, 'whatsapp.enabled',false);compare();
 }finally{f.close();}
});

test('two opted employees receive only their own documents and names, while management sees both',()=>{
 const f=reminderFixture();try{
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1,residency_expiry_date=NULL').run();
  const other=insertRow(f.db, { workspaceId: 'ws_legacy' }, 'employees',{name:'Other synthetic employee',company_id:f.company.id,mobile_no:'+99900000003',whatsapp_notifications_enabled:true});
  const otherDoc=insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents',{title:'Other private synthetic document',employee_id:other.id,document_type_id:f.type.id,expiry_date:'2026-01-01'});
  f.db.prepare("INSERT INTO whatsapp_recipients VALUES('manager','ws_legacy','Synthetic manager',?,1,'x','x')").run(MANAGER_PHONE);
  const rows=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now);
  assert.deepEqual(rows.filter(r=>r.recipient===EMPLOYEE_PHONE).map(r=>r.item_id),[f.document.id]);
  assert.deepEqual(rows.filter(r=>r.recipient==='+99900000003').map(r=>r.item_id),[otherDoc.id]);
  assert.ok(rows.filter(r=>r.recipient===EMPLOYEE_PHONE).every(r=>!r.text.includes(other.name)&&!r.text.includes(otherDoc.title)));
  assert.equal(rows.filter(r=>r.recipient===MANAGER_PHONE).length,2);
 }finally{f.close();}
});

test('fixed owner templates and management-only company routing; residency respects opt-in',()=>{
 const f=reminderFixture();try {
  assert.equal(reminderText('management','اختبار','موظف','2026-01-01'),'تذكير: وثيقة «اختبار» الخاصة بالموظف «موظف»، تاريخ انتهائها 01/01/2026. يُرجى متابعة التجديد.');
  assert.equal(reminderText('employee','اختبار','موظف','2026-01-01'),'أهلاً بيك «موظف»،\nتذكير: وثيقة «اختبار» تاريخ انتهائها 01/01/2026. يُرجى متابعة التجديد مع الإدارة.');
  assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now).length,0);
  f.db.prepare("INSERT INTO whatsapp_recipients VALUES('manager','ws_legacy','الإدارة',?,1,'2026-01-01','2026-01-01')").run(MANAGER_PHONE);
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();
  let rows=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now);
  assert.equal(rows.length,4);assert.equal(rows.filter(r=>r.recipient===EMPLOYEE_PHONE).length,2);assert.ok(rows.every(r=>r.bucket===0));
  f.db.prepare('UPDATE documents SET employee_id=NULL,company_id=?').run(f.company.id);
  rows=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now).filter(r=>r.item_type==='document');
  assert.equal(rows.length,1);assert.equal(rows[0].recipient,MANAGER_PHONE);assert.match(rows[0].text,/بالشركة «شركة اختبار»/);
 }finally{f.close();}
});

test('threshold boundaries, employee isolation, disabled intervals and canonical management precedence',()=>{
 const f=reminderFixture();try{
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1,residency_expiry_date=NULL').run();
  for(const [expiry,bucket] of [['2026-04-02',90],['2026-02-01',30],['2026-01-17',15],['2026-01-09',7],['2026-01-03',1],['2026-01-02',1],['2026-01-01',0]]){
   f.db.prepare('UPDATE documents SET expiry_date=?').run(expiry);
   const rows=selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now);assert.equal(rows.length,1);assert.equal(rows[0].bucket,bucket);assert.equal(rows[0].recipient,EMPLOYEE_PHONE);
  }
  f.db.prepare("INSERT INTO whatsapp_recipients VALUES('overlap','ws_legacy','الإدارة',?,1,'x','x')").run(EMPLOYEE_PHONE);
  assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now)[0].audience,'management');
  f.db.prepare('DELETE FROM whatsapp_recipients').run();f.db.prepare('UPDATE employees SET is_active=0').run();assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now).length,0);
  f.db.prepare("UPDATE employees SET is_active=1,mobile_no='national-only'").run();assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now).length,0);
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'email.notification_intervals',[]);assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' },'romani-fixture',f.clock.now).length,0);
 }finally{f.close();}
});
