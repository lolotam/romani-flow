import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { isSmtpConfigured } from '../config.js';
import { emailIdentity, emailIdentities } from './emailAddress.js';
import type { Db } from '../db/connection.js';
import type { Scope } from '../repositories/base.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';
import { getWorkspaceSmtp } from '../repositories/smtpSettings.js';
import { createSecureLookup } from './smtpSecurity.js';

/**
 * SMTP transport.
 *
 * Supports global configuration (legacy Romani fallback) as well as per-workspace
 * custom SMTP settings for strict multi-tenant sender isolation.
 */

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
}

export interface MailResult {
  /** `partial` means the relay accepted some recipients and rejected others. */
  status: 'sent' | 'partial';
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export class Mailer {
  private defaultTransporter: Transporter | null = null;
  private workspaceTransporters = new Map<string, { transporter: Transporter; from: string; signature: string }>();

  constructor(private readonly config: AppConfig, private db?: Db) {}

  setDb(db: Db): void {
    this.db = db;
  }

  isConfigured(scope?: Scope): boolean {
    if (scope && this.db) {
      const custom = getWorkspaceSmtp(this.db, scope.workspaceId);
      if (custom && custom.host && custom.user && custom.pass && custom.from) {
        return true;
      }
      if (scope.workspaceId === LEGACY_WORKSPACE_ID) {
        return isSmtpConfigured(this.config);
      }
      return false;
    }
    return isSmtpConfigured(this.config);
  }

  private getTransport(scope?: Scope): { transporter: Transporter; from: string } {
    if (scope && this.db) {
      const custom = getWorkspaceSmtp(this.db, scope.workspaceId);
      if (custom && custom.host && custom.user && custom.pass && custom.from) {
        const signature = `${custom.host}:${custom.port}:${custom.user}:${custom.pass}:${custom.from}:${custom.secure}`;
        const cached = this.workspaceTransporters.get(scope.workspaceId);
        if (cached && cached.signature === signature) {
          return { transporter: cached.transporter, from: cached.from };
        }
        const transporter = nodemailer.createTransport({
          host: custom.host,
          port: custom.port,
          secure: custom.secure,
          auth: {
            user: custom.user,
            pass: custom.pass,
          },
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 30_000,
          lookup: createSecureLookup(),
        } as nodemailer.TransportOptions);
        this.workspaceTransporters.set(scope.workspaceId, {
          transporter,
          from: custom.from,
          signature,
        });
        return { transporter, from: custom.from };
      }

      if (scope.workspaceId !== LEGACY_WORKSPACE_ID) {
        throw new MailError(
          'SMTP is not configured for this workspace. Configure your email server in Settings.',
          'smtp_not_configured',
          503,
        );
      }
    }

    if (!isSmtpConfigured(this.config)) {
      throw new MailError(
        'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the environment or workspace settings.',
        'smtp_not_configured',
        503,
      );
    }

    if (!this.defaultTransporter) {
      this.defaultTransporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.pass as string,
        },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
    }

    return { transporter: this.defaultTransporter, from: this.config.smtp.from };
  }

  /** Sends one message. Rejects empty recipient lists before touching the network. */
  async send(message: MailMessage, scope?: Scope): Promise<MailResult> {
    const to = emailIdentities(message.to);
    const cc = message.cc ? emailIdentities(message.cc).filter(address => !to.some(primary => emailIdentity(primary) === emailIdentity(address))) : undefined;
    const bcc = message.bcc ? emailIdentities(message.bcc).filter(address => ![...to, ...(cc ?? [])].some(primary => emailIdentity(primary) === emailIdentity(address))) : undefined;
    if (to.length === 0 && !cc?.length && !bcc?.length) {
      throw new MailError('At least one recipient is required.', 'no_recipients', 400);
    }

    const { transporter, from } = this.getTransport(scope);

    try {
      const info = await transporter.sendMail({
        from,
        to,
        cc,
        bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });

      const accepted = emailIdentities((info.accepted ?? []).map((address: unknown) => String(address))).map(emailIdentity);
      const rejected = emailIdentities((info.rejected ?? []).map((address: unknown) => String(address))).map(emailIdentity);

      const allRecipients = [...to, ...(cc ?? []), ...(bcc ?? [])];
      const missing = allRecipients.filter(
        (address) => !accepted.includes(emailIdentity(address)) && !rejected.includes(emailIdentity(address)),
      );

      return {
        status: rejected.length > 0 || missing.length > 0 ? 'partial' : 'sent',
        messageId: info.messageId,
        accepted,
        rejected: [...rejected, ...missing],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const provenUnsent = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EDNS'].includes(code);
      const rejectedBeforeData = code === 'EAUTH' || code === 'EENVELOPE';
      const failureCode = provenUnsent ? 'connection_failed' : rejectedBeforeData ? 'smtp_rejected' : 'send_failed';
      throw new MailError(`The message could not be sent: ${detail}`, failureCode, 502);
    }
  }

  /** Verifies the SMTP credentials without sending anything to a recipient. */
  async verify(scope?: Scope): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured(scope)) {
      return { ok: false, message: 'SMTP is not configured.' };
    }

    try {
      const { transporter } = this.getTransport(scope);
      await transporter.verify();
      return { ok: true, message: 'SMTP connection succeeded.' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `SMTP connection failed: ${detail}` };
    }
  }
}
