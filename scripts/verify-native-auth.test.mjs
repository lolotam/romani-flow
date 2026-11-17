import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { findAdminByEmail } from '../server/repositories/adminUsers.ts';

test('native registration creates workspace, starter catalog, and admin account', () => reminderApi(async f => {
  const res = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: {
      email: 'dr.vet.waleedtam@gmail.com',
      password: 'StrongPassword123!',
      name: 'Dr. Waleed',
      workspaceName: 'Waleed Clinic',
    },
  });

  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.user.email, 'dr.vet.waleedtam@gmail.com');
  assert.equal(res.json.data.workspaceName, 'Waleed Clinic');
  assert.ok(res.json.data.workspaceId.startsWith('ws_'));

  const ws = f.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(res.json.data.workspaceId);
  assert.ok(ws, 'workspace must exist');
  assert.equal(ws.name, 'Waleed Clinic');

  const admin = findAdminByEmail(f.db, 'dr.vet.waleedtam@gmail.com');
  assert.ok(admin, 'admin account must exist');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.workspace_id, res.json.data.workspaceId);
}));

test('registration enforces field validation and bcrypt limits', () => reminderApi(async f => {
  // Invalid email
  const badEmail = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'not-an-email', password: 'validPassword123!' },
  });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.json.error.code, 'invalid_email');

  // Short password
  const shortPass = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'test@example.com', password: 'short' },
  });
  assert.equal(shortPass.status, 400);
  assert.equal(shortPass.json.error.code, 'password_too_short');

  // Password exceeding bcrypt limit (72 bytes)
  const longPass = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'test2@example.com', password: 'a'.repeat(73) },
  });
  assert.equal(longPass.status, 400);
  assert.equal(longPass.json.error.code, 'password_too_long');

  // Multibyte password exceeding 72 bytes ('é' is 2 bytes, 36 * 2 + 1 = 73 bytes)
  const multibyteLong = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'test3@example.com', password: 'é'.repeat(36) + 'A' },
  });
  assert.equal(multibyteLong.status, 400);
  assert.equal(multibyteLong.json.error.code, 'password_too_long');

  // Multibyte password exactly 72 bytes ('é' is 2 bytes, 36 * 2 = 72 bytes)
  const multibyteExact = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'test4@example.com', password: 'é'.repeat(36) },
  });
  assert.equal(multibyteExact.status, 201);
}));

test('registration is atomic and rejects duplicate emails with 409', () => reminderApi(async f => {
  const first = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'duplicate@example.com', password: 'password123!', workspaceName: 'First' },
  });
  assert.equal(first.status, 201);

  const beforeWorkspaces = f.db.prepare('SELECT count(*) as count FROM workspaces').get().count;

  // Duplicate submission
  const second = await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'duplicate@example.com', password: 'password123!', workspaceName: 'Second' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, 'email_already_exists');

  // Verify no orphan workspace was left behind
  const afterWorkspaces = f.db.prepare('SELECT count(*) as count FROM workspaces').get().count;
  assert.equal(afterWorkspaces, beforeWorkspaces, 'no orphan workspace created on failure');
}));

test('login verifies credentials, rejects bad passwords, and handles suspension', () => reminderApi(async f => {
  await f.request('/api/auth/register', {
    method: 'POST',
    role: null,
    body: { email: 'user@example.com', password: 'correctPassword123', workspaceName: 'User WS' },
  });

  // Bad password
  const badLogin = await f.request('/api/auth/login', {
    method: 'POST',
    role: null,
    body: { email: 'user@example.com', password: 'wrongPassword' },
  });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.json.error.code, 'invalid_credentials');

  // Good login
  const goodLogin = await f.request('/api/auth/login', {
    method: 'POST',
    role: null,
    body: { email: 'user@example.com', password: 'correctPassword123' },
  });
  assert.equal(goodLogin.status, 200);

  // Suspend workspace
  const user = findAdminByEmail(f.db, 'user@example.com');
  f.db.prepare('UPDATE workspaces SET suspended_at = ? WHERE id = ?').run(new Date().toISOString(), user.workspace_id);

  // Login to suspended workspace
  const suspendedLogin = await f.request('/api/auth/login', {
    method: 'POST',
    role: null,
    body: { email: 'user@example.com', password: 'correctPassword123' },
  });
  assert.equal(suspendedLogin.status, 403);
  assert.equal(suspendedLogin.json.error.code, 'workspace_suspended');
}));

test('auth mutations reject foreign origins', () => reminderApi(async f => {
  // Foreign origin
  const foreignOrigin = await f.request('/api/auth/login', {
    method: 'POST',
    role: null,
    headers: {
      origin: 'https://attacker.evil.com',
    },
    body: { email: 'user@example.com', password: 'pass' },
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(foreignOrigin.json.error.code, 'origin_forbidden');
}));
