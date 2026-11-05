/** An edit submits only user-changed fields; creates keep the complete payload. */
export function formPatch<T extends object>(payload: T, changes?: Partial<Record<keyof T, boolean>>): Partial<T> {
  if (!changes) return payload;
  const patch: Partial<T> = {};
  for (const key of Object.keys(payload) as (keyof T)[]) {
    if (changes[key]) patch[key] = payload[key];
  }
  return patch;
}
