import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * D8 guard: every raw SQL statement that touches a tenant table must bind that
 * table to a workspace. Mentioning the token `workspace_id` is not enough: the
 * statement needs `workspace_id = ?` (or `= :name`, or `= 'literal'`) inside a
 * WHERE or ON clause. An INSERT is scoped only when the workspace_id value is
 * a placeholder (`?` or `:name`) or the tenant helper, not a string literal
 * such as 'ws_legacy'. `${tenant.sql}` counts: it is the helper fragment
 * `AND "workspace_id" = ?`.
 *
 * Each non-INSERT reference needs its own predicate. A single table may use an
 * unqualified `workspace_id = ?`. A join or subquery must qualify each table
 * (`alias.workspace_id = ?`, or the table name when it has no alias). A second
 * predicate on the same alias does not cover another table.
 *
 * A workspace predicate that shares its AND/OR group with a top-level OR is
 * rejected: `workspace_id = ? OR id = ?` can be satisfied without the workspace.
 * An OR nested in its own parentheses, beside the predicate with AND, is kept.
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

/**
 * Statements that are safe without a workspace filter, and why.
 * `statement` is the whole SQL text. Matching ignores only whitespace, so a
 * longer statement that merely contains this text is not allowed.
 */
const ALLOWED = [
  { file: 'server/services/documentService.ts', statement: 'DELETE FROM pending_uploads WHERE file_path=?',
    reason: 'Maintenance sweep by a server-generated path; returns nothing to a client.' },
  { file: 'server/services/documentService.ts', statement: 'SELECT file_path FROM pending_uploads WHERE created_at < ?',
    reason: 'Stale-upload sweep across all workspaces; paths are server-generated.' },
  { file: 'server/services/documentService.ts', statement: 'SELECT file_path FROM upload_cleanup_queue',
    reason: 'The same stale-file sweep; it only deletes files and returns nothing to a client.' },
  { file: 'server/services/documentService.ts', statement: 'DELETE FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'file_path is the primary key: a server-generated storage path, never client-chosen.' },
  { file: 'server/services/documentService.ts', statement: 'SELECT upload_id,draft_user_id,draft_scope FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'Lookup by the primary-key storage path the service itself just generated.' },
  { file: 'server/services/documentService.ts', statement: 'SELECT 1 FROM upload_cleanup_queue WHERE file_path=?',
    reason: 'Existence check by the primary-key storage path the service itself just generated.' },
  { file: 'server/repositories/base.ts', statement: 'SELECT * FROM "${spec.name}"${whereSql}${orderSql}',
    reason: 'listRows: buildWhere(spec, scope, …) adds the workspace filter.' },
  { file: 'server/repositories/base.ts', statement: 'SELECT COUNT(*) AS total FROM "${spec.name}"${sql}',
    reason: 'countRows: buildWhere(spec, scope, …) adds the workspace filter.' },
  { file: 'server/repositories/base.ts', statement: 'INSERT INTO "${spec.name}" (${columns.map((column) => `"${column}"`).join(\', \')}) VALUES (${placeholders})',
    reason: 'insertRow appends the workspace_id column and a placeholder for every tenant table.' },
  { file: 'server/db/seed.ts', statement: 'SELECT COUNT(*) AS total FROM "${table}"',
    reason: 'Boot-time emptiness check before the first import; no request context.' },
  { file: 'server/db/seed.ts', statement: 'INSERT INTO "${table}" (${[...values.keys()].map((column) => `"${column}"`).join(\', \')}) VALUES (${[...values.keys()].map(() => \'?\').join(\', \')})',
    reason: 'Boot import. insertPreservingHistory sets workspace_id to the legacy workspace in its bound values.' },
  { file: 'server/repositories/adminUsers.ts', statement: 'SELECT * FROM admin_users WHERE email = ?',
    reason: 'Identity resolution at sign-in: the account row is what yields the workspace.' },
  { file: 'server/repositories/adminUsers.ts', statement: 'SELECT * FROM admin_users WHERE id = ?',
    reason: 'Identity resolution of the authenticated session: the account row yields the workspace.' },
  { file: 'server/repositories/adminUsers.ts', statement: 'UPDATE admin_users SET last_login_at = ? WHERE id = ?',
    reason: 'Touches only the signing-in account itself.' },
  { file: 'server/extraction/policy.ts', statement: 'SELECT role FROM admin_users WHERE id = ? AND is_active = 1',
    reason: 'Re-reads the role of the authenticated account itself.' },
  { file: 'server/index.ts', statement: 'SELECT COUNT(*) AS total FROM admin_users',
    reason: 'Boot-time bootstrap check for whether any account exists; no request context.' },
  { file: 'server/auth/webhook.ts', statement: 'DELETE FROM document_drafts WHERE user_id = ?',
    reason: 'user.deleted restores the pre-011 cascade: a Clerk user is a platform identity, so their drafts are removed in every workspace.' },
  { file: 'server/auth/webhook.ts', statement: 'DELETE FROM form_defaults WHERE user_id = ?',
    reason: 'user.deleted restores the pre-011 cascade: form defaults belonged to the deleted platform user in every workspace.' },
  { file: 'server/auth/webhook.ts', statement: 'UPDATE pending_uploads SET draft_user_id = NULL WHERE draft_user_id = ?',
    reason: 'user.deleted restores the pre-011 ON DELETE SET NULL so a staged upload survives without a deleted draft owner.' },
];

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

function skipString(source, i) {
  const quote = source[i];
  i += 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    if (quote !== '`' && source[i] === '\n') return i;
    i += 1;
  }
  return i;
}

/** A template literal, including `${…}` expressions that themselves contain templates. */
function skipTemplate(source, i) {
  i += 1;
  let depth = 0;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (depth === 0 && source[i] === '`') return i + 1;
    if (source[i] === '$' && source[i + 1] === '{') { depth += 1; i += 2; continue; }
    if (depth > 0 && source[i] === '{') { depth += 1; i += 1; continue; }
    if (depth > 0 && source[i] === '}') { depth -= 1; i += 1; continue; }
    if (depth > 0 && (source[i] === "'" || source[i] === '"')) { i = skipString(source, i); continue; }
    if (depth > 0 && source[i] === '`') { i = skipTemplate(source, i); continue; }
    i += 1;
  }
  return i;
}

/** String literals of a TypeScript source: '…', "…" and `…` (template bodies kept verbatim). */
function literals(source) {
  const found = [];
  for (let i = 0; i < source.length;) {
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const end = skipString(source, i);
      if (end > i && source[end - 1] === quote) found.push({ text: source.slice(i, end), index: i });
      i = Math.max(end, i + 1);
      continue;
    }
    if (quote === '`') {
      const end = skipTemplate(source, i);
      found.push({ text: source.slice(i, end), index: i });
      i = Math.max(end, i + 1);
      continue;
    }
    i += 1;
  }
  return found;
}

const TABLE_REF = /\b(FROM|INTO|UPDATE|JOIN)\s+"?([A-Za-z_][\w]*|\$\{[^}]+\})"?/gi;
/** `workspace_id = ?`, `= :name`, or `= 'literal'` / `= "literal"`, with an optional qualifier. */
const BOUND_PREDICATE = /(?:\b([A-Za-z_][\w]*)\.)?"?workspace_id"?\s*=\s*(?:\?|:[A-Za-z_][\w]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gi;
const CLAUSE_KEYWORD = /\b(?:SELECT|FROM|WHERE|SET|ON|VALUES|ORDER|GROUP|LIMIT|HAVING|INSERT|UPDATE|DELETE|INTO|JOIN)\b/gi;
const CLAUSE_END = /^(?:ORDER|GROUP|LIMIT|HAVING|UNION|EXCEPT|INTERSECT|WINDOW|RETURNING)$/i;
const ALIAS_KEYWORDS = new Set(['WHERE', 'SET', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'ORDER', 'GROUP', 'LIMIT', 'HAVING', 'UNION', 'AND', 'OR', 'VALUES', 'SELECT', 'FROM', 'INTO', 'UPDATE', 'DELETE', 'WHEN', 'THEN', 'ELSE', 'END', 'NOT', 'EXISTS', 'IN', 'AS', 'RETURNING', 'WINDOW', 'NATURAL', 'USING', 'EXCEPT', 'INTERSECT']);

function tenantName(raw) {
  if (raw.startsWith('${')) return '${table}';
  const name = raw.toLowerCase();
  return TENANT_TABLES.includes(name) ? name : null;
}

function splitTopLevel(list) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < list.length;) {
    if (list[i] === "'" || list[i] === '"') { i = skipQuoted(list, i); continue; }
    if (list[i] === '(') { depth += 1; i += 1; continue; }
    if (list[i] === ')') { depth = Math.max(0, depth - 1); i += 1; continue; }
    if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  const tail = list.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function readParen(sql, openIndex) {
  const close = matchingParen(sql, openIndex);
  return { inner: sql.slice(openIndex + 1, close), end: close + 1 };
}

/** The SELECT list of an INSERT ... SELECT, stopping at the top-level FROM. */
function selectList(sql) {
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { i = skipQuoted(sql, i); continue; }
    if (sql[i] === '(') { depth += 1; i += 1; continue; }
    if (sql[i] === ')') { depth = Math.max(0, depth - 1); i += 1; continue; }
    if (depth === 0) {
      const word = keywordAt(sql, i);
      if (word && word.toUpperCase() === 'FROM') return sql.slice(0, i);
      if (word) { i += word.length; continue; }
    }
    i += 1;
  }
  return sql;
}

function isBoundWorkspaceValue(expression) {
  const value = expression.trim();
  if (value === '?') return true;
  if (/^:[A-Za-z_][\w]*$/.test(value)) return true;
  if (/^\$\{tenant\.[^}]+\}$/.test(value)) return true;
  return false;
}

/**
 * True when the workspace_id column is a placeholder, a named parameter, or
 * the tenant helper. A string literal such as 'ws_legacy' does not count.
 * A single template that expands to a list of `?` placeholders does.
 */
function valuesBindWorkspace(columnsInner, valuesInner) {
  const columns = splitTopLevel(columnsInner);
  const index = columns.findIndex(column => /^"?workspace_id"?$/i.test(column.trim()));
  if (index < 0) return false;
  const trimmed = valuesInner.trim();
  if (/^\$\{[\s\S]+\}$/.test(trimmed) && trimmed.includes("'?'")) return true;
  return isBoundWorkspaceValue(splitTopLevel(trimmed)[index] ?? '');
}

/** The inner text of each `(...)` tuple of a VALUES list, starting at its first parenthesis. */
function valueTuples(sql, openIndex) {
  const tuples = [];
  let next = openIndex;
  for (;;) {
    const tuple = readParen(sql, next);
    tuples.push(tuple.inner);
    const more = /^\s*,\s*\(/.exec(sql.slice(tuple.end));
    if (!more) return tuples;
    next = tuple.end + more[0].length - 1;
  }
}

/** INSERT targets whose workspace_id value is a placeholder. One entry per such INSERT. */
function coveredInserts(sql) {
  const covered = [];
  const head = /\bINSERT\b(?:\s+OR\s+\w+)?\s+INTO\s+"?([A-Za-z_][\w]*|\$\{[^}]+\})"?\s*\(/gi;
  for (const match of sql.matchAll(head)) {
    const name = tenantName(match[1]);
    if (!name) continue;
    const columns = readParen(sql, match.index + match[0].length - 1);
    if (!/\bworkspace_id\b/i.test(columns.inner)) continue;
    const rest = sql.slice(columns.end);
    const valuesMatch = /^\s*VALUES\s*\(/i.exec(rest);
    const selectMatch = /^\s*SELECT\b/i.exec(rest);
    let lists = [];
    if (valuesMatch) lists = valueTuples(sql, columns.end + valuesMatch[0].length - 1);
    else if (selectMatch) lists = [selectList(rest.slice(selectMatch[0].length))];
    else continue;
    // Every row of a multi-row VALUES list must bind the workspace.
    if (lists.every(list => valuesBindWorkspace(columns.inner, list))) covered.push(name);
  }
  return covered;
}

function skipQuoted(sql, i) {
  const quote = sql[i];
  if (quote !== "'" && quote !== '"') return i;
  i += 1;
  while (i < sql.length) {
    if (sql[i] === '\\') { i += 2; continue; }
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) { i += 2; continue; }
      return i + 1;
    }
    i += 1;
  }
  return i;
}

function keywordAt(sql, i) {
  if (i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1])) return null;
  const match = /^[A-Za-z_][\w]*/.exec(sql.slice(i));
  return match ? match[0] : null;
}

function matchingParen(sql, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { i = skipQuoted(sql, i); continue; }
    if (sql[i] === '(') { depth += 1; i += 1; continue; }
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return sql.length;
}

/** WHERE and ON bodies, so `INSERT OR IGNORE` is not treated as a boolean OR. */
function clauseBodies(sql) {
  const bodies = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { i = skipQuoted(sql, i); continue; }
    if (sql[i] === '(') { depth += 1; i += 1; continue; }
    if (sql[i] === ')') { depth = Math.max(0, depth - 1); i += 1; continue; }
    const word = keywordAt(sql, i);
    if (word && (word.toUpperCase() === 'WHERE' || word.toUpperCase() === 'ON')) {
      const startDepth = depth;
      const kind = word.toUpperCase();
      let j = i + word.length;
      const bodyStart = j;
      while (j < sql.length) {
        if (sql[j] === "'" || sql[j] === '"') { j = skipQuoted(sql, j); continue; }
        if (sql[j] === '(') { depth += 1; j += 1; continue; }
        if (sql[j] === ')') {
          if (depth === startDepth) break;
          depth -= 1;
          j += 1;
          continue;
        }
        if (depth === startDepth) {
          const endWord = keywordAt(sql, j);
          if (endWord && CLAUSE_END.test(endWord)) break;
          if (kind === 'ON' && endWord && /^(JOIN|WHERE|GROUP|ORDER|LIMIT)$/i.test(endWord)) break;
        }
        j += 1;
      }
      bodies.push(sql.slice(bodyStart, j));
      i = j;
      continue;
    }
    if (word) { i += word.length; continue; }
    i += 1;
  }
  return bodies;
}

/** True when a workspace predicate shares its group with an OR, so the OR can bypass it. */
function groupBypassesWorkspace(sql, start, end) {
  let hasWorkspace = false;
  let hasOr = false;
  for (let i = start; i < end;) {
    if (sql[i] === "'" || sql[i] === '"') { i = skipQuoted(sql, i); continue; }
    if (sql[i] === '(') {
      const close = matchingParen(sql, i);
      if (groupBypassesWorkspace(sql, i + 1, close)) return true;
      i = close + 1;
      continue;
    }
    const word = keywordAt(sql, i);
    if (word && word.toUpperCase() === 'OR') { hasOr = true; i += word.length; continue; }
    if (word && word.toUpperCase() === 'WORKSPACE_ID') {
      const after = sql.slice(i + word.length);
      if (/^\s*=\s*(?:\?|:[A-Za-z_][\w]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.test(after)) hasWorkspace = true;
      i += word.length;
      continue;
    }
    if (word) { i += word.length; continue; }
    i += 1;
  }
  return hasWorkspace && hasOr;
}

function orBypassesWorkspace(sql) {
  return clauseBodies(sql).some(body => groupBypassesWorkspace(body, 0, body.length));
}

/** Predicates that sit in a WHERE or ON clause, plus each `${tenant.sql}` helper fragment. */
/**
 * Blanks the contents of SQL string literals and comments, keeping offsets and
 * the quotes themselves. A `workspace_id = ?` written inside a string is text,
 * not a predicate. Double-quoted identifiers are kept.
 */
function maskLiteralsAndComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "'" + ' '.repeat(Math.max(0, j - i - 1)) + (j < sql.length ? "'" : '');
      i = j + 1;
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

function boundPredicates(rawSql) {
  const sql = maskLiteralsAndComments(rawSql);
  const predicates = [];
  BOUND_PREDICATE.lastIndex = 0;
  for (const match of sql.matchAll(BOUND_PREDICATE)) {
    let nearest = '';
    CLAUSE_KEYWORD.lastIndex = 0;
    for (const keyword of sql.slice(0, match.index).matchAll(CLAUSE_KEYWORD)) nearest = keyword[0].toUpperCase();
    if (nearest === 'WHERE' || nearest === 'ON') predicates.push({ qualifier: match[1] ?? null });
  }
  const helpers = sql.match(/\$\{tenant\.sql\}/g)?.length ?? 0;
  for (let index = 0; index < helpers; index += 1) predicates.push({ qualifier: null });
  return predicates;
}

function readAlias(sql, index) {
  const match = /^\s+(?:AS\s+)?([A-Za-z_][\w]*)/i.exec(sql.slice(index));
  if (!match || ALIAS_KEYWORDS.has(match[1].toUpperCase())) return null;
  return match[1];
}

function qualifierMatches(qualifier, ref) {
  const name = qualifier.toLowerCase();
  return name === ref.name.toLowerCase() || (ref.alias !== null && name === ref.alias.toLowerCase());
}

function splitStatements(sql) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') { i = skipQuoted(sql, i); continue; }
    if (sql[i] === ';') {
      parts.push(sql.slice(start, i));
      start = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  parts.push(sql.slice(start));
  return parts.map(part => part.trim()).filter(part => /\b(?:FROM|INTO|UPDATE|JOIN)\b/i.test(part));
}

/**
 * Tenant tables in one statement that are not bound to a workspace.
 * An INSERT is bound when its column list includes workspace_id. Every other
 * reference needs its own WHERE/ON predicate on that table.
 */
function unboundStatement(sql) {
  const covered = coveredInserts(sql);
  const reads = [];
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
      unbound.push(name);
      continue;
    }
    reads.push({ name, alias: readAlias(sql, match.index + match[0].length) });
  }
  if (orBypassesWorkspace(sql)) return [...unbound, ...reads.map(ref => ref.name)];

  const predicates = boundPredicates(sql);
  if (reads.length === 1) {
    const ref = reads[0];
    const coveredRead = predicates.some(predicate => predicate.qualifier === null || qualifierMatches(predicate.qualifier, ref));
    if (!coveredRead) unbound.push(ref.name);
    return unbound;
  }
  const used = new Set();
  for (const ref of reads) {
    const index = predicates.findIndex((predicate, predicateIndex) => !used.has(predicateIndex) && predicate.qualifier && qualifierMatches(predicate.qualifier, ref));
    if (index < 0) unbound.push(ref.name);
    else used.add(index);
  }
  return unbound;
}

/**
 * Tenant tables in `sql` that are not bound to a workspace.
 * A script of several statements is checked one statement at a time.
 */
function unboundTables(sql) {
  return splitStatements(sql).flatMap(statement => unboundStatement(statement));
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

/** An allow-list entry matches one whole statement, never a fragment of another. */
function statementAllowed(file, statement) {
  const normalized = normalizeSql(statement);
  return ALLOWED.some(rule => rule.file === file && normalizeSql(rule.statement) === normalized);
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
      const body = text.slice(1, -1);
      let cursor = 0;
      for (const statement of splitStatements(body)) {
        const at = body.indexOf(statement, cursor);
        cursor = at < 0 ? cursor : at + statement.length;
        if (statementAllowed(rel, statement)) continue;
        const unbound = unboundStatement(statement);
        if (unbound.length === 0) continue;
        const line = source.slice(0, index + 1 + (at < 0 ? 0 : at)).split('\n').length;
        offenders.push(`${rel}:${line} [${unbound.join(', ')}] ${normalizeSql(statement).slice(0, 180)}`);
      }
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
  assert.deepEqual(unboundTables("INSERT INTO companies (id, workspace_id) VALUES (?, ?), (?, 'ws_legacy')"), ['companies']);
  assert.deepEqual(unboundTables('INSERT INTO companies (id, workspace_id) VALUES (?, ?), (?, ?)'), []);
  assert.deepEqual(unboundTables("SELECT id FROM documents WHERE title = 'workspace_id = ?'"), ['documents']);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE id = ? -- AND workspace_id = ?'), ['documents']);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE id=?${tenant.sql}'), []);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE workspace_id = ? OR id = ?'), ['documents']);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE (workspace_id = ? OR id = ?)'), ['documents']);
  assert.deepEqual(unboundTables('SELECT id FROM documents WHERE workspace_id = ? AND (id = ? OR title = ?)'), []);
  assert.deepEqual(
    unboundTables('SELECT d.id FROM documents d JOIN employees e ON e.id = d.employee_id WHERE d.workspace_id = ? AND d.workspace_id = ?'),
    ['employees'],
  );
  assert.deepEqual(
    unboundTables('SELECT d.id FROM documents d JOIN employees e ON e.id = d.employee_id AND e.workspace_id = ? WHERE d.workspace_id = ?'),
    [],
  );
});

test('every allow-list entry still matches a statement, so stale exceptions do not linger', () => {
  for (const rule of ALLOWED) {
    const source = fs.readFileSync(path.resolve(rule.file), 'utf8').replace(/\s+/g, ' ');
    assert.ok(source.includes(normalizeSql(rule.statement)), `${rule.file} no longer contains: ${rule.statement}`);
    assert.ok(rule.reason.length > 10, 'each exception states why it is safe');
  }
});

test('an allow-list entry matches the whole statement, not a fragment of a different one', () => {
  const rule = ALLOWED[0];
  assert.equal(statementAllowed(rule.file, rule.statement), true);
  assert.equal(statementAllowed(rule.file, `${rule.statement} OR id = ?`), false);
  assert.equal(statementAllowed(rule.file, rule.statement.slice(0, 24)), false);
});

test('a workspace_id string literal does not scope an INSERT', () => {
  assert.deepEqual(
    unboundTables("INSERT INTO companies (id, workspace_id, name) VALUES ('a', 'ws_legacy', 'X')"),
    ['companies'],
  );
  assert.deepEqual(unboundTables("INSERT INTO companies (id, workspace_id) SELECT 'a', 'ws_legacy'"), ['companies']);
  assert.deepEqual(unboundTables('INSERT INTO companies (id, workspace_id, name) VALUES (?, ?, ?)'), []);
  assert.deepEqual(unboundTables('INSERT INTO companies (id, workspace_id) VALUES (?, :workspaceId)'), []);
  assert.deepEqual(unboundTables('INSERT INTO companies (id, workspace_id) VALUES (?, ${tenant.sql})'), []);
});
