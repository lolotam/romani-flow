import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { reminderApi } from './fixtures/whatsapp-api.mjs';
import { APP_ENCRYPTION_KEY, memberSmtpDatabase } from './fixtures/member-smtp.mjs';
import { saveMemberSmtp } from '../server/repositories/memberSmtp.ts';
import { createCredentialEncryption, MEMBER_SMTP_AAD } from '../server/services/credentialEncryption.ts';

/**
 * The backup of a member relay.
 *
 * A backup keeps the relay of a member, but never the password as it was typed:
 * the password lives sealed in the database and stays sealed in the copy.
 */

const PASSWORD = 'relay-secret-value';
const RELAY = {
  host: 'smtp.example.invalid', port: 587, secure: false, username: 'member',
  senderAddress: 'member@example.invalid', senderName: 'Member',
};

const sealed = password => createCredentialEncryption(APP_ENCRYPTION_KEY).encrypt(password, MEMBER_SMTP_AAD);

test('a backup of the database never holds the plaintext password of a member relay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'romani-member-smtp-backup-'));
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  const { db, close } = memberSmtpDatabase(path.join(data, 'romani.db'));
  saveMemberSmtp(db, { workspaceId: 'ws_legacy', accountId: 'member-admin' }, RELAY, sealed(PASSWORD));
  const ciphertext = db.prepare('SELECT password_ciphertext FROM member_smtp_settings').get().password_ciphertext;
  close();

  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = JSON.parse(execFileSync(python, [path.resolve('scripts/recovery.py'), 'backup', '--data-dir', data,
    '--output', path.join(root, 'backup')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(result.verified, true);

  const copy = fs.readFileSync(path.join(root, 'backup', 'romani.db'));
  assert.equal(copy.includes(Buffer.from(PASSWORD)), false, 'the backup holds no plaintext password');
  assert.equal(copy.includes(Buffer.from(ciphertext)), true, 'the backup keeps the relay, sealed');

  const restored = new DatabaseSync(path.join(root, 'backup', 'romani.db'));
  const row = restored.prepare('SELECT password_ciphertext FROM member_smtp_settings').get();
  assert.equal(createCredentialEncryption(APP_ENCRYPTION_KEY).decrypt(row.password_ciphertext, MEMBER_SMTP_AAD), PASSWORD,
    'the sealed password of the backup still opens');
  restored.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('the export of the application never holds the plaintext password of a member relay', () => reminderApi(async f => {
  await f.request('/api/me/smtp', { method: 'PUT', body: {
    host: 'smtp.example.invalid', port: 587, secure: false, username: 'member',
    password: PASSWORD, sender_address: 'member@example.invalid',
  } });

  const exported = await f.request('/api/backup/export');
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  const body = JSON.stringify(exported.json);
  assert.equal(body.includes(PASSWORD), false, 'the export holds no plaintext password');
  assert.equal(body.includes('password_ciphertext'), false, 'the export holds no sealed password either');
}, undefined, { APP_ENCRYPTION_KEY, SMTP_ALLOWED_HOSTS: 'smtp.example.invalid' }));
