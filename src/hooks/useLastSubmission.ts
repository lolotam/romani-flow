import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from './useAuth';
import { request } from '@/lib/api/http';
type Values = Record<string, unknown>;

/** Restore only successful server submissions, never unsaved browser state. */
export function useLastSubmissionRestore(form: string, enabled: boolean,
  restore: (values: Values) => void, pristine: () => boolean) {
  const { user } = useAuth();
  const userId = user?.id;
  const callbacks = useRef({ restore, pristine });
  callbacks.current = { restore, pristine };
  useEffect(() => {
    if (!enabled || !userId) return;
    const controller = new AbortController();
    void request<Values>(`/api/form-defaults/${form}`, { signal: controller.signal }).then(({ data, error }) => {
      if (!controller.signal.aborted && !error && data && Object.keys(data).length > 0 && callbacks.current.pristine()) callbacks.current.restore(data);
    });
    return () => controller.abort();
  }, [form, enabled, userId]);
}

/** Guard late responses against overwriting input and reset when accounts change. */
export function useLastSubmissionState<T extends object>(form: string, initial: T, enabled = true): [T, Dispatch<SetStateAction<T>>] {
  const { user } = useAuth();
  const baseline = useRef(initial);
  const dirty = useRef(false);
  const [value, update] = useState<T>(initial);
  useEffect(() => {
    if (enabled) { dirty.current = false; update(baseline.current); }
  }, [enabled, user?.id]);
  useLastSubmissionRestore(form, enabled, (saved) => {
    const next = { ...baseline.current };
    for (const key of Object.keys(next) as Array<keyof T>) {
      const item = saved[String(key)];
      if (item !== undefined && item !== null && typeof item === typeof next[key]) next[key] = item as T[keyof T];
    }
    update(next);
  }, () => !dirty.current);
  return [value, (next) => { dirty.current = true; update(next); }];
}
