import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { addWorkspaceB, asB, B, LEG, today } from './fixtures/workspace-b.mjs';
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
  assert.deepEqual(JSON.parse(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_b' AND key='email.recipients'").get().value), [B_TO]);
  assert.deepEqual(JSON.parse(f.db.prepare("SELECT value FROM workspace_settings WHERE workspace_id='ws_legacy' AND key='email.recipients'").get().value), [LEGACY_TO]);

  const read = await asB(f, '/api/settings');
  assert.equal(JSON.stringify(read.json).includes(LEGACY_TO), false, "B's settings read never shows legacy values");

  const whatsapp = await asB(f, '/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.enabled': false } } });
  assert.equal(whatsapp.status, 400);
  assert.equal(getBoolean(f.db, LEG, 'whatsapp.enabled'), true);
}));
