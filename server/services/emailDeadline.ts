/** A bounded wait does not prove cancellation: the SMTP handoff may still finish. */
export class EmailDeadlineError extends Error {
  constructor() { super('Email run deadline exceeded; delivery outcome unknown.'); }
}

/** Observe late settlements without allowing them to mutate the delivery ledger. */
export async function withinEmailDeadline<T>(operation: Promise<T>, remainingMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EmailDeadlineError()), Math.max(0, remainingMs));
    })]);
  } finally { clearTimeout(timer); }
}
