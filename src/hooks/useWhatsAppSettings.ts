import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { ApiRequestError, request, type ApiEnvelope } from '@/lib/api/http';
import { whatsappReminders, type WhatsAppRecipient, type WhatsAppLogItem, type WhatsAppLogFilter } from '@/lib/api/whatsapp';

export function useWhatsAppSettings() {
  const { user } = useAuth();
  const identity = user?.role === 'admin' ? user.id : null;
  const active = useRef<string | null>(identity);
  const generation = useRef(0);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [filter, setFilter] = useState<WhatsAppLogFilter>({});
  const [recipients, setRecipients] = useState<WhatsAppRecipient[]>([]), [recipientTotal, setRecipientTotal] = useState(0);
  const [log, setLog] = useState<WhatsAppLogItem[]>([]), [logTotal, setLogTotal] = useState(0);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!identity) return;
    setLoading(true);
    const version = ++generation.current;
    const results = await Promise.all([
      whatsappReminders.recipients(recipientOffset, signal), whatsappReminders.log(filter, signal),
      request<{ settings: Record<string, unknown> }>('/api/settings', { signal }),
    ]);
    if (signal?.aborted || active.current !== identity || generation.current !== version) return;
    setLoading(false);
    const [people, jobs, settings] = results;
    if (results.some(result => result.error)) { setError('failed'); return; }
    setRecipients(people.data?.items ?? []); setRecipientTotal(people.data?.total ?? 0);
    setLog(jobs.data?.items ?? []); setLogTotal(jobs.data?.total ?? 0);
    setEnabled(settings.data?.settings['whatsapp.enabled'] === true); setError('');
  }, [identity, recipientOffset, filter]);
  const latestLoad = useRef(load);
  useEffect(() => { latestLoad.current = load; }, [load]);

  useEffect(() => {
    active.current = identity;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); active.current = null; };
  }, [load, identity]);

  const act = async (operation: () => Promise<ApiEnvelope<unknown>>): Promise<boolean> => {
    if (!identity || active.current !== identity) return false;
    setBusy(true); setError('');
    try {
      const result = await operation();
      if (active.current !== identity) return false;
      if (result.error) {
        setError(result.error instanceof ApiRequestError && result.error.code === 'duplicate_recipient' ? 'duplicate' : result.error instanceof ApiRequestError && result.error.code === 'whatsapp_not_connected' ? 'connectFirst' : 'failed');
        return false;
      }
      await latestLoad.current(); return true;
    } finally { if (active.current === identity) setBusy(false); }
  };

  return { recipients, recipientTotal, recipientOffset, setRecipientOffset, log, logTotal, filter, setFilter,
    enabled, busy, loading, error, act, reload: () => void load(),
    setEnabled: (value: boolean) => act(() => request('/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.enabled': value } } })) };
}
