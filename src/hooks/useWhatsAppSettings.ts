import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { ApiRequestError, request, type ApiEnvelope } from '@/lib/api/http';
import type { WhatsAppRecipient, WhatsAppLogItem, WhatsAppLogFilter } from '@/lib/api/whatsapp';
import { loadWhatsAppReminderSettings } from '@/lib/api/whatsappSettings';
import { isOwner } from '@/lib/permissions';

export function useWhatsAppSettings(refreshKey = 0) {
  const { user, workspaceId } = useAuth();
  const identity = user && isOwner(user.role)
    ? workspaceId ? `${workspaceId}:${user.id}` : user.id
    : null;
  const active = useRef<string | null>(identity);
  const generation = useRef(0);
  const identityEpoch = useRef(0);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [filter, setFilter] = useState<WhatsAppLogFilter>({});
  const [recipients, setRecipients] = useState<WhatsAppRecipient[]>([]), [recipientTotal, setRecipientTotal] = useState(0);
  const [log, setLog] = useState<WhatsAppLogItem[]>([]), [logTotal, setLogTotal] = useState(0);
  const [recipientsAvailable, setRecipientsAvailable] = useState(false), [logAvailable, setLogAvailable] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<'ar' | 'en' | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Returning to the same account must not revive an earlier session's mutation.
  // Lists are cleared here and withheld until a load for this identity finishes.
  useEffect(() => {
    identityEpoch.current += 1;
    setLoadedFor(null);
    setBusy(false); setError('');
    setRecipients([]); setRecipientTotal(0); setRecipientsAvailable(false);
    setLog([]); setLogTotal(0); setLogAvailable(false);
    setRecipientOffset(current => current === 0 ? current : 0);
    setFilter(current => Object.keys(current).length === 0 ? current : {});
    return () => { identityEpoch.current += 1; };
  }, [identity]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!identity) return;
    setLoading(true);
    setEnabled(null);
    setLanguage(null);
    const version = ++generation.current;
    const results = await loadWhatsAppReminderSettings(recipientOffset, filter, signal);
    if (signal?.aborted || active.current !== identity || generation.current !== version) return;
    setLoadedFor(identity);
    setLoading(false);
    setRecipientsAvailable(results.people !== null); setLogAvailable(results.jobs !== null);
    setRecipients(results.people?.items ?? []); setRecipientTotal(results.people?.total ?? 0);
    setLog(results.jobs?.items ?? []); setLogTotal(results.jobs?.total ?? 0);
    setEnabled(results.enabled); setError(results.failed ? 'failed' : '');
    setLanguage(results.language);
  }, [identity, recipientOffset, filter]);
  const latestLoad = useRef(load);
  useEffect(() => { latestLoad.current = load; }, [load]);

  useEffect(() => {
    active.current = identity;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); active.current = null; };
  }, [load, identity, refreshKey]);

  const act = async (operation: () => Promise<ApiEnvelope<unknown>>): Promise<boolean> => {
    if (!identity || active.current !== identity) return false;
    const epoch = identityEpoch.current;
    const current = () => active.current === identity && identityEpoch.current === epoch;
    setBusy(true); setError('');
    try {
      const result = await operation();
      if (!current()) return false;
      if (result.error) {
        setError(result.error instanceof ApiRequestError && result.error.code === 'duplicate_recipient' ? 'duplicate' : result.error instanceof ApiRequestError && result.error.code === 'whatsapp_not_connected' ? 'connectFirst' : 'failed');
        return false;
      }
      await latestLoad.current(); return current();
    } finally { if (current()) setBusy(false); }
  };

  const listsMatch = loadedFor === identity;
  return { recipients: listsMatch ? recipients : [], recipientTotal: listsMatch ? recipientTotal : 0, recipientOffset, setRecipientOffset, recipientsAvailable: listsMatch && recipientsAvailable, log: listsMatch ? log : [], logTotal: listsMatch ? logTotal : 0, logAvailable: listsMatch && logAvailable, filter, setFilter,
    enabled: active.current === identity ? enabled : null, language: active.current === identity ? language : null, busy, loading, error, act, reload: () => void load(),
    setLanguage: (value: 'ar' | 'en') => language === null ? Promise.resolve(false) : act(() => request('/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.language': value } } })),
    setEnabled: (value: boolean) => enabled === null ? Promise.resolve(false) : act(() => request('/api/settings', { method: 'PUT', body: { settings: { 'whatsapp.enabled': value } } })) };
}
