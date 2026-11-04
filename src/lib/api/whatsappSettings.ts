import { request } from './http';
import { whatsappReminders, type WhatsAppLogFilter } from './whatsapp';

/** Ancillary failures cannot turn a successfully read global sending state into OFF. */
export async function loadWhatsAppReminderSettings(offset: number, filter: WhatsAppLogFilter, signal?: AbortSignal) {
  const [people, jobs, settings] = await Promise.all([
    whatsappReminders.recipients(offset, signal), whatsappReminders.log(filter, signal),
    request<{ settings: Record<string, unknown> }>('/api/settings', { signal }),
  ]);
  const value = settings.data?.settings?.['whatsapp.enabled'];
  const enabled = !settings.error && typeof value === 'boolean' ? value : null;
  return {
    people: people.error ? null : people.data,
    jobs: jobs.error ? null : jobs.data,
    enabled,
    failed: Boolean(people.error || jobs.error || enabled === null),
  };
}
