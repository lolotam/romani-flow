/**
 * Fluent query builder.
 *
 * The method names and the chaining order match the client-side database that
 * this replaced, so the pages keep the same call sites:
 *
 *   api.from('employees').select('*, companies (name)').eq('company_id', id).execute()
 *
 * `select` is not a projection — it declares which relations to embed.
 */

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'in';

export interface QueryResult<T> {
  data: T[] | null;
  error: Error | null;
}

export type QueryExecutor<T> = (builder: QueryBuilder<T>) => Promise<QueryResult<T>>;

interface Filter {
  operator: FilterOperator;
  field: string;
  value: string | string[];
}

export interface QueryParams {
  select?: string;
  filters: Filter[];
  order?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export class QueryBuilder<T = unknown> {
  private readonly filters: Filter[] = [];
  private selectFields = '*';
  private orderByField?: string;
  private orderDirection: 'asc' | 'desc' = 'asc';
  private limitCount?: number;
  private offsetCount?: number;
  private executor?: QueryExecutor<T>;

  constructor(private readonly resource: string) {}

  /** Injected by the client so the builder can execute itself. */
  withExecutor(executor: QueryExecutor<T>): this {
    this.executor = executor;
    return this;
  }

  /** Runs the query. Never rejects — failures come back as `{ data, error }`. */
  async execute(): Promise<QueryResult<T>> {
    if (!this.executor) {
      return { data: null, error: new Error('This query is not bound to the API client.') };
    }
    return this.executor(this);
  }

  select(fields: string): this {
    this.selectFields = fields;
    return this;
  }

  eq(field: string, value: string | number | boolean | null): this {
    this.filters.push({ operator: 'eq', field, value: String(value ?? '') });
    return this;
  }

  neq(field: string, value: string | number | boolean | null): this {
    this.filters.push({ operator: 'neq', field, value: String(value ?? '') });
    return this;
  }

  gt(field: string, value: string | number): this {
    this.filters.push({ operator: 'gt', field, value: String(value) });
    return this;
  }

  gte(field: string, value: string | number): this {
    this.filters.push({ operator: 'gte', field, value: String(value) });
    return this;
  }

  lt(field: string, value: string | number): this {
    this.filters.push({ operator: 'lt', field, value: String(value) });
    return this;
  }

  lte(field: string, value: string | number): this {
    this.filters.push({ operator: 'lte', field, value: String(value) });
    return this;
  }

  /** `%` is the wildcard, exactly as the previous client behaved. */
  like(field: string, pattern: string): this {
    this.filters.push({ operator: 'like', field, value: pattern });
    return this;
  }

  in(field: string, values: Array<string | number>): this {
    this.filters.push({ operator: 'in', field, value: values.map((value) => String(value)) });
    return this;
  }

  order(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderByField = field;
    this.orderDirection = direction;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /** Turns the chain into the query string the API expects. */
  toSearchParams(basePath: string): string {
    const params = new URLSearchParams();

    if (this.selectFields && this.selectFields !== '*') {
      params.set('select', this.selectFields);
    }

    for (const filter of this.filters) {
      if (filter.operator === 'in') {
        params.set(`in[${filter.field}]`, (filter.value as string[]).join(','));
        continue;
      }
      params.set(`${filter.operator}[${filter.field}]`, String(filter.value));
    }

    if (this.orderByField) {
      params.set('order', `${this.orderByField}:${this.orderDirection}`);
    }
    if (this.limitCount !== undefined) {
      params.set('limit', String(this.limitCount));
    }
    if (this.offsetCount !== undefined) {
      params.set('offset', String(this.offsetCount));
    }

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  get path(): string {
    return this.resource;
  }
}
