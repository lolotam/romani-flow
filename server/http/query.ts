import type { Request } from 'express';
import type { Filter, FilterOperator, ListOptions } from '../repositories/base.js';
import { getTable } from '../repositories/schema.js';

/**
 * Translates the SPA's query string into repository options.
 *
 * The wire format mirrors the fluent client the SPA already uses:
 *   ?select=*,companies (name, name_ar)&eq[company_id]=abc&like[name]=%ali%
 *    &order=name:asc&limit=50&offset=0
 */

const OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in'];

function asString(value: unknown): string {
  if (Array.isArray(value)) return String(value[value.length - 1] ?? '');
  return String(value ?? '');
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => asList(entry));
  const raw = String(value ?? '');
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asInteger(value: unknown): number | undefined {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Extracts the relation names from a select expression.
 *
 * `select` is not a projection — it only declares which relations should be
 * embedded, exactly as the previous client-side implementation did.
 */
export function parseRelations(select: string | undefined, tableName: string): string[] {
  if (!select || !select.includes('(')) return [];

  const spec = getTable(tableName);
  if (!spec) return [];

  const found = new Set<string>();
  const pattern = /([a-z_]+)\s*\(/gi;
  let match = pattern.exec(select);

  while (match !== null) {
    const name = match[1].toLowerCase();
    // Only relations that this table actually declares are embedded.
    if (spec.relations?.[name]) found.add(name);
    match = pattern.exec(select);
  }

  return [...found];
}

export function parseFilters(query: Request['query'], tableName: string): Filter[] {
  const spec = getTable(tableName);
  if (!spec) return [];

  const filters: Filter[] = [];

  for (const operator of OPERATORS) {
    const raw = query[operator];
    if (raw === undefined || raw === null) continue;

    if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!spec.columns.includes(field)) continue;
        if (value === undefined || value === null) continue;
        filters.push({
          field,
          operator,
          value: operator === 'in' ? asList(value) : asString(value),
        });
      }
      continue;
    }

    // Scalar form: `?eq=company_id` is not valid on its own, so it is ignored.
  }

  return filters;
}

export function parseOrder(query: Request['query'], tableName: string): ListOptions['order'] {
  const spec = getTable(tableName);
  const raw = asString(query.order).trim();
  if (!raw || !spec) return undefined;

  const [field, direction] = raw.split(':');
  if (!spec.columns.includes(field)) return undefined;

  return { field, direction: direction === 'desc' ? 'desc' : 'asc' };
}

export function parseListOptions(query: Request['query'], tableName: string): ListOptions {
  const limit = asInteger(query.limit);
  const offset = asInteger(query.offset);

  return {
    filters: parseFilters(query, tableName),
    order: parseOrder(query, tableName),
    limit: limit !== undefined && limit >= 0 ? limit : undefined,
    offset: offset !== undefined && offset > 0 ? offset : undefined,
    relations: parseRelations(typeof query.select === 'string' ? query.select : undefined, tableName),
  };
}
