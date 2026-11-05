/** One coordinator per application/database; no SQLite transaction is held across HTTP.
 * A bounded provider call may hold the coordinator for up to 15 seconds, so
 * eligibility-sensitive writes can wait for the current handoff to finish.
 */
export class NotificationCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  runExclusive<T>(action: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
