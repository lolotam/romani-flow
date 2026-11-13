import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB, asB, B, LEG, today } from './fixtures/workspace-b.mjs';
import { insertRow } from '../server/repositories/base.ts';
import { getBoolean, getString, setSetting } from '../server/repositories/settings.ts';
import { startEmailAttempt } from '../server/services/emailLog.ts';

/**
 * Two workspaces side by side: the legacy one (Romani) and a second tenant B.
 * Every check pairs what B must not see or touch with proof that B's own path works,
 * so a check cannot pass merely because a request did nothing.
 */

const LEGACY_TO = 'legacy@example.invalid', B_TO = 'tenant-b@example.invalid';

/** Makes the legacy fixture's document the only legacy item due today. */
function legacyDueToday(f) {
  f.db.prepare("UPDATE documents SET title='Legacy doc',expiry_date=? WHERE workspace_id='ws_legacy'").run(today());
  f.db.prepare("UPDATE employees SET residency_expiry_date=NULL WHERE workspace_id='ws_legacy'").run();
}

function enableReports(f, scope, to) {
  setSetting(f.db, scope, 'email.enabled', true);
  setSetting(f.db, scope, 'email.recipients', [to]);
  setSetting(f.db, scope, 'email.cc', []);
  setSetting(f.db, scope, 'cron.enabled', true);
}

function withMail(t, run) {
  const calls = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => true,
    sendMail: async message => {
      calls.push(message);
      return { messageId: 'synthetic-' + calls.length, accepted: [...(message.to ?? []), ...(message.cc ?? [])], rejected: [] };
    },
  }));
  return reminderApi(f => run(f, calls), undefined, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'synthetic', SMTP_PASS: randomBytes(24).toString('hex'), SMTP_FROM: 'synthetic@example.invalid',
  });
}

const mailTo = (calls, address) => calls.filter(message => [...(message.to ?? []), ...(message.cc ?? [])].includes(address));

test('one scheduled tick reports each enabled workspace its own items and logs', t => withMail(t, async (f, calls) => {
  addWorkspaceB(f); legacyDueToday(f);
  enableReports(f, LEG, LEGACY_TO); enableReports(f, B, B_TO);

  const result = await f.cron.run();
  assert.equal(result.sent, true, JSON.stringify(result));

  const [legacyMail] = mailTo(calls, LEGACY_TO), [bMail] = mailTo(calls, B_TO);
  assert.equal(mailTo(calls, LEGACY_TO).length, 1); assert.equal(mailTo(calls, B_TO).length, 1);
  assert.ok(legacyMail.text.includes('Legacy doc')); assert.equal(legacyMail.text.includes('Tenant B doc'), false);
  assert.ok(bMail.text.includes('Tenant B doc')); assert.equal(bMail.text.includes('Legacy doc'), false);

  for (const [ws, own, other] of [['ws_legacy', LEGACY_TO, B_TO], ['ws_b', B_TO, LEGACY_TO]]) {
    const rows = f.db.prepare("SELECT recipients FROM email_log WHERE kind='expiry_report' AND workspace_id=?").all(ws);
    assert.ok(rows.length > 0, `${ws} logged its report`);
    for (const row of rows) { assert.ok(row.recipients.includes(own)); assert.equal(row.recipients.includes(other), false); }
  }
  const crossed = f.db.prepare(`SELECT count(*) n FROM expiry_notifications n JOIN documents d ON d.id = n.item_id
    WHERE n.item_type='document' AND n.workspace_id <> d.workspace_id`).get().n;
  assert.equal(crossed, 0, 'every notification is recorded in the workspace of its item');
  assert.ok(getString(f.db, B, 'cron.last_run_at'), 'B records its own run');
}));

test("B's interrupted report blocks only B, never the legacy workspace", t => withMail(t, async (f, calls) => {
  addWorkspaceB(f); legacyDueToday(f);
  enableReports(f, LEG, LEGACY_TO); enableReports(f, B, B_TO);
  // A row without details cannot be attributed, so it blocks every recipient of its workspace.
  const stuck = startEmailAttempt(f.db, B, { kind: 'expiry_report', recipients: [B_TO], subject: 'Interrupted', triggerSource: 'cron' });

  await f.cron.run();

  assert.equal(mailTo(calls, LEGACY_TO).length, 1, 'legacy still receives its report');
  assert.equal(mailTo(calls, B_TO).length, 0, 'B stays blocked by its own uncertain send');
  assert.equal(f.db.prepare('SELECT status FROM email_log WHERE id=?').get(stuck).status, 'unknown');
  assert.equal(f.db.prepare("SELECT count(*) n FROM email_log WHERE workspace_id='ws_legacy' AND status='unknown'").get().n, 0);
}));

test('B enabling its schedule never queues WhatsApp messages and cannot move the platform schedule', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  // The legacy employee is eligible, so only the schedule gate keeps the instance quiet.
  await f.request('/api/employees/' + f.employee.id, { method: 'PATCH', body: { whatsapp_notifications_enabled: true, residency_expiry_date: null } });
  setSetting(f.db, LEG, 'cron.enabled', false);
  const schedule = getString(f.db, { platform: true }, 'cron.schedule', '0 8 * * *');

  const enabled = await asB(f, '/api/cron/schedule', { method: 'PUT', body: { schedule, enabled: true } });
  assert.equal(enabled.status, 200); assert.equal(enabled.json.data.enabled, true);
  const moved = await asB(f, '/api/cron/schedule', { method: 'PUT', body: { schedule: '5 9 * * *', enabled: true } });
  assert.equal(moved.status, 403); assert.equal(moved.json.error.code, 'schedule_platform_managed');
  assert.equal(getString(f.db, { platform: true }, 'cron.schedule', '0 8 * * *'), schedule);

  await f.cron.run();
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n, 0, 'the instance belongs to the legacy workspace, whose schedule is off');
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs WHERE item_id=?').get(b.document.id).n, 0);

  // Control: the same firing selects the legacy reminder once legacy's own schedule is on.
  setSetting(f.db, LEG, 'cron.enabled', true);
  await f.cron.run();
  assert.equal(f.reminders.store.due().length, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_jobs WHERE workspace_id <> 'ws_legacy'").get().n, 0);
}));

test("B's export contains only B's rows, accounts and settings", () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const exported = await asB(f, '/api/backup/export');
  assert.equal(exported.status, 200);
  const { data } = exported.json;
  assert.deepEqual(data.documents.map(row => row.id), [b.document.id]);
  assert.deepEqual(data.employees.map(row => row.id), [b.employee.id]);
  assert.deepEqual(data.admin_users.map(row => row.id), ['admin-b']);
  for (const [table, rows] of Object.entries(data)) {
    if (table === 'settings') continue;
    for (const row of rows) assert.equal(row.workspace_id ?? 'ws_b', 'ws_b', `${table} row ${row.id} leaked into B's export`);
  }
  const ownSettings = f.db.prepare("SELECT count(*) n FROM workspace_settings WHERE workspace_id='ws_b'").get().n;
  assert.equal(data.settings.length, ownSettings);
  assert.equal(data.settings.some(row => row.key === 'cron.schedule'), false, 'platform settings are not exported');
}));

test("B's erase removes B's data and files and leaves the legacy workspace intact", () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const legacyFile = '2026/01/legacy-synthetic.pdf', bFile = '2026/01/tenant-b-synthetic.pdf';
  for (const rel of [legacyFile, bFile]) { fs.mkdirSync(path.dirname(f.storage.resolve(rel)), { recursive: true }); fs.writeFileSync(f.storage.resolve(rel), 'synthetic'); }
  f.db.prepare('UPDATE documents SET file_path=? WHERE id=?').run(legacyFile, f.document.id);
  f.db.prepare('UPDATE documents SET file_path=? WHERE id=?').run(bFile, b.document.id);
  const legacyCounts = () => ['companies', 'employees', 'documents', 'document_types']
    .map(table => f.db.prepare(`SELECT count(*) n FROM "${table}" WHERE workspace_id='ws_legacy'`).get().n);
  const before = legacyCounts();

  const erased = await asB(f, '/api/backup/erase', { method: 'POST', body: {} });
  assert.equal(erased.status, 200, JSON.stringify(erased.json));

  assert.deepEqual(legacyCounts(), before);
  assert.ok(fs.existsSync(f.storage.resolve(legacyFile)), "the legacy file survives B's erase");
  assert.equal(fs.existsSync(f.storage.resolve(bFile)), false, "B's own file is removed");
  assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE workspace_id='ws_b'").get().n, 0);
  assert.equal(getBoolean(f.db, LEG, 'whatsapp.enabled'), true, "B's erase does not switch off legacy reminders");
}));

test('the WhatsApp reminder and pairing routes do not exist for B', () => reminderApi(async f => {
  addWorkspaceB(f);
  for (const url of ['/api/whatsapp/recipients', '/api/whatsapp/log', '/api/whatsapp/status', '/api/whatsapp/template-preview']) {
    const response = await asB(f, url);
    assert.equal(response.status, 404, url); assert.equal(response.json.error.code, 'whatsapp_unavailable', url);
  }
  assert.equal((await asB(f, '/api/whatsapp/recipients', { method: 'POST', body: { label: 'B', phone: '+99900000098' } })).status, 404);
  assert.equal(f.db.prepare("SELECT count(*) n FROM whatsapp_recipients WHERE workspace_id='ws_b'").get().n, 0);
  assert.equal((await f.request('/api/whatsapp/recipients')).status, 200, 'legacy keeps its reminder routes');
}));

test("B saves its own settings without touching legacy's, and cannot set WhatsApp keys", () => reminderApi(async f => {
  addWorkspaceB(f);
  setSetting(f.db, LEG, 'email.recipients', [LEGACY_TO]);
  const schedule = getString(f.db, { platform: true }, 'cron.schedule', '0 8 * * *');

  const saved = await asB(f, '/api/settings', { method: 'PUT', body: { settings: { 'email.recipients': [B_TO], 'cron.schedule': schedule } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const savedWithoutSchedule = await asB(f, '/api/settings', { method: 'PUT', body: { settings: { 'email.from_name': 'Tenant B' } } });
  assert.equal(savedWithoutSchedule.status, 200, JSON.stringify(savedWithoutSchedule.json));
  assert.equal(JSON.parse(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_b' AND key='email.from_name'").get().value), 'Tenant B');
  assert.deepEqual(JSON.parse(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_b' AND key='email.recipients'").get().value), [B_TO]);
  assert.deepEqual(JSON.parse(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.recipients'").get().value), [LEGACY_TO]);

  const read = await asB(f, '/api/settings');
  assert.equal(JSON.stringify(read.json).includes(LEGACY_TO), false, "B's settings read never shows legacy values");

  const whatsapp = await asB(f, '/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.enabled': false } } });
  assert.equal(whatsapp.status, 400);
  assert.equal(getBoolean(f.db, LEG, 'whatsapp.enabled'), true);
}));

test('the settings and the mail log are read by an owner alone', () => reminderApi(async f => {
  f.db.prepare("INSERT INTO admin_users(workspace_id,id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_legacy','editor','editor@example.invalid','Synthetic','editor','not-a-login-fixture','2026-01-01','2026-01-01')").run();

  for (const role of ['viewer', 'editor']) {
    for (const url of ['/api/settings', '/api/email/status', '/api/email/log', '/api/email/expiry-preview']) {
      const refused = await f.request(url, { role, user: role });
      assert.equal(refused.status, 403, `${role} ${url} answered ${refused.status}`);
      assert.equal(refused.json.error.code, 'forbidden', `${role} ${url}`);
    }
  }

  const settings = await f.request('/api/settings');
  assert.equal(settings.status, 200, JSON.stringify(settings.json));
  const status = await f.request('/api/email/status');
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(typeof status.json.data.configured, 'boolean', 'the status publishes whether mail is configured');
  for (const field of ['host', 'port', 'user']) {
    assert.equal(field in status.json.data, false, `the mail status no longer publishes the ${field}`);
  }
}));

test('a suspended workspace sends no report and queues no WhatsApp message', t => withMail(t, async (f, calls) => {
  legacyDueToday(f);
  enableReports(f, LEG, LEGACY_TO);
  await f.request(`/api/employees/${f.employee.id}`, { method: 'PATCH', body: { whatsapp_notifications_enabled: true, residency_expiry_date: null } });
  f.db.prepare("UPDATE workspaces SET suspended_at=? WHERE id='ws_legacy'").run(new Date().toISOString());

  // The scheduled tick leaves the suspended workspace alone.
  await f.cron.run();
  assert.equal(mailTo(calls, LEGACY_TO).length, 0, 'no report leaves a suspended workspace');
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n, 0, 'no message is queued for a suspended workspace');

  // A manual report of that workspace is refused as well.
  const manual = await f.cron.run('manual', LEG);
  assert.equal(manual.sent, false, JSON.stringify(manual));
  assert.equal(manual.skipped, 'workspace_suspended');
  assert.equal(mailTo(calls, LEGACY_TO).length, 0, 'the manual report of a suspended workspace sends nothing');
}));

test('a message that was queued before the suspension is not delivered', () => reminderApi(async f => {
  await f.request(`/api/employees/${f.employee.id}`, { method: 'PATCH', body: { whatsapp_notifications_enabled: true, residency_expiry_date: null } });
  assert.equal(await f.reminders.schedule(), 1, 'the message is queued while the workspace is live');
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n, 1);

  f.db.prepare("UPDATE workspaces SET suspended_at=? WHERE id='ws_legacy'").run(new Date().toISOString());
  assert.equal(await f.reminders.drain(), 0, 'a suspended workspace delivers nothing');
  assert.equal(f.calls.length, 0, 'no message reached the provider');
  assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_jobs').get().n, 1, 'the queued message waits for the suspension to end');
}));

test('a client cannot point a document at a stored file', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const bFile = '2026/01/tenant-b-file.pdf';
  fs.mkdirSync(path.dirname(f.storage.resolve(bFile)), { recursive: true });
  fs.writeFileSync(f.storage.resolve(bFile), '%PDF-1.4 synthetic');
  f.db.prepare('UPDATE documents SET file_path=?,file_name=?,mime_type=? WHERE id=?')
    .run(bFile, 'tenant-b-file.pdf', 'application/pdf', b.document.id);

  // The route refuses the storage columns outright.
  const refused = await asB(f, '/api/documents', {
    method: 'POST', body: { title: 'Forged path', employee_id: b.employee.id, document_type_id: b.type.id, file_path: bFile },
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, 'managed_field');

  // The service drops them as well, so no caller can hand a document a path.
  const row = await f.documents.createDocument(B, {
    title: 'Forged by the service', employee_id: b.employee.id, document_type_id: b.type.id,
    file_path: bFile, file_name: 'tenant-b-file.pdf', file_size: 10, mime_type: 'application/pdf',
  }, () => 'valid');
  assert.equal(row.file_path, null);
  assert.equal(row.file_name, null);
  assert.equal(f.db.prepare('SELECT file_path FROM documents WHERE id=?').get(row.id).file_path, null);
}));

test('a client cannot retarget a document file on update', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const ownPath = '2026/01/tenant-b-own.pdf';
  const foreignPath = '2026/01/tenant-b-foreign.pdf';
  f.db.prepare('UPDATE documents SET file_path=?,file_name=?,mime_type=? WHERE id=?')
    .run(ownPath, 'own.pdf', 'application/pdf', b.document.id);

  const refused = await asB(f, `/api/documents/${b.document.id}`, {
    method: 'PATCH', body: { title: 'Retarget', file_path: foreignPath },
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, 'managed_field');
  assert.equal(f.db.prepare('SELECT file_path,title FROM documents WHERE id=?').get(b.document.id).file_path, ownPath);

  const row = await f.documents.updateDocument(B, b.document.id, {
    title: 'Service retarget', file_path: foreignPath, file_name: 'foreign.pdf', file_size: 10, mime_type: 'application/pdf',
  }, () => 'valid');
  assert.equal(row.title, 'Service retarget');
  assert.equal(row.file_path, ownPath);
  assert.equal(f.db.prepare('SELECT file_path FROM documents WHERE id=?').get(b.document.id).file_path, ownPath);
}));

test('the ministry sentinel is accepted and never points at another ministry', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const bMinistries = f.db.prepare("SELECT id FROM ministries WHERE workspace_id='ws_b'").all();

  // A custom ministry of the caller's own workspace.
  const created = await asB(f, '/api/documents', {
    method: 'POST', body: { title: 'Custom ministry', employee_id: b.employee.id, document_type_id: b.type.id, ministry_id: 'other', entity_name: 'Custom B' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const createdDocument = created.json.data[0];
  const ministry = f.db.prepare("SELECT id FROM ministries WHERE workspace_id='ws_b' AND name='Custom B'").get();
  assert.ok(ministry, 'the custom ministry belongs to the caller');
  assert.equal(f.db.prepare('SELECT ministry_id FROM documents WHERE id=?').get(createdDocument.id).ministry_id, ministry.id);

  // The sentinel without a name names no ministry at all.
  const nameless = await asB(f, '/api/documents', {
    method: 'POST', body: { title: 'Nameless', employee_id: b.employee.id, document_type_id: b.type.id, ministry_id: 'other' },
  });
  assert.equal(nameless.status, 400, JSON.stringify(nameless.json));
  assert.equal(nameless.json.error.code, 'invalid_entity');

  // The sentinel is never resolved to the ministry of another workspace.
  for (const row of bMinistries) {
    assert.notEqual(createdDocument.ministry_id, row.id, 'the sentinel never points at another ministry');
  }
}));

test('ministry other is accepted on update and another workspace ministry is rejected', () => reminderApi(async f => {
  const b = addWorkspaceB(f);
  const legacyMinistry = insertRow(f.db, LEG, 'ministries', { name: 'Legacy only', name_ar: 'تراث' });

  const updated = await asB(f, `/api/documents/${b.document.id}`, {
    method: 'PATCH', body: { ministry_id: 'other', entity_name: 'Updated custom' },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  const custom = f.db.prepare("SELECT id FROM ministries WHERE workspace_id='ws_b' AND name='Updated custom'").get();
  assert.ok(custom, 'the custom ministry belongs to the caller');
  assert.equal(f.db.prepare('SELECT ministry_id FROM documents WHERE id=?').get(b.document.id).ministry_id, custom.id);

  const foreignCreate = await asB(f, '/api/documents', {
    method: 'POST', body: { title: 'Foreign ministry', employee_id: b.employee.id, document_type_id: b.type.id, ministry_id: legacyMinistry.id },
  });
  assert.equal(foreignCreate.status, 404, JSON.stringify(foreignCreate.json));
  assert.equal(foreignCreate.json.error.code, 'not_found');
  assert.equal(f.db.prepare("SELECT count(*) n FROM documents WHERE title='Foreign ministry'").get().n, 0);

  const foreignUpdate = await asB(f, `/api/documents/${b.document.id}`, {
    method: 'PATCH', body: { ministry_id: legacyMinistry.id },
  });
  assert.equal(foreignUpdate.status, 404, JSON.stringify(foreignUpdate.json));
  assert.equal(foreignUpdate.json.error.code, 'not_found');
  assert.equal(f.db.prepare('SELECT ministry_id FROM documents WHERE id=?').get(b.document.id).ministry_id, custom.id);
}));
