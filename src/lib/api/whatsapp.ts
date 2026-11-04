import { request } from './http';

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
};
