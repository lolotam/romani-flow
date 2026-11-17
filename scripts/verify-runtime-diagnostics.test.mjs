import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderApi } from './fixtures/whatsapp-api.mjs';

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
