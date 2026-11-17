import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { isSmtpConfigured } from '../config.js';
import { emailIdentity, emailIdentities, mailboxOf } from './emailAddress.js';
import type { Db } from '../db/connection.js';
import type { Scope } from '../repositories/base.js';
import { LEGACY_WORKSPACE_ID } from '../repositories/workspaces.js';
import { getWorkspaceSmtp } from '../repositories/smtpSettings.js';
import { getMemberSmtp, legacyEnvironmentSmtpRetired } from '../repositories/memberSmtp.js';
import { createSecureLookup } from './smtpSecurity.js';
import { createSmtpDestinationPolicy, type SmtpDestinationPolicy } from './smtpDestination.js';
import { createCredentialEncryption, CredentialEncryptionError, MEMBER_SMTP_AAD } from './credentialEncryption.js';
import { MailError } from './mailError.js';
import { runtimeSnapshot } from './runtime.js';

export { MailError };

/**
 * SMTP transport.
 *
 * The relay of the member that acts wins, then the relay of the workspace, and
 * last the platform relay of the legacy workspace. A member relay therefore
 * overrides the relay of the workspace without replacing it.
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

/**
 * The relay one message leaves through.
 *
 * The origin is named so the container log can say which relay answered and
 * how long it took. It never carries the password: the sealed password is
 * opened inside the transporter and never leaves it.
 */
interface RelayOrigin {
  transporter: Transporter;
  from: string;
  kind: 'member' | 'workspace' | 'platform';
  host: string;
  port: number;
}

/** The relay did not answer inside the deadline of the request. */
export class MailTimeoutError extends MailError {
  constructor(readonly timeoutMs: number) {
    super(`The mail server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'smtp_timeout', 504);
    this.name = 'MailTimeoutError';
  }
}

/**
 * Socket deadlines for one SMTP exchange.
 *
 * A relay that blackholes the connection has to fail inside the deadline of the
 * browser request. A request that hangs is aborted by the proxy or by the
 * browser, and the operator then sees a broken connection instead of the
 * reason the mail did not go out.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
export const SMTP_GREETING_TIMEOUT_MS = 8_000;
export const SMTP_SOCKET_TIMEOUT_MS = 12_000;

/** Stops waiting for the relay when it does not answer inside the deadline. */
function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  if (!deadlineMs || deadlineMs <= 0) return work;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    const handle = setTimeout(() => reject(new MailTimeoutError(deadlineMs)), deadlineMs);
    handle.unref();
    timer = handle;
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * One line about one exchange with a relay.
 *
 * The line names the relay and the state of the process. It never carries a
 * recipient, a subject or a credential: the log states where a message went,
 * never what it said.
 */
function smtpLine(stage: string, relay: { kind: string; host: string; port: number }, extra: string): string {
  const snapshot = runtimeSnapshot();
  return (
    `[smtp] ${stage} kind=${relay.kind} host=${relay.host} port=${relay.port} ` +
    `uptime=${snapshot.uptimeSeconds}s rss=${snapshot.memory.rssMb}MB heap=${snapshot.memory.heapUsedMb}MB ` +
    extra.trim()
  );
}

export class Mailer {
  private defaultTransporter: Transporter | null = null;
  private workspaceTransporters = new Map<string, { transporter: Transporter; from: string; signature: string }>();
  private readonly policy: SmtpDestinationPolicy;

  constructor(private readonly config: AppConfig, private db?: Db) {
    this.policy = createSmtpDestinationPolicy(config);
  }

  setDb(db: Db): void {
    this.db = db;
  }

  isConfigured(scope?: Scope): boolean {
    if (scope && this.db) {
      if (this.memberRecord(scope)) return true;
      const custom = getWorkspaceSmtp(this.db, scope.workspaceId);
      if (custom && custom.host && custom.user && custom.pass && custom.from) {
        return true;
      }
      if (scope.workspaceId === LEGACY_WORKSPACE_ID) {
        return isSmtpConfigured(this.config) && !legacyEnvironmentSmtpRetired(this.db, scope.workspaceId);
      }
      return false;
    }
    return isSmtpConfigured(this.config);
  }

  /** The relay of the member that acts, when the member saved one. */
  private memberRecord(scope: Scope): ReturnType<typeof getMemberSmtp> {
    if (!this.db || !scope.accountId) return null;
    const record = getMemberSmtp(this.db, scope);
    return record?.passwordCiphertext ? record : null;
  }

  /**
   * The relay of the member that acts.
   *
   * The password is sealed in the database and only opened here, so it never
   * reaches a log, a response or an error message.
   */
  private memberTransport(scope: Scope): RelayOrigin | null {
    const record = this.memberRecord(scope);
    if (!record) return null;
    let password: string;
    try {
      password = createCredentialEncryption(this.config.appEncryptionKey)
        .decrypt(record.passwordCiphertext, MEMBER_SMTP_AAD);
    } catch (error) {
      if (error instanceof CredentialEncryptionError && error.code === 'encryption_not_configured') {
        throw new MailError(
          'The saved SMTP password cannot be opened. Set APP_ENCRYPTION_KEY in the environment.',
          'encryption_not_configured',
          503,
        );
      }
      throw new MailError(
        'The saved SMTP password cannot be opened. The encryption key does not match the stored credentials.',
        'credential_authentication_failed',
        503,
      );
    }
    return {
      transporter: nodemailer.createTransport({
        host: record.host,
        port: record.port,
        secure: record.secure,
        auth: { user: record.username, pass: password },
        requireTLS: !this.policy.allowsPlaintext(record.host),
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        lookup: createSecureLookup(),
      } as nodemailer.TransportOptions),
      from: record.senderName ? `${record.senderName} <${record.senderAddress}>` : record.senderAddress,
      kind: 'member',
      host: record.host,
      port: record.port,
    };
  }

  /** The relay of the workspace, when the workspace saved one. */
  private workspaceTransport(scope: Scope): RelayOrigin | null {
    if (!this.db) return null;
    const custom = getWorkspaceSmtp(this.db, scope.workspaceId);
    if (!custom || !custom.host || !custom.user || !custom.pass || !custom.from) return null;
    const signature = `${custom.host}:${custom.port}:${custom.user}:${custom.pass}:${custom.from}:${custom.secure}`;
    const cached = this.workspaceTransporters.get(scope.workspaceId);
    if (cached && cached.signature === signature) {
      return { transporter: cached.transporter, from: cached.from, kind: 'workspace', host: custom.host, port: custom.port };
    }
    const transporter = nodemailer.createTransport({
      host: custom.host,
      port: custom.port,
      secure: custom.secure,
      auth: {
        user: custom.user,
        pass: custom.pass,
      },
      requireTLS: !this.policy.allowsPlaintext(custom.host),
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      lookup: createSecureLookup(),
    } as nodemailer.TransportOptions);
    this.workspaceTransporters.set(scope.workspaceId, {
      transporter,
      from: custom.from,
      signature,
    });
    return { transporter, from: custom.from, kind: 'workspace', host: custom.host, port: custom.port };
  }

  /** The relay of the platform environment, when the environment has one. */
  private platformTransport(): RelayOrigin | null {
    if (!isSmtpConfigured(this.config)) return null;
    if (!this.defaultTransporter) {
      this.defaultTransporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: {
          user: this.config.smtp.user,
          pass: this.config.smtp.pass as string,
        },
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      });
    }
    return {
      transporter: this.defaultTransporter,
      from: this.config.smtp.from,
      kind: 'platform',
      host: this.config.smtp.host,
      port: this.config.smtp.port,
    };
  }

  private getTransport(scope?: Scope, workspaceOnly = false): RelayOrigin {
    if (scope && this.db) {
      // The relay of the member that acts wins over the relay of the workspace,
      // unless the caller asked for the relay of the workspace only.
      if (!workspaceOnly) {
        const member = this.memberTransport(scope);
        if (member) return member;
      }

      const workspace = this.workspaceTransport(scope);
      if (workspace) return workspace;

      // The platform relay belongs to the legacy workspace only, and only while
      // that workspace has not retired it.
      if (
        scope.workspaceId !== LEGACY_WORKSPACE_ID
        || legacyEnvironmentSmtpRetired(this.db, scope.workspaceId)
      ) {
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

    const platform = this.platformTransport();
    if (!platform) {
      throw new MailError(
        'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the environment or workspace settings.',
        'smtp_not_configured',
        503,
      );
    }

    return platform;
  }

  /**
   * Sends one message. Rejects empty recipient lists before touching the network.
   *
   * `deadlineMs` bounds the whole exchange, so a relay that never answers still
   * produces a reply with a reason instead of a request that hangs.
   * `workspaceOnly` skips the relay of the member that acts, so a test of the
   * relay of the workspace never belongs to another relay.
   */
  async send(
    message: MailMessage,
    scope?: Scope,
    options: { deadlineMs?: number; workspaceOnly?: boolean } = {},
  ): Promise<MailResult> {
    const relay = this.getTransport(scope, options.workspaceOnly === true);
    return this.deliver(message, relay, options);
  }

  /**
   * Sends through the relay of the member that acts.
   *
   * The relay of the workspace is not a fallback here: a test of the member
   * relay has to fail when the member has none, so a green test never belongs
   * to another relay.
   */
  async sendAsMember(message: MailMessage, scope: Scope, options: { deadlineMs?: number } = {}): Promise<MailResult> {
    const member = this.memberTransport(scope);
    if (!member) throw new MailError('You have not saved an SMTP relay yet.', 'smtp_not_configured', 503);
    return this.deliver(message, member, options);
  }

  /**
   * Sends through the relay of the workspace.
   *
   * The relay of the member that acts is not used here: a test of the relay of
   * the workspace has to fail when the workspace has none, so a green test
   * never belongs to another relay.
   */
  async sendAsWorkspace(message: MailMessage, scope: Scope, options: { deadlineMs?: number } = {}): Promise<MailResult> {
    return this.send(message, scope, { ...options, workspaceOnly: true });
  }

  /** One exchange with the relay. The recipients are checked before the network. */
  private async deliver(
    message: MailMessage,
    relay: RelayOrigin,
    options: { deadlineMs?: number },
  ): Promise<MailResult> {
    const { transporter, from } = relay;
    const to = emailIdentities(message.to);
    const cc = message.cc ? emailIdentities(message.cc).filter(address => !to.some(primary => emailIdentity(primary) === emailIdentity(address))) : undefined;
    const bcc = message.bcc ? emailIdentities(message.bcc).filter(address => ![...to, ...(cc ?? [])].some(primary => emailIdentity(primary) === emailIdentity(address))) : undefined;
    if (to.length === 0 && !cc?.length && !bcc?.length) {
      throw new MailError('At least one recipient is required.', 'no_recipients', 400);
    }

    if (!mailboxOf(from)) {
      throw new MailError(
        'The sender address must contain an email address, for example "Company <no-reply@example.com>".',
        'smtp_from_invalid',
        502,
      );
    }

    const startedAt = Date.now();
    console.log(smtpLine('start', relay, `recipients=${to.length}`));

    try {
      const info = await withDeadline(
        transporter.sendMail({
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
        }),
        options.deadlineMs ?? 0,
      );

      const accepted = emailIdentities((info.accepted ?? []).map((address: unknown) => String(address))).map(emailIdentity);
      const rejected = emailIdentities((info.rejected ?? []).map((address: unknown) => String(address))).map(emailIdentity);

      const allRecipients = [...to, ...(cc ?? []), ...(bcc ?? [])];
      const missing = allRecipients.filter(
        (address) => !accepted.includes(emailIdentity(address)) && !rejected.includes(emailIdentity(address)),
      );

      const status = rejected.length > 0 || missing.length > 0 ? 'partial' : 'sent';
      console.log(smtpLine('done', relay, `ms=${Date.now() - startedAt} outcome=${status}`));
      return {
        status,
        messageId: info.messageId,
        accepted,
        rejected: [...rejected, ...missing],
      };
    } catch (error) {
      if (error instanceof MailError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const provenUnsent = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EDNS'].includes(code);
      const failureCode = code === 'ETIMEDOUT'
        ? 'smtp_timeout'
        : code === 'EAUTH'
          ? 'smtp_auth_failed'
          : code === 'EENVELOPE'
            ? 'smtp_sender_rejected'
            : code === 'ETLS'
              ? 'smtp_tls_required'
              : provenUnsent
                ? 'smtp_connection_failed'
                : 'send_failed';
      // The line names the stage and the reason code, never the upstream text:
      // the message may quote a server response that carries an address.
      console.log(smtpLine('fail', relay, `ms=${Date.now() - startedAt} outcome=${failureCode} upstream=${code || 'none'}`));
      throw new MailError(`The message could not be sent: ${detail}`, failureCode, failureCode === 'smtp_timeout' ? 504 : 502);
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
