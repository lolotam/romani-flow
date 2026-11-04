import cron, { type ScheduledTask } from 'node-cron';
import type { Db } from '../db/connection.js';
import { getBoolean, getString, setSetting } from '../repositories/settings.js';
import type { Mailer } from './mailer.js';
import {
  recordAutomatedRun,
  sendExpiryReport,
  shouldSkipAutomatedRun,
} from './expiryService.js';

/**
 * Scheduled expiry reminders.
 *
 * The scheduler lives inside the API process: the deployment is a single
 * container with one SQLite file, so a second process would add a coordination
 * problem without buying any throughput. The schedule is stored in the database
 * and re-read whenever the settings change, so it can be edited from the UI
 * without restarting the container.
 */

export interface CronStatus {
  enabled: boolean;
  schedule: string;
  running: boolean;
  lastRunAt: string;
  lastRunResult: string;
  nextRun: string | null;
}

export class CronService {
  private task: ScheduledTask | null = null;
  private inFlight = false;
  private reminderEnqueue: (() => Promise<unknown>) | null = null;

  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  setReminderEnqueue(action: () => Promise<unknown>): void { this.reminderEnqueue = action; }

  private async enqueueReminders(source: 'cron' | 'manual'): Promise<void> {
    if (source !== 'cron' || !this.reminderEnqueue) return;
    try { await this.reminderEnqueue(); }
    catch { console.error('[whatsapp] scheduled selection failed; details suppressed'); }
  }

  /** Reads the schedule from the database and (re)arms the scheduler. */
  reschedule(): CronStatus {
    this.stop();

    const enabled = getBoolean(this.db, 'cron.enabled');
    const schedule = getString(this.db, 'cron.schedule', '0 8 * * *');

    if (!enabled) {
      return this.status();
    }

    if (!cron.validate(schedule)) {
      console.error(`[cron] invalid schedule "${schedule}" — the job stays disabled.`);
      setSetting(this.db, 'cron.last_run_result', `invalid schedule: ${schedule}`);
      return this.status();
    }

    this.task = cron.schedule(schedule, () => {
      void this.run();
    });

    console.log(`[cron] expiry reminder scheduled with "${schedule}"`);

    return this.status();
  }

  /**
   * Runs the expiry report.
   *
   * A run that is already in flight is not started twice, and an automatic run
   * that already happened today is skipped so a container restart cannot send a
   * second copy of the same report.
   * WhatsApp selection remains idempotent and independent when a manual email
   * report overlaps the real scheduled firing.
   */
  async run(source: 'cron' | 'manual' = 'cron'): Promise<{ sent: boolean; skipped?: string; error?: string }> {
    if (this.inFlight) {
      await this.enqueueReminders(source);
      return { sent: false, skipped: 'already_running' };
    }

    this.inFlight = true;
    try {
      // WhatsApp owns its checkpoint; an email success/disable must not suppress it.
      await this.enqueueReminders(source);
      if (source === 'cron' && shouldSkipAutomatedRun(this.db)) {
        return { sent: false, skipped: 'already_run_today' };
      }
      const result = await sendExpiryReport(this.db, this.mailer, source);

      if (source === 'cron') {
        // A genuine failure must stay retryable: the day is only marked as
        // "already handled" when the run actually completed.
        const completed =
          result.sent ||
          result.skipped === 'nothing_due' ||
          result.skipped === 'disabled' ||
          result.skipped === 'no_recipients' ||
          result.skipped === 'no_intervals';

        recordAutomatedRun(this.db, result.sent ? 'sent' : (result.skipped ?? 'skipped'), completed);
      }

      return { sent: result.sent, skipped: result.skipped, error: result.error };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (source === 'cron') {
        recordAutomatedRun(this.db, `failed: ${detail}`, false);
      }
      console.error('[cron] expiry report failed:', error);
      return { sent: false, error: detail };
    } finally {
      this.inFlight = false;
    }
  }

  status(): CronStatus {
    return {
      enabled: getBoolean(this.db, 'cron.enabled'),
      schedule: getString(this.db, 'cron.schedule', '0 8 * * *'),
      running: this.inFlight,
      lastRunAt: getString(this.db, 'cron.last_run_at'),
      lastRunResult: getString(this.db, 'cron.last_run_result'),
      nextRun: this.task?.getNextRun()?.toISOString() ?? null,
    };
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

}
