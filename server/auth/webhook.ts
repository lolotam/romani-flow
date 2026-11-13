import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { verifyWebhook, type WebhookEvent } from '@clerk/express/webhooks';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { atomic } from '../notifications/whatsapp/repository.js';
import { upsertLocalUser } from './users.js';
import { syncOrganization, suspendOrganization } from './workspaces.js';

function forgetDeletedUser(db: Db, clerkUserId: string): void {
  const now = new Date().toISOString();
  // The event may arrive before the first request stored the user, so a
  // tombstone is written either way. A later sign-in upsert keeps deleted_at
  // and is refused; the stored email and name are removed.
  db.prepare(`
    INSERT INTO users (id, clerk_user_id, email, email_verified, name, deleted_at, created_at, last_seen_at)
    VALUES (?, ?, NULL, 0, NULL, ?, ?, ?)
    ON CONFLICT(clerk_user_id) DO UPDATE SET
      email = NULL, email_verified = 0, name = NULL,
      deleted_at = excluded.deleted_at, last_seen_at = excluded.last_seen_at
  `).run(`usr_${randomUUID()}`, clerkUserId, now, now, now);
  const user = db.prepare('SELECT id FROM users WHERE clerk_user_id = ?').get(clerkUserId) as { id: string };
  // Migration 011 dropped the admin_users foreign keys. These three statements
  // restore that cascade for a platform identity: drafts and defaults go away,
  // and staged uploads stay without a deleted owner.
  db.prepare('DELETE FROM document_drafts WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM form_defaults WHERE user_id = ?').run(user.id);
  db.prepare('UPDATE pending_uploads SET draft_user_id = NULL WHERE draft_user_id = ?').run(user.id);
}

function syncUserEvent(db: Db, event: WebhookEvent): void {
  if (event.type === 'user.deleted') {
    if (event.data.id) forgetDeletedUser(db, event.data.id);
    return;
  }
  if (event.type !== 'user.created' && event.type !== 'user.updated') return;

  const data = event.data;
  const primary = data.email_addresses.find(email => email.id === data.primary_email_address_id);
  const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  upsertLocalUser(db, {
    userId: data.id,
    email: primary?.email_address ?? null,
    emailVerified: primary?.verification?.status === 'verified',
    name: fullName || data.username || primary?.email_address || 'User',
  });
}

function syncEvent(db: Db, event: WebhookEvent): void {
  if (event.type.startsWith('user.')) {
    syncUserEvent(db, event);
    return;
  }
  if (event.type === 'organization.created' || event.type === 'organization.updated') {
    syncOrganization(db, { id: event.data.id, name: event.data.name });
    return;
  }
  if (event.type === 'organization.deleted') {
    if (event.data.id) suspendOrganization(db, event.data.id);
  }
}

/** Verifies the raw request before recording or applying any event. */
export function createClerkWebhookRouter(config: AppConfig, db: Db): Router {
  const router = Router();
  router.post('/', asyncHandler(async (req, res) => {
    let event: WebhookEvent;
    try {
      event = await verifyWebhook(req, { signingSecret: config.clerkWebhookSigningSecret ?? undefined });
    } catch {
      res.status(400).json({ data: null, error: { message: 'Webhook signature verification failed.', code: 'invalid_signature' } });
      return;
    }

    const id = req.get('svix-id') ?? req.get('webhook-id');
    if (!id) {
      res.status(400).json({ data: null, error: { message: 'Webhook id is required.', code: 'invalid_signature' } });
      return;
    }
    const duplicate = !atomic(db, () => {
      const inserted = db.prepare('INSERT OR IGNORE INTO clerk_webhook_events (id, type, received_at) VALUES (?, ?, ?)')
        .run(id, event.type, new Date().toISOString()).changes;
      if (inserted === 0) return false;
      syncEvent(db, event);
      return true;
    });
    res.json({ data: { received: true, duplicate }, error: null });
  }));
  return router;
}
