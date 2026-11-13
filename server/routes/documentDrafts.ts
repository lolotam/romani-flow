import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { requireRole, tenantOf } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { NotificationCoordinator } from '../notifications/coordinator.js';
import { draftReference, readDraft, validateDraftValues, writeDraft } from '../repositories/documentDrafts.js';
import { RepositoryError } from '../repositories/base.js';

/** Unsaved metadata is private to the current authenticated editor account. */
export function createDocumentDraftsRouter(db: Db, coordinator: NotificationCoordinator): Router {
  const router = Router();
  router.use(requireRole('editor'), (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('x-draft-account') !== req.user!.id) { next(new RepositoryError('Draft account changed.', 'draft_conflict', 409)); return; }
    // The form remembers the workspace it was created for. A draft of another
    // workspace is refused instead of being written into this one.
    const draftWorkspace = req.get('x-draft-workspace');
    if (draftWorkspace && draftWorkspace !== tenantOf(req).workspaceId) {
      next(new RepositoryError('Draft workspace changed.', 'draft_workspace_mismatch', 409));
      return;
    }
    next();
  });
  router.get('/:scope', (req, res) => {
    res.json({ data: readDraft(db, tenantOf(req), req.user!.id, String(req.params.scope)), error: null });
  });
  for (const method of ['put', 'delete'] as const) router[method]('/:scope', asyncHandler(async (req, res) => {
    const ref = draftReference({ scope: String(req.params.scope), revision: req.body?.revision });
    const tenant = tenantOf(req);
    const revision = await coordinator.runExclusive(async () => {
      const values = method === 'delete' ? null : validateDraftValues(db, tenant, req.body?.values);
      return writeDraft(db, tenant, req.user!.id, ref, values);
    });
    res.json({ data: { revision }, error: null });
  }));
  return router;
}
