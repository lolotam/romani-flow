import type { SessionUser } from '@/hooks/useAuth';

/** `/api/auth/me` may add these next to `user`. Absent fields use the defaults below. */
export interface AuthMePayload {
  user: SessionUser;
  scheduleEditable?: boolean;
  whatsappAvailable?: boolean;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Missing `scheduleEditable` stays editable.
 * Missing `whatsappAvailable` is on only in legacy mode.
 */
export function sessionCapabilities(data: AuthMePayload | null | undefined, legacy: boolean): {
  scheduleEditable: boolean;
  whatsappAvailable: boolean;
} {
  const scheduleEditable = optionalBoolean(data?.scheduleEditable);
  const whatsappAvailable = optionalBoolean(data?.whatsappAvailable);
  return {
    scheduleEditable: scheduleEditable !== false,
    whatsappAvailable: whatsappAvailable === true || (whatsappAvailable === undefined && legacy),
  };
}
