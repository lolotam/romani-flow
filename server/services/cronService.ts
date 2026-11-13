import cron, { type ScheduledTask } from 'node-cron';
import type { Db } from '../db/connection.js';
import type { Scope } from '../repositories/base.js';
import { getBoolean, getString, PLATFORM, setSetting } from '../repositories/settings.js';
import { LEGACY_WORKSPACE_ID, isWorkspaceSuspended, listWorkspaceIds } from '../repositories/workspaces.js';
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
 *
 * The schedule is one platform setting; each firing reports every active
 * workspace that enabled its reminders, one workspace at a time, so a failure in
 * one workspace never blocks or leaks into another.
 */

export interface CronStatus {
  enabled: boolean;
  /** Present only when this workspace may read the platform schedule. */
  schedule?: string;
  running: boolean;
  lastRunAt: string;
  lastRunResult: string;
  nextRun: string | null;
}

interface CronResult { sent: boolean; skipped?: string; error?: string }

const DEFAULT_SCHEDULE = '0 8 * * *';

/** D11: until the platform dashboard exists, only the legacy workspace edits the shared schedule. */
export function mayChangeSchedule(scope: Scope): boolean {
  return scope.workspaceId === LEGACY_WORKSPACE_ID;
}

/** A day is only "handled" when the run completed; a genuine failure stays retryable. */
const COMPLETED_SKIPS = new Set(['nothing_due', 'disabled', 'no_recipients', 'no_intervals']);

/** Several workspace results read as one: an error or a partial run is never hidden. */
function combine(results: CronResult[]): CronResult {
  if (results.length === 0) return { sent: false, skipped: 'disabled' };
  const skipped = results.every(result => result.skipped === results[0].skipped) ? results[0].skipped : undefined;
  const error = results.find(result => result.error)?.error;
  return { sent: results.every(result => result.sent), ...(skipped ? { skipped } : {}), ...(error ? { error } : {}) };
}

export class CronService {
  private task: ScheduledTask | null = null;
  private inFlight = false;
  private reminderEnqueue: { scope: Scope; action: () => Promise<unknown> } | null = null;
  private readonly activeRuns = new Set<Promise<CronResult>>();
  private closing = false;

  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  /**
   * The WhatsApp selection of the workspace that owns the instance. It only runs
   * when that workspace enabled its scheduled reminders: another workspace
   * enabling its own report must never select or queue messages here.
   */
  setReminderEnqueue(scope: Scope, action: () => Promise<unknown>): void { this.reminderEnqueue = { scope, action }; }

  private async enqueueReminders(source: 'cron' | 'manual'): Promise<void> {
    if (source !== 'cron' || !this.reminderEnqueue) return;
    if (!getBoolean(this.db, this.reminderEnqueue.scope, 'cron.enabled')) return;
    // A suspended workspace keeps its data but sends nothing.
    if (isWorkspaceSuspended(this.db, this.reminderEnqueue.scope.workspaceId)) return;
    try { await this.reminderEnqueue.action(); }
    catch { console.error('[whatsapp] scheduled selection failed; details suppressed'); }
  }

  /** The active workspaces whose administrators turned the scheduled report on. */
  private enabledWorkspaces(): Scope[] {
    return listWorkspaceIds(this.db)
      .map(workspaceId => ({ workspaceId }))
      .filter(scope => getBoolean(this.db, scope, 'cron.enabled'));
  }

  /** Reads the schedule from the database and (re)arms the scheduler. */
  reschedule(): void {
    this.stop();
    if (this.closing || this.enabledWorkspaces().length === 0) return;

    const schedule = this.currentSchedule();
    if (!cron.validate(schedule)) {
      console.error(`[cron] invalid schedule "${schedule}" — the job stays disabled.`);
      // Only the legacy workspace can edit the platform schedule in P1 (decision D11).
      setSetting(this.db, { workspaceId: LEGACY_WORKSPACE_ID }, 'cron.last_run_result', `invalid schedule: ${schedule}`);
      return;
    }

    this.task = cron.schedule(schedule, () => {
      void this.run();
    });
    console.log(`[cron] expiry reminder scheduled with "${schedule}"`);
  }

  /**
   * Runs the expiry report: a scheduled run covers every enabled workspace, a
   * manual run only the requesting one.
   *
   * A run that is already in flight is not started twice, and an automatic run
   * that already happened today is skipped so a container restart cannot send a
   * second copy of the same report.
   * WhatsApp selection remains idempotent and independent when a manual email
   * report overlaps the real scheduled firing.
   */
  run(source?: 'cron'): Promise<CronResult>;
  run(source: 'manual', scope: Scope): Promise<CronResult>;
  run(source: 'cron' | 'manual' = 'cron', scope?: Scope): Promise<CronResult> {
    if (source === 'manual' && !scope) throw new Error('A manual report needs the requesting workspace.');
    if (this.closing) return Promise.resolve({ sent: false, skipped: 'shutting_down' });
    const active = this.executeRun(source, scope);
    this.activeRuns.add(active);
    void active.then(() => this.activeRuns.delete(active), () => this.activeRuns.delete(active));
    return active;
  }

  private async executeRun(source: 'cron' | 'manual', scope?: Scope): Promise<CronResult> {
    if (this.inFlight) {
      await this.enqueueReminders(source);
      return { sent: false, skipped: 'already_running' };
    }

    this.inFlight = true;
    try {
      // WhatsApp owns its checkpoint; an email success/disable must not suppress it.
      await this.enqueueReminders(source);
      if (source === 'manual') return await this.reportFor(scope!, 'manual');
      const results: CronResult[] = [];
      for (const workspace of this.enabledWorkspaces()) results.push(await this.reportFor(workspace, 'cron'));
      return combine(results);
    } finally {
      this.inFlight = false;
    }
  }

  private async reportFor(scope: Scope, source: 'cron' | 'manual'): Promise<CronResult> {
    try {
      // A suspended workspace keeps every row, but no report leaves it.
      if (isWorkspaceSuspended(this.db, scope.workspaceId)) {
        return { sent: false, skipped: 'workspace_suspended' };
      }
      if (source === 'cron' && shouldSkipAutomatedRun(this.db, scope)) {
        return { sent: false, skipped: 'already_run_today' };
      }
      const result = await sendExpiryReport(this.db, scope, this.mailer, source);
      if (source === 'cron') {
        const completed = result.sent || COMPLETED_SKIPS.has(result.skipped ?? '');
        recordAutomatedRun(this.db, scope, result.sent ? 'sent' : (result.skipped ?? 'skipped'), completed);
      }
      return { sent: result.sent, skipped: result.skipped, error: result.error };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (source === 'cron') recordAutomatedRun(this.db, scope, `failed: ${detail}`, false);
      console.error('[cron] expiry report failed:', error);
      return { sent: false, error: detail };
    }
  }

  /** The one platform schedule every enabled workspace reports on (D11). */
  currentSchedule(): string {
    return getString(this.db, PLATFORM, 'cron.schedule', DEFAULT_SCHEDULE);
  }

  status(scope: Scope): CronStatus {
    const status: CronStatus = {
      enabled: getBoolean(this.db, scope, 'cron.enabled'),
      running: this.activeRuns.size > 0,
      lastRunAt: getString(this.db, scope, 'cron.last_run_at'),
      lastRunResult: getString(this.db, scope, 'cron.last_run_result'),
      nextRun: getBoolean(this.db, scope, 'cron.enabled') ? (this.task?.getNextRun()?.toISOString() ?? null) : null,
    };
    if (mayChangeSchedule(scope)) status.schedule = this.currentSchedule();
    return status;
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.stop();
    await Promise.all([...this.activeRuns]);
  }
}
