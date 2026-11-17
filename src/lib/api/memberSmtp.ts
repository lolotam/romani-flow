/**
 * The typed calls of the two relays of the app.
 *
 * The relay of the workspace is the default and is shared by every account of
 * the workspace. The relay of the signed-in account overrides it for that
 * account only. The password of the member relay is sealed on the server: it
 * is never sent back, so the screen only knows whether one is stored.
 *
 * Every call resolves with the shared `{ data, error }` envelope, so a card
 * never has to handle a rejected promise.
 */

import { request } from './http';

/** The public state of the relay of the signed-in account. */
export interface MemberSmtpDetails {
  configured: boolean;
  /** True when a password is stored. The password itself is never returned. */
  hasPassword: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  username: string | null;
  senderAddress: string | null;
  senderName: string | null;
  lastTestedAt: string | null;
  lastTestStatus: 'succeeded' | 'failed' | null;
  lastTestErrorCode: string | null;
}

/** The body of a save. An omitted `password` keeps the stored one. */
export interface MemberSmtpPayload {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  sender_address: string;
  sender_name?: string;
}

/** The outcome of the test message. */
export interface MemberSmtpTestResult {
  sent: boolean;
  status: string;
}

/** One account of the workspace that may send its reminders. */
export interface NotificationSenderMember {
  accountId: string;
  displayName: string;
  email: string;
  /** The account has a relay of its own with a stored password. */
  hasCompleteSmtp: boolean;
}

/** The account that sends the scheduled reminders of the workspace. */
export interface NotificationSenderDetails {
  accountId: string | null;
  members: NotificationSenderMember[];
}

export const memberSmtp = {
  read: () => request<MemberSmtpDetails>('/api/me/smtp'),
  save: (payload: MemberSmtpPayload) =>
    request<MemberSmtpDetails>('/api/me/smtp', { method: 'PUT', body: payload }),
  remove: () => request<{ deleted: boolean }>('/api/me/smtp', { method: 'DELETE' }),
  /**
   * Sends the test message.
   *
   * The server always sends it to the e-mail address of the account, so the
   * body stays empty and no recipient can be chosen here.
   */
  test: () => request<MemberSmtpTestResult>('/api/me/smtp/test', { method: 'POST', body: {} }),
};

export const notificationSender = {
  read: () => request<NotificationSenderDetails>('/api/workspace/notification-sender'),
  /** `null` clears the designated sender. */
  save: (accountId: string | null) =>
    request<{ accountId: string | null }>('/api/workspace/notification-sender', {
      method: 'PUT',
      body: { account_id: accountId },
    }),
};
