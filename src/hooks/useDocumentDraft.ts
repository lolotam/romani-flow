import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { DocumentDraftSession, type DraftStatus, type DraftValues } from '@/lib/documentDraftSession';
import { request, type ApiEnvelope, type RequestOptions } from '@/lib/api/http';
import { canEdit } from '@/lib/permissions';

/**
 * The retirements of the sessions, keyed by workspace, account and scope.
 *
 * A session that is retired registers its own settlement here, and the
 * successor of the same identity and the same scope waits for that settlement
 * before it loads. The key owns the retirement: another scope and another
 * identity never wait for it and never read the values of this context. The
 * entry is removed as soon as the retirement has settled, so a retired
 * context leaves nothing behind.
 */
const retirements = new Map<string, Promise<void>>();

/** The key that owns the retirement of one account and one scope. */
function retirementKey(account: string, scope: string): string {
  return `${account}\u0000${scope}`;
}

/**
 * The settlement of a retirement, chained with the one it replaces.
 *
 * The chain keeps the order of the retirements of one key: the successor of
 * a successor waits for the retirement of its predecessor as well. The chain
 * never rejects, so a wait for it can never end in an unhandled rejection.
 */
function chainedSettlement(previous: Promise<void> | null, settlement: Promise<void>): Promise<void> {
  const settled = settlement.catch(() => undefined);
  if (!previous) return settled;
  return previous.then(() => settled, () => settled);
}

/** Changing account/context disposes the previous session instead of applying its late restore. */
export function useDocumentDraft(scope: string, restore: (values: DraftValues | null) => void, enabled = true) {
  const { user, workspaceId } = useAuth();
  const userId = user && canEdit(user.role) ? user.id : null;
  const identityId = userId && workspaceId ? `${workspaceId}:${userId}` : userId;
  const identity = useRef(identityId); identity.current = identityId;
  const callback = useRef(restore); callback.current = restore;
  const session = useRef<DocumentDraftSession | null>(null);
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (!enabled || !userId || !identityId) return;
    let active = true;
    const key = retirementKey(identityId, scope);
    // The load of a successor waits for the settlement of the writes of its
    // predecessor, so it reads what the predecessor has written. The promise
    // is the settlement of the real work, never the notification of a flush.
    const predecessor = retirements.get(key) ?? null;
    const current = new DocumentDraftSession(scope, values => {
      if (active && identity.current === identityId) { setHasDraft(values !== null); callback.current(values); }
    }, value => {
      if (active && identity.current === identityId) {
        setStatus(value);
        if (value === 'saved') setHasDraft(current.hasDraft);
      }
    },
    <T>(url: string, options?: RequestOptions): Promise<ApiEnvelope<T>> => {
      const send = (): Promise<ApiEnvelope<T>> =>
        request<T>(url, { ...options, draftAccount: userId, keepalive: options?.method !== undefined });
      // A write is never delayed: the session orders its own writes behind
      // its own load.
      if (options?.method || !predecessor) return send();
      // The load waits for the retirement of the predecessor. A successor that
      // is retired before the predecessor has settled never sends the
      // request, and the wait never ends in a rejection.
      const afterRetirement = (): Promise<ApiEnvelope<T>> => {
        if (!active || identity.current !== identityId) {
          return Promise.resolve({ data: null, error: new Error('Draft unavailable') });
        }
        return send();
      };
      return predecessor.then(afterRetirement, afterRetirement);
    });
    session.current = current;
    const flush = () => { if (document.visibilityState === 'hidden' && identity.current === identityId) void current.flush().catch(() => undefined); };
    document.addEventListener('visibilitychange', flush);
    return () => {
      active = false; session.current = null;
      document.removeEventListener('visibilitychange', flush);
      // The work of a retired session belongs to the workspace, account and
      // scope of that session. A changed identity never flushes the pending
      // values of the old context, and another identity never waits for it.
      const settlement = current.dispose(identity.current === identityId);
      // The chain keeps the order of the retirements of the key: the entry is
      // the retirement of this session and of every retirement that came
      // before it.
      const chained = chainedSettlement(retirements.get(key) ?? predecessor, settlement);
      retirements.set(key, chained);
      void chained.then(() => { if (retirements.get(key) === chained) retirements.delete(key); });
    };
  }, [scope, identityId, userId, enabled]);
  return { session, status, hasDraft, reference: async () => {
    if (!session.current || identity.current !== identityId) throw new Error('Draft unavailable');
    return { ...await session.current.reference(), account: userId! };
  }, prepare: async (values: DraftValues) => {
    if (!session.current || identity.current !== identityId) throw new Error('Draft unavailable');
    return { ...await session.current.prepare(values), account: userId! };
  } };
}
