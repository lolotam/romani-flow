import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCredentialEncryption, CredentialEncryptionError, EVOLUTION_TOKEN_AAD, MEMBER_SMTP_AAD,
} from '../server/services/credentialEncryption.ts';

/**
 * The sealing of a stored credential.
 *
 * A password reaches the database as a sealed value and leaves it the same way.
 * The key lives in the environment, the associated data names the kind of
 * credential, and a value that was changed on the way never opens.
 */

const KEY = Buffer.alloc(32, 7).toString('base64url');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64url');

test('a key that is not 32 bytes leaves the credential unconfigured', () => {
  for (const encoded of [null, '', 'short', Buffer.alloc(16, 7).toString('base64url'), Buffer.alloc(33, 7).toString('base64url')]) {
    const encryption = createCredentialEncryption(encoded);
    assert.throws(
      () => encryption.encrypt('secret', MEMBER_SMTP_AAD),
      error => error instanceof CredentialEncryptionError && error.code === 'encryption_not_configured',
      `the key ${String(encoded)} is refused`,
    );
  }
});

test('a sealed credential opens back to the password it seals', () => {
  const encryption = createCredentialEncryption(KEY);
  const sealed = encryption.encrypt('relay-secret-value', MEMBER_SMTP_AAD);
  assert.notEqual(sealed, 'relay-secret-value');
  assert.equal(sealed.includes('relay-secret-value'), false, 'the sealed value holds no part of the password');
  assert.equal(encryption.decrypt(sealed, MEMBER_SMTP_AAD), 'relay-secret-value');
});

test('the same password seals to another value every time', () => {
  const encryption = createCredentialEncryption(KEY);
  const first = encryption.encrypt('relay-secret-value', MEMBER_SMTP_AAD);
  const second = encryption.encrypt('relay-secret-value', MEMBER_SMTP_AAD);
  assert.notEqual(first, second, 'the nonce makes every sealed value different');
  assert.equal(encryption.decrypt(first, MEMBER_SMTP_AAD), encryption.decrypt(second, MEMBER_SMTP_AAD));
});

test('a sealed credential belongs to the kind it was sealed for', () => {
  const encryption = createCredentialEncryption(KEY);
  const sealed = encryption.encrypt('relay-secret-value', MEMBER_SMTP_AAD);
  assert.throws(
    () => encryption.decrypt(sealed, EVOLUTION_TOKEN_AAD),
    error => error instanceof CredentialEncryptionError && error.code === 'credential_authentication_failed',
    'the associated data is part of the seal',
  );
});

test('a changed sealed credential never opens', () => {
  const encryption = createCredentialEncryption(KEY);
  const sealed = encryption.encrypt('relay-secret-value', MEMBER_SMTP_AAD);
  const bytes = Buffer.from(sealed, 'base64url');
  bytes[bytes.length - 1] ^= 0xff;
  assert.throws(
    () => encryption.decrypt(bytes.toString('base64url'), MEMBER_SMTP_AAD),
    error => error instanceof CredentialEncryptionError && error.code === 'credential_authentication_failed',
    'a changed value does not open',
  );
  assert.throws(
    () => createCredentialEncryption(OTHER_KEY).decrypt(sealed, MEMBER_SMTP_AAD),
    error => error instanceof CredentialEncryptionError && error.code === 'credential_authentication_failed',
    'another key does not open the value',
  );
});
