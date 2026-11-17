import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { safeErrorLine } from '../server/services/runtime.ts';
import { hasControlCharacter } from '../server/services/smtpSecurity.ts';

/**
 * The runtime facts of the API process.
 *
 * A deployment that fails in a way the code cannot explain leaves one question
 * behind: is this still the process that started, and how much memory does it
 * hold? The endpoint answers both, and it answers them only to an
 * administrator.
 */

test('the runtime facts are only for an administrator', () => reminderApi(async f => {
  const anonymous = await f.request('/api/runtime', { role: null });
  assert.equal(anonymous.status, 401, JSON.stringify(anonymous.json));

  const member = await f.request('/api/runtime', { role: 'viewer' });
  assert.equal(member.status, 403, JSON.stringify(member.json));

  const admin = await f.request('/api/runtime');
  assert.equal(admin.status, 200, JSON.stringify(admin.json));
  assert.equal(admin.json.error, null);
}));

test('the runtime facts describe the process and nothing else', () => reminderApi(async f => {
  const admin = await f.request('/api/runtime');
  assert.equal(admin.status, 200, JSON.stringify(admin.json));

  const data = admin.json.data;
  assert.equal(typeof data.uptimeSeconds, 'number');
  assert.ok(data.uptimeSeconds >= 0, 'the uptime is a number of seconds');
  assert.match(data.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'the start time is an ISO timestamp');
  assert.equal(typeof data.memory.rssMb, 'number');
  assert.equal(typeof data.memory.heapUsedMb, 'number');
  assert.equal(typeof data.memory.heapTotalMb, 'number');

  // The answer describes the server, never the data it holds.
  const body = JSON.stringify(admin.json);
  for (const secret of ['password', 'secret', 'token', 'ciphertext', 'jwt', 'smtp_pass']) {
    assert.equal(body.toLowerCase().includes(secret), false, `the answer never mentions ${secret}`);
  }
}));

test('a fatal error is described without its message', () => {
  const error = new Error('535-5.7.8 Authentication failed for user@gmail.com with password hunter2');
  const line = safeErrorLine(error);

  assert.match(line, /^Error/, 'the line names the failure');
  assert.equal(line.includes('hunter2'), false, 'the line never carries the password');
  assert.equal(line.includes('gmail.com'), false, 'the line never carries the address');
});

test('a host with a control character is refused', () => reminderApi(async f => {
  const escape = String.fromCharCode(27);
  const del = String.fromCharCode(127);
  const escaped = `smtp.gmail.com${escape}[31m`;

  const member = await f.request('/api/me/smtp', {
    method: 'PUT',
    body: {
      host: escaped,
      port: 587,
      secure: false,
      username: 'relay@example.com',
      password: 'app-password',
      sender_address: 'relay@example.com',
      sender_name: 'Relay',
    },
  });
  assert.equal(member.status, 400, JSON.stringify(member.json));
  assert.equal(member.json.error.code, 'invalid_smtp_settings');

  const workspace = await f.request('/api/email/smtp', {
    method: 'PUT',
    body: {
      host: escaped,
      port: 587,
      secure: false,
      user: 'relay@example.com',
      pass: 'app-password',
      from: 'relay@example.com',
    },
  });
  assert.equal(workspace.status, 400, JSON.stringify(workspace.json));
  assert.equal(workspace.json.error.code, 'invalid_smtp_settings');

  // The check itself is the simple one: a control character is any code point
  // below the space, plus the delete character.
  assert.equal(hasControlCharacter('smtp.gmail.com'), false);
  assert.equal(hasControlCharacter(escaped), true);
  assert.equal(hasControlCharacter(`smtp.gmail.com${del}`), true);
}));
