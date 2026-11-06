import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { DocumentDraftSession, type DraftStatus, type DraftValues } from '@/lib/documentDraftSession';
import { request } from '@/lib/api/http';

/** Changing account/context disposes the previous session instead of applying its late restore. */
export function useDocumentDraft(scope: string, restore: (values: DraftValues | null) => void, enabled = true) {
  const { user } = useAuth();
  const userId = user?.role === 'admin' ? user.id : null;
  const identity = useRef(userId); identity.current = userId;
  const callback = useRef(restore); callback.current = restore;
  const session = useRef<DocumentDraftSession | null>(null);
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    const current: DocumentDraftSession = new DocumentDraftSession(scope, values => {
      if (active && identity.current === userId) { setHasDraft(values !== null); callback.current(values); }
    }, value => {
      if (active && identity.current === userId) {
        setStatus(value);
        if (value === 'saved') setHasDraft(current.hasDraft);
      }
    },
    (url, options) => request(url, { ...options, draftAccount: userId, keepalive: options?.method !== undefined }));
    session.current = current;
    const flush = () => { if (document.visibilityState === 'hidden' && identity.current === userId) void current.flush().catch(() => undefined); };
    document.addEventListener('visibilitychange', flush);
    return () => {
      active = false; session.current = null;
      document.removeEventListener('visibilitychange', flush);
      current.dispose(identity.current === userId);
    };
  }, [scope, userId, enabled]);
  return { session, status, hasDraft, reference: async () => {
    if (!session.current || identity.current !== userId) throw new Error('Draft unavailable');
    return { ...await session.current.reference(), account: userId! };
  }, prepare: async (values: DraftValues) => {
    if (!session.current || identity.current !== userId) throw new Error('Draft unavailable');
    return { ...await session.current.prepare(values), account: userId! };
  } };
}
