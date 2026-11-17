import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { PairingConfig } from './config.js';
import { pairingConfiguration } from './config.js';
import { PairingClient, PairingError } from './pairingClient.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { NodeEnv } from '../config.js';
import type { WhatsAppReminders } from '../notifications/whatsapp/service.js';
import { requireReminderWorkspace } from '../notifications/whatsapp/routes.js';
import {
  getWorkspaceWhatsAppRecord,
  getWorkspaceInstance,
  getPairingPendingUntil,
  setPairingPendingUntil,
} from './instance.js';
export { getWorkspaceInstance };

function fail(res: Response, status: number, code: string): void {
  res.status(status).json({ data: null, error: { code, message: 'WhatsApp connection request could not be completed.' } });
}

function emptyInput(req: Request): boolean {
  return !['x-project', 'x-project-id', 'x-instance', 'x-instance-name'].some(name => req.get(name)) && Object.keys(req.query).length === 0 &&
    (req.body === undefined || (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) && Object.keys(req.body).length === 0));
}

export function createPairingRouter(config: PairingConfig, env: NodeEnv, reminders: WhatsAppReminders): Router {
  const router = Router();
  const connectingWorkspaces = new Set<string>();
  const lastConnectByWorkspace = new Map<string, number>();
  const lastDisconnectByWorkspace = new Map<string, number>();

  router.use(requireReminderWorkspace(reminders), requireAdmin, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (pairingConfiguration(config) === 'invalid') {
      fail(res, 503, 'whatsapp_not_configured');
      return;
    }
    next();
  });

  router.get('/status', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    const scope = tenantOf(req);
    const ws = getWorkspaceWhatsAppRecord(reminders.db, scope.workspaceId, config.instance, config.apiKey);
    const client = new PairingClient({ ...config, instance: ws.instanceName, apiKey: ws.apiKey });
    const pendingPairingUntil = () => getPairingPendingUntil(reminders.db, scope.workspaceId);

    try {
      const status = await client.status();
      res.json({
        data: status.configured && status.state === 'disconnected' && pendingPairingUntil() > Date.now()
          ? { ...status, state: 'connecting' }
          : status,
        error: null,
      });
    }
    catch (error) {
      const e = error instanceof PairingError ? error : new PairingError('provider_unavailable');
      fail(res, e.status, e.code);
    }
  }));

  router.post('/disconnect', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    const expected = env === 'production' ? 'https://romani.curemedkw.com' : `${req.protocol}://${req.get('host')}`;
    if (req.get('origin') && req.get('origin') !== expected) { fail(res, 403, 'origin_forbidden'); return; }

    const scope = tenantOf(req);
    const wsId = scope.workspaceId;
    const isConnecting = connectingWorkspaces.has(wsId);
    const lastDisconnectAt = lastDisconnectByWorkspace.get(wsId) ?? 0;
    if (isConnecting || Date.now() - lastDisconnectAt < 15_000) { fail(res, 429, 'pairing_rate_limited'); return; }

    connectingWorkspaces.add(wsId);
    lastDisconnectByWorkspace.set(wsId, Date.now());
    const ws = getWorkspaceWhatsAppRecord(reminders.db, scope.workspaceId, config.instance, config.apiKey);
    const client = new PairingClient({ ...config, instance: ws.instanceName, apiKey: ws.apiKey });
    const workspaceRuntime = reminders.forWorkspace(scope, ws.instanceName);
    const pendingPairingUntil = () => getPairingPendingUntil(reminders.db, wsId);
    const setPendingPairing = (until: number) => setPairingPendingUntil(reminders.db, wsId, until);

    try {
      const { status, logoutVerified } = await workspaceRuntime.withSendingDisabled(
        () => client.disconnect(pendingPairingUntil() > Date.now()),
        scope,
      );
      if (logoutVerified) {
        lastConnectByWorkspace.set(wsId, 0);
        setPendingPairing(0);
      }
      res.json({ data: status, error: null });
    } catch (error) {
      const e = error instanceof PairingError ? error : new PairingError('provider_unavailable');
      fail(res, e.status, e.code);
    }
    finally {
      connectingWorkspaces.delete(wsId);
    }
  }));

  router.post('/connect', asyncHandler(async (req, res) => {
    if (!emptyInput(req)) { fail(res, 400, 'project_override_forbidden'); return; }
    const origin = req.get('origin');
    const expectedOrigin = env === 'production' ? 'https://romani.curemedkw.com' : `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== expectedOrigin) { fail(res, 403, 'origin_forbidden'); return; }

    const scope = tenantOf(req);
    const wsId = scope.workspaceId;
    const isConnecting = connectingWorkspaces.has(wsId);
    const lastConnectAt = lastConnectByWorkspace.get(wsId) ?? 0;
    if (isConnecting || Date.now() - lastConnectAt < 15_000) {
      res.setHeader('Retry-After', '15'); fail(res, 429, 'pairing_rate_limited'); return;
    }

    connectingWorkspaces.add(wsId);
    lastConnectByWorkspace.set(wsId, Date.now());
    const ws = getWorkspaceWhatsAppRecord(reminders.db, scope.workspaceId, config.instance, config.apiKey);
    const client = new PairingClient({ ...config, instance: ws.instanceName, apiKey: ws.apiKey });
    const setPendingPairing = (until: number) => setPairingPendingUntil(reminders.db, wsId, until);

    try {
      const result = await client.connect();
      setPendingPairing(result.qr ? Date.now() + 60_000 : 0);
      res.json({ data: result, error: null });
    }
    catch (error) {
      const e = error instanceof PairingError ? error : new PairingError('provider_unavailable');
      fail(res, e.status, e.code);
    }
    finally {
      connectingWorkspaces.delete(wsId);
    }
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
    if (Object.keys(req.query).length || !body || typeof body !== 'object' || Array.isArray(body)) {
      fail(res, 403, 'project_mismatch'); return;
    }
    if (typeof body.instance === 'string' && body.instance !== config.instance) {
      fail(res, 403, 'project_mismatch'); return;
    }
    if (body.event !== 'connection.update' || !body.data || !['open', 'close', 'connecting'].includes(body.data.state)) {
      fail(res, 400, 'unsupported_event'); return;
    }
    res.status(202).json({ data: { accepted: true }, error: null });
  });
  return router;
}
