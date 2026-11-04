import { pairingConfiguration, type PairingConfig } from './config.js';

export type PairingState = 'unconfigured' | 'connected' | 'connecting' | 'disconnected' | 'unknown';
export interface PairingStatus { configured: boolean; state: PairingState }
export interface PairingResult extends PairingStatus { qr?: string; expiresInSeconds?: number }

export class PairingError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super('WhatsApp connection is unavailable. Check the project integration configuration.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PairingError('invalid_provider_response', 502);
  return value as Record<string, unknown>;
}

/** PNG only: QR payloads are never HTML, SVG, provider error bodies or pairing codes. */
function qrImage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 350_000) throw new PairingError('qr_unavailable', 502);
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new PairingError('qr_unavailable', 502);
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new PairingError('qr_unavailable', 502);
  return value;
}

/** Fixed-instance v2 contract. No discovery, provisioning, logout or message methods. */
export class PairingClient {
  constructor(private readonly config: PairingConfig) {}

  private async call(action: 'connectionState' | 'connect'): Promise<Record<string, unknown>> {
    if (pairingConfiguration(this.config) !== 'valid') throw new PairingError('whatsapp_not_configured');
    const url = `${this.config.url.replace(/\/+$/, '')}/instance/${action}/${encodeURIComponent(this.config.instance)}`;
    try {
      const response = await fetch(url, {
        headers: { apikey: this.config.apiKey }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PairingError(response.status === 404 ? 'instance_not_ready' : 'provider_unavailable', 502);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PairingError('invalid_provider_response', 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 400_000) { await reader.cancel(); throw new PairingError('invalid_provider_response', 502); }
        chunks.push(part.value);
      }
      const payload = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (payload.error || (typeof payload.status === 'number' && payload.status >= 400)) throw new PairingError('provider_unavailable', 502);
      return payload;
    } catch (error) {
      if (error instanceof PairingError) throw error;
      // Discard upstream URLs, headers, keys, session data and exception causes.
      throw new PairingError('provider_unavailable', 502);
    }
  }

  async status(): Promise<PairingStatus> {
    if (pairingConfiguration(this.config) === 'absent') return { configured: false, state: 'unconfigured' };
    const payload = await this.call('connectionState');
    return this.instanceStatus(payload.instance);
  }

  private instanceStatus(payload: unknown): PairingStatus {
    const instance = record(payload);
    if (instance.instanceName !== this.config.instance) throw new PairingError('project_mismatch', 502);
    const state = instance.state;
    if (state === 'open') return { configured: true, state: 'connected' };
    if (state === 'connecting') return { configured: true, state: 'connecting' };
    if (state === 'close' || state === 'closed') return { configured: true, state: 'disconnected' };
    if (state === undefined || state === null || typeof state === 'string') return { configured: true, state: 'unknown' };
    throw new PairingError('invalid_provider_response', 502);
  }

  async connect(): Promise<PairingResult> {
    const status = await this.status();
    if (!status.configured) throw new PairingError('whatsapp_not_configured');
    if (status.state === 'connected') return status;
    if (status.state === 'unknown') throw new PairingError('connection_state_unknown');
    const payload = await this.call('connect');
    if ('instanceName' in payload && payload.instanceName !== this.config.instance) throw new PairingError('project_mismatch', 502);
    if ('instance' in payload) {
      const reported = this.instanceStatus(payload.instance);
      if (reported.state === 'connected') return reported;
    }
    return { configured: true, state: 'connecting', qr: qrImage(payload.base64), expiresInSeconds: 60 };
  }
}
