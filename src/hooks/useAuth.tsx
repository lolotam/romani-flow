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

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const applySession = useCallback((nextUser: SessionUser | null) => {
    setUser(nextUser);
    setIsAuthenticated(Boolean(nextUser));
  }, []);

  useEffect(() => {
    let active = true;

    // The session is resolved from the cookie on every page load.
    request<{ user: SessionUser }>('/api/auth/me')
      .then(({ data, error }) => {
        if (!active) return;
        applySession(error ? null : (data?.user ?? null));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applySession]);

  useEffect(() => {
    // A 401 from any request means the session expired.
    onUnauthorized(() => applySession(null));
  }, [applySession]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      const { data, error } = await request<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      applySession(data?.user ?? null);
      return { success: true };
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await request('/api/auth/logout', { method: 'POST' });
    applySession(null);
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated, isLoading, user, login, logout }),
    [isAuthenticated, isLoading, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
