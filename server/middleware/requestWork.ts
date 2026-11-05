import type { Application } from 'express';

interface RequestWork {
  accepting: boolean;
  pending: Set<Promise<unknown>>;
}

const applications = new WeakMap<Application, RequestWork>();

function workFor(app: Application): RequestWork {
  let work = applications.get(app);
  if (!work) {
    work = { accepting: true, pending: new Set() };
    applications.set(app, work);
  }
  return work;
}

/** Handler lifetime can exceed its socket's lifetime, notably during SMTP. */
export function runRequestWork(app: Application, action: () => Promise<unknown>): Promise<unknown> | null {
  const work = workFor(app);
  if (!work.accepting) return null;
  const pending = Promise.resolve().then(action);
  work.pending.add(pending);
  const remove = () => { work.pending.delete(pending); };
  void pending.then(remove, remove);
  return pending;
}

/** Close admission synchronously before waiting for the already admitted work. */
export async function stopRequestWork(app: Application): Promise<void> {
  const work = workFor(app);
  work.accepting = false;
  await Promise.allSettled(work.pending);
}
