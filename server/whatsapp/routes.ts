import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { PairingConfig } from './config.js';
import { pairingConfiguration } from './config.js';
import { PairingClient, PairingError } from './pairingClient.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { NodeEnv } from '../config.js';
import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { getNumber, setSetting } from '../repositories/settings.js';

/** Shared, durable end of the 60-second QR window; survives restarts and is the same for every worker. */
const PENDING_PAIRING_KEY = 'system.whatsapp_pairing_pending_until';

function fail(res: Response, status: number, code: string): void {
  res.status(status).json({ data: null, error: { code, message: 'WhatsApp connection request could not be completed.' } });
}

function emptyInput(req: Request): boolean {
  return !['x-project', 'x-project-id', 'x-instance', 'x-instance-name'].some(name => req.get(name)) && Object.keys(req.query).length === 0 &&
    (req.body === undefined || (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) && Object.keys(req.body).length === 0));
}

export function createPairingRouter(config: PairingConfig, env: NodeEnv, reminders: WhatsAppReminders): Router {
  const router = Router();
  const client = new PairingClient(config);
  let connecting = false;
  let lastConnectAt = 0;
  let lastDisconnectAt = 0;
  const pendingPairingUntil = () => getNumber(reminders.db, PENDING_PAIRING_KEY, 0);
  const setPendingPairingUntil = (until: number) => setSetting(reminders.db, PENDING_PAIRING_KEY, until);
  router.use(requireAdmin, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/status', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    try {
      const status = await client.status();
      // While a QR the server issued is still valid the provider may keep reporting `close`;
      // report `connecting` so the admin keeps the QR and the disconnect control. `connected` wins.
      res.json({ data: status.configured && status.state === 'disconnected' && pendingPairingUntil() > Date.now() ? { ...status, state: 'connecting' } : status, error: null });
    }
    catch (error) { const e = error instanceof PairingError ? error : new PairingError('provider_unavailable'); fail(res, e.status, e.code); }
  }));
  router.post('/disconnect', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    const expected = env === 'production' ? 'https://romani.curemedkw.com' : `${req.protocol}://${req.get('host')}`;
    if (req.get('origin') && req.get('origin') !== expected) { fail(res, 403, 'origin_forbidden'); return; }
    if (connecting || Date.now() - lastDisconnectAt < 15_000) { fail(res, 429, 'pairing_rate_limited'); return; }
    connecting = true;
    lastDisconnectAt = Date.now();
    try {
      const { status, logoutVerified } = await reminders.withSendingDisabled(() => client.disconnect(pendingPairingUntil() > Date.now()));
      if (logoutVerified) { lastConnectAt = 0; setPendingPairingUntil(0); }
      res.json({ data: status, error: null });
    } catch (error) { const e = error instanceof PairingError ? error : new PairingError('provider_unavailable'); fail(res, e.status, e.code); }
    finally { connecting = false; }
  }));
  router.post('/connect', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    const origin = req.get('origin');
    // Production terminates TLS upstream; its public origin is server-fixed,
    // independent of untrusted forwarded scheme/host and the internal HTTP hop.
    const expectedOrigin = env === 'production' ? 'https://romani.curemedkw.com' : `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== expectedOrigin) { fail(res, 403, 'origin_forbidden'); return; }
    if (connecting || Date.now() - lastConnectAt < 15_000) {
      res.setHeader('Retry-After', '15'); fail(res, 429, 'pairing_rate_limited'); return;
    }
    connecting = true;
    lastConnectAt = Date.now();
    try {
      const result = await client.connect();
      setPendingPairingUntil(result.qr ? Date.now() + 60_000 : 0);
      res.json({ data: result, error: null });
    }
    catch (error) { const e = error instanceof PairingError ? error : new PairingError('provider_unavailable'); fail(res, e.status, e.code); }
    finally { connecting = false; }
  }));
  return router;
}

/** Dedicated per-project bearer header. Connection-only events; no chat persistence. */
export function createPairingWebhook(config: PairingConfig): Router {
  const router = Router();
  router.post('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (pairingConfiguration(config) !== 'valid') { fail(res, 503, 'whatsapp_not_configured'); return; }
    const token = req.get('x-romani-webhook-key') ?? '';
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(hash(token), hash(config.webhookSecret))) { fail(res, 401, 'webhook_unauthorized'); return; }
    const body = req.body;
    if (Object.keys(req.query).length || !body || typeof body !== 'object' || Array.isArray(body) || body.instance !== config.instance) {
      fail(res, 403, 'project_mismatch'); return;
    }
    if (body.event !== 'connection.update' || !body.data || !['open', 'close', 'connecting'].includes(body.data.state)) {
      fail(res, 400, 'unsupported_event'); return;
    }
    // No body/log/cache write, no external action. Status always reads the provider.
    res.status(202).json({ data: { accepted: true }, error: null });
  });
  return router;
}
