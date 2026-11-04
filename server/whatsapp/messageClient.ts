import type { PairingConfig } from './config.js';
import { pairingConfiguration } from './config.js';
import { PairingClient } from './pairingClient.js';
import type { SendOutcome, WhatsAppTransport } from '../notifications/whatsapp/contracts.js';
import { normalizeWhatsAppPhone } from '../notifications/whatsapp/phone.js';

/** Contract: docs/WHATSAPP_SEND_CONTRACT.md, pinned custom source f1100ad. */
export class MessageClient implements WhatsAppTransport {
  private readonly pairing: PairingClient;
  constructor(private readonly config: PairingConfig) { this.pairing = new PairingClient(config); }
  status() { return this.pairing.status(); }

  async sendText(phone: string, text: string): Promise<SendOutcome> {
    if (pairingConfiguration(this.config) !== 'valid') return { kind: 'permanent_failed', code: 'whatsapp_not_configured' };
    const origin = new URL(this.config.url).origin;
    if (this.config.instance !== 'romani' || this.config.url.replace(/\/+$/, '') !== origin) return { kind: 'permanent_failed', code: 'whatsapp_not_configured' };
    if (normalizeWhatsAppPhone(phone) !== phone) return { kind: 'permanent_failed', code: 'invalid_number' };
    if (!text.trim() || text.length > 4096) return { kind: 'permanent_failed', code: 'invalid_text' };
    try {
      const response = await fetch(`${origin}/message/sendText/romani`, {
        method: 'POST', headers: { apikey: this.config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ number: phone.slice(1), text, linkPreview: false }),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if ([401, 403].includes(response.status)) {
        await response.body?.cancel(); return { kind: 'permanent_failed', code: 'provider_unauthorized' };
      }
      if (response.status !== 201) {
        await response.body?.cancel(); return { kind: 'unknown', code: 'provider_uncertain_response' };
      }
      const reader = response.body?.getReader();
      if (!reader) return { kind: 'unknown', code: 'invalid_provider_response' };
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) { await reader.cancel(); return { kind: 'unknown', code: 'invalid_provider_response' }; }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const key = body?.key;
      if (body?.error || (typeof body?.status === 'number' && body.status >= 400) || typeof key?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key.id) || key.fromMe !== true ||
          (key.remoteJid !== undefined && key.remoteJid !== `${phone.slice(1)}@s.whatsapp.net`) ||
          (body.instanceName !== undefined && body.instanceName !== this.config.instance)) {
        return { kind: 'unknown', code: 'invalid_provider_response' };
      }
      return { kind: 'provider_accepted', messageId: key.id };
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (code && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return { kind: 'retryable_failed', code: 'provider_connection_failed' };
      return { kind: 'unknown', code: 'transport_interrupted' };
    }
  }
}
