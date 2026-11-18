import type { Request } from 'express';
import type { Db } from '../db/connection.js';
import { tenantOf } from '../middleware/auth.js';
import { getString } from '../repositories/settings.js';
import { getMemberSmtp } from '../repositories/memberSmtp.js';

export const DEFAULT_SENDER_NAME = 'ROMANI Flow';

/**
 * The name an email from the caller is signed with.
 *
 * The personal relay name of the member wins, then the account's own name,
 * and only then the workspace setting — so a message a person sends never
 * reads like it came from the product when the person can be named instead.
 */
export function resolveSenderName(db: Db, req: Request): string {
  const scope = tenantOf(req);
  const memberName = getMemberSmtp(db, scope)?.senderName?.trim();
  if (memberName) return memberName;
  const accountName = req.user?.name.trim();
  if (accountName) return accountName;
  const workspaceName = getString(db, scope, 'email.from_name', DEFAULT_SENDER_NAME).trim();
  return workspaceName || DEFAULT_SENDER_NAME;
}
