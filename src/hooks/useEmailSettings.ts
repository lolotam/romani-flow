import { useCallback, useEffect, useRef, useState } from 'react';
import { endpoints, rejectedSettings } from '@/lib/api';
import type { CronStatus, EmailLogEntry, ExpiryPreview, SmtpStatus } from '@/lib/api';
import { ApiRequestError } from '@/lib/api/http';
import { validEmailSettings, writeLoadedEmailSettings } from '@/lib/emailSettingsWrite';
import { useAuth } from './useAuth';
import { isOwner } from '@/lib/permissions';

/**
 * State and actions of the e-mail settings screen.
 *
 * Everything lives on the server: the form is loaded from `GET /api/settings`
 * and written back with `PUT /api/settings`. The actions return a small
 * `{ ok, message }` result so the screen decides how to tell the user.
 */

export const REMINDER_INTERVALS = [90, 30, 15, 7, 1] as const;

export interface EmailForm {
  enabled: boolean;
  recipients: string;
  cc: string;
  fromName: string;
  language: 'ar' | 'en';
  intervals: number[];
  cronEnabled: boolean;
  cronSchedule: string;
  cronDays: number;
  includeEmployees: boolean;
  includeDocuments: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const EMPTY_FORM: EmailForm = {
  enabled: true,
  recipients: '',
  cc: '',
  fromName: 'ROMANI Flow',
  language: 'ar',
  intervals: [...REMINDER_INTERVALS],
  cronEnabled: true,
  cronSchedule: '0 8 * * *',
  cronDays: 30,
  includeEmployees: true,
  includeDocuments: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function forbidden(error: Error | null): boolean {
  return error instanceof ApiRequestError && error.status === 403;
}

function toForm(settings: Record<string, unknown>): EmailForm {
  return {
    enabled: asBoolean(settings['email.enabled'], EMPTY_FORM.enabled),
    recipients: asList(settings['email.recipients']).join(', '),
    cc: asList(settings['email.cc']).join(', '),
    fromName: String(settings['email.from_name'] ?? EMPTY_FORM.fromName),
    language: settings['email.language'] === 'en' ? 'en' : 'ar',
    intervals: asList(settings['email.notification_intervals'])
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => (REMINDER_INTERVALS as readonly number[]).includes(entry)),
    cronEnabled: asBoolean(settings['cron.enabled'], EMPTY_FORM.cronEnabled),
    cronSchedule: String(settings['cron.schedule'] ?? EMPTY_FORM.cronSchedule),
    cronDays: asNumber(settings['cron.days'], EMPTY_FORM.cronDays),
    includeEmployees: asBoolean(settings['cron.include_employees'], true),
    includeDocuments: asBoolean(settings['cron.include_documents'], true),
  };
}

export function useEmailSettings() {
  const { user, scheduleEditable } = useAuth();
  const owner = isOwner(user?.role);
  const [form, setForm] = useState<EmailForm>(EMPTY_FORM);
  const [smtp, setSmtp] = useState<SmtpStatus | null>(null);
  const [cron, setCron] = useState<CronStatus | null>(null);
  const [preview, setPreview] = useState<ExpiryPreview | null>(null);
  const [log, setLog] = useState<EmailLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'test' | 'report' | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const ready = useRef(false);

  const loadStatus = useCallback(async () => {
    if (!owner) return;
    const [cronResult, previewResult, logResult] = await Promise.all([
      endpoints.cron.status(),
      endpoints.email.expiryPreview(),
      endpoints.email.log(),
    ]);
    setCron(cronResult.data);
    setPreview(previewResult.data);
    setLog(logResult.data ?? []);
  }, [owner]);

  const load = useCallback(async () => {
    if (!owner) {
      ready.current = false;
      setSettingsReady(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    ready.current = false; setSettingsReady(false);
    const [{ data, error }, status] = await Promise.all([
      endpoints.settings.read(),
      endpoints.email.status(),
    ]);
    if (forbidden(error)) {
      setIsLoading(false);
      return;
    }
    if (!error && validEmailSettings(data?.settings)) {
      setForm(toForm(data.settings));
      const configured = typeof status.data?.configured === 'boolean'
        ? status.data.configured
        : data.smtp?.configured === true;
      setSmtp({ configured });
      ready.current = true; setSettingsReady(true);
    }
    await loadStatus();
    setIsLoading(false);
  }, [loadStatus, owner]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleInterval = (days: number, selected: boolean) => {
    setForm((current) => ({
      ...current,
      intervals: selected
        ? [...new Set([...current.intervals, days])]
        : current.intervals.filter((entry) => entry !== days),
    }));
  };

  const save = async (): Promise<ActionResult> => {
    setBusy('save');
    const { error } = await writeLoadedEmailSettings({
      'email.enabled': form.enabled,
      'email.recipients': splitAddresses(form.recipients),
      'email.cc': splitAddresses(form.cc),
      'email.from_name': form.fromName.trim(),
      'email.language': form.language,
      'email.notification_intervals': form.intervals,
      'cron.enabled': form.cronEnabled,
      // A workspace that cannot edit the platform schedule must not send it:
      // a changed value would reject the whole save.
      ...(scheduleEditable ? { 'cron.schedule': form.cronSchedule.trim() } : {}),
      'cron.days': form.cronDays,
      'cron.include_employees': form.includeEmployees,
      'cron.include_documents': form.includeDocuments,
    }, ready.current);
    setBusy(null);

    if (error) {
      const refused = rejectedSettings(error);
      const detail = refused.map((entry) => `${entry.key}: ${entry.reason}`).join(' | ');
      return { ok: false, message: detail || error.message };
    }

    await loadStatus();
    return { ok: true, message: '' };
  };

  const sendTest = async (): Promise<ActionResult> => {
    if (!ready.current) return { ok: false, message: 'Load email settings successfully before sending.' };
    setBusy('test');
    const { data, error } = await endpoints.email.sendTest(splitAddresses(form.recipients), splitAddresses(form.cc));
    setBusy(null);
    await loadStatus();
    if (error || !data?.sent) return { ok: false, message: error?.message ?? 'not_sent' };
    return { ok: true, message: '' };
  };

  const sendReport = async (): Promise<ActionResult> => {
    if (!ready.current) return { ok: false, message: 'Load email settings successfully before sending.' };
    setBusy('report');
    const { data, error } = await endpoints.email.expiryReport();
    setBusy(null);
    await loadStatus();
    if (error) return { ok: false, message: error.message };
    if (!data?.sent) return { ok: false, message: data?.error ?? data?.skipped ?? 'not_sent' };
    return { ok: true, message: '' };
  };

  return {
    form,
    setForm,
    smtp,
    cron,
    preview,
    log,
    isLoading,
    settingsReady,
    reloadSettings: load,
    busy,
    toggleInterval,
    save,
    sendTest,
    sendReport,
    refresh: loadStatus,
  };
}
