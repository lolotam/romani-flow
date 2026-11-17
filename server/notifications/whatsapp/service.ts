import type { Db } from '../../db/connection.js';
import { RepositoryError, type Scope } from '../../repositories/base.js';
import { getBoolean, getString, isTenantSetting, PLATFORM, setSetting, setSettings, type SettingValue } from '../../repositories/settings.js';
import { LEGACY_WORKSPACE_ID, isWorkspaceSuspended } from '../../repositories/workspaces.js';
import { NotificationCoordinator } from '../coordinator.js';
import type { SendOutcome, WhatsAppTransport } from './contracts.js';
import { atomic, ReminderStore } from './repository.js';
import { selectReminders } from './selection.js';
import { changedDestinations, snapshotDestinations, type DestinationSnapshot } from './destinations.js';

import { getWorkspaceInstance } from '../../whatsapp/instance.js';

export class WhatsAppReminders {
  readonly scope: Scope;
  readonly coordinator = new NotificationCoordinator();
  readonly store: ReminderStore;
  readonly auditInstance: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining: Promise<number> | null = null;
  private stopped = false;
  private started = false;
  private beforeDestinations: DestinationSnapshot | null = null;
  private readonly workspaceRuntimes = new Map<string, WhatsAppReminders>();

  constructor(
    readonly db: Db,
    readonly instance: string,
    readonly transport: WhatsAppTransport,
    readonly clock: () => Date = () => new Date(),
    scope: Scope = { workspaceId: LEGACY_WORKSPACE_ID },
    readonly transportFactory?: (instance: string, scope?: Scope) => WhatsAppTransport,
  ) {
    this.scope = scope;
    this.store = new ReminderStore(db, this.scope, instance, clock);
    // Invalid sending configuration must not hide this backend's existing audit.
    this.auditInstance = instance || 'romani';
  }

  forWorkspace(scope: Scope, instance?: string, transport?: WhatsAppTransport): WhatsAppReminders {
    const inst = instance ?? this.instance;
    if (scope.workspaceId === this.scope.workspaceId && inst === this.instance) {
      return this;
    }
    const key = `${scope.workspaceId}:${inst}`;
    let runtime = this.workspaceRuntimes.get(key);
    if (!runtime) {
      const childTransport = transport ?? (this.transportFactory ? this.transportFactory(inst, scope) : this.transport);
      runtime = new WhatsAppReminders(this.db, inst, childTransport, this.clock, scope, this.transportFactory);
      this.workspaceRuntimes.set(key, runtime);
      if (this.started) {
        runtime.start();
      }
    }
    return runtime;
  }

  /** Call inside the business write's transaction and the shared coordinator. */
  reconcile(): void {
    if (!this.instance) return;
    const candidates = selectReminders(this.db, this.scope, this.instance, this.clock());
    const after = snapshotDestinations(this.db, this.scope, candidates);
    const replacements = this.beforeDestinations ? changedDestinations(this.beforeDestinations, after) : [];
    this.store.reconcile(candidates, replacements);
    // Multiple hooks in one write must not reuse an already-consumed destination change.
    if (this.beforeDestinations) this.beforeDestinations = after;
  }

  aroundWrite<T>(action: () => Promise<T>): Promise<T> {
    return this.coordinator.runExclusive(async () => {
      this.beforeDestinations = snapshotDestinations(this.db, this.scope, selectReminders(this.db, this.scope, this.instance, this.clock()));
      try { return await action(); }
      finally { this.beforeDestinations = null; }
    });
  }

  mutate<T>(action: () => T): Promise<T> {
    return this.aroundWrite(async () => atomic(this.db, () => {
      const result = action();
      this.reconcile();
      return result;
    }));
  }

  async schedule(): Promise<number> {
    return this.coordinator.runExclusive(() => atomic(this.db, () => {
      if (!this.instance) return 0;
      // A suspended workspace keeps its rows, but no message is queued for it.
      if (isWorkspaceSuspended(this.db, this.scope.workspaceId)) return 0;
      if (!getBoolean(this.db, this.scope, 'whatsapp.enabled')) { this.reconcile(); return 0; }
      const today = this.clock().toISOString().slice(0, 10);
      if (getString(this.db, this.scope, 'whatsapp.last_enqueue_date') === today) return 0;
      const count = this.store.enqueue(selectReminders(this.db, this.scope, this.instance, this.clock()));
      setSetting(this.db, this.scope, 'whatsapp.last_enqueue_date', today);
      return count;
    }));
  }

  async retry(id: string): Promise<void> {
    await this.mutate(() => { this.reconcile(); this.store.retry(id); });
  }

  async retryForWorkspace(scope: Scope, id: string): Promise<void> {
    await this.mutate(() => {
      const job = this.db.prepare(
        'SELECT id, workspace_id, instance, state, error_code, text, recipient FROM whatsapp_jobs WHERE id = ? AND workspace_id = ? AND instance = ?',
      ).get(id, scope.workspaceId, this.auditInstance);
      if (!job) {
        throw new RepositoryError('Job not found.', 'not_found', 404);
      }
      this.reconcile();
      this.store.retry(id);
    });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.saveSettings(this.scope, { 'whatsapp.enabled': enabled });
  }

  /**
   * Saves settings under the shared coordinator.
   */
  async saveSettings(
    scope: Scope,
    settings: Record<string, SettingValue>,
    beforeWrite?: () => void,
  ): Promise<void> {
    await this.aroundWrite(async () => {
      if (settings['whatsapp.enabled'] === true && !getBoolean(this.db, scope, 'whatsapp.enabled')) await this.assertCanEnable();
      beforeWrite?.();
      this.applySettings(scope, settings);
    });
  }

  /** Disable and disconnect share one lock; settings are disabled before disconnect so failures still stop reminders. */
  withSendingDisabled<T>(disconnect: () => Promise<T>, targetScope?: Scope): Promise<T> {
    const scope = targetScope ?? this.scope;
    return this.aroundWrite(async () => {
      this.applySettings(scope, { 'whatsapp.enabled': false });
      return await disconnect();
    });
  }

  /** Caller holds the coordinator; the SQLite transaction ends before provider I/O. */
  private applySettings(scope: Scope, settings: Record<string, SettingValue>): void {
    const entries = Object.entries(settings);
    const tenant = Object.fromEntries(entries.filter(([key]) => isTenantSetting(key)));
    const platform = Object.fromEntries(entries.filter(([key]) => !isTenantSetting(key)));
    atomic(this.db, () => {
      setSettings(this.db, scope, tenant);
      setSettings(this.db, PLATFORM, platform);
      this.reconcile();
    });
  }

  async assertCanEnable(): Promise<void> {
    const status = await this.transport.status();
    if (!status.configured || status.state !== 'connected') throw new RepositoryError('Connect WhatsApp before enabling reminders.', 'whatsapp_not_connected', 409);
  }

  drain(): Promise<number> {
    if (this.draining) return this.draining;
    this.draining = this.drainBatch().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async drainBatch(): Promise<number> {
    if (this.stopped || !getBoolean(this.db, this.scope, 'whatsapp.enabled')) return 0;
    // A suspended workspace keeps its queued jobs, but none of them is delivered.
    if (isWorkspaceSuspended(this.db, this.scope.workspaceId)) return 0;
    // Status is bounded by the transport and does not hold up business mutations.
    try { if ((await this.transport.status()).state !== 'connected') return 0; }
    catch { return 0; }
    let sent = 0;
    for (const pending of this.store.due(10)) {
      if (this.stopped) break;
      await this.coordinator.runExclusive(async () => {
        atomic(this.db, () => this.store.reconcileClaim(pending.id, selectReminders(this.db, this.scope, this.instance, this.clock(), pending)));
        if (this.stopped || !getBoolean(this.db, this.scope, 'whatsapp.enabled')
          || isWorkspaceSuspended(this.db, this.scope.workspaceId)) return;
        const claim = this.store.claim(pending.id);
        if (!claim) return;
        let outcome: SendOutcome;
        try { outcome = await this.transport.sendText(claim.job.recipient, claim.job.text); }
        catch { outcome = { kind: 'unknown', code: 'transport_interrupted' }; }
        this.store.finish(claim.job, claim.attemptId, outcome);
        if (outcome.kind === 'provider_accepted') sent += 1;
      });
    }
    return sent;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    if (this.instance) {
      this.store.recover();
      this.timer = setInterval(() => {
        void this.drain().catch(() => console.error('[whatsapp] worker failed; details suppressed'));
      }, 60_000);
      this.timer.unref();
    }

    for (const child of this.workspaceRuntimes.values()) {
      child.start();
    }

    if (this.scope.workspaceId === LEGACY_WORKSPACE_ID) {
      try {
        const rows = this.db.prepare('SELECT id FROM workspaces WHERE id != ?').all(LEGACY_WORKSPACE_ID) as { id: string }[];
        for (const row of rows) {
          const inst = getWorkspaceInstance(this.db, row.id, '');
          const runtime = this.forWorkspace({ workspaceId: row.id }, inst);
          runtime.start();
        }
      } catch {
        // Ignored if table not initialized in unit tests
      }
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const stops: (Promise<number> | Promise<void>)[] = [];
    if (this.draining) stops.push(this.draining);
    for (const child of this.workspaceRuntimes.values()) {
      stops.push(child.stop());
    }
    await Promise.all(stops);
  }
}
