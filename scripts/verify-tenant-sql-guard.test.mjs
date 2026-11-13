import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * D8 guard: every raw SQL statement that touches a tenant table must bind that
 * table to a workspace. Mentioning the token `workspace_id` is not enough: the
 * statement needs `workspace_id = ?` (or `= :name`, or `= 'literal'`) inside a
 * WHERE or ON clause, or `workspace_id` in an INSERT column list. `${tenant.sql}`
 * counts: it is the helper fragment `AND "workspace_id" = ?`.
 *
 * The generic repository helpers add the scope themselves (they build the SQL
 * from a table name), so this guard is aimed at hand-written statements.
 */

const TENANT_TABLES = ['companies', 'ministries', 'document_types', 'positions', 'employees', 'documents',
  'email_log', 'expiry_notifications', 'pending_uploads', 'form_defaults', 'document_drafts',
  'whatsapp_recipients', 'whatsapp_jobs', 'whatsapp_attempts', 'workspace_settings', 'admin_users',
  'upload_cleanup_queue', 'workspace_usage'];

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

const TABLE_REF = /\b(FROM|INTO|UPDATE|JOIN)\s+"?([A-Za-z_][\w]*|\$\{[^}]+\})"?/gi;
const INSERT_COLUMNS = /\bINSERT\b(?:\s+OR\s+\w+)?\s+INTO\s+"?([A-Za-z_][\w]*|\$\{[^}]+\})"?\s*\(([^)]*)\)/gi;
/** `workspace_id = ?`, `= :name`, or `= 'literal'` / `= "literal"`. */
const BOUND_PREDICATE = /(?:\b[\w]+\.)?"?workspace_id"?\s*=\s*(?:\?|:[A-Za-z_][\w]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi;
const CLAUSE_KEYWORD = /\b(?:SELECT|FROM|WHERE|SET|ON|VALUES|ORDER|GROUP|LIMIT|HAVING|INSERT|UPDATE|DELETE|INTO|JOIN)\b/gi;

function tenantName(raw) {
  if (raw.startsWith('${')) return '${table}';
  const name = raw.toLowerCase();
  return TENANT_TABLES.includes(name) ? name : null;
}

/** INSERT targets whose column list names workspace_id. One entry per such INSERT. */
function coveredInserts(sql) {
  const covered = [];
  INSERT_COLUMNS.lastIndex = 0;
  for (const match of sql.matchAll(INSERT_COLUMNS)) {
    const name = tenantName(match[1]);
    if (name && /\bworkspace_id\b/i.test(match[2])) covered.push(name);
  }
  return covered;
}

/** Predicates that sit in a WHERE or ON clause, plus each `${tenant.sql}` helper fragment. */
function boundPredicates(sql) {
  let count = 0;
  BOUND_PREDICATE.lastIndex = 0;
  for (const match of sql.matchAll(BOUND_PREDICATE)) {
    let nearest = '';
    CLAUSE_KEYWORD.lastIndex = 0;
    for (const keyword of sql.slice(0, match.index).matchAll(CLAUSE_KEYWORD)) nearest = keyword[0].toUpperCase();
    if (nearest === 'WHERE' || nearest === 'ON') count += 1;
  }
  count += sql.match(/\$\{tenant\.sql\}/g)?.length ?? 0;
  return count;
}

/**
 * Tenant tables in `sql` that are not bound to a workspace.
 * An INSERT is bound when its column list includes workspace_id. Every other
 * reference needs its own WHERE/ON predicate, so one predicate cannot cover
 * two tables.
 */
function unboundTables(sql) {
  const covered = coveredInserts(sql);
  const unbound = [];
  TABLE_REF.lastIndex = 0;
  for (const match of sql.matchAll(TABLE_REF)) {
    const name = tenantName(match[2]);
    if (!name) continue;
    if (match[1].toUpperCase() === 'INTO') {
      const index = covered.indexOf(name);
      if (index >= 0) {
        covered.splice(index, 1);
        continue;
      }
    }
    unbound.push(name);
  }
  const predicates = boundPredicates(sql);
  // Each remaining reference needs a predicate of its own.
  return predicates >= unbound.length ? [] : unbound;
}

function unscopedStatements() {
  const offenders = [];
  for (const file of sourceFiles(path.resolve('server'))) {
    const rel = path.relative(process.cwd(), file).replaceAll('\\', '/');
    if (rel.startsWith('server/db/migrations/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const { text, index } of literals(source)) {
      TABLE_REF.lastIndex = 0;
      const mentionsTenant = TABLE_REFERENCE.test(text) || INTERPOLATED_TABLE.test(text);
      TABLE_REFERENCE.lastIndex = 0;
      if (!mentionsTenant) continue;
      if (ALLOWED.some(rule => rule.file === rel && text.includes(rule.fragment))) continue;
      const unbound = unboundTables(text);
      if (unbound.length === 0) continue;
      const line = source.slice(0, index).split('\n').length;
      offenders.push(`${rel}:${line} [${unbound.join(', ')}] ${text.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  return offenders;
}

test('every raw tenant-table statement is scoped to a workspace or allow-listed with a reason', () => {
  const offenders = unscopedStatements();
  assert.deepEqual(offenders, [], `Unscoped tenant SQL:\n${offenders.join('\n')}`);
});

test('a workspace_id column is not a workspace predicate', () => {
  assert.deepEqual(unboundTables('SELECT id, workspace_id FROM documents WHERE id=?'), ['documents']);
  assert.deepEqual(unboundTables('SELECT workspace_id FROM documents'), ['documents']);
  assert.deepEqual(unboundTables('SELECT id FROM workspace_usage WHERE id=?'), ['workspace_usage']);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE id=? AND workspace_id=?'), []);
  assert.deepEqual(unboundTables('INSERT INTO documents (id, workspace_id) VALUES (?, ?)'), []);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE id=?${tenant.sql}'), []);
});

test('every allow-list entry still matches a statement, so stale exceptions do not linger', () => {
  for (const rule of ALLOWED) {
    const source = fs.readFileSync(path.resolve(rule.file), 'utf8');
    assert.ok(source.includes(rule.fragment), `${rule.file} no longer contains: ${rule.fragment}`);
    assert.ok(rule.reason.length > 10, 'each exception states why it is safe');
  }
});
