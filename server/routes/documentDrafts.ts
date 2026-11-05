import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { NotificationCoordinator } from '../notifications/coordinator.js';
import { draftReference, readDraft, validateDraftValues, writeDraft } from '../repositories/documentDrafts.js';
import { RepositoryError } from '../repositories/base.js';

/** Unsaved metadata is private to the current authenticated administrator. */
export function createDocumentDraftsRouter(db: Db, coordinator: NotificationCoordinator): Router {
  const router = Router();
  router.use(requireAdmin, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('x-draft-account') !== req.user!.id) { next(new RepositoryError('Draft account changed.', 'draft_conflict', 409)); return; }
    next();
  });
  router.get('/:scope', (req, res) => {
    res.json({ data: readDraft(db, req.user!.id, String(req.params.scope)), error: null });
  });
  for (const method of ['put', 'delete'] as const) router[method]('/:scope', asyncHandler(async (req, res) => {
    const ref = draftReference({ scope: String(req.params.scope), revision: req.body?.revision });
    const revision = await coordinator.runExclusive(async () => {
      const values = method === 'delete' ? null : validateDraftValues(db, req.body?.values);
      return writeDraft(db, req.user!.id, ref, values);
    });
    res.json({ data: { revision }, error: null });
  }));
  return router;
}
