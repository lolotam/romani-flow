import { request } from './http';
import { formPatch } from '../formPatch';

export interface WhatsAppPairingStatus {
  configured: boolean;
  state: 'unconfigured' | 'connected' | 'connecting' | 'disconnected' | 'unknown';
}

export interface WhatsAppPairingResult extends WhatsAppPairingStatus {
  qr?: string;
  expiresInSeconds?: number;
}

export const whatsappPairing = {
  status: () => request<WhatsAppPairingStatus>('/api/whatsapp/status'),
  connect: () => request<WhatsAppPairingResult>('/api/whatsapp/connect', { method: 'POST', body: {} }),
  disconnect: () => request<WhatsAppPairingStatus>('/api/whatsapp/disconnect', { method: 'POST', body: {}, timeoutMs: 60_000 }),
};

export interface WhatsAppRecipient { id: string; label: string; phone: string; enabled: boolean }
export type WhatsAppJobState = 'pending' | 'sending' | 'provider_accepted' | 'retryable_failed' | 'permanent_failed' | 'unknown' | 'cancelled';
export interface WhatsAppAttempt { id: string; text: string; state: WhatsAppJobState; started_at: string; recipient_label: string; recipient: string; error_code: string | null }
export interface WhatsAppLogItem {
  id: string; item_id: string; item_name: string; owner_name: string; expiry_date: string;
  recipient: string; recipient_label: string; audience: 'management' | 'employee';
  state: WhatsAppJobState; attempt_count: number; retry_allowed: boolean; text: string; created_at: string; attempts: WhatsAppAttempt[]; error_code: string | null;
}
export interface WhatsAppPage<T> { items: T[]; total: number }
export interface WhatsAppLogFilter { state?: string; recipient?: string; item?: string; offset?: number }
export const whatsappReminders = {
  recipients: (offset = 0, signal?: AbortSignal) => request<WhatsAppPage<WhatsAppRecipient>>(`/api/whatsapp/recipients?limit=20&offset=${offset}`, { signal }),
  saveRecipient: (body: Omit<WhatsAppRecipient, 'id'>, id?: string, changes?: Partial<Record<keyof Omit<WhatsAppRecipient, 'id'>, boolean>>) => request<{ id: string }>(`/api/whatsapp/recipients${id ? `/${encodeURIComponent(id)}` : ''}`, {
    method: id ? 'PATCH' : 'POST',
    body: id ? formPatch(body, changes ?? { label: true }) : body,
  }),
  toggleRecipient: (id: string, enabled: boolean) => request(`/api/whatsapp/recipients/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } }),
  removeRecipient: (id: string) => request(`/api/whatsapp/recipients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  log: (filter: WhatsAppLogFilter, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: '20', offset: String(filter.offset ?? 0) });
    for (const key of ['state', 'recipient', 'item'] as const) if (filter[key]) query.set(key, filter[key]!);
    return request<WhatsAppPage<WhatsAppLogItem>>(`/api/whatsapp/log?${query}`, { signal });
  },
  retry: (id: string) => request(`/api/whatsapp/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} }),
};
