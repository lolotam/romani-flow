import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reminderFixture } from './fixtures/whatsapp.mjs';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { ReminderStore } from '../server/notifications/whatsapp/repository.ts';
import { selectReminders } from '../server/notifications/whatsapp/selection.ts';
import { NotificationCoordinator } from '../server/notifications/coordinator.ts';
import { DocumentService } from '../server/services/documentService.ts';
import { relationForCompany } from '../src/components/employees/employeeHelpers.ts';

const phone = (n) => '+999' + String(n).padStart(8, '0');

test('queue capacity is counted per operational instance, not across namespaces', () => {
  const f = reminderFixture();
  try {
    f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();
    const base = selectReminders(f.db, 'romani-fixture', f.clock.now)[0];
    const clock = () => f.clock.now;
    const foreign = new ReminderStore(f.db, 'foreign', clock);
    const local = new ReminderStore(f.db, 'romani-fixture', clock);

    const full = Array.from({ length: 2000 }, (_, n) => ({ ...base, instance: 'foreign', recipient: phone(n) }));
    assert.equal(foreign.enqueue(full), 2000);
    assert.equal(foreign.queueSize(), 2000);
    assert.equal(local.queueSize(), 0);

    // A full foreign queue must not block local admission...
    assert.equal(local.enqueue([{ ...base, recipient: phone(5000) }]), 1);
    assert.equal(local.queueSize(), 1);

    // ...nor a local manual retry.
    const claim = local.claim(local.due()[0].id);
    local.finish(claim.job, claim.attemptId, { kind: 'permanent_failed', code: 'provider_unauthorized' });
    local.retry(claim.job.id);
    assert.equal(f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id=?').get(claim.job.id).state, 'pending');
  } finally {
    f.close();
  }
});

test('a document create waits for the notification coordinator (backup erase) instead of interleaving', async () => {
  const f = reminderFixture();
  try {
    const service = new DocumentService(f.db, {});
    const coordinator = new NotificationCoordinator();
    service.configureNotifications({ coordinator, changed: () => {} });
    const count = () => f.db.prepare('SELECT count(*) n FROM documents').get().n;
    const before = count();

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const erase = coordinator.runExclusive(() => gate);

    const created = service.createDocument(
      { title: 'Synthetic create', employee_id: f.employee.id, document_type_id: f.type.id, expiry_date: '2030-01-01' },
      () => 'valid',
    );
    assert.ok(created instanceof Promise);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count(), before, 'create must not run while the coordinator is held');

    release();
    await erase;
    const row = await created;
    assert.equal(count(), before + 1);
    assert.equal(row.title, 'Synthetic create');
  } finally {
    f.close();
  }
});

test('the displayed company relation always follows the returned company id', () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const stale = { company_id: 'a', companies: a };
  assert.equal(relationForCompany('b', [{ company_id: 'b' }, stale], [a, b]), b);
  // Not in the loaded list: only a source whose own company id matches may supply it.
  assert.equal(relationForCompany('c', [stale], [a, b]), null);
  assert.equal(relationForCompany('a', [{ company_id: 'a' }, stale], []), a);
  assert.equal(relationForCompany(null, [stale], [a]), null);
});

test('the audit log reads attempts once per page and keeps per-job order and content', () => reminderApi(async (f) => {
  f.db.prepare('UPDATE employees SET whatsapp_notifications_enabled=1').run();
  const base = selectReminders(f.db, 'romani', f.clock.now)[0];
  assert.equal(f.reminders.store.enqueue([0, 1, 2].map((n) => ({ ...base, recipient: phone(n) }))), 3);

  for (const job of f.reminders.store.due(10)) {
    const claim = f.reminders.store.claim(job.id);
    f.reminders.store.finish(claim.job, claim.attemptId, { kind: 'retryable_failed', code: 'provider_unavailable' });
  }
  f.clock.now = new Date(f.clock.now.getTime() + 2 * 3600_000);
  const retried = f.reminders.store.claim(f.reminders.store.due(10)[0].id);
  f.reminders.store.finish(retried.job, retried.attemptId, { kind: 'retryable_failed', code: 'provider_unavailable' });

  const originalPrepare = f.db.prepare.bind(f.db);
  let attemptQueries = 0;
  f.db.prepare = (sql) => {
    if (/FROM whatsapp_attempts/i.test(sql)) attemptQueries += 1;
    return originalPrepare(sql);
  };
  const log = await f.request('/api/whatsapp/log?limit=100');
  f.db.prepare = originalPrepare;

  assert.equal(log.status, 200);
  assert.equal(log.json.data.items.length, 3);
  assert.equal(attemptQueries, 1);
  for (const item of log.json.data.items) {
    const expected = JSON.parse(JSON.stringify(originalPrepare('SELECT * FROM whatsapp_attempts WHERE job_id=? ORDER BY attempt').all(item.id)));
    assert.deepEqual(item.attempts, expected);
  }
  assert.deepEqual(log.json.data.items.map((item) => item.attempts.length).sort(), [1, 1, 2]);
}));
