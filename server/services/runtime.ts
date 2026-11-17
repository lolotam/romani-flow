/**
 * The runtime facts of the API process.
 *
 * They answer one question: is this still the process that started the
 * deployment? A restart or a crash shows up as a smaller uptime, and the
 * memory shows how close the container is to its limit.
 *
 * Nothing here is a secret: the numbers describe the process, never the data
 * it holds.
 */

export interface RuntimeSnapshot {
  /** Seconds since the process started. A smaller value means a restart. */
  uptimeSeconds: number;
  /** When the process started, in ISO 8601. */
  startedAt: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
}

const BYTES_PER_MB = 1024 * 1024;

export function runtimeSnapshot(): RuntimeSnapshot {
  const memory = process.memoryUsage();
  const uptimeSeconds = process.uptime();
  return {
    uptimeSeconds: Math.round(uptimeSeconds),
    startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
    memory: {
      rssMb: Math.round(memory.rss / BYTES_PER_MB),
      heapUsedMb: Math.round(memory.heapUsed / BYTES_PER_MB),
      heapTotalMb: Math.round(memory.heapTotal / BYTES_PER_MB),
    },
  };
}

/**
 * One line for the container log.
 *
 * The line names the process, not the traffic: no address, no credential and
 * no message content ever reaches it.
 */
export function runtimeLine(prefix: string): string {
  const snapshot = runtimeSnapshot();
  return (
    `[${prefix}] uptime=${snapshot.uptimeSeconds}s ` +
    `rss=${snapshot.memory.rssMb}MB heap=${snapshot.memory.heapUsedMb}/${snapshot.memory.heapTotalMb}MB`
  );
}

/**
 * A safe description of an unknown failure.
 *
 * The message of an exception may carry a credential, a token or a recipient,
 * so it never reaches the log. The name and the frames say what broke and
 * where; the values stay inside the process.
 */
export function safeErrorLine(error: unknown): string {
  if (!(error instanceof Error)) return `non-error value of type ${typeof error}`;
  const frames = (error.stack ?? '')
    .split('\n')
    .filter(line => line.trimStart().startsWith('at '))
    .slice(0, 6);
  return frames.length > 0 ? `${error.name}\n${frames.join('\n')}` : error.name;
}
