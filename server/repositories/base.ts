import type { Db } from '../db/connection.js';
import { getTable, type RelationSpec, type TableSpec } from './schema.js';

/**
 * Generic, allow-list driven data access.
 *
 * The SPA talks to the database through a fluent client whose semantics are fixed
 * (see docs/SPEC.md §6.1). This module implements those semantics on top of
 * SQLite: relations are embedded as whole nested objects, column projection is
 * intentionally not performed, and the server owns all timestamps.
 */

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

export interface ListOptions {
  filters?: Filter[];
  order?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
  /** Relation names to embed, e.g. `['companies', 'employees']`. */
  relations?: string[];
}

export type Row = Record<string, unknown>;

/** Values that can be bound to a prepared statement. */
export type SqlValue = string | number | null | bigint | Uint8Array;

/** Normalises a JSON payload value into something SQLite can store. */
export function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const OPERATOR_SQL: Record<FilterOperator, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  in: 'IN',
};

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

function requireSpec(tableName: string): TableSpec {
  const spec = getTable(tableName);
  if (!spec) {
    throw new RepositoryError(`Unknown table "${tableName}"`, 'unknown_table', 404);
  }
  return spec;
}

/** Rejects any column that is not declared in the table registry. */
function assertColumn(spec: TableSpec, field: string): string {
  if (!spec.columns.includes(field)) {
    throw new RepositoryError(
      `Unknown column "${field}" on "${spec.name}"`,
      'unknown_column',
      400,
    );
  }
  return field;
}

/**
 * Prepares a search term for a SQL `LIKE` comparison.
 *
 * `%` stays a wildcard (that is the contract of the existing client), while
 * `_` and the escape character itself are escaped so they match literally.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\_]/g, (match) => `\\${match}`);
}

/**
 * Converts a filter value for a column.
 *
 * The client sends everything as text, so a boolean arrives as `"true"` and a
 * missing value as an empty string. Comparing those against an INTEGER column
 * with `=` would never match anything.
 */
function coerceFilterValue(
  spec: TableSpec,
  column: string,
  value: string,
): SqlValue | null {
  if (spec.booleanColumns?.includes(column)) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return 1;
    if (normalized === 'false' || normalized === '0') return 0;
  }
  return value;
}

function buildWhere(spec: TableSpec, filters: Filter[]): { sql: string; params: SqlValue[] } {
  const clauses: string[] = [];
  const params: SqlValue[] = [];

  for (const filter of filters) {
    const column = assertColumn(spec, filter.field);

    if (filter.operator === 'in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      if (values.length === 0) {
        // An empty IN list must match nothing, not everything.
        clauses.push('1 = 0');
        continue;
      }
      clauses.push(`"${column}" IN (${values.map(() => '?').join(', ')})`);
      params.push(...values.map((value) => toSqlValue(value)));
      continue;
    }

    if (filter.operator === 'like') {
      clauses.push(`"${column}" LIKE ? ESCAPE '\\'`);
      params.push(escapeLike(String(filter.value)));
      continue;
    }

    // An empty value means "the field is not set", which has to be compared
    // with IS NULL — `= ''` would never match a NULL column.
    if (filter.operator === 'eq' && String(filter.value).trim() === '') {
      clauses.push(`"${column}" IS NULL`);
      continue;
    }
    if (filter.operator === 'neq' && String(filter.value).trim() === '') {
      clauses.push(`"${column}" IS NOT NULL`);
      continue;
    }

    clauses.push(`"${column}" ${OPERATOR_SQL[filter.operator]} ?`);
    params.push(coerceFilterValue(spec, column, String(filter.value)));
  }

  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

function buildOrder(spec: TableSpec, order?: ListOptions['order']): string {
  if (!order) return '';
  const column = assertColumn(spec, order.field);
  const direction = order.direction === 'desc' ? 'DESC' : 'ASC';
  return ` ORDER BY "${column}" ${direction}`;
}

/** Loads the related rows for one relation and returns them keyed by id. */
function loadRelation(
  db: Db,
  ownerRows: Row[],
  relation: RelationSpec,
): Map<string, Row> {
  const foreignKeys = ownerRows
    .map((row) => row[relation.foreignKey])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const linked = new Map<string, Row>();
  if (foreignKeys.length === 0) return linked;

  const placeholders = foreignKeys.map(() => '?').join(', ');
  const related = db
    .prepare(`SELECT * FROM "${relation.table}" WHERE id IN (${placeholders})`)
    .all(...foreignKeys) as Row[];

  for (const row of related) {
    linked.set(String(row.id), row);
  }
  return linked;
}

function attachRelations(
  db: Db,
  spec: TableSpec,
  rows: Row[],
  relationNames: string[],
): Row[] {
  if (rows.length === 0 || relationNames.length === 0) return rows;

  for (const relationName of relationNames) {
    const relation = spec.relations?.[relationName];
    if (!relation) continue;

    const linked = loadRelation(db, rows, relation);

    for (const row of rows) {
      const foreignValue = row[relation.foreignKey];
      if (typeof foreignValue !== 'string') continue;

      const related = linked.get(foreignValue);
      if (!related) continue;

      const embedded: Row = { ...related };

      // A relation may itself declare nested relations (documents → employees → companies).
      if (relation.nested) {
        for (const [nestedName, nestedSpec] of Object.entries(relation.nested)) {
          const nestedLinked = loadRelation(db, [related], nestedSpec);
          const nestedRow = nestedLinked.get(String(related[nestedSpec.foreignKey]));
          if (nestedRow) {
            embedded[nestedName] = { ...nestedRow };
          }
        }
      }

      row[relationName] = embedded;
    }
  }

  return rows;
}

export function listRows(db: Db, tableName: string, options: ListOptions = {}): Row[] {
  const spec = requireSpec(tableName);
  const { sql: whereSql, params } = buildWhere(spec, options.filters ?? []);
  const orderSql = buildOrder(spec, options.order);

  const limit = options.limit !== undefined && options.limit >= 0 ? options.limit : undefined;
  const offset = options.offset !== undefined && options.offset > 0 ? options.offset : undefined;

  const queryParams: SqlValue[] = [...params];
  let sql = `SELECT * FROM "${spec.name}"${whereSql}${orderSql}`;
  // SQLite rejects an OFFSET without a LIMIT, so the limit is always written.
  if (limit !== undefined) {
    sql += ' LIMIT ?';
    queryParams.push(limit);
  } else if (offset !== undefined) {
    sql += ' LIMIT -1';
  }
  if (offset !== undefined) {
    sql += ' OFFSET ?';
    queryParams.push(offset);
  }

  const rows = db.prepare(sql).all(...queryParams) as Row[];
  return attachRelations(db, spec, rows, options.relations ?? []);
}

export function findRow(
  db: Db,
  tableName: string,
  id: string,
  relations: string[] = [],
): Row | null {
  const spec = requireSpec(tableName);
  const row = db.prepare(`SELECT * FROM "${spec.name}" WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  return attachRelations(db, spec, [row], relations)[0];
}

export function countRows(db: Db, tableName: string, filters: Filter[] = []): number {
  const spec = requireSpec(tableName);
  const { sql, params } = buildWhere(spec, filters);
  const row = db.prepare(`SELECT COUNT(*) AS total FROM "${spec.name}"${sql}`).get(...params) as {
    total: number;
  };
  return row.total;
}

/** Columns the client is allowed to set; timestamps and computed fields are excluded. */
function writableColumns(spec: TableSpec, payload: Row): Array<[string, SqlValue]> {
  const managed = new Set(['created_at', 'updated_at', ...(spec.managed ?? [])]);
  const entries: Array<[string, SqlValue]> = [];

  for (const [key, value] of Object.entries(payload)) {
    if (managed.has(key)) continue;
    if (!spec.columns.includes(key)) {
      throw new RepositoryError(
        `Unknown column "${key}" on "${spec.name}"`,
        'unknown_column',
        400,
      );
    }
    entries.push([key, toSqlValue(value)]);
  }

  return entries;
}

export function insertRow(db: Db, tableName: string, payload: Row): Row {
  const spec = requireSpec(tableName);
  const now = new Date().toISOString();
  const entries = writableColumns(spec, payload);

  const columns = ['id', ...entries.map(([key]) => key)];
  const values: SqlValue[] = [];

  // The id is honoured when the client supplies one; otherwise one is generated.
  const id = typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : createId();
  values.push(id);

  for (const [, value] of entries) {
    values.push(value);
  }

  if (spec.columns.includes('created_at')) {
    columns.push('created_at');
    values.push(now);
  }
  if (spec.columns.includes('updated_at')) {
    columns.push('updated_at');
    values.push(now);
  }

  const placeholders = values.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO "${spec.name}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders})`,
  ).run(...values);

  const row = findRow(db, tableName, id, []) as Row;
  return row;
}

export function updateRow(db: Db, tableName: string, id: string, payload: Row): Row | null {
  const spec = requireSpec(tableName);
  const existing = db.prepare(`SELECT id FROM "${spec.name}" WHERE id = ?`).get(id);
  if (!existing) return null;

  const entries = writableColumns(spec, payload);
  if (entries.length === 0) return findRow(db, tableName, id, []);

  const assignments = entries.map(([key]) => `"${key}" = ?`);
  const values: SqlValue[] = entries.map(([, value]) => value);

  if (spec.columns.includes('updated_at')) {
    assignments.push('"updated_at" = ?');
    values.push(new Date().toISOString());
  }

  values.push(id);
  db.prepare(`UPDATE "${spec.name}" SET ${assignments.join(', ')} WHERE id = ?`).run(...values);

  return findRow(db, tableName, id, []);
}

export function deleteRow(db: Db, tableName: string, id: string): boolean {
  const spec = requireSpec(tableName);
  const result = db.prepare(`DELETE FROM "${spec.name}" WHERE id = ?`).run(id);
  return result.changes > 0;
}

/** RFC 4122 version 4 identifier, using the platform crypto implementation. */
export function createId(): string {
  return globalThis.crypto.randomUUID();
}
