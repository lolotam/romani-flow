import { ApiRequestError, request, uploadFiles } from './http';

/**
 * Typed calls for the features that have no fluent equivalent:
 * file storage, email, the scheduler and the settings screen.
 */

export interface UploadedFile {
  /** The id the owning record uses to claim this file. */
  upload_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  original_name: string;
}

export interface ExpiryPreviewItem {
  id: string;
  title?: string;
  name?: string;
  expiryDate: string;
  daysRemaining: number;
  isExpired: boolean;
  intervalDays: number;
  documentTypeName?: string | null;
  employeeName?: string | null;
  companyName?: string | null;
  ministryName?: string | null;
}

export interface ExpiryPreview {
  employees: ExpiryPreviewItem[];
  documents: ExpiryPreviewItem[];
  asOfDate: string;
  windowDays: number;
  intervals: number[];
}

export interface CronStatus {
  enabled: boolean;
  /** Omitted when this workspace cannot see the platform schedule. */
  schedule?: string;
  running: boolean;
  lastRunAt: string;
  lastRunResult: string;
  nextRun: string | null;
}

/** Whether the server can send mail. Host, port and username are not returned. */
export interface SmtpStatus {
  configured: boolean;
}

/**
 * `GET /api/email/status`: mail is configured, plus the caller's workspace settings.
 * SMTP host, port and username are not part of this response.
 */
export interface EmailStatus {
  configured: boolean;
  settings?: Record<string, unknown>;
}

export interface AppSettings {
  settings: Record<string, unknown>;
  smtp: SmtpStatus;
}

export interface EmailLogEntry {
  id: string;
  kind: string;
  recipients: string;
  subject: string | null;
  status: string;
  error: string | null;
  attachment_count: number;
  attachment_bytes: number;
  trigger_source: string | null;
  created_at: string;
}

/** The outcome of a "send by email" request. */
export interface SendDocumentsResult {
  /** True when every recipient accepted the message. */
  sent: boolean;
  /** `sent` when everybody accepted, `partial` when some refused it. */
  status: string;
  /** The recipients that accepted the message. */
  recipients: string[];
  /** The recipients that refused it. */
  rejected: string[];
  /** How many files were attached. */
  attachments: number;
  /** The size of the encoded MIME message, in bytes. */
  encodedBytes: number;
}

const files = {
  upload: (selected: File[], draft?: { scope: string; revision: string; account?: string }) => uploadFiles<UploadedFile[]>('/api/files/upload', selected, draft ? { draft: JSON.stringify(draft) } : {}),
  downloadUrl: (documentId: string) => `/api/files/${encodeURIComponent(documentId)}/download`,
  previewUrl: (documentId: string) => `/api/files/${encodeURIComponent(documentId)}/preview`,
  /** Swaps the attachment of an existing document for a staged upload. */
  replace: (documentId: string, uploadId: string) =>
    request<unknown>(`/api/documents/${encodeURIComponent(documentId)}/file`, {
      method: 'PUT',
      body: { upload_id: uploadId },
    }),
  /** Removes the attachment but keeps the document. */
  detach: (documentId: string) =>
    request<unknown>(`/api/documents/${encodeURIComponent(documentId)}/file`, { method: 'DELETE' }),
  photoUrl: (employeeId: string) => `/api/files/employees/${encodeURIComponent(employeeId)}/photo`,
  uploadPhoto: (employeeId: string, photo: File) =>
    uploadFiles<{ photo_path: string }>(`/api/files/employees/${encodeURIComponent(employeeId)}/photo`, [photo], {}, 'PUT'),
  removePhoto: (employeeId: string) =>
    request<unknown>(`/api/files/employees/${encodeURIComponent(employeeId)}/photo`, { method: 'DELETE' }),
};

const email = {
  status: () => request<EmailStatus>('/api/email/status'),
  sendTest: (to: string[], cc?: string[]) => request<{ sent: boolean }>('/api/email/test', { method: 'POST', body: { to, ...(cc === undefined ? {} : { cc }) } }),
  expiryReport: () =>
    request<{ sent: boolean; skipped: string | null; error: string | null }>('/api/email/expiry-report', {
      method: 'POST',
    }),
  expiryPreview: () => request<ExpiryPreview>('/api/email/expiry-preview'),
  sendDocuments: (payload: {
    document_ids: string[];
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    message?: string;
  }) => request<SendDocumentsResult>('/api/email/send-documents', { method: 'POST', body: payload }),
  log: () => request<EmailLogEntry[]>('/api/email/log'),
};

const cron = {
  status: () => request<CronStatus>('/api/cron/status'),
  update: (payload: { schedule: string; enabled?: boolean }) =>
    request<CronStatus>('/api/cron/schedule', { method: 'PUT', body: payload }),
};

const settings = {
  read: () => request<AppSettings>('/api/settings'),
  update: (values: Record<string, unknown>) =>
    request<{ updated: string[]; rejected: Array<{ key: string; reason: string }> }>('/api/settings', {
      method: 'PUT',
      body: { settings: values },
    }),
};

const backup = {
  export: () => request<unknown>('/api/backup/export'),
  erase: () =>
    request<{ erased: string[]; at: string; filesPendingCleanup: number }>('/api/backup/erase', {
      method: 'POST',
      body: { confirmation: 'DELETE ALL' },
    }),
};

export const endpoints = { files, email, cron, settings, backup };

/** A setting the server refused, with the reason. */
export interface RejectedSetting {
  key: string;
  reason: string;
}

/**
 * The settings the server refused to write.
 *
 * The settings endpoint rejects the whole request when one value is invalid and
 * lists the offenders in the error payload, so the screen can point at them.
 */
export function rejectedSettings(error: Error | null): RejectedSetting[] {
  if (!error) return [];

  const details = (error as ApiRequestError).details as
    | { rejected?: RejectedSetting[] }
    | undefined;

  return details?.rejected ?? [];
}

/** A document the server could not attach. */
export interface MissingAttachment {
  document_id: string;
  title: string;
  reason: string;
}

/**
 * The documents the server refused to attach.
 *
 * The send-by-email endpoint answers with 409 when one of the selected
 * documents has no stored file, and lists them in the error payload.
 */
export function missingAttachments(error: Error | null): MissingAttachment[] {
  if (!error) return [];

  const details = (error as ApiRequestError).details as
    | { missing?: MissingAttachment[] }
    | undefined;

  return details?.missing ?? [];
}
