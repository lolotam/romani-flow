import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * D8 guard: every raw SQL statement that touches a tenant table must mention
 * `workspace_id`, unless it is listed below with the reason it is safe.
 *
 * The generic repository helpers add the scope themselves (they build the SQL
 * from a table name), so this guard is aimed at hand-written statements.
 */

const TENANT_TABLES = ['companies', 'ministries', 'document_types', 'positions', 'employees', 'documents',
  'email_log', 'expiry_notifications', 'pending_uploads', 'form_defaults', 'document_drafts',
  'whatsapp_recipients', 'whatsapp_jobs', 'whatsapp_attempts', 'workspace_settings', 'admin_users', 'upload_cleanup_queue'];

/** A table name chosen at run time can be any tenant table, so it is held to the same rule. */
const INTERPOLATED_TABLE = /\b(?:FROM|INTO|UPDATE|JOIN)\s+"?\$\{/i;

const TABLE_REFERENCE = new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN)\\s+"?(${TENANT_TABLES.join('|')})\\b`, 'i');

/** Statements that are safe without a workspace filter, and why. Match by file and a unique fragment. */
const ALLOWED = [
  { file: 'server/services/documentService.ts', fragment: 'DELETE FROM pending_uploads WHERE file_path=?',
    reason: 'Maintenance sweep by a server-generated path; returns nothing to a client.' },
  { file: 'server/services/documentService.ts', fragment: 'SELECT file_path FROM pending_uploads WHERE created_at < ?',
    reason: 'Stale-upload sweep across all workspaces; paths are server-generated.' },
  { file: 'server/services/documentService.ts', fragment: 'SELECT file_path FROM upload_cleanup_queue',
    reason: 'The same stale-file sweep; it only deletes files and returns nothing to a client.' },
  { file: 'server/services/documentService.ts', fragment: 'DELETE FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'file_path is the primary key: a server-generated storage path, never client-chosen.' },
  { file: 'server/services/documentService.ts', fragment: 'SELECT upload_id,draft_user_id,draft_scope FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'Lookup by the primary-key storage path the service itself just generated.' },
  { file: 'server/services/documentService.ts', fragment: 'SELECT 1 FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'Existence check by the primary-key storage path the service itself just generated.' },
  { file: 'server/repositories/base.ts', fragment: 'SELECT * FROM "${spec.name}"${whereSql}${orderSql}',
    reason: 'listRows: buildWhere(spec, scope, …) adds the workspace filter.' },
  { file: 'server/repositories/base.ts', fragment: 'SELECT COUNT(*) AS total FROM "${spec.name}"${sql}',
    reason: 'countRows: buildWhere(spec, scope, …) adds the workspace filter.' },
  { file: 'server/repositories/base.ts', fragment: 'INSERT INTO "${spec.name}" (',
    reason: 'insertRow appends the workspace_id column for every tenant table.' },
  { file: 'server/db/seed.ts', fragment: 'SELECT COUNT(*) AS total FROM "${table}"',
    reason: 'Boot-time emptiness check before the first import; no request context.' },
  { file: 'server/db/seed.ts', fragment: 'INSERT INTO "${table}" (',
    reason: 'insertPreservingHistory sets workspace_id to the legacy workspace in its values.' },
  { file: 'server/repositories/adminUsers.ts', fragment: 'SELECT * FROM admin_users WHERE email = ?',
    reason: 'Identity resolution at sign-in: the account row is what yields the workspace.' },
  { file: 'server/repositories/adminUsers.ts', fragment: 'SELECT * FROM admin_users WHERE id = ?',
    reason: 'Identity resolution of the authenticated session: the account row yields the workspace.' },
  { file: 'server/repositories/adminUsers.ts', fragment: 'UPDATE admin_users SET last_login_at = ? WHERE id = ?',
    reason: 'Touches only the signing-in account itself.' },
  { file: 'server/extraction/policy.ts', fragment: 'SELECT role FROM admin_users WHERE id = ? AND is_active = 1',
    reason: 'Re-reads the role of the authenticated account itself.' },
  { file: 'server/index.ts', fragment: 'SELECT COUNT(*) AS total FROM admin_users',
    reason: 'Boot-time bootstrap check for whether any account exists; no request context.' },
];

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

/** String literals of a TypeScript source: '…', "…" and `…` (template bodies kept verbatim). */
function literals(source) {
  const found = [];
  const pattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const match of source.matchAll(pattern)) found.push({ text: match[0], index: match.index });
  return found;
}

function unscopedStatements() {
  const offenders = [];
  for (const file of sourceFiles(path.resolve('server'))) {
    const rel = path.relative(process.cwd(), file).replaceAll('\\', '/');
    if (rel.startsWith('server/db/migrations/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const { text, index } of literals(source)) {
      const table = TABLE_REFERENCE.exec(text)?.[1] ?? (INTERPOLATED_TABLE.test(text) ? '${table}' : undefined);
      // `${tenant.sql}` is the `andScope` fragment of the generic helpers.
      if (!table || /workspace_id|\$\{tenant\.sql\}/.test(text)) continue;
      if (ALLOWED.some(rule => rule.file === rel && text.includes(rule.fragment))) continue;
      const line = source.slice(0, index).split('\n').length;
      offenders.push(`${rel}:${line} [${table}] ${text.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  return offenders;
}

test('every raw tenant-table statement is scoped to a workspace or allow-listed with a reason', () => {
  const offenders = unscopedStatements();
  assert.deepEqual(offenders, [], `Unscoped tenant SQL:\n${offenders.join('\n')}`);
});

test('every allow-list entry still matches a statement, so stale exceptions do not linger', () => {
  for (const rule of ALLOWED) {
    const source = fs.readFileSync(path.resolve(rule.file), 'utf8');
    assert.ok(source.includes(rule.fragment), `${rule.file} no longer contains: ${rule.fragment}`);
    assert.ok(rule.reason.length > 10, 'each exception states why it is safe');
  }
});
