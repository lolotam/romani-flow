import {seedDatabase, writeSeedMarker} from '../server/db/seed.ts';
import {applyOwnerCatalogs} from '../server/db/ownerCatalogs.ts';
﻿import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { runMigrations } from '../server/db/migrator.ts';
import { insertRow } from '../server/repositories/base.ts';
import { signSession } from '../server/middleware/auth.ts';
import { StorageService } from '../server/services/storageService.ts';
import { DocumentService } from '../server/services/documentService.ts';
import { Mailer } from '../server/services/mailer.ts';
import { CronService } from '../server/services/cronService.ts';
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'romani-defaults-'));
const config=loadConfig({NODE_ENV:'test',JWT_SECRET:randomBytes(32).toString('hex')});
const accounts=['actor-a','actor-b'].map((id,i)=>({id,email:`actor${i}@example.invalid`,name:'Test admin',role:'admin'}));
let base,server;
before(async()=>{
 runMigrations(db,path.resolve('server/db/migrations'));writeSeedMarker(db);applyOwnerCatalogs(db);
 for(const user of accounts)db.prepare('INSERT INTO admin_users (workspace_id, id,email,name,role,password_hash,created_at,updated_at) VALUES (\'ws_legacy\', ?,?,?,?,?,?,?)').run(user.id,user.email,user.name,user.role,'unused-fixture-hash','2026-01-01','2026-01-01');
 const storage=new StorageService(dir);storage.ensureDirectories();const mailer=new Mailer(config);const cron=new CronService(db,mailer);const documents=new DocumentService(db,storage);
 server=createApp({config,db,mailer,cron,storage,documents,staticDir:dir}).listen(0,'127.0.0.1');
 await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
async function call(url,{actor=0,body,method='GET',anonymous=false}={}){
 const res=await fetch(base+url,{method,headers:{'content-type':'application/json',...(anonymous?{}:{cookie:`${config.cookieName}=${signSession(config,accounts[actor])}`})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,payload:await res.json(),headers:res.headers};
}
test('catalogs include bilingual owner entries and preserve existing records on reapply',()=>{
 assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n,2);
 assert.equal(db.prepare('SELECT count(*) n FROM ministries').get().n,4);
 assert.equal(db.prepare('SELECT count(*) n FROM positions').get().n,10);
 const company=db.prepare('SELECT id FROM companies LIMIT 1').get();db.prepare('UPDATE companies SET description=? WHERE id=?').run('Owner edit',company.id);
 applyOwnerCatalogs(db);
 assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n,2);
 assert.equal(db.prepare('SELECT description FROM companies WHERE id=?').get(company.id).description,'Owner edit');
});
test('defaults require authentication, isolate accounts and reject arbitrary form names',async()=>{
 assert.equal((await call('/api/form-defaults/employees',{anonymous:true})).status,401);
 assert.equal((await call('/api/form-defaults/admin_users')).status,400);
 const r=await call('/api/form-defaults/employees');assert.deepEqual(r.payload.data,{});assert.equal(r.headers.get('cache-control'),'no-store');
});
test('only the latest successful creation is remembered; failures and edits leave it intact',async()=>{
 const company=db.prepare('SELECT id FROM companies LIMIT 1').get().id;
 const created=await call('/api/employees',{method:'POST',body:{name:'First fixture',company_id:company,driving_license:true}});assert.equal(created.status,201);
 let saved=(await call('/api/form-defaults/employees')).payload.data;assert.equal(saved.name,'First fixture');assert.equal(saved.driving_license,true);assert.equal('id' in saved,false);assert.equal('created_at' in saved,false);
 assert.deepEqual((await call('/api/form-defaults/employees',{actor:1})).payload.data,{});
 await call('/api/employees/'+created.payload.data[0].id,{method:'PATCH',body:{name:'Edited fixture'}});
 const bad=await call('/api/employees',{method:'POST',body:{name:'Rejected fixture',company_id:'nonexistent'}});assert.notEqual(bad.status,201);
 assert.equal((await call('/api/form-defaults/employees')).payload.data.name,'First fixture');
 assert.equal((await call('/api/employees',{method:'POST',body:{name:'Latest fixture',company_id:company}})).status,201);
 saved=(await call('/api/form-defaults/employees')).payload.data;assert.equal(saved.name,'Latest fixture');
 assert.equal(db.prepare('SELECT count(*) n FROM form_defaults WHERE user_id=? AND form_key=?').get(accounts[0].id,'employees').n,1);
});
test('document defaults omit files and dates, including legacy values, without changing stored documents',async()=>{
 const type=insertRow(db, { workspaceId: 'ws_legacy' }, 'document_types',{name:'Fixture type',name_ar:'نوع اختباري'});
 const created=await call('/api/documents',{method:'POST',body:{title:'Fixture document',document_type_id:type.id,issue_date:'2029-01-01',expiry_date:'2030-01-01'}});assert.equal(created.status,201);
 const before=(await call('/api/form-defaults/documents')).payload.data;assert.equal(before.title,'Fixture document');
 for(const k of ['file_name','file_path','file_size','mime_type','upload_id','id','status','issue_date','expiry_date'])assert.equal(k in before,false);
 assert.equal(created.payload.data[0].expiry_date,'2030-01-01');
 assert.equal(created.payload.data[0].issue_date,'2029-01-01');
 db.prepare("UPDATE form_defaults SET values_json=? WHERE user_id=? AND form_key='documents'")
  .run(JSON.stringify({...before,issue_date:'2029-01-01',expiry_date:'2030-01-01'}),accounts[0].id);
 assert.deepEqual((await call('/api/form-defaults/documents')).payload.data,before);
 const bad=await call('/api/documents',{method:'POST',body:{title:'Rejected document',document_type_id:type.id,upload_id:'missing'}});assert.notEqual(bad.status,201);
 assert.deepEqual((await call('/api/form-defaults/documents')).payload.data,before);
 assert.throws(()=>db.prepare('DELETE FROM document_types WHERE id=?').run(type.id));
});
test('catalog setup preserves a previously imported owner row',()=>{
 const other=new DatabaseSync(':memory:');try{
 runMigrations(other,path.resolve('server/db/migrations'));
 writeSeedMarker(other);
 const old=insertRow(other, { workspaceId: 'ws_legacy' }, 'companies',{name:'curemed',name_ar:'Existing owner label',description:'Keep this description'});
 applyOwnerCatalogs(other);
 assert.equal(other.prepare('SELECT count(*) n FROM companies').get().n,2);
 assert.equal(other.prepare('SELECT name_ar FROM companies WHERE id=?').get(old.id).name_ar,'Existing owner label');
 assert.equal(other.prepare('SELECT description FROM companies WHERE id=?').get(old.id).description,'Keep this description');
 }finally{other.close();}
});
test('a defaults storage failure rolls back the creation itself',async()=>{
 const company=db.prepare('SELECT id FROM companies LIMIT 1').get().id;
 const before=db.prepare('SELECT count(*) n FROM employees').get().n;
 db.exec("CREATE TRIGGER fixture_reject_default BEFORE INSERT ON form_defaults WHEN json_extract(NEW.values_json,'$.name')='Atomic fixture' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END;");
 try{
 const r=await call('/api/employees',{method:'POST',body:{name:'Atomic fixture',company_id:company}});assert.notEqual(r.status,201);
 assert.equal(db.prepare('SELECT count(*) n FROM employees').get().n,before);
 assert.equal((await call('/api/form-defaults/employees')).payload.data.name,'Latest fixture');
 }finally{db.exec('DROP TRIGGER fixture_reject_default');}
});
test('deleted catalog references are not restored into a new document form',async()=>{
 const ministry=insertRow(db, { workspaceId: 'ws_legacy' }, 'ministries',{name:'Temporary fixture ministry',name_ar:'Temporary fixture'});
 const type=db.prepare('SELECT id FROM document_types LIMIT 1').get().id;
 assert.equal((await call('/api/documents',{method:'POST',body:{title:'Reference fixture',document_type_id:type,ministry_id:ministry.id}})).status,201);
 db.prepare('DELETE FROM ministries WHERE id=?').run(ministry.id);
 const defaults=(await call('/api/form-defaults/documents')).payload.data;
 assert.equal('ministry_id' in defaults,false);assert.equal(defaults.title,'Reference fixture');
});
test('a custom ministry choice is remembered for the next document form',async()=>{
 const type=db.prepare('SELECT id FROM document_types LIMIT 1').get().id;
 assert.equal((await call('/api/documents',{method:'POST',body:{title:'Custom ministry fixture',document_type_id:type,ministry_id:'other',entity_name:'Fixture custom ministry'}})).status,201);
 // The sentinel is resolved to a real ministry before the defaults are stored, so the choice survives.
 const custom=db.prepare("SELECT id FROM ministries WHERE name_ar='Fixture custom ministry'").get();
 assert.equal((await call('/api/form-defaults/documents')).payload.data.ministry_id,custom.id);
});
test('all catalog add request objects are accepted and remembered',async()=>{
 const payloads={companies:{name:'Fixture company',name_ar:'Fixture company AR'},ministries:{name:'Fixture ministry',name_ar:'Fixture ministry AR'},positions:{name:'Fixture position',name_ar:'Fixture position AR',value:'fixture-position'},document_types:{name:'Fixture document type',name_ar:'Fixture document type AR'}};
 for(const [table,body] of Object.entries(payloads)){
  const result=await call('/api/'+(table==='document_types'?'document-types':table),{method:'POST',body});assert.equal(result.status,201,table);
  assert.equal((await call('/api/form-defaults/'+table)).payload.data.name,body.name);
 }
});
test('renamed or removed positions are cleared from employee defaults',async()=>{
 const company=db.prepare('SELECT id FROM companies LIMIT 1').get().id;
 const position=db.prepare('SELECT id,value FROM positions LIMIT 1').get();
 const result=await call('/api/employees',{method:'POST',body:{name:'Position fixture',company_id:company,position:position.value}});assert.equal(result.status,201);
 db.prepare('UPDATE positions SET value=? WHERE id=?').run('renamed-fixture-value',position.id);
 assert.equal('position' in (await call('/api/form-defaults/employees')).payload.data,false);
 db.prepare('UPDATE positions SET value=? WHERE id=?').run(position.value,position.id);
});
test('deleting an employee removes retained identity data as well as the record',async()=>{
 const company=db.prepare('SELECT id FROM companies LIMIT 1').get().id;
 const result=await call('/api/employees',{actor:1,method:'POST',body:{name:'Retention fixture',company_id:company,civil_id_no:'fixture-id-not-real',email:'fixture@example.invalid'}});assert.equal(result.status,201);
 assert.equal((await call('/api/form-defaults/employees',{actor:1})).payload.data.civil_id_no,'fixture-id-not-real');
 assert.equal((await call('/api/employees/'+result.payload.data[0].id,{actor:1,method:'DELETE'})).status,200);
 assert.deepEqual((await call('/api/form-defaults/employees',{actor:1})).payload.data,{});
 assert.equal(db.prepare('SELECT count(*) n FROM form_defaults WHERE user_id=? AND form_key=?').get(accounts[1].id,'employees').n,0);
});
test('a missing optional seed stays importable after a later restart',async()=>{
 const other=new DatabaseSync(':memory:');const file=path.join(dir,'late-synthetic-seed.json');
 try{
 runMigrations(other,path.resolve('server/db/migrations'));
 const missing=await seedDatabase(other,{seedFile:file,adminEmails:[],adminPassword:null});assert.equal(missing.seedApplied,false);
 applyOwnerCatalogs(other);assert.equal(other.prepare('SELECT count(*) n FROM companies').get().n,0);
 fs.writeFileSync(file,JSON.stringify({companies:[{id:'late-seed-fixture',name:'Imported fixture',name_ar:'Imported fixture AR'}]}));
 const imported=await seedDatabase(other,{seedFile:file,adminEmails:[],adminPassword:null});assert.equal(imported.seedApplied,true);
 applyOwnerCatalogs(other);assert.equal(other.prepare('SELECT count(*) n FROM companies').get().n,3);
 }finally{other.close();}
});
