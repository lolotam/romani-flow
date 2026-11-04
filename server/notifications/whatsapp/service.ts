import type { Db } from '../../db/connection.js';
import { RepositoryError } from '../../repositories/base.js';
import { getBoolean, getString, setSetting } from '../../repositories/settings.js';
import { NotificationCoordinator } from '../coordinator.js';
import type { SendOutcome, WhatsAppTransport } from './contracts.js';
import { atomic, ReminderStore } from './repository.js';
import { selectReminders } from './selection.js';

export class WhatsAppReminders {
  readonly coordinator = new NotificationCoordinator();
  readonly store: ReminderStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining: Promise<number> | null = null;
  private stopped = false;

  constructor(readonly db: Db, readonly instance: string, private readonly transport: WhatsAppTransport,
    readonly clock: () => Date = () => new Date()) {
    this.store = new ReminderStore(db, instance, clock);
  }

  /** Call inside the business write's transaction and the shared coordinator. */
  reconcile(): void { this.store.reconcile(selectReminders(this.db, this.instance, this.clock())); }

  mutate<T>(action: () => T): Promise<T> {
    return this.coordinator.runExclusive(() => atomic(this.db, () => {
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
    if (enabled) await this.assertCanEnable();
    await this.mutate(() => setSetting(this.db, 'whatsapp.enabled', enabled));
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
        atomic(this.db, () => this.reconcile());
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
    if (this.timer) return;
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
