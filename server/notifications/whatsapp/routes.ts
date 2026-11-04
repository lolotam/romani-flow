import { Router, type Request } from 'express';
import type { NodeEnv } from '../../config.js';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { RepositoryError } from '../../repositories/base.js';
import { normalizeWhatsAppPhone } from './phone.js';
import type { WhatsAppReminders } from './service.js';
import { isManualRetryFailure, isValidReminderText } from './contracts.js';

function body(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new RepositoryError('An object is required.', 'invalid_body', 400);
  return req.body;
}
function page(req: Request): { limit: number; offset: number } {
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new RepositoryError('Invalid pagination.', 'invalid_query', 400);
  return { limit, offset };
}

export function createReminderRouter(reminders: WhatsAppReminders, env: NodeEnv): Router {
  const router = Router(), db = reminders.db;
  router.use(requireAdmin, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['x-project', 'x-project-id', 'x-instance', 'x-instance-name'].some(name => req.get(name)) ||
        ['instance', 'instanceName', 'project', 'url', 'apikey'].some(name => name in req.query)) {
      next(new RepositoryError('Project overrides are forbidden.', 'project_override_forbidden', 400)); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = env === 'production' ? 'https://romani.curemedkw.com' : `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== expected) { next(new RepositoryError('Foreign origin refused.', 'origin_forbidden', 403)); return; }
    }
    next();
  });
  router.get('/recipients', (req, res, next) => {
    try {
      const { limit, offset } = page(req);
      const items = db.prepare('SELECT * FROM whatsapp_recipients ORDER BY created_at,id LIMIT ? OFFSET ?').all(limit, offset)
        .map(row => ({ ...row, enabled: Boolean(row.enabled) }));
      res.json({ data: { items, total: (db.prepare('SELECT count(*) total FROM whatsapp_recipients').get()!).total }, error: null });
    } catch (error) { next(error); }
  });
  router.post('/recipients', asyncHandler(async (req, res) => {
    const payload = body(req);
    const id = await reminders.mutate(() => reminders.store.saveRecipient(payload));
    res.status(201).json({ data: { id }, error: null });
  }));
  router.patch('/recipients/:id', asyncHandler(async (req, res) => {
    const payload = body(req);
    const id = await reminders.mutate(() => reminders.store.saveRecipient(payload, String(req.params.id)));
    res.json({ data: { id }, error: null });
  }));
  router.delete('/recipients/:id', asyncHandler(async (req, res) => {
    await reminders.mutate(() => {
      if (!db.prepare('DELETE FROM whatsapp_recipients WHERE id=?').run(String(req.params.id)).changes) throw new RepositoryError('Recipient not found.', 'not_found', 404);
    });
    res.json({ data: { deleted: true }, error: null });
  }));
  router.get('/log', (req, res, next) => {
    try {
      const { limit, offset } = page(req), where = ['instance=?'], values: (string | number)[] = [reminders.auditInstance];
      if (req.query.state !== undefined) {
        if (typeof req.query.state !== 'string' || !['pending', 'sending', 'provider_accepted', 'retryable_failed', 'permanent_failed', 'unknown', 'cancelled'].includes(req.query.state)) throw new RepositoryError('Invalid state.', 'invalid_query', 400);
        where.push('state=?'); values.push(req.query.state);
      }
      if (req.query.recipient !== undefined) {
        const phone = normalizeWhatsAppPhone(req.query.recipient);
        if (!phone) throw new RepositoryError('Invalid recipient filter.', 'invalid_query', 400);
        where.push('recipient=?'); values.push(phone);
      }
      if (req.query.item !== undefined) {
        if (typeof req.query.item !== 'string' || req.query.item.length > 100) throw new RepositoryError('Invalid item filter.', 'invalid_query', 400);
        where.push("(item_id=? OR item_name LIKE ? ESCAPE '\\')");
        values.push(req.query.item, `%${req.query.item.replace(/[\\%_]/g, value => `\\${value}`)}%`);
      }
      const clause = where.join(' AND ');
      const total = db.prepare(`SELECT count(*) total FROM whatsapp_jobs WHERE ${clause}`).get(...values)!.total;
      const hasCapacity = reminders.store.queueSize() < 2000;
      const items = db.prepare(`SELECT * FROM whatsapp_jobs WHERE ${clause} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...values, limit, offset)
        .map(job => ({ ...job,
          retry_allowed: isValidReminderText(job.text) && normalizeWhatsAppPhone(job.recipient) === job.recipient &&
            Number(job.attempt_count) < 4 && (job.state === 'retryable_failed' || (hasCapacity && job.state === 'permanent_failed' && isManualRetryFailure(job.error_code))),
          attempts: db.prepare('SELECT * FROM whatsapp_attempts WHERE job_id=? ORDER BY attempt').all(String(job.id)) }));
      res.json({ data: { items, total }, error: null });
    } catch (error) { next(error); }
  });
  router.post('/jobs/:id/retry', asyncHandler(async (req, res) => {
    if (Object.keys(body(req)).length || Object.keys(req.query).length) throw new RepositoryError('Retry accepts no overrides.', 'invalid_body', 400);
    await reminders.retry(String(req.params.id));
    res.json({ data: { queued: true }, error: null });
  }));
  return router;
}
