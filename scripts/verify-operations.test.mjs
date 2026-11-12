import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { runMigrations } from '../server/db/migrator.ts';
import { hashPassword } from '../server/repositories/adminUsers.ts';
import { insertRow } from '../server/repositories/base.ts';
import { setSetting } from '../server/repositories/settings.ts';
import { StorageService } from '../server/services/storageService.ts';
import { DocumentService } from '../server/services/documentService.ts';
import { CronService } from '../server/services/cronService.ts';

// Loopback-only synthetic fixture. No .env, external SMTP or production database.
async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-operations-'));
  const db = new DatabaseSync(path.join(dir, 'romani.db'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL');
  runMigrations(db, path.resolve('server/db/migrations'));
  const reminderType = insertRow(db, { workspaceId: 'ws_legacy' }, 'document_types', { name: 'Reminder fixture', name_ar: 'Fixture' });
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex') });
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  for (const role of ['admin', 'viewer']) db.prepare(`INSERT INTO admin_users
    (workspace_id, id,email,name,role,password_hash,created_at,updated_at) VALUES('ws_legacy', ?,?,?,?,?,?,?)`)
    .run(role, `${role}@example.invalid`, 'Isolated fixture', role, passwordHash, '2026-01-01', '2026-01-01');
  const deliveries = [];
  let mode = 'sent';
  let verifyOk = true;
  const mailer = { isConfigured: () => true, verify: async () => ({ ok: verifyOk, message: 'Synthetic verification result' }),
    send: async message => {
      deliveries.push(message);
      if (mode === 'failed') throw new Error('Synthetic relay failure');
      return { status: mode, messageId: 'fixture-message',
        accepted: mode === 'partial' ? [] : message.to, rejected: mode === 'partial' ? message.to : [] };
    } };
  const storage = new StorageService(path.join(dir, 'uploads')); storage.ensureDirectories();
  const documents = new DocumentService(db, storage);
  const cron = new CronService(db, mailer);
  const server = createApp({ config, db, mailer, cron, storage, documents, staticDir: dir }).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, { method = 'GET', body, cookie = '' } = {}) {
    const multipart = body instanceof FormData;
    const res = await fetch(base + url, { method, headers: { cookie, ...(!multipart && body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, bytes,
      json: res.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : null };
  }
  async function login(role = 'admin') {
    const result = await request('/api/auth/login', { method: 'POST', body: { email: `${role}@example.invalid`, password } });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /HttpOnly/i);
    return result.headers.get('set-cookie').split(';')[0];
  }
  try { await run({ db, dir, request, login, cron, config, password, mailer, deliveries, reminderType,
    setMode: value => { mode = value; }, setVerify: value => { verifyOk = value; } }); }
  finally { cron.stop(); await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('real login, PDF upload/save/retrieve/edit, private defaults and logout journey', () => fixture(async ({ db, request, login }) => {
  assert.equal((await request('/api/documents')).status, 401);
  const cookie = await login();
  assert.equal((await request('/api/auth/me', { cookie })).status, 200);
  const company = insertRow(db, { workspaceId: 'ws_legacy' }, 'companies', { name: 'Fixture company', name_ar: 'Fixture' });
  const type = insertRow(db, { workspaceId: 'ws_legacy' }, 'document_types', { name: 'Fixture type', name_ar: 'Fixture' });
  const employee = insertRow(db, { workspaceId: 'ws_legacy' }, 'employees', { name: 'Fixture employee', company_id: company.id });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
  const form = new FormData(); form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'fixture.pdf');
  const upload = await request('/api/files/upload', { method: 'POST', body: form, cookie });
  assert.equal(upload.status, 201);
  const saved = await request('/api/documents', { method: 'POST', cookie, body: {
    title: 'Isolated document', employee_id: employee.id, document_type_id: type.id,
    expiry_date: '2030-01-01', upload_id: upload.json.data[0].upload_id } });
  assert.equal(saved.status, 201);
  const id = saved.json.data[0].id;
  const download = await request(`/api/files/${id}/download`, { cookie });
  assert.equal(download.status, 200); assert.deepEqual(download.bytes, pdf);
  assert.equal((await request(`/api/documents/${id}`, { method: 'PATCH', cookie, body: { title: 'Updated title' } })).status, 200);
  assert.equal((await request(`/api/documents/${id}`, { cookie })).json.data.title, 'Updated title');
  const defaults = (await request('/api/form-defaults/documents', { cookie })).json.data;
  assert.equal(defaults.title, 'Isolated document'); assert.equal('file_path' in defaults, false);
  const viewerCookie = await login('viewer');
  assert.deepEqual((await request('/api/form-defaults/documents', { cookie: viewerCookie })).json.data, {});
  const exportResult = await request('/api/backup/export', { cookie });
  assert.equal(exportResult.status, 200);
  assert.equal(JSON.stringify(exportResult.json).includes('password_hash'), false);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie })).json.data.loggedOut, true);
  db.prepare('UPDATE admin_users SET is_active=0 WHERE id=?').run('admin');
  assert.equal((await request('/api/documents', { cookie })).status, 401);
}));

test('viewer cannot mutate operational schedule, file links or trigger mail', () => fixture(async ({ request, login, db, deliveries }) => {
  const cookie = await login('viewer');
  const changesBefore = db.prepare('SELECT total_changes() n').get().n;
  for (const [url, method, body] of [
    ['/api/cron/schedule', 'PUT', { schedule: '0 8 * * *' }],
    ['/api/documents/nonexistent/file', 'PUT', { upload_id: 'missing' }],
    ['/api/documents/nonexistent/file', 'DELETE'],
    ['/api/email/expiry-report', 'POST'],
    ['/api/files/upload', 'POST'],
    ['/api/documents', 'POST', { title: 'Denied' }],
    ['/api/backup/export', 'GET'],
  ]) assert.equal((await request(url, { method, body, cookie })).status, 403, `${method} ${url}`);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changesBefore);
  assert.equal(deliveries.length, 0);
}));

test('invalid operational schedules are rejected without storing a disabled job', () => fixture(async ({ request, login, db }) => {
  const cookie = await login();
  const changesBefore = db.prepare('SELECT total_changes() n').get().n;
  const response = await request('/api/cron/schedule', { method: 'PUT', cookie, body: { schedule: '99 99 * * *' } });
  assert.equal(response.status, 400);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changesBefore);
}));

test('SMTP test records partial outcome rather than claiming delivery', () => fixture(async ({ request, login, db, setMode }) => {
  const cookie = await login(); setMode('partial');
  const r = await request('/api/email/test', { method: 'POST', cookie, body: { to: ['test@example.invalid'] } });
  assert.equal(r.json.data.sent, false);
  assert.equal(db.prepare('SELECT status FROM email_log').get().status, 'partial');
}));

test('SMTP verification failure is durable and never reaches send', () => fixture(async ({ request, login, db, deliveries, setVerify }) => {
  const cookie = await login(); setVerify(false);
  const r = await request('/api/email/test', { method: 'POST', cookie, body: { to: ['test@example.invalid'] } });
  assert.equal(r.status, 502); assert.equal(deliveries.length, 0);
  assert.equal(db.prepare('SELECT status FROM email_log').get().status, 'failed');
}));

test('actual scheduler fires, records success, deduplicates and reports a future run', () => fixture(async ({ db, cron, deliveries, reminderType }) => {
  setSetting(db, { workspaceId: 'ws_legacy' }, 'email.enabled', true); setSetting(db, { workspaceId: 'ws_legacy' }, 'email.recipients', ['test@example.invalid']);
  setSetting(db, { workspaceId: 'ws_legacy' }, 'email.notification_intervals', ['1']); setSetting(db, { workspaceId: 'ws_legacy' }, 'cron.enabled', true);
  setSetting(db, { platform: true }, 'cron.schedule', '* * * * * *'); // accelerated local engine proof only
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  insertRow(db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Due fixture', document_type_id: reminderType.id, expiry_date: tomorrow.toISOString().slice(0, 10) });
  cron.reschedule(); const state = cron.status({ workspaceId: 'ws_legacy' }); assert.ok(new Date(state.nextRun).getTime() > Date.now());
  const deadline = Date.now() + 4000;
  while (deliveries.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert.equal(deliveries.length, 1);
  assert.equal((await cron.run()).skipped, 'already_run_today');
  assert.equal(deliveries.length, 1);
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind='expiry_report'").get().status, 'sent');
  assert.ok(new Date(cron.status({ workspaceId: 'ws_legacy' }).nextRun).getTime() > Date.now());
}));

test('failed reminders remain retryable with durable failure evidence', () => fixture(async ({ db, cron, setMode, deliveries, reminderType }) => {
  setSetting(db, { workspaceId: 'ws_legacy' }, 'email.enabled', true); setSetting(db, { workspaceId: 'ws_legacy' }, 'email.recipients', ['test@example.invalid']);
  setSetting(db, { workspaceId: 'ws_legacy' }, 'email.notification_intervals', ['1']);
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  insertRow(db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Retry fixture', document_type_id: reminderType.id, expiry_date: tomorrow.toISOString().slice(0, 10) });
  setMode('failed'); assert.equal((await cron.run()).sent, false);
  assert.equal(db.prepare('SELECT count(*) n FROM expiry_notifications').get().n, 0);
  setMode('sent'); assert.equal((await cron.run()).sent, true);
  assert.equal(deliveries.length, 2);
}));

test('consistent backup restores real login and attachment bytes in a separate application', () => fixture(async ({ db, dir, request, login, config, password, mailer, reminderType }) => {
  const cookie = await login();
  const pdf = Buffer.from('%PDF-1.4\nIsolated recovery fixture\n%%EOF');
  const multipart = new FormData(); multipart.append('files', new Blob([pdf], { type: 'application/pdf' }), 'restore.pdf');
  const uploaded = await request('/api/files/upload', { method: 'POST', cookie, body: multipart });
  const saved = await request('/api/documents', { method: 'POST', cookie, body: {
    title: 'Recovery fixture', document_type_id: reminderType.id, upload_id: uploaded.json.data[0].upload_id, expiry_date: '2030-01-01' } });
  assert.equal(saved.status, 201);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-recovery-proof-'));
  const recovery = path.resolve('scripts/recovery.py');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const run = args => JSON.parse(execFileSync(python, [recovery, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  let restoredDb, restoredServer, restoredCron;
  try {
    const backup = path.join(root, 'backup'), target = path.join(root, 'restored');
    assert.equal(run(['backup', '--data-dir', dir, '--output', backup]).verified, true);
    assert.equal(run(['restore', '--backup', backup, '--target', target]).restored, true);
    assert.throws(() => run(['restore', '--backup', backup, '--target', dir]));
    restoredDb = new DatabaseSync(path.join(target, 'romani.db'));
    restoredDb.exec('PRAGMA foreign_keys=ON');
    const storage = new StorageService(path.join(target, 'uploads'));
    const documents = new DocumentService(restoredDb, storage);
    restoredCron = new CronService(restoredDb, mailer);
    restoredServer = createApp({ config, db: restoredDb, mailer, cron: restoredCron, storage, documents, staticDir: target }).listen(0, '127.0.0.1');
    await new Promise(r => restoredServer.on('listening', r));
    const base = `http://127.0.0.1:${restoredServer.address().port}`;
    const auth = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.invalid', password }) });
    assert.equal(auth.status, 200);
    const response = await fetch(base + `/api/files/${saved.json.data[0].id}/download`, { headers: { cookie: auth.headers.get('set-cookie').split(';')[0] } });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    // Existing supported split mounts/DB_PATH overrides must produce a usable set too.
    const customDb = path.join(root, 'custom.sqlite');
    db.prepare('VACUUM INTO ?').run(customDb);
    const splitUploads = path.join(root, 'split-uploads');
    fs.cpSync(path.join(dir, 'uploads'), splitUploads, { recursive: true });
    const splitBackup = path.join(root, 'split-backup'), splitRestore = path.join(root, 'split-restored');
    // No default source exists: ignoring either explicit root must make this fail.
    const emptyData = path.join(root, 'empty-default-data'); fs.mkdirSync(emptyData);
    assert.equal(fs.existsSync(path.join(emptyData, 'romani.db')), false);
    assert.equal(fs.existsSync(path.join(emptyData, 'uploads')), false);
    assert.equal(run(['backup', '--data-dir', emptyData, '--db', customDb, '--uploads-dir', splitUploads,
      '--output', splitBackup]).verified, true);
    assert.equal(run(['restore', '--backup', splitBackup, '--target', splitRestore]).restored, true);
    const splitDb = new DatabaseSync(path.join(splitRestore, 'romani.db'), { readOnly: true });
    try {
      const file = splitDb.prepare('SELECT file_path FROM documents WHERE id=?').get(saved.json.data[0].id).file_path;
      assert.deepEqual(fs.readFileSync(path.join(splitRestore, 'uploads', file)), pdf);
    } finally { splitDb.close(); }
    fs.appendFileSync(path.join(backup, 'romani.db'), 'tampered');
    assert.throws(() => run(['verify', '--backup', backup]));
  } finally {
    restoredCron?.stop();
    if (restoredServer) await new Promise(r => restoredServer.close(r));
    restoredDb?.close(); fs.rmSync(root, { recursive: true, force: true });
  }
}));
