import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { loadConfig, validateConfig, isSmtpConfigured } from '../server/config.ts';
// Ephemeral test values only; never credentials for an external service.
const base = { JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test' };
const mail = { SMTP_HOST: 'localhost', SMTP_USER: 'sender@example.com', SMTP_PASS: randomBytes(16).toString('hex'), SMTP_FROM: 'ROMANI Flow <sender@example.com>' };
test('absent SMTP permits startup and remains unconfigured', () => {
  const config = loadConfig(base);
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(isSmtpConfigured(config), false);
  assert.equal(config.smtp.from, '');
});
for (const trigger of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
  for (const missing of ['SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter(key => key !== trigger)) {
    test(`${trigger} requires ${missing}`, () => {
      const config = loadConfig({ ...base, [trigger]: mail[trigger] });
      assert.throws(() => validateConfig(config), new RegExp(`${missing} is required`));
    });
  }
}
test('complete SMTP validates; sender is explicit', () => {
  const config = loadConfig({ ...base, ...mail });
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(isSmtpConfigured(config), true);
  assert.equal(config.smtp.from, mail.SMTP_FROM);
  assert.equal(loadConfig({ ...base, SMTP_USER: mail.SMTP_USER }).smtp.from, '');
});
test('aliases undergo the same validation', () => {
  assert.throws(() => validateConfig(loadConfig({ ...base, MAIL_HOST: 'localhost' })), /SMTP_USER is required/);
  const config = loadConfig({ ...base, MAIL_USER: mail.SMTP_USER, MAIL_PASS: mail.SMTP_PASS, MAIL_FROM: mail.SMTP_FROM });
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(isSmtpConfigured(config), true);
});

test('legacy remains the default auth provider', () => {
  assert.equal(loadConfig(base).authProvider, 'legacy');
});

const clerk = {
  AUTH_PROVIDER: 'clerk',
  CLERK_SECRET_KEY: 'sk_test_synthetic',
  CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_c3ludGhldGlj',
};
for (const missing of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']) {
  test(`clerk config fails fast when ${missing} is missing`, () => {
    const env = { ...base, ...clerk };
    delete env[missing];
    assert.throws(() => validateConfig(loadConfig(env)), error => {
      assert.match(error.message, new RegExp(missing));
      assert.equal(error.message.includes('synthetic'), false, 'the error never includes a key value');
      return true;
    });
  });
}
test('clerk config validates and normalizes the platform admin allowlist', () => {
  const config = loadConfig({ ...base, ...clerk, PLATFORM_ADMIN_EMAILS: ' Owner@Example.com , second@example.com ' });
  assert.doesNotThrow(() => validateConfig(config));
  assert.deepEqual(config.platformAdminEmails, ['owner@example.com', 'second@example.com']);
  assert.deepEqual(loadConfig({ ...base, PLATFORM_ADMIN_EMAILS: ' , ' }).platformAdminEmails, []);
});
