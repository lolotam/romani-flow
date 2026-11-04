import type { Server } from 'node:http';

// Allows SMTP's 15/15/30-second phase timers plus worker drain and margin; not a delivery guarantee.
export const SHUTDOWN_DEADLINE_MS = 90_000;

interface ShutdownOptions {
  server: Server;
  stopReminders: () => Promise<void>;
  stopCron: () => Promise<void>;
  stopHandlers: () => Promise<void>;
  closeDatabase: () => void;
  exit: (code: number) => void;
}

export async function drainApplication(options: ShutdownOptions): Promise<void> {
  const deadline = setTimeout(() => options.exit(1), SHUTDOWN_DEADLINE_MS);
  deadline.unref();
  // Stop new claims synchronously, before waiting for active HTTP requests.
  const remindersStopped = options.stopReminders();
  const cronStopped = options.stopCron();
  const handlersStopped = options.stopHandlers();
  const httpClosed = new Promise<void>((resolve, reject) => {
    options.server.close(error => error ? reject(error) : resolve());
  });
  try {
    await Promise.all([remindersStopped, cronStopped, handlersStopped, httpClosed]);
    options.closeDatabase();
    options.exit(0);
  } catch {
    // Leave interrupted durable attempts for recovery; never close an in-use DB.
    console.error('[server] shutdown failed; details suppressed');
    options.exit(1);
  } finally { clearTimeout(deadline); }
}
