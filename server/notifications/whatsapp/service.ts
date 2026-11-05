import type { Db } from '../../db/connection.js';
import { RepositoryError } from '../../repositories/base.js';
import { getBoolean, getString, setSetting, setSettings, type SettingValue } from '../../repositories/settings.js';
import { NotificationCoordinator } from '../coordinator.js';
import type { SendOutcome, WhatsAppTransport } from './contracts.js';
import { atomic, ReminderStore } from './repository.js';
import { selectReminders } from './selection.js';
import { changedDestinations, snapshotDestinations, type DestinationSnapshot } from './destinations.js';

export class WhatsAppReminders {
  readonly coordinator = new NotificationCoordinator();
  readonly store: ReminderStore;
  readonly auditInstance: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining: Promise<number> | null = null;
  private stopped = false;
  private beforeDestinations: DestinationSnapshot | null = null;

  constructor(readonly db: Db, readonly instance: string, private readonly transport: WhatsAppTransport,
    readonly clock: () => Date = () => new Date()) {
    this.store = new ReminderStore(db, instance, clock);
    // Invalid sending configuration must not hide this backend's existing audit.
    this.auditInstance = instance || 'romani';
  }

  /** Call inside the business write's transaction and the shared coordinator. */
  reconcile(): void {
    if (!this.instance) return;
    const candidates = selectReminders(this.db, this.instance, this.clock());
    const after = snapshotDestinations(this.db, candidates);
    const replacements = this.beforeDestinations ? changedDestinations(this.beforeDestinations, after) : [];
    this.store.reconcile(candidates, replacements);
    // Multiple hooks in one write must not reuse an already-consumed destination change.
    if (this.beforeDestinations) this.beforeDestinations = after;
  }

  aroundWrite<T>(action: () => Promise<T>): Promise<T> {
    return this.coordinator.runExclusive(async () => {
      this.beforeDestinations = snapshotDestinations(this.db, selectReminders(this.db, this.instance, this.clock()));
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
      if (!getBoolean(this.db, 'whatsapp.enabled')) { this.reconcile(); return 0; }
      const today = this.clock().toISOString().slice(0, 10);
      if (getString(this.db, 'whatsapp.last_enqueue_date') === today) return 0;
      const count = this.store.enqueue(selectReminders(this.db, this.instance, this.clock()));
      setSetting(this.db, 'whatsapp.last_enqueue_date', today);
      return count;
    }));
  }

  async retry(id: string): Promise<void> {
    await this.mutate(() => { this.reconcile(); this.store.retry(id); });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.saveSettings({ 'whatsapp.enabled': enabled });
  }

  async saveSettings(settings: Record<string, SettingValue>): Promise<void> {
    await this.aroundWrite(async () => {
      if (settings['whatsapp.enabled'] === true && !getBoolean(this.db, 'whatsapp.enabled')) await this.assertCanEnable();
      atomic(this.db, () => {
        setSettings(this.db, settings);
        this.reconcile();
      });
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
    if (this.stopped || !getBoolean(this.db, 'whatsapp.enabled')) return 0;
    // Status is bounded by the transport and does not hold up business mutations.
    try { if ((await this.transport.status()).state !== 'connected') return 0; }
    catch { return 0; }
    let sent = 0;
    for (const pending of this.store.due(10)) {
      if (this.stopped) break;
      await this.coordinator.runExclusive(async () => {
        atomic(this.db, () => this.store.reconcileClaim(pending.id, selectReminders(this.db, this.instance, this.clock(), pending)));
        if (this.stopped || !getBoolean(this.db, 'whatsapp.enabled')) return;
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
    if (this.timer || !this.instance) return;
    this.stopped = false;
    this.store.recover();
    this.timer = setInterval(() => {
      void this.drain().catch(() => console.error('[whatsapp] worker failed; details suppressed'));
    }, 60_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }
}
