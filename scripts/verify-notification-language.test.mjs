import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { MANAGER_PHONE } from './fixtures/whatsapp.mjs';
import { selectReminders } from '../server/notifications/whatsapp/selection.ts';
import { sendExpiryReport } from '../server/services/expiryService.ts';
import { insertRow } from '../server/repositories/base.ts';
import { setSetting } from '../server/repositories/settings.ts';
import { signSession } from '../server/middleware/auth.ts';

test('company reminders select the stored name matching the channel language with Arabic fallback', () => reminderApi(async f => {
  insertRow(f.db, { workspaceId: 'ws_legacy' }, 'documents', { title: 'Synthetic company document', company_id: f.company.id, document_type_id: f.type.id, expiry_date: '2026-01-01' });
  f.reminders.store.saveRecipient({ label: 'Synthetic', phone: MANAGER_PHONE, enabled: true });
  for (const language of ['ar', 'en']) {
    setSetting(f.db, { workspaceId: 'ws_legacy' }, 'whatsapp.language', language);
    const job = selectReminders(f.db, { workspaceId: 'ws_legacy' }, 'romani', f.clock.now).find(row => row.item_name === 'Synthetic company document');
    assert.equal(job.owner_name, language === 'en' ? f.company.name : f.company.name_ar);
    assert.ok(job.text.includes(job.owner_name));
  }
  f.db.prepare('UPDATE companies SET name_ar=? WHERE id=?').run('', f.company.id);
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'whatsapp.language', 'ar');
  assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' }, 'romani', f.clock.now).find(row => row.item_name === 'Synthetic company document').owner_name, f.company.name);
  assert.equal(f.calls.length, 0);
  f.db.prepare('UPDATE companies SET name=?,name_ar=? WHERE id=?').run('   ', 'اسم الشركة', f.company.id);
  setSetting(f.db, { workspaceId: 'ws_legacy' }, 'whatsapp.language', 'en');
  assert.equal(selectReminders(f.db, { workspaceId: 'ws_legacy' }, 'romani', f.clock.now).find(row => row.item_name === 'Synthetic company document').owner_name, 'اسم الشركة');
}));

test('channel languages persist independently; invalid writes are atomic and viewers cannot change or preview templates', () => reminderApi(async f => {
  const save = (settings, role = 'admin') => f.request('/api/settings', { method: 'PUT', body: { settings }, role });
  const read = async () => (await f.request('/api/settings')).json.data.settings;
  assert.equal((await read())['whatsapp.language'], 'ar');
  assert.equal((await save({ 'whatsapp.language': 'en', 'email.language': 'ar' })).status, 200);
  assert.equal((await read())['whatsapp.language'], 'en');
  assert.equal((await read())['email.language'], 'ar');
  assert.equal((await save({ 'email.language': 'en' })).status, 200);
  assert.equal((await save({ 'whatsapp.language': 'ar' })).status, 200);
  assert.equal((await read())['email.language'], 'en');
  assert.equal((await save({ 'whatsapp.language': 'de', 'email.language': 'ar' })).status, 400);
  assert.equal((await read())['email.language'], 'en');
  assert.equal((await save({ 'whatsapp.language': 'en' }, 'viewer')).status, 403);
  assert.equal((await f.request('/api/whatsapp/template-preview?channel=email&language=en', { role: 'viewer' })).status, 403);
  for (const query of ['channel=email&language=fr', 'channel=other&language=en', 'channel=email&language=en&instance=foreign']) {
    assert.equal((await f.request('/api/whatsapp/template-preview?' + query)).status, 400);
  }
  assert.equal((await read())['whatsapp.language'], 'ar');
  assert.equal(f.calls.length, 0);
}));

test('language changes refresh pending text without changing destination identities or historical attempts', () => reminderApi(async f => {
  await f.request('/api/employees/' + f.employee.id, { method: 'PATCH', body: { whatsapp_notifications_enabled: true, residency_expiry_date: null } });
  for (const phone of [MANAGER_PHONE, '+99900000003', '+99900000004']) {
    await f.request('/api/whatsapp/recipients', { method: 'POST', body: { label: 'Synthetic', phone, enabled: true } });
  }
  await f.reminders.schedule();
  const original = f.db.prepare('SELECT * FROM whatsapp_jobs ORDER BY id').all();
  assert.equal(original.length, 4);
  for (const [id, outcome] of [[original[0].id, { kind: 'provider_accepted', messageId: 'synthetic-language' }], [original[1].id, { kind: 'unknown', code: 'transport_interrupted' }]]) {
    const claim = f.reminders.store.claim(id); f.reminders.store.finish(claim.job, claim.attemptId, outcome);
  }
  const history = f.db.prepare("SELECT * FROM whatsapp_jobs WHERE state IN ('provider_accepted','unknown') ORDER BY id").all();
  const attempts = f.db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id').all();
  assert.equal((await f.request('/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.language': 'en' } } })).status, 200);
  const pending = f.db.prepare("SELECT * FROM whatsapp_jobs WHERE state='pending'").all();
  assert.equal(pending.length, 2); assert.ok(pending.every(row => row.text.includes('Reminder:')));
  assert.deepEqual(f.db.prepare("SELECT * FROM whatsapp_jobs WHERE state IN ('provider_accepted','unknown') ORDER BY id").all(), history);
  assert.deepEqual(f.db.prepare('SELECT * FROM whatsapp_attempts ORDER BY id').all(), attempts);
  assert.deepEqual(f.db.prepare('SELECT id FROM whatsapp_jobs ORDER BY id').all().map(row => row.id), original.map(row => row.id));
  assert.equal(await f.reminders.schedule(), 0); assert.equal(f.calls.length, 0);
  const candidates = selectReminders(f.db, { workspaceId: 'ws_legacy' }, 'romani', f.clock.now);
  assert.ok(candidates.some(row => row.audience === 'employee' && row.text.startsWith('Hello')));
  assert.ok(candidates.some(row => row.audience === 'management' && row.text.includes('for employee')));
}));

test('synthetic previews and actual email reports use bilingual renderers without provider calls or business data exposure', () => reminderApi(async f => {
  f.db.prepare('UPDATE documents SET expiry_date=?').run(new Date().toISOString().slice(0, 10));
  await f.request('/api/settings', { method: 'PUT', body: { settings: { 'email.recipients': ['synthetic@example.invalid'] } } });
  for (const language of ['ar', 'en']) {
    const response = await fetch(f.base + '/api/whatsapp/template-preview?channel=email&language=' + language, {
      headers: { cookie: f.config.cookieName + '=' + signSession(f.config, { id: 'admin', role: 'admin', name: 'Synthetic', email: 'admin@example.invalid' }) },
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const wa = await f.request('/api/whatsapp/template-preview?channel=whatsapp&language=' + language);
    assert.equal(wa.status, 200); assert.equal(wa.json.data.samples.length, 3);
    assert.ok(wa.json.data.samples.every(row => row.text.includes('15/01/2030')));
    assert.match(wa.json.data.samples[1].text, language === 'en' ? /for company/ : /بالشركة/);
    assert.match(wa.json.data.samples[2].text, language === 'en' ? /^Hello/ : /^أهلاً/);
    const email = await f.request('/api/whatsapp/template-preview?channel=email&language=' + language);
    assert.equal(email.status, 200);
    assert.equal(JSON.stringify(email.json).includes(f.employee.name), false);
    await f.request('/api/settings', { method: 'PUT', body: { settings: { 'email.language': language } } });
    const sent = [];
    // Only SMTP is replaced; real settings, selection, renderers and audit remain in use.
    const result = await sendExpiryReport(f.db, { workspaceId: 'ws_legacy' }, { send: async message => {
      sent.push(message); return { status: 'sent', messageId: 'synthetic-email', accepted: message.to, rejected: [] };
    } }, 'manual');
    assert.equal(result.sent, true); assert.equal(sent.length, 1);
    assert.match(sent[0].text, language === 'en' ? /Expiry reminder/ : /تنبيه انتهاء الصلاحية/);
    assert.match(sent[0].subject, language === 'en' ? /Expiry/ : /انتهاء/);
    assert.match(sent[0].html, new RegExp('dir="' + (language === 'ar' ? 'rtl' : 'ltr') + '"'));
  }
  assert.equal(f.calls.length, 0);
}));
