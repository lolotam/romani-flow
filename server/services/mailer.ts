import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { isSmtpConfigured } from '../config.js';

/**
 * SMTP transport.
 *
 * Credentials come from the environment only — the password is never written to
 * the database and never leaves the server. The Settings screen shows whether
 * SMTP is configured and can trigger a test send.
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
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return isSmtpConfigured(this.config);
  }

  private getTransport(): Transporter {
    if (!this.isConfigured()) {
      throw new MailError(
        'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the environment.',
        'smtp_not_configured',
        503,
      );
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.pass as string,
        },
        // Fail fast instead of hanging on an unreachable relay.
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
    }

    return this.transporter;
  }

  /** Sends one message. Rejects empty recipient lists before touching the network. */
  async send(message: MailMessage): Promise<MailResult> {
    const to = message.to.filter((address) => address.trim().length > 0);
    if (to.length === 0) {
      throw new MailError('At least one recipient is required.', 'no_recipients', 400);
    }

    const transport = this.getTransport();

    try {
      const info = await transport.sendMail({
        from: this.config.smtp.from,
        to,
        cc: message.cc?.filter((address) => address.trim().length > 0),
        bcc: message.bcc?.filter((address) => address.trim().length > 0),
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });

      // The relay can accept some recipients and reject others. That has to be
      // visible, otherwise the rejected recipients would never be retried.
      const accepted = (info.accepted ?? []).map((address: unknown) => String(address));
      const rejected = (info.rejected ?? []).map((address: unknown) => String(address));

      const allRecipients = [...to, ...(message.cc ?? []), ...(message.bcc ?? [])];
      const missing = allRecipients.filter(
        (address) => !accepted.includes(address) && !rejected.includes(address),
      );

      return {
        status: rejected.length > 0 || missing.length > 0 ? 'partial' : 'sent',
        messageId: info.messageId,
        accepted,
        rejected: [...rejected, ...missing],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MailError(`The message could not be sent: ${detail}`, 'send_failed', 502);
    }
  }

  /** Verifies the SMTP credentials without sending anything to a recipient. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) {
      return { ok: false, message: 'SMTP is not configured.' };
    }

    try {
      await this.getTransport().verify();
      return { ok: true, message: 'SMTP connection succeeded.' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `SMTP connection failed: ${detail}` };
    }
  }
}
