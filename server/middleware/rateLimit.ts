import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { tenantOf } from './auth.js';

export function createRateLimit(namespace: string, limit: number, windowMs: number): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  function increment(key: string, now: number): boolean {
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
    const tenant = tenantOf(req);
    const limited = [
      increment(`${namespace}:member:${tenant.workspaceId}:${tenant.accountId ?? 'none'}`, now),
      increment(`${namespace}:ip:${req.ip ?? 'unknown'}`, now),
    ].some(Boolean);
    if (limited) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      res.status(429).json({ data: null, error: { message: 'Too many requests. Try again later.', code: 'rate_limited' } });
      return;
    }
    next();
  };
}
