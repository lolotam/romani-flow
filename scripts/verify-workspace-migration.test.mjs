import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../server/db/migrator.ts';

const migrationsDir = path.resolve('server/db/migrations');
const T = '2026-11-01T00:00:00.000Z';

/** Builds a database exactly as production has it before migration 010. */
function databaseAt009() {
  const staging = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'ws-mig-'));
  for (const file of fs.readdirSync(migrationsDir)) {
    if (file.endsWith('.sql') && Number(file.slice(0, 3)) <= 9) fs.copyFileSync(path.join(migrationsDir, file), path.join(staging, file));
  }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  runMigrations(db, staging);
  fs.rmSync(staging, { recursive: true, force: true });
  return db;
}

function seedEveryTenantTable(db) {
  db.prepare("INSERT INTO admin_users(id,email,name,password_hash,role,created_at,updated_at) VALUES('u1','a@example.invalid','A','x','admin',?,?)").run(T, T);
  db.prepare("INSERT INTO companies(id,name,created_at,updated_at) VALUES('c1','Co',?,?)").run(T, T);
  db.prepare("INSERT INTO ministries(id,name,created_at,updated_at) VALUES('m1','Min',?,?)").run(T, T);
  db.prepare("INSERT INTO document_types(id,name,created_at,updated_at) VALUES('t1','Type',?,?)").run(T, T);
  db.prepare("INSERT INTO positions(id,name,value,created_at,updated_at) VALUES('p1','Pos','pos',?,?)").run(T, T);
  db.prepare("INSERT INTO employees(id,name,company_id,created_at,updated_at) VALUES('e1','Emp','c1',?,?)").run(T, T);
  db.prepare("INSERT INTO documents(id,title,document_type_id,employee_id,created_at,updated_at) VALUES('d1','Doc','t1','e1',?,?)").run(T, T);
  db.prepare("INSERT INTO email_log(id,kind,recipients,status,created_at) VALUES('l1','expiry','x@example.invalid','sent',?)").run(T);
  db.prepare("INSERT INTO expiry_notifications(id,item_type,item_id,expiry_date,interval_days,recipient,notified_at) VALUES('n1','document','d1','2026-12-01',30,'x',?)").run(T);
  db.prepare("INSERT INTO pending_uploads(id,file_name,file_path,file_size,mime_type,created_at) VALUES('pu1','f.pdf','2026/11/f.pdf',1,'application/pdf',?)").run(T);
  db.prepare("INSERT INTO form_defaults(user_id,form_key,source_id,values_json,updated_at) VALUES('u1','employees','e1','{}',?)").run(T);
  db.prepare("INSERT INTO document_drafts(user_id,scope,revision,values_json,updated_at) VALUES('u1','employee:e1','r1','{\"employee_id\":\"e1\"}',?)").run(T);
  db.prepare("INSERT INTO whatsapp_recipients(id,label,phone,enabled,created_at,updated_at) VALUES('r1','Boss','+96550000000',1,?,?)").run(T, T);
  db.prepare(`INSERT INTO whatsapp_jobs(id,instance,item_type,item_id,expiry_date,bucket,recipient,recipient_label,audience,item_name,owner_name,text,next_attempt_at,created_at,updated_at)
    VALUES('j1','inst','document','d1','2026-12-01',30,'+96550000000','Boss','management','Doc','Emp','hi',?,?,?)`).run(T, T, T);
  db.prepare(`INSERT INTO whatsapp_attempts(id,job_id,attempt,recipient,recipient_label,audience,item_name,owner_name,expiry_date,text,state,started_at)
    VALUES('a1','j1',1,'+96550000000','Boss','management','Doc','Emp','2026-12-01','hi','provider_accepted',?)`).run(T);
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('email.recipients','[\"x@example.invalid\"]',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(T);
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('cron.schedule','\"0 8 * * *\"',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(T);
}

const TENANT_TABLES = ['admin_users', 'companies', 'ministries', 'document_types', 'positions', 'employees', 'documents',
  'email_log', 'expiry_notifications', 'pending_uploads', 'form_defaults', 'document_drafts', 'whatsapp_recipients',
  'whatsapp_jobs', 'whatsapp_attempts'];

test('010 moves every existing tenant row into the legacy workspace', () => {
  const db = databaseAt009();
  seedEveryTenantTable(db);
  const result = runMigrations(db, migrationsDir);
  assert.deepEqual(result.applied, ['010_workspaces.sql', '011_clerk_identity.sql']);

  assert.deepEqual({ ...db.prepare("SELECT id, name FROM workspaces").get() }, { id: 'ws_legacy', name: 'Romani' });
  for (const table of TENANT_TABLES) {
    const counts = db.prepare(`SELECT count(*) total, sum(workspace_id = 'ws_legacy') legacy FROM "${table}"`).get();
    assert.ok(counts.total > 0, `${table} should keep its synthetic row`);
    assert.equal(counts.legacy, counts.total, `every ${table} row belongs to ws_legacy`);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('010 moves tenant settings into the legacy workspace and leaves platform settings where they are', () => {
  const db = databaseAt009();
  seedEveryTenantTable(db);
  runMigrations(db, migrationsDir);
  const moved = db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.recipients'").get();
  assert.equal(moved.value, '["x@example.invalid"]');
  assert.equal(db.prepare("SELECT count(*) n FROM settings WHERE key='email.recipients'").get().n, 0, 'no stale platform copy is left behind');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='cron.schedule'").get().value, '"0 8 * * *"');
  assert.equal(db.prepare("SELECT count(*) n FROM workspace_settings WHERE key='cron.schedule'").get().n, 0);
});

test('the server tenant-setting list equals the keys migration 010 moves', async () => {
  const { TENANT_SETTING_KEYS } = await import('../server/repositories/settings.ts');
  const sql = fs.readFileSync(path.join(migrationsDir, '010_workspaces.sql'), 'utf8');
  const lists = [...sql.matchAll(/WHERE key IN \(([^)]*)\)/g)].map(match => [...match[1].matchAll(/'([^']+)'/g)].map(key => key[1]).sort());
  assert.equal(lists.length, 2, 'one list copies the keys, one deletes the platform originals');
  assert.deepEqual(lists[1], lists[0], 'the copy and the delete cover the same keys');
  assert.deepEqual([...TENANT_SETTING_KEYS].sort(), lists[0]);
});

test('a tenant row written without a workspace is refused', () => {
  const db = databaseAt009();
  runMigrations(db, migrationsDir);
  for (const sql of [
    "INSERT INTO companies(id,name,created_at,updated_at) VALUES('c2','Co',?,?)",
    "INSERT INTO documents(id,title,document_type_id,created_at,updated_at) VALUES('d2','Doc','none',?,?)",
  ]) {
    assert.throws(() => db.prepare(sql).run(T, T), /workspace_required/);
  }
  db.prepare("INSERT INTO companies(id,name,workspace_id,created_at,updated_at) VALUES('c3','Co','ws_legacy',?,?)").run(T, T);
  assert.throws(() => db.prepare("UPDATE companies SET workspace_id=NULL WHERE id='c3'").run(), /workspace_required/);
});

test('a recipient phone is unique per workspace, not across workspaces', () => {
  const db = databaseAt009();
  runMigrations(db, migrationsDir);
  db.prepare("INSERT INTO workspaces(id,name,created_at,updated_at) VALUES('ws_b','B',?,?)").run(T, T);
  const add = db.prepare("INSERT INTO whatsapp_recipients(id,workspace_id,label,phone,enabled,created_at,updated_at) VALUES(?,?,'L','+96550000000',1,?,?)");
  add.run('r1', 'ws_legacy', T, T);
  add.run('r2', 'ws_b', T, T);
  assert.throws(() => add.run('r3', 'ws_b', T, T), /UNIQUE/);
});

test('the 006 and 008 deletion triggers still clear defaults and drafts after 010', () => {
  const db = databaseAt009();
  seedEveryTenantTable(db);
  runMigrations(db, migrationsDir);
  db.prepare("DELETE FROM documents WHERE id='d1'").run();
  db.prepare("DELETE FROM employees WHERE id='e1'").run();
  assert.equal(db.prepare("SELECT count(*) n FROM form_defaults WHERE source_id='e1'").get().n, 0);
  assert.equal(db.prepare("SELECT values_json FROM document_drafts WHERE scope='employee:e1'").get().values_json, null);
});


test('011 adds Clerk users and idempotent webhook events without changing workspace links', () => {
  const db = databaseAt009();
  runMigrations(db, migrationsDir);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  assert.deepEqual(userColumns, ['id', 'clerk_user_id', 'email', 'email_verified', 'name', 'deleted_at', 'created_at', 'last_seen_at']);
  assert.deepEqual(db.prepare('PRAGMA table_info(clerk_webhook_events)').all().map(column => column.name), ['id', 'type', 'received_at']);
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('workspaces') WHERE name='clerk_org_id'").get());
  const orgIndexes = db.prepare("SELECT name FROM pragma_index_list('workspaces') WHERE [unique]=1").all();
  assert.ok(orgIndexes.some(index => db.prepare(`SELECT 1 FROM pragma_index_info('${index.name}') WHERE name='clerk_org_id'`).get()));

  const insert = db.prepare("INSERT INTO users(id,clerk_user_id,email,created_at,last_seen_at) VALUES(?,?,?,?,?)");
  insert.run('local-1', 'clerk-1', 'one@example.invalid', T, T);
  assert.throws(() => insert.run('local-2', 'clerk-1', 'two@example.invalid', T, T), /UNIQUE/);
  db.prepare("INSERT INTO clerk_webhook_events(id,type,received_at) VALUES('evt-1','user.created',?)").run(T);
  assert.throws(() => db.prepare("INSERT INTO clerk_webhook_events(id,type,received_at) VALUES('evt-1','user.updated',?)").run(T), /UNIQUE/);

  db.prepare("INSERT INTO form_defaults(workspace_id,user_id,form_key,source_id,values_json,updated_at) VALUES('ws_legacy','local-1','companies','c1','{}',?)").run(T);
  db.prepare("INSERT INTO document_drafts(workspace_id,user_id,scope,revision,values_json,updated_at) VALUES('ws_legacy','local-1','new','r2','{}',?)").run(T);
  db.prepare("INSERT INTO pending_uploads(workspace_id,id,file_name,file_path,file_size,mime_type,created_at,draft_user_id) VALUES('ws_legacy','pu2','f.pdf','ws_legacy/f.pdf',1,'application/pdf',?,'local-1')").run(T);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'legacy ownership rows survive and Clerk ownership ids are accepted');
});


test('011 keys drafts and form defaults by workspace, user and context', () => {
  const db = databaseAt009();
  runMigrations(db, migrationsDir);
  db.prepare("INSERT INTO workspaces(id,name,created_at,updated_at) VALUES('ws_b','B',?,?)").run(T, T);

  for (const [table, context] of [['form_defaults', 'form_key'], ['document_drafts', 'scope']]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    assert.equal(columns.find(column => column.name === 'workspace_id').notnull, 1, `${table}.workspace_id is required`);
    const primaryKey = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    assert.deepEqual(primaryKey, ['workspace_id', 'user_id', context]);
  }

  const defaultInsert = db.prepare("INSERT INTO form_defaults(workspace_id,user_id,form_key,source_id,values_json,updated_at) VALUES(?,'local-1','companies','c1',?,?)");
  defaultInsert.run('ws_legacy', '{"name":"A"}', T);
  defaultInsert.run('ws_b', '{"name":"B"}', T);
  const draftInsert = db.prepare("INSERT INTO document_drafts(workspace_id,user_id,scope,revision,values_json,updated_at) VALUES(?,'local-1','new',?,?,?)");
  draftInsert.run('ws_legacy', 'revision-a', '{"title":"A"}', T);
  draftInsert.run('ws_b', 'revision-b', '{"title":"B"}', T);
  assert.equal(db.prepare("SELECT values_json FROM form_defaults WHERE workspace_id='ws_legacy'").get().values_json, '{"name":"A"}');
  assert.equal(db.prepare("SELECT values_json FROM document_drafts WHERE workspace_id='ws_legacy'").get().values_json, '{"title":"A"}');
});
