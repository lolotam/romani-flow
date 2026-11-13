import { format } from 'date-fns';
import { request, ApiRequestError, type ApiEnvelope, type RequestOptions } from './api/http';

export type DraftValues = Record<string, string | null>;
export interface DraftReference { scope: string; revision: string; account?: string }
export type DraftStatus = 'loading' | 'saved' | 'saving' | 'discarding' | 'failed' | 'conflict';

/** The open form belongs to another workspace; autosave must stop and must not throw. */
export function draftWorkspaceMismatch(error: unknown): boolean {
  return error instanceof ApiRequestError
    && error.status === 409
    && (error.code === 'draft_workspace_mismatch' || error.message === 'draft_workspace_mismatch');
}
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
  private discardEdits: DraftValues | null = null;
  private deletingDraft = false;
  private ready = false;
  /** A 409 workspace mismatch retires this form; later edits must not autosave. */
  private workspaceMismatch = false;
  hasDraft = false;

  constructor(readonly scope: string, private restore: (values: DraftValues | null) => void,
    private status: (value: DraftStatus) => void, private transport: Transport = request) {
    this.loaded = this.load();
  }

  private get url(): string { return `/api/document-drafts/${encodeURIComponent(this.scope)}`; }

  private async load(): Promise<void> {
    this.status('loading');
    let result: ApiEnvelope<{ revision: string; values: DraftValues | null }>;
    try {
      result = await this.transport<{ revision: string; values: DraftValues | null }>(this.url);
    } catch (error) {
      // A load that fails is a failure of the session, never an unhandled
      // rejection: the promise of the load always settles.
      this.fail(error instanceof Error ? error : new Error('Draft unavailable'));
      return;
    }
    if (result.error || !result.data) {
      this.fail(result.error ?? new Error('Draft unavailable'));
      return;
    }
    this.revision = result.data.revision;
    this.ready = true;
    this.hasDraft = result.data.values !== null;
    if (!this.disposed && !this.edited) {
      this.restoring = true;
      try { this.restore(result.data.values); } finally { this.restoring = false; }
    }
    if (!this.disposed) this.status(this.pending ? 'saving' : 'saved');
  }

  /** A workspace mismatch must not hand back the revision this form loaded. */
  private assertSameWorkspace(): void {
    if (this.workspaceMismatch) throw this.failure ?? new Error('draft_workspace_mismatch');
  }

  private fail(error: Error): void {
    if (draftWorkspaceMismatch(error)) {
      this.workspaceMismatch = true;
      this.failure = error;
      this.pending = null;
      this.paused = true;
      clearTimeout(this.timer);
      if (!this.disposed) this.status('failed');
      return;
    }
    this.failure = error;
    if (!this.disposed) this.status(error instanceof ApiRequestError && error.code === 'draft_conflict' ? 'conflict' : 'failed');
  }

  change(values: DraftValues): void {
    if (this.workspaceMismatch || this.disposed || this.restoring) return;
    if (this.deletingDraft) { this.edited = true; this.discardEdits = values; return; }
    if (this.paused) return;
    this.edited = true; this.pending = values;
    // A rejected field value is a proven non-write; corrected input may be saved again.
    if (this.failure instanceof ApiRequestError && this.failure.code === 'invalid_draft') this.failure = null;
    if (this.failure) return;
    this.status(this.ready ? 'saving' : 'loading');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, 500);
  }

  /** Errors stay visible and pending metadata stays in memory; conflicts never auto-retry. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const task = this.serial.then(async () => {
      await this.loaded;
      if (this.workspaceMismatch) return;
      if (this.failure) throw this.failure;
      while (this.pending) {
        const values = this.pending; this.pending = null;
        const result = await this.transport<{ revision: string }>(this.url, { method: 'PUT', body: { revision: this.revision, values } });
        if (draftWorkspaceMismatch(result.error)) {
          this.fail(result.error ?? new Error('draft_workspace_mismatch'));
          return;
        }
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
    if (this.discarding) await this.discarding;
    this.assertSameWorkspace();
    if (!this.ready) throw new Error('Wait for the draft to load before saving.');
    this.change(values);
    await this.flush();
    this.assertSameWorkspace();
    this.paused = true;
    this.prepared = values;
    return { scope: this.scope, revision: this.revision };
  }

  /** Flush metadata before a draft-owned file operation without pausing future edits. */
  async reference(): Promise<DraftReference> {
    if (this.discarding) await this.discarding;
    this.assertSameWorkspace();
    if (!this.ready) throw new Error('Wait for the draft to load before continuing.');
    await this.flush();
    this.assertSameWorkspace();
    return { scope: this.scope, revision: this.revision };
  }

  resume(error?: unknown): void {
    this.paused = false;
    if (this.prepared) {
      this.pending = this.prepared; this.prepared = null;
      if (error instanceof ApiRequestError && error.code === 'draft_conflict') this.fail(error);
      else if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
        this.pending = null; this.status('saved');
      } else this.fail(error instanceof Error ? error : new Error('Document save outcome is unknown.'));
    }
  }

  committed(): void { this.paused = true; this.pending = null; this.prepared = null; clearTimeout(this.timer); }

  /** A successful Save & Add Next must read the new tombstone before editing again. */
  async restart(): Promise<void> {
    this.committed(); this.failure = null; this.edited = false; this.ready = false;
    this.loaded = this.load(); await this.loaded;
    this.paused = false;
  }

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
    this.deletingDraft = true;
    this.paused = true; clearTimeout(this.timer); this.pending = null;
    this.status('discarding');
    try {
      await this.loaded; await this.serial;
      if (this.failure) throw this.failure;
      this.status('discarding');
      const result = await this.transport<{ revision: string }>(this.url, { method: 'DELETE', body: { revision: this.revision } });
      if (result.error || !result.data) throw result.error ?? new Error('Draft unavailable');
      this.revision = result.data.revision; this.hasDraft = false;
      if (!this.discardEdits) {
        this.restoring = true;
        try { this.restore(null); } finally { this.restoring = false; }
        this.status('saved');
      }
    } catch (error) {
      this.fail(error as Error);
      if (draftWorkspaceMismatch(error)) return;
      throw error;
    }
    finally {
      this.deletingDraft = false;
      this.paused = false;
      if (this.discardEdits) { this.pending = this.discardEdits; this.discardEdits = null; }
    }
    if (this.pending) await this.flush();
  }

  /**
   * The settlement of the work that has already started.
   *
   * The promise settles when the load, the writes and the deletion of this
   * session have settled. It never rejects: the settlement is an observation
   * of the retirement, not a failure of whoever waits for it.
   */
  private settlement(): Promise<void> {
    return Promise.all([
      this.loaded.catch(() => undefined),
      this.serial.catch(() => undefined),
      this.discarding?.catch(() => undefined) ?? Promise.resolve(),
    ]).then(() => undefined);
  }

  /**
   * Retires the session and reports the settlement of its started work.
   *
   * The returned promise settles when the work that has already started has
   * settled, on every path: a session that is retired without a flush still
   * reports the settlement of its load and of its writes. A pending write is
   * only started when the retirement is allowed to flush, so a retired
   * session never retries a failed write and never overwrites a failed or
   * conflicting draft.
   */
  dispose(flush = false): Promise<void> {
    clearTimeout(this.timer);
    if (flush && !this.paused && !this.failure) {
      void this.flush().catch(() => undefined);
    }
    this.disposed = true;
    return this.settlement();
  }
}
