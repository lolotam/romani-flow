import { endpoints } from './api';

/** Never write placeholder defaults when authoritative settings could not be read. */
export function writeLoadedEmailSettings(settings: Parameters<typeof endpoints.settings.update>[0], loaded: boolean): ReturnType<typeof endpoints.settings.update> {
  if (!loaded) return Promise.resolve({ data: null, error: new Error('Load email settings successfully before saving.') });
  return endpoints.settings.update(settings);
}
