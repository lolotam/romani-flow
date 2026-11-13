import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { tenantOf } from '../middleware/auth.js';
import { readSubmission, supportsForm } from '../repositories/formDefaults.js';

export function createFormDefaultsRouter(db: Db): Router {
  const router = Router();
  router.get('/:form', (req, res) => {
    const form = String(req.params.form);
    res.setHeader('Cache-Control', 'no-store');
    if (!supportsForm(form)) {
      res.status(400).json({ data: null, error: { code: 'unknown_form', message: 'Unknown form.' } });
      return;
    }
    res.json({ data: readSubmission(db, tenantOf(req), req.user!.id, form), error: null });
  });
  return router;
}
