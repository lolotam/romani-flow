import { format } from 'date-fns';
import { request, ApiRequestError, type ApiEnvelope, type RequestOptions } from './api/http';

export type DraftValues = Record<string, string | null>;
export interface DraftReference { scope: string; revision: string; account?: string }
export type DraftStatus = 'loading' | 'saved' | 'saving' | 'failed' | 'conflict';
type Transport = <T>(url: string, options?: RequestOptions) => Promise<ApiEnvelope<T>>;

/** Draft dates remain local date-only values; files and undefined values never enter the payload. */
export function draftValues(values: object): DraftValues {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, value instanceof Date ? format(value, 'yyyy-MM-dd') : value])) as DraftValues;
}

/** Serial CAS writes protect a single context against delayed replies and other devices. */
export class DocumentDraftSession {
  private revision = 'none';
  private pending: DraftValues | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial: Promise<void> = Promise.resolve();
  private loaded: Promise<void>;
  private paused = false;
  private disposed = false;
  private restoring = false;
  private edited = false;
  private failure: Error | null = null;
  private prepared: DraftValues | null = null;
  private discarding: Promise<void> | null = null;
  hasDraft = false;

  constructor(readonly scope: string, private restore: (values: DraftValues | null) => void,
    private status: (value: DraftStatus) => void, private transport: Transport = request) {
    this.loaded = this.load();
  }

  private get url(): string { return `/api/document-drafts/${encodeURIComponent(this.scope)}`; }

  private async load(): Promise<void> {
    this.status('loading');
    const result = await this.transport<{ revision: string; values: DraftValues | null }>(this.url);
    if (result.error || !result.data) { this.fail(result.error ?? new Error('Draft unavailable')); return; }
    this.revision = result.data.revision;
    this.hasDraft = result.data.values !== null;
    if (!this.disposed && !this.edited) {
      this.restoring = true;
      try { this.restore(result.data.values); } finally { this.restoring = false; }
    }
    if (!this.disposed) this.status(this.pending ? 'saving' : 'saved');
  }

  private fail(error: Error): void {
    this.failure = error;
    if (!this.disposed) this.status(error instanceof ApiRequestError && error.code === 'draft_conflict' ? 'conflict' : 'failed');
  }

  change(values: DraftValues): void {
    if (this.disposed || this.paused || this.restoring) return;
    this.edited = true; this.pending = values;
    // A rejected field value is a proven non-write; corrected input may be saved again.
    if (this.failure instanceof ApiRequestError && this.failure.code === 'invalid_draft') this.failure = null;
    if (this.failure) return;
    this.status('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, 500);
  }

  /** Errors stay visible and pending metadata stays in memory; conflicts never auto-retry. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const task = this.serial.then(async () => {
      await this.loaded;
      if (this.failure) throw this.failure;
      while (this.pending) {
        const values = this.pending; this.pending = null;
        const result = await this.transport<{ revision: string }>(this.url, { method: 'PUT', body: { revision: this.revision, values } });
        if (result.error || !result.data) {
          this.pending ??= values;
          this.fail(result.error ?? new Error('Draft unavailable')); throw this.failure;
        }
        this.revision = result.data.revision; this.hasDraft = true;
      }
      if (!this.disposed) this.status('saved');
    });
    this.serial = task.catch(() => undefined);
    return task;
  }

  async prepare(values: DraftValues): Promise<DraftReference> {
    this.change(values);
    await this.flush();
    this.paused = true;
    this.prepared = values;
    return { scope: this.scope, revision: this.revision };
  }

  resume(error?: unknown): void {
    this.paused = false;
    if (this.prepared) {
      this.pending = this.prepared; this.prepared = null;
      if (error instanceof ApiRequestError && error.code === 'draft_conflict') this.fail(error);
      else if (!this.failure) this.status('saving');
    }
  }

  committed(): void { this.paused = true; this.pending = null; this.prepared = null; clearTimeout(this.timer); }

  /** Closing after failure requires an explicit choice to drop only unsaved local changes. */
  async close(confirmDiscard: () => boolean): Promise<boolean> {
    try { await this.flush(); return true; }
    catch {
      if (!confirmDiscard()) return false;
      this.committed(); this.dispose(); return true;
    }
  }

  discard(): Promise<void> {
    if (this.discarding) return this.discarding;
    const operation = this.discardOnce();
    this.discarding = operation;
    void operation.then(() => { this.discarding = null; }, () => { this.discarding = null; });
    return operation;
  }

  private async discardOnce(): Promise<void> {
    this.paused = true; clearTimeout(this.timer); this.pending = null;
    this.status('saving');
    try {
      await this.loaded; await this.serial;
      if (this.failure) throw this.failure;
      this.status('saving');
      const result = await this.transport<{ revision: string }>(this.url, { method: 'DELETE', body: { revision: this.revision } });
      if (result.error || !result.data) throw result.error ?? new Error('Draft unavailable');
      this.revision = result.data.revision; this.hasDraft = false;
      this.restoring = true;
      try { this.restore(null); } finally { this.restoring = false; }
      this.status('saved');
    } catch (error) { this.fail(error as Error); throw error; }
    finally { this.paused = false; }
  }

  dispose(flush = false): void {
    clearTimeout(this.timer);
    if (flush && !this.paused && !this.failure) void this.flush().catch(() => undefined);
    this.disposed = true;
  }
}
