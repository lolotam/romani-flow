import { Router } from 'express';
import { runtimeSnapshot } from '../services/runtime.js';

/**
 * The runtime facts of the API process.
 *
 * The operator asks the same two questions when a request fails in a
 * deployment: is this still the process that started, and how close is it to
 * the memory limit of the host? Both answers live here, and both are read from
 * the container log as well.
 *
 * The route is behind the administrator session: the numbers describe the
 * server, so they never belong to an anonymous visitor.
 */
export function createRuntimeRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ data: runtimeSnapshot(), error: null });
  });

  return router;
}
