import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteMemberSmtp, getMemberSmtp, listEligibleMembers, notificationSenderAccountId,
  publicMemberSmtp, saveMemberSmtp, setNotificationSender,
} from '../server/repositories/memberSmtp.ts';
import { createCredentialEncryption, MEMBER_SMTP_AAD } from '../server/services/credentialEncryption.ts';
import { APP_ENCRYPTION_KEY, B, LEGACY, MEMBER, memberSmtpDatabase, OTHER, TENANT_B } from './fixtures/member-smtp.mjs';

/**
 * The repository of the member relay.
 *
 * A relay belongs to one account of one workspace, and the password it holds is
 * sealed before it reaches the database.
 */

const RELAY = {
  host: 'smtp.example.invalid', port: 587, secure: false, username: 'member',
  senderAddress: 'member@example.invalid', senderName: 'Member',
};
const PASSWORD = 'relay-secret-value';

const sealed = password => createCredentialEncryption(APP_ENCRYPTION_KEY).encrypt(password, MEMBER_SMTP_AAD);

test('the stored password is sealed, never the plaintext', () => {
  const { db, close } = memberSmtpDatabase();
  saveMemberSmtp(db, { ...LEGACY, accountId: MEMBER }, RELAY, sealed(PASSWORD));

  const row = db.prepare('SELECT * FROM member_smtp_settings WHERE workspace_id=? AND account_id=?').get(LEGACY.workspaceId, MEMBER);
  assert.notEqual(row.password_ciphertext, PASSWORD, 'the password is not stored as it was typed');
  assert.ok(!JSON.stringify(row).includes(PASSWORD), 'no column of the row holds the plaintext');
  assert.equal(createCredentialEncryption(APP_ENCRYPTION_KEY).decrypt(row.password_ciphertext, MEMBER_SMTP_AAD), PASSWORD,
    'the stored value opens back to the password it seals');

  const view = publicMemberSmtp(db, { ...LEGACY, accountId: MEMBER });
  assert.equal(view.configured, true);
  assert.equal(view.hasPassword, true);
  assert.equal(JSON.stringify(view).includes(PASSWORD), false, 'the public view never carries the password');
  assert.equal(JSON.stringify(view).includes(row.password_ciphertext), false, 'the public view never carries the ciphertext');
  close();
});

test('a relay of one account is invisible to another account of the same workspace', () => {
  const { db, close } = memberSmtpDatabase();
  saveMemberSmtp(db, { ...LEGACY, accountId: MEMBER }, RELAY, sealed(PASSWORD));

  assert.equal(getMemberSmtp(db, { ...LEGACY, accountId: OTHER }), null, 'the other account of the workspace sees no relay');
  assert.equal(publicMemberSmtp(db, { ...LEGACY, accountId: OTHER }).configured, false);
  assert.equal(getMemberSmtp(db, { ...B, accountId: TENANT_B }), null, 'the account of the other workspace sees no relay');

  // The relay of the owner stays readable for the owner.
  assert.equal(getMemberSmtp(db, { ...LEGACY, accountId: MEMBER }).host, RELAY.host);
  close();
});

test('deleting the relay of the designated sender clears the designation', () => {
  const { db, close } = memberSmtpDatabase();
  saveMemberSmtp(db, { ...LEGACY, accountId: MEMBER }, RELAY, sealed(PASSWORD));
  setNotificationSender(db, LEGACY.workspaceId, MEMBER);
  assert.equal(notificationSenderAccountId(db, LEGACY.workspaceId), MEMBER);

  assert.equal(deleteMemberSmtp(db, { ...LEGACY, accountId: MEMBER }), true);
  assert.equal(getMemberSmtp(db, { ...LEGACY, accountId: MEMBER }), null);
  assert.equal(notificationSenderAccountId(db, LEGACY.workspaceId), null, 'a deleted relay cannot stay the designated sender');
  close();
});

test('the eligible members of a workspace name the ones with a complete relay', () => {
  const { db, close } = memberSmtpDatabase();
  saveMemberSmtp(db, { ...LEGACY, accountId: MEMBER }, RELAY, sealed(PASSWORD));

  const members = listEligibleMembers(db, LEGACY.workspaceId);
  assert.deepEqual(members.map(member => member.accountId), [MEMBER, OTHER]);
  assert.equal(members.find(member => member.accountId === MEMBER).hasCompleteSmtp, true);
  assert.equal(members.find(member => member.accountId === OTHER).hasCompleteSmtp, false);
  assert.deepEqual(listEligibleMembers(db, B.workspaceId).map(member => member.accountId), [TENANT_B]);
  close();
});
