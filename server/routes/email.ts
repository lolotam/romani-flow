import { Router } from 'express';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import { findRow, type Row } from '../repositories/base.js';
import { getBoolean, getNumber, getRawList, getString, getStringList } from '../repositories/settings.js';
import { MailError, type Mailer } from '../services/mailer.js';
import type { CronService } from '../services/cronService.js';
import { collectExpiring, startEmailAttempt, finishEmailAttempt } from '../services/expiryService.js';
import { parseIntervals } from '../services/intervals.js';
import { emailIdentity, emailIdentities } from '../services/emailAddress.js';
import { documentEmailHtml, documentEmailText } from '../services/templates/index.js';
import { resolveSenderName } from '../services/senderName.js';
import type { StorageService } from '../services/storageService.js';
import { registerWorkspaceSmtpRoutes } from './emailSmtp.js';

/**
 * Email endpoints.
 *
 * Every send is recorded in `email_log` so the operator can see what was sent,
 * to whom, and whether it succeeded.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The whole SMTP exchange of a test message has to answer inside the deadline of
 * the browser request, so a relay that never replies cannot turn into a request
 * that hangs and is reported as a broken connection.
 */
const SMTP_TEST_DEADLINE_MS = 20_000;

function parseAddressList(value: unknown): { valid: string[]; invalid: string[] } {
  const raw = Array.isArray(value)
    ? value.flatMap((entry) => String(entry).split(/[,;\n]/))
    : String(value ?? '').split(/[,;\n]/);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const entry of raw) {
    const address = entry.trim();
    if (address.length === 0) continue;
    if (EMAIL_PATTERN.test(address)) valid.push(address);
    else invalid.push(address);
  }

  return { valid, invalid };
}

export function createEmailRouter(
  config: AppConfig,
  db: Db,
  mailer: Mailer,
  cron: CronService,
  storage: StorageService,
): Router {
  const router = Router();

  router.get(
    '/log',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const rows = db
        .prepare('SELECT * FROM email_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100')
        .all(tenantOf(req).workspaceId) as Row[];
      res.json({ data: rows, error: null });
    }),
  );

  router.get(
    '/status',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      res.json({
        data: {
          configured: mailer.isConfigured(scope),
          enabled: getBoolean(db, scope, 'email.enabled'),
          recipients: getStringList(db, scope, 'email.recipients'),
          cc: getStringList(db, scope, 'email.cc'),
          lastSentAt: getString(db, scope, 'email.last_sent_at'),
          lastResult: getString(db, scope, 'email.last_result'),
        },
        error: null,
      });
    }),
  );

  router.get(
    '/sender-name',
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json({ data: { senderName: resolveSenderName(db, req) }, error: null });
    }),
  );

  registerWorkspaceSmtpRoutes(router, { config, db, mailer });

  router.post(
    '/test',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const scope = tenantOf(req);
      const { valid, invalid: invalidTo } = parseAddressList(req.body?.to);
      const recipients = emailIdentities(Object.hasOwn(req.body ?? {}, 'to') ? valid : getStringList(db, scope, 'email.recipients'));
      const copies = parseAddressList(Object.hasOwn(req.body ?? {}, 'cc') ? req.body.cc : getStringList(db, scope, 'email.cc'));
      const cc = emailIdentities(copies.valid).filter(address => !recipients.some(primary => emailIdentity(primary) === emailIdentity(address)));
      const invalid = [...invalidTo, ...copies.invalid];
      const allRecipients = [...recipients, ...cc];

      if (allRecipients.length === 0) {
        res.status(400).json({
          data: null,
          error: { message: 'No recipients are configured.', code: 'no_recipients' },
        });
        return;
      }

      const senderName = resolveSenderName(db, req);
      const logId = startEmailAttempt(db, scope, {
        kind: 'test', recipients: allRecipients, subject: `SMTP test — ${senderName}`, details: { invalid },
      });

      try {
        // The test of the relay of the workspace uses that relay only. A relay
        // of the member who clicks the button is never a fallback here. One
        // handshake proves the credentials and bounds the time a broken relay
        // can hold the request.
        const result = await mailer.send({
          to: recipients,
          cc,
          subject: `SMTP test — ${senderName}`,
          text: 'This is a test message from ROMANI Flow. SMTP is configured correctly.',
          html: '<p style="font-family:Segoe UI,Arial,sans-serif">This is a test message from <strong>ROMANI Flow</strong>. SMTP is configured correctly.</p>',
        }, scope, { workspaceOnly: true, deadlineMs: SMTP_TEST_DEADLINE_MS });

        finishEmailAttempt(db, scope, logId, {
          status: result.status,
          error: result.rejected.length ? 'Some recipients were rejected by the relay.' : undefined,
          details: { invalid, messageId: result.messageId, accepted: result.accepted, rejected: result.rejected },
        });

        if (result.status === 'partial') {
          res.status(502).json({ data: { sent: false, status: result.status },
            error: { message: 'The relay did not accept every test recipient.', code: 'partial_delivery' } });
          return;
        }
        res.json({ data: { sent: true, recipients: allRecipients, invalid, messageId: result.messageId }, error: null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const status = error instanceof MailError ? error.status : 502;
        const code = error instanceof MailError ? error.code : 'send_failed';
        finishEmailAttempt(db, scope, logId, { status: 'failed', error: detail });
        res.status(status).json({ data: null, error: { message: detail, code } });
      }
    }),
  );

  router.get(
    '/expiry-preview',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const windowDays = getNumber(db, tenantOf(req), 'cron.days', 30);
      const intervals = parseIntervals(getRawList(db, tenantOf(req), 'email.notification_intervals'));
      const report = collectExpiring(db, tenantOf(req), {
        windowDays,
        includeEmployees: getBoolean(db, tenantOf(req), 'cron.include_employees'),
        includeDocuments: getBoolean(db, tenantOf(req), 'cron.include_documents'),
        intervals,
      });

      res.json({
        data: {
          employees: report.employees,
          documents: report.documents,
          asOfDate: report.generatedAt.toISOString().slice(0, 10),
          windowDays,
          intervals,
        },
        error: null,
      });
    }),
  );

  router.post(
    '/expiry-report',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const result = await cron.run('manual', tenantOf(req));
      res.json({
        data: {
          sent: result.sent,
          skipped: result.skipped ?? null,
          error: result.error ?? null,
        },
        error: null,
      });
    }),
  );

  router.post(
    '/send-documents',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const rawIds: string[] = Array.isArray(req.body?.document_ids)
        ? req.body.document_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [];

      // The same document selected twice must not be attached twice.
      const documentIds = [...new Set(rawIds)];

      const to = parseAddressList(req.body?.to);
      const cc = parseAddressList(req.body?.cc);
      const bcc = parseAddressList(req.body?.bcc);

      if (documentIds.length === 0) {
        res.status(400).json({
          data: null,
          error: { message: 'Select at least one document to send.', code: 'no_documents' },
        });
        return;
      }

      // Nothing reaches SMTP unless every recipient address is valid.
      const invalidFields = {
        to: to.invalid,
        cc: cc.invalid,
        bcc: bcc.invalid,
      };
      const hasInvalidAddress =
        invalidFields.to.length > 0 ||
        invalidFields.cc.length > 0 ||
        invalidFields.bcc.length > 0;

      if (hasInvalidAddress || to.valid.length === 0) {
        res.status(400).json({
          data: null,
          error: {
            message: hasInvalidAddress
              ? 'Some recipient addresses are not valid.'
              : 'At least one valid recipient is required.',
            code: 'invalid_recipients',
            fields: invalidFields,
          },
        });
        return;
      }

      // Every selected document must exist and have a stored file. A partial
      // batch is refused rather than sent as a half-empty message.
      const documents: Row[] = [];
      const missing: Array<{ document_id: string; title: string; reason: string }> = [];

      for (const id of documentIds) {
        const document = findRow(db, tenantOf(req), 'documents', id, []);
        if (!document) {
          missing.push({ document_id: id, title: id, reason: 'not_found' });
          continue;
        }
        const filePath = document.file_path as string | undefined;
        if (!filePath || !storage.exists(filePath)) {
          missing.push({
            document_id: id,
            title: String(document.title ?? ''),
            reason: 'no_file',
          });
          continue;
        }
        documents.push(document);
      }

      if (missing.length > 0) {
        res.status(409).json({
          data: null,
          error: {
            message: 'Some of the selected documents have no stored file.',
            code: 'missing_files',
            missing,
          },
        });
        return;
      }

      // The encoded message is larger than the raw files, so the real size of
      // the MIME body is what decides whether it fits.
      let rawBytes = 0;
      for (const document of documents) {
        const filePath = document.file_path as string;
        rawBytes += storage.stat(filePath).size;
      }

      const encodedBytes = Math.ceil((rawBytes * 4) / 3) + documents.length * 1024;
      const limit = Math.min(config.maxEmailAttachmentBytes, config.maxEmailMessageBytes);

      if (encodedBytes > limit) {
        const limitMb = Math.round(limit / (1024 * 1024));
        res.status(400).json({
          data: null,
          error: {
            message: `The encoded message would be larger than ${limitMb} MB. Select fewer documents.`,
            code: 'attachments_too_large',
            rawBytes,
            encodedBytes,
          },
        });
        return;
      }

      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      const senderName = resolveSenderName(db, req);
      const language = getString(db, tenantOf(req), 'email.language', 'ar') === 'en' ? 'en' : 'ar';
      const fallbackSubject = language === 'ar'
        ? 'مستندات من ' + senderName
        : 'Documents from ' + senderName;
      const subject = String(req.body?.subject ?? '').trim() || fallbackSubject;

      // The attempt is recorded before the files are read and handed to SMTP.
      const logId = startEmailAttempt(db, tenantOf(req), {
        kind: 'documents',
        recipients: to.valid,
        subject,
        attachmentCount: documents.length,
        attachmentBytes: encodedBytes,
        triggerSource: 'manual',
        details: { cc: cc.valid, bcc: bcc.valid },
      });

      try {
        const attachments = [];
        for (const document of documents) {
          const filePath = document.file_path as string;
          attachments.push({
            filename: (document.file_name as string | undefined) ?? 'document',
            content: await storage.read(filePath),
            contentType: (document.mime_type as string | undefined) ?? 'application/octet-stream',
          });
        }

        const result = await mailer.send({
          to: to.valid,
          cc: cc.valid.length > 0 ? cc.valid : undefined,
          bcc: bcc.valid.length > 0 ? bcc.valid : undefined,
          subject,
          text: documentEmailText({
            documents: documents.map((document) => ({
              title: String(document.title ?? ''),
              fileName: (document.file_name as string | undefined) ?? null,
            })),
            message,
            senderName,
            language,
          }),
          html: documentEmailHtml({
            documents: documents.map((document) => ({
              title: String(document.title ?? ''),
              fileName: (document.file_name as string | undefined) ?? null,
            })),
            message,
            senderName,
            language,
          }),
          attachments,
        }, tenantOf(req));

        finishEmailAttempt(db, tenantOf(req), logId, {
          status: result.status,
          error:
            result.rejected.length > 0
              ? `Rejected recipients: ${result.rejected.join(', ')}`
              : undefined,
        });

        res.json({
          data: {
            sent: result.status === 'sent',
            status: result.status,
            recipients: result.accepted,
            rejected: result.rejected,
            attachments: attachments.length,
            encodedBytes,
          },
          error: null,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        finishEmailAttempt(db, tenantOf(req), logId, { status: 'failed', error: detail });
        res.status(502).json({ data: null, error: { message: detail, code: 'send_failed' } });
      }
    }),
  );

  return router;
}
