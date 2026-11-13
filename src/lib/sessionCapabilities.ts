import type { SessionUser } from '@/hooks/useAuth';

/** `/api/auth/me` may add these next to `user`. Absent fields use the defaults below. */
export interface AuthMePayload {
  user: SessionUser;
  /** Database workspace id. This is not the Clerk organization id. */
  workspaceId?: string;
  /** Workspace `expiry_warning_days`. Present for every role. */
  expiryWarningDays?: number;
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
  workspaceId: string | null;
  expiryWarningDays: number;
} {
  const scheduleEditable = optionalBoolean(data?.scheduleEditable);
  const whatsappAvailable = optionalBoolean(data?.whatsappAvailable);
  const workspaceId = typeof data?.workspaceId === 'string' && data.workspaceId.trim() ? data.workspaceId : null;
  const parsedDays = typeof data?.expiryWarningDays === 'number' ? data.expiryWarningDays : Number(data?.expiryWarningDays);
  return {
    scheduleEditable: scheduleEditable !== false,
    whatsappAvailable: whatsappAvailable === true || (whatsappAvailable === undefined && legacy),
    workspaceId,
    expiryWarningDays: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30,
  };
}
