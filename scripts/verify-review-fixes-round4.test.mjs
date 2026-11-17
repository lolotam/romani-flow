import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { isPrivateOrReservedIp, assertPublicHost } from '../server/services/smtpSecurity.ts';
import { getWorkspaceWhatsAppRecord, setPairingPendingUntil, getPairingPendingUntil } from '../server/whatsapp/instance.ts';
import { createWorkspace } from '../server/repositories/workspaces.ts';
import { createAdminWithHash } from '../server/repositories/adminUsers.ts';

test('Finding 4 & 10: Private and reserved IPs and forbidden hostnames are detected', async () => {
  // IPv4 loopback and private
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('127.255.255.254'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIp('172.31.255.255'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.100'), true);
  assert.equal(isPrivateOrReservedIp('169.254.1.1'), true);
  assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);
  assert.equal(isPrivateOrReservedIp('224.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('240.0.0.1'), true);

  // IPv6
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::'), true);
  assert.equal(isPrivateOrReservedIp('fc00::1'), true);
  assert.equal(isPrivateOrReservedIp('fd12::3456'), true);
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:192.168.1.1'), true);

  // Public IP
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);

  // assertPublicHost
  await assert.rejects(() => assertPublicHost('localhost'), /forbidden/);
  await assert.rejects(() => assertPublicHost('test.local'), /forbidden/);
  await assert.rejects(() => assertPublicHost('127.0.0.1'), /forbidden/);
  await assert.rejects(() => assertPublicHost('10.10.10.10'), /forbidden/);
});

test('Finding 4 & 10: PUT /api/email/smtp enforces port integer, strict boolean secure, and public host', () => reminderApi(async f => {
  createWorkspace(f.db, { id: 'ws_test_smtp', name: 'SMTP Workspace' });
  createAdminWithHash(f.db, {
    id: 'u_smtp_admin',
    email: 'tenant.admin@example.invalid',
    name: 'Admin',
    passwordHash: 'hash',
    role: 'admin',
    workspaceId: 'ws_test_smtp',
  });

  // Reject loopback host
  const resLoopback = await f.request('/api/email/smtp', {
    method: 'PUT',
    user: 'u_smtp_admin',
    body: { host: '127.0.0.1', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@b.com' },
  });
  assert.equal(resLoopback.status, 400);
  assert.equal(resLoopback.json.error?.code, 'smtp_host_forbidden');

  // Reject localhost
  const resLocalhost = await f.request('/api/email/smtp', {
    method: 'PUT',
    user: 'u_smtp_admin',
    body: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@b.com' },
  });
  assert.equal(resLocalhost.status, 400);
  assert.equal(resLocalhost.json.error?.code, 'smtp_host_forbidden');

  // Reject invalid port (out of range or non-integer)
  const resBadPort = await f.request('/api/email/smtp', {
    method: 'PUT',
    user: 'u_smtp_admin',
    body: { host: 'smtp.google.com', port: 70000, secure: false, user: 'u', pass: 'p', from: 'a@b.com' },
  });
  assert.equal(resBadPort.status, 400);
  assert.equal(resBadPort.json.error?.code, 'invalid_smtp_settings');

  // Reject non-boolean secure
  const resBadSecure = await f.request('/api/email/smtp', {
    method: 'PUT',
    user: 'u_smtp_admin',
    body: { host: 'smtp.google.com', port: 587, secure: 'true', user: 'u', pass: 'p', from: 'a@b.com' },
  });
  assert.equal(resBadSecure.status, 400);
  assert.equal(resBadSecure.json.error?.code, 'invalid_smtp_settings');
}));

test('Finding 8: Platform admin access is restricted and platform emails cannot be registered publicly', () => reminderApi(async f => {
  // Try to register with platform admin email -> 403 platform_email_restricted
  const resReg = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: {
      email: 'platform.admin@curemedkw.com',
      password: 'StrongPassword123!',
      name: 'Imposter',
    },
    headers: { origin: 'https://romani.curemedkw.com' },
  });
  assert.equal(resReg.status, 403);
  assert.equal(resReg.json.error?.code, 'platform_email_restricted');

  // Register a legitimate workspace admin
  createWorkspace(f.db, { id: 'ws_tenant', name: 'Tenant' });
  createAdminWithHash(f.db, {
    id: 'u_regular',
    email: 'regular.tenant@curemedkw.com',
    name: 'Regular Tenant',
    passwordHash: 'hash',
    role: 'admin',
    workspaceId: 'ws_tenant',
  });

  // /api/platform/me should return isPlatformAdmin: false
  const resMe = await f.request('/api/platform/me', {
    user: 'u_regular',
  });
  assert.equal(resMe.status, 200);
  assert.equal(resMe.json.data.isPlatformAdmin, false);
}, undefined, { PLATFORM_ADMIN_EMAILS: 'platform.admin@curemedkw.com' }));

test('Finding 5 & 6: Workspace WhatsApp instances have dedicated api_key and pairing timestamp', () => reminderApi(async f => {
  createWorkspace(f.db, { id: 'ws_tenant_1', name: 'Tenant 1' });
  const legacyRecord = getWorkspaceWhatsAppRecord(f.db, 'ws_legacy', 'custom_legacy', 'custom_key');
  assert.equal(legacyRecord.instanceName, 'romani');

  const tenantRecord = getWorkspaceWhatsAppRecord(f.db, 'ws_tenant_1', 'custom_legacy', 'custom_key');
  assert.ok(tenantRecord.instanceName.startsWith('rf_ws_tenant_1'));
  assert.ok(tenantRecord.apiKey && tenantRecord.apiKey.length >= 32);
  assert.notEqual(tenantRecord.apiKey, 'custom_key');

  // Pairing timestamp
  assert.equal(getPairingPendingUntil(f.db, 'ws_tenant_1'), 0);
  const future = Date.now() + 60_000;
  setPairingPendingUntil(f.db, 'ws_tenant_1', future);
  assert.equal(getPairingPendingUntil(f.db, 'ws_tenant_1'), future);

  // Legacy pairing timestamp remains isolated
  assert.equal(getPairingPendingUntil(f.db, 'ws_legacy'), 0);
}));

test('Finding 2: Business writes and erase run on workspace coordinator and cancel tenant jobs', () => reminderApi(async f => {
  createWorkspace(f.db, { id: 'ws_erase_test', name: 'Erase Test Workspace' });
  createAdminWithHash(f.db, {
    id: 'u_erase_admin',
    email: 'erase.admin@example.invalid',
    name: 'Erase Admin',
    passwordHash: 'hash',
    role: 'admin',
    workspaceId: 'ws_erase_test',
  });

  // Insert a test job in whatsapp_jobs for ws_erase_test
  const tenantInstance = getWorkspaceWhatsAppRecord(f.db, 'ws_erase_test', 'romani').instanceName;
  f.db.prepare(`
    INSERT INTO whatsapp_jobs (id, workspace_id, instance, item_type, item_id, expiry_date, bucket, recipient, recipient_label, audience, item_name, owner_name, text, state, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES ('job_tenant_1', 'ws_erase_test', ?, 'document', 'doc1', '2026-12-01', 30, '+96590000000', 'Mgr', 'management', 'Passport', 'John', 'Expiring soon', 'pending', 0, '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z')
  `).run(tenantInstance);

  // Also insert a legacy job
  f.db.prepare(`
    INSERT INTO whatsapp_jobs (id, workspace_id, instance, item_type, item_id, expiry_date, bucket, recipient, recipient_label, audience, item_name, owner_name, text, state, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES ('job_legacy_1', 'ws_legacy', 'romani', 'document', 'doc2', '2026-12-01', 30, '+96591111111', 'Mgr', 'management', 'Passport', 'Jane', 'Expiring soon', 'pending', 0, '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z')
  `).run();

  // Erase tenant workspace
  const resErase = await f.request('/api/backup/erase', {
    method: 'POST',
    user: 'u_erase_admin',
    body: {},
  });
  assert.equal(resErase.status, 200);

  // Tenant job must be cancelled
  const tenantJob = f.db.prepare('SELECT state, error_code FROM whatsapp_jobs WHERE id = ?').get('job_tenant_1');
  assert.equal(tenantJob.state, 'cancelled');
  assert.equal(tenantJob.error_code, 'no_longer_eligible');

  // Legacy job must remain pending
  const legacyJob = f.db.prepare('SELECT state FROM whatsapp_jobs WHERE id = ?').get('job_legacy_1');
  assert.equal(legacyJob.state, 'pending');
}));
