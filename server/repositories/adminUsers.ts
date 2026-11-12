import bcrypt from 'bcryptjs';
import type { Db } from '../db/connection.js';
import { createId } from './base.js';

/**
 * Admin account storage and authentication helpers.
 *
 * Passwords are hashed with bcryptjs (pure JavaScript, so the Docker image needs no
 * native toolchain) and never returned by any read path.
 */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** The workspace this login works in. Clerk organizations replace it in P2. */
  workspace_id: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserWithHash extends AdminUser {
  password_hash: string;
}

const BCRYPT_ROUNDS = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findAdminByEmail(db: Db, email: string): AdminUserWithHash | null {
  const row = db
    .prepare('SELECT * FROM admin_users WHERE email = ?')
    .get(normalizeEmail(email)) as AdminUserWithHash | undefined;
  return row ?? null;
}

export function findAdminById(db: Db, id: string): AdminUser | null {
  const row = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id) as
    | AdminUserWithHash
    | undefined;
  if (!row) return null;
  const { password_hash: _passwordHash, ...admin } = row;
  return admin;
}

export function listAdmins(db: Db): AdminUser[] {
  const rows = db
    .prepare('SELECT id, email, name, role, workspace_id, is_active, last_login_at, created_at, updated_at FROM admin_users ORDER BY created_at')
    .all() as unknown as AdminUser[];
  return rows;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function createAdmin(
  db: Db,
  input: { email: string; name: string; password: string; role?: string; workspaceId: string },
): Promise<AdminUser> {
  const now = new Date().toISOString();
  const id = createId();

  db.prepare(
    `INSERT INTO admin_users (id, email, name, password_hash, role, workspace_id, is_active, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
  ).run(
    id,
    normalizeEmail(input.email),
    input.name,
    await hashPassword(input.password),
    input.role ?? 'admin',
    input.workspaceId,
    now,
    now,
  );

  return findAdminById(db, id) as AdminUser;
}

export function touchLastLogin(db: Db, id: string): void {
  db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
