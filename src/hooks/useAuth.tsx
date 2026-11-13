import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onUnauthorized, request } from '@/lib/api/http';
import { sessionCapabilities, type AuthMePayload } from '@/lib/sessionCapabilities';

/**
 * Authentication.
 *
 * The session lives in an httpOnly cookie issued by the API, so the browser
 * never holds a token that could be stolen from JavaScript.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: SessionUser | null;
  provider: 'legacy' | 'clerk';
  /** Database workspace id from `/api/auth/me`, never a client-selected tenant. */
  workspaceId: string | null;
  /** Clerk organization id. Tenant calls and drafts use `workspaceId`. */
  organizationId: string | null;
  /** Workspace expiry warning window, in days, for every role. */
  expiryWarningDays: number;
  workspaceRequired: boolean;
  isPlatformAdmin: boolean;
  /**
   * The reminder cron expression can be edited.
   * A missing flag stays editable so older sessions keep today's control.
   */
  scheduleEditable: boolean;
  /**
   * WhatsApp settings exist for this workspace.
   * A missing flag is available only in legacy mode (the single legacy workspace).
   */
  whatsappAvailable: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [scheduleEditable, setScheduleEditable] = useState(true);
  const [whatsappAvailable, setWhatsappAvailable] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [expiryWarningDays, setExpiryWarningDays] = useState(30);

  const applyCapabilities = useCallback((data: AuthMePayload | null | undefined) => {
    const capabilities = sessionCapabilities(data, true);
    setScheduleEditable(capabilities.scheduleEditable);
    setWhatsappAvailable(capabilities.whatsappAvailable);
    setWorkspaceId(capabilities.workspaceId);
    setExpiryWarningDays(capabilities.expiryWarningDays);
  }, []);

  const applySession = useCallback((nextUser: SessionUser | null) => {
    setUser(nextUser);
    setIsAuthenticated(Boolean(nextUser));
  }, []);

  useEffect(() => {
    let active = true;

    // The session is resolved from the cookie on every page load.
    request<AuthMePayload>('/api/auth/me')
      .then(({ data, error }) => {
        if (!active) return;
        applyCapabilities(data);
        applySession(error ? null : (data?.user ?? null));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applyCapabilities, applySession]);

  useEffect(() => {
    // A 401 from any request means the session expired.
    onUnauthorized(() => {
      applyCapabilities(null);
      applySession(null);
    });
  }, [applyCapabilities, applySession]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      const { data, error } = await request<AuthMePayload>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      applyCapabilities(data);
      applySession(data?.user ?? null);
      return { success: true };
    },
    [applyCapabilities, applySession],
  );

  const logout = useCallback(async () => {
    await request('/api/auth/logout', { method: 'POST' });
    applyCapabilities(null);
    applySession(null);
  }, [applyCapabilities, applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading,
      user,
      provider: 'legacy',
      workspaceId,
      organizationId: null,
      expiryWarningDays,
      workspaceRequired: false,
      isPlatformAdmin: false,
      scheduleEditable,
      whatsappAvailable,
      login,
      logout,
    }),
    [isAuthenticated, isLoading, user, workspaceId, expiryWarningDays, scheduleEditable, whatsappAvailable, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
