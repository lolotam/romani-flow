import { request, uploadFiles, type ApiEnvelope } from './http';
import { QueryBuilder } from './queryBuilder';
import type { ApiResult } from './types';

/**
 * The API client.
 *
 * It exposes the same surface as the localStorage database it replaces, so the
 * pages only need to swap the import. Every method resolves — failures come
 * back as `{ data: null, error }` instead of a rejected promise.
 */

/** Maps a table name to its API path. */
const RESOURCE_PATHS: Record<string, string> = {
  companies: '/api/companies',
  ministries: '/api/ministries',
  document_types: '/api/document-types',
  positions: '/api/positions',
  employees: '/api/employees',
  documents: '/api/documents',
};

export class ApiClient {
  from<T = unknown>(tableName: string): QueryBuilder<T> {
    const path = RESOURCE_PATHS[tableName];
    if (!path) {
      throw new Error(`Unknown resource "${tableName}".`);
    }
    return new QueryBuilder<T>(path).withExecutor((builder) => this.execute(builder));
  }

  async insert<T>(
    tableName: string,
    records: Partial<T> | Partial<T>[],
  ): Promise<ApiResult<T[]>> {
    const path = RESOURCE_PATHS[tableName];
    if (!path) {
      return { data: null, error: new Error(`Unknown resource "${tableName}".`) };
    }

    const envelope = await request<T[]>(path, { method: 'POST', body: records });
    return toResult<T[]>(envelope);
  }

  async update<T>(tableName: string, id: string, updates: Partial<T>): Promise<ApiResult<T>> {
    const path = RESOURCE_PATHS[tableName];
    if (!path) {
      return { data: null, error: new Error(`Unknown resource "${tableName}".`) };
    }

    const envelope = await request<T>(`${path}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: updates,
    });
    return toResult<T>(envelope);
  }

  async delete(tableName: string, id: string): Promise<{ error: Error | null }> {
    const path = RESOURCE_PATHS[tableName];
    if (!path) {
      return { error: new Error(`Unknown resource "${tableName}".`) };
    }

    const envelope = await request<unknown>(`${path}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return { error: envelope.error };
  }

  /** Runs a built query. */
  async execute<T>(builder: QueryBuilder<T>): Promise<ApiResult<T[]>> {
    const envelope = await request<T[]>(builder.toSearchParams(builder.path));
    return toResult<T[]>(envelope);
  }

  /** Uploads files to the storage bucket. */
  async upload<T>(files: File[]): Promise<ApiResult<T>> {
    const envelope = await uploadFiles<T>('/api/files/upload', files);
    return toResult<T>(envelope);
  }
}

function toResult<T>(envelope: ApiEnvelope<T>): ApiResult<T> {
  if (envelope.error) {
    // The original error is kept, so the caller can still read the details the
    // server attached to it (the rejected settings, for instance).
    return { data: null, error: envelope.error };
  }
  return { data: envelope.data, error: null };
}

export const api = new ApiClient();
