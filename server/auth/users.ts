import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import type { Identity } from './types.js';

export interface LocalUser {
  id: string;
  clerk_user_id: string;
  email: string | null;
  email_verified: number;
  name: string | null;
  deleted_at: string | null;
  created_at: string;
  last_seen_at: string;
}

/** Syncs the primary Clerk profile without ever storing credentials. */
export function upsertLocalUser(db: Db, identity: Pick<Identity, 'userId' | 'email' | 'emailVerified' | 'name'>): LocalUser {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, clerk_user_id, email, email_verified, name, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clerk_user_id) DO UPDATE SET
      email = excluded.email,
      email_verified = excluded.email_verified,
      name = excluded.name,
      last_seen_at = excluded.last_seen_at
  `).run(`usr_${randomUUID()}`, identity.userId, identity.email?.trim() || null,
    identity.emailVerified ? 1 : 0, identity.name, now, now);
  return db.prepare('SELECT * FROM users WHERE clerk_user_id = ?').get(identity.userId) as unknown as LocalUser;
}
