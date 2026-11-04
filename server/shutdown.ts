import type { Server } from 'node:http';

// Exceeds the bounded 15-second send and 10-second status requests; deployment must allow this grace.
export const SHUTDOWN_DEADLINE_MS = 20_000;

interface ShutdownOptions {
  server: Server;
  stopReminders: () => Promise<void>;
  closeDatabase: () => void;
  exit: (code: number) => void;
}

export async function drainApplication(options: ShutdownOptions): Promise<void> {
  const deadline = setTimeout(() => options.exit(1), SHUTDOWN_DEADLINE_MS);
  deadline.unref();
  // Stop new claims synchronously, before waiting for active HTTP requests.
  const remindersStopped = options.stopReminders();
  const httpClosed = new Promise<void>((resolve, reject) => {
    options.server.close(error => error ? reject(error) : resolve());
  });
  try {
    await Promise.all([remindersStopped, httpClosed]);
    options.closeDatabase();
    options.exit(0);
  } catch {
    // Leave interrupted durable attempts for recovery; never close an in-use DB.
    console.error('[server] shutdown failed; details suppressed');
    options.exit(1);
  } finally { clearTimeout(deadline); }
}
