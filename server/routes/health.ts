import { Router, type Response } from 'express';
import type { Db } from '../db/connection.js';

/**
 * Health endpoints.
 *
 * `/api/health` is the liveness probe; `/health` is kept because the existing
 * docker-compose health check targets it.
 */

function databaseIsHealthy(db: Db): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function createHealthRouter(db: Db): Router {
  const router = Router();

  router.get('/', (_req, res: Response) => {
    const healthy = databaseIsHealthy(db);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      database: healthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

export function createRootHealthRouter(db: Db, smtpConfigured: () => boolean): Router {
  const router = Router();

  router.get('/', (_req, res: Response) => {
    const healthy = databaseIsHealthy(db);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      database: healthy ? 'ok' : 'error',
      smtp: smtpConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
