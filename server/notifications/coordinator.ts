/** One coordinator per application/database; no SQLite transaction is held across HTTP. */
export class NotificationCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  runExclusive<T>(action: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
