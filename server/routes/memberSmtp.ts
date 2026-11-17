import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tenantOf } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { RepositoryError } from '../repositories/base.js';
import {
  deleteMemberSmtp, publicMemberSmtp, recordMemberSmtpTest, saveMemberSmtp,
} from '../repositories/memberSmtp.js';
import { createCredentialEncryption, MEMBER_SMTP_AAD } from '../services/credentialEncryption.js';
import { mailErrorCode } from '../services/mailError.js';
import type { Mailer } from '../services/mailer.js';
import { assertAllowedSmtpDestination } from '../services/smtpDestination.js';
import { startEmailAttempt, finishEmailAttempt } from '../services/emailLog.js';
import type { AppConfig } from '../config.js';

const inputSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(/^\S+$/),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(1024).optional(),
  sender_address: z.string().trim().email().max(320),
  sender_name: z.string().trim().max(120).nullable().optional(),
}).strict();

/**
 * The relay of the member that is signed in.
 *
 * The relay of the workspace stays the default. A member relay overrides it for
 * that member only, and the saved password is sealed before it reaches the
 * database.
 */
export function createMemberSmtpRouter(config: AppConfig, db: Db, mailer: Mailer): Router {
  const router = Router();
  const saveLimit = createRateLimit('smtp-save', 10, 10 * 60 * 1000);
  const testLimit = createRateLimit('smtp-test', 5, 10 * 60 * 1000);
  const encryption = createCredentialEncryption(config.appEncryptionKey);

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ data: publicMemberSmtp(db, tenantOf(req)), error: null });
  }));

  router.put('/', saveLimit, asyncHandler(async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) throw new RepositoryError('Invalid SMTP settings.', 'invalid_smtp_settings', 400);
    const value = parsed.data;
    const scope = tenantOf(req);
    // The relay is chosen by the member, so a destination the server must not
    // reach is refused before it is stored.
    await assertAllowedSmtpDestination(config, value.host);
    const ciphertext = value.password ? encryption.encrypt(value.password, MEMBER_SMTP_AAD) : null;
    saveMemberSmtp(db, scope, {
      host: value.host, port: value.port, secure: value.secure, username: value.username,
      senderAddress: value.sender_address, senderName: value.sender_name ?? null,
    }, ciphertext);
    res.json({ data: publicMemberSmtp(db, scope), error: null });
  }));

  router.delete('/', asyncHandler(async (req, res) => {
    const deleted = deleteMemberSmtp(db, tenantOf(req));
    res.json({ data: { deleted }, error: null });
  }));

  router.post('/test', testLimit, asyncHandler(async (req, res) => {
    if (Object.keys(req.body ?? {}).length > 0) {
      throw new RepositoryError('The test recipient is always your account email.', 'recipient_forbidden', 400);
    }
    const scope = tenantOf(req);
    const recipient = req.user?.email.trim();
    if (!recipient) throw new RepositoryError('The account has no email address.', 'account_email_required', 409);
    const logId = startEmailAttempt(db, scope, {
      kind: 'member_smtp_test', recipients: [recipient], subject: 'ROMANI Flow — SMTP test', triggerSource: 'manual',
    });
    try {
      // The test only ever uses the relay of the member. The relay of the
      // workspace is not a fallback here, so a green test never belongs to
      // another relay.
      const result = await mailer.sendAsMember({
        to: [recipient], subject: 'ROMANI Flow — SMTP test',
        text: 'This is a test message from ROMANI Flow. SMTP is configured correctly.',
      }, scope, { deadlineMs: 20_000 });
      if (result.status !== 'sent') throw new RepositoryError('The test was not accepted.', 'send_failed', 502);
      recordMemberSmtpTest(db, scope, 'succeeded', null);
      finishEmailAttempt(db, scope, logId, { status: 'sent' });
      res.json({ data: { sent: true, status: 'sent' }, error: null });
    } catch (error) {
      const code = mailErrorCode(error);
      recordMemberSmtpTest(db, scope, 'failed', code);
      finishEmailAttempt(db, scope, logId, { status: 'failed', error: code });
      throw error;
    }
  }));
  return router;
}
