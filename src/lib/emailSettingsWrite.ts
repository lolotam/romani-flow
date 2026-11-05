import { endpoints } from './api';

/** Require an authoritative, complete settings payload before enabling writes. */
export function validEmailSettings(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  const booleans = ['email.enabled', 'cron.enabled', 'cron.include_employees', 'cron.include_documents'];
  if (!booleans.every(key => typeof settings[key] === 'boolean' || settings[key] === 'true' || settings[key] === 'false')) return false;
  const addresses = ['email.recipients', 'email.cc'];
  if (!addresses.every(key => Array.isArray(settings[key]) && (settings[key] as unknown[]).every(item => typeof item === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(item)))) return false;
  const intervals = settings['email.notification_intervals'];
  return typeof settings['email.from_name'] === 'string'
    && (settings['email.language'] === 'ar' || settings['email.language'] === 'en')
    && typeof settings['cron.schedule'] === 'string' && settings['cron.schedule'].trim().split(/\s+/).length === 5
    && typeof settings['cron.days'] === 'number' && Number.isFinite(settings['cron.days']) && settings['cron.days'] >= 1 && settings['cron.days'] <= 365
    && Array.isArray(intervals) && intervals.every(item => (typeof item === 'string' || typeof item === 'number') && ['90', '30', '15', '7', '1'].includes(String(item)));
}

/** Never write placeholder defaults when authoritative settings could not be read. */
export function writeLoadedEmailSettings(settings: Parameters<typeof endpoints.settings.update>[0], loaded: boolean): ReturnType<typeof endpoints.settings.update> {
  if (!loaded) return Promise.resolve({ data: null, error: new Error('Load email settings successfully before saving.') });
  return endpoints.settings.update(settings);
}
