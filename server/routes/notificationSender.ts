import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/connection.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, tenantOf } from '../middleware/auth.js';
import { RepositoryError } from '../repositories/base.js';
import {
  listEligibleMembers, notificationSenderAccountId, setNotificationSender,
} from '../repositories/memberSmtp.js';

const selectionSchema = z.object({ account_id: z.string().min(1).nullable() }).strict();

/**
 * The member that sends the reminders of the workspace.
 *
 * The member does not need a relay of its own: without one the reminders go
 * out through the relay of the workspace, exactly like before. The member is
 * only named so that a workspace can tell who sends its reminders.
 */
export function createNotificationSenderRouter(db: Db): Router {
  const router = Router();
  router.use(requireAdmin);
  router.get('/', asyncHandler(async (req, res) => {
    const workspaceId = tenantOf(req).workspaceId;
    res.json({
      data: {
        accountId: notificationSenderAccountId(db, workspaceId),
        members: listEligibleMembers(db, workspaceId),
      },
      error: null,
    });
  }));
  router.put('/', asyncHandler(async (req, res) => {
    const parsed = selectionSchema.safeParse(req.body);
    if (!parsed.success) throw new RepositoryError('Invalid notification sender.', 'invalid_notification_sender', 400);
    const workspaceId = tenantOf(req).workspaceId;
    const accountId = parsed.data.account_id;
    if (accountId === null) {
      setNotificationSender(db, workspaceId, null);
      res.json({ data: { accountId: null }, error: null });
      return;
    }
    const member = listEligibleMembers(db, workspaceId).find(candidate => candidate.accountId === accountId);
    if (!member) throw new RepositoryError('The member is not eligible.', 'notification_sender_ineligible', 400);
    setNotificationSender(db, workspaceId, accountId);
    res.json({ data: { accountId }, error: null });
  }));
  return router;
}
