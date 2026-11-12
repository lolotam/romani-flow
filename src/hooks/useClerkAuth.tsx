import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, onUnauthorized, request } from '@/lib/api/http';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { AuthContext, type AuthContextValue, type SessionUser } from './useAuth';

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, orgId, signOut } = useClerkAuth();
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [workspaceRequired, setWorkspaceRequired] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const previousIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    const identity = isSignedIn ? `${userId}:${orgId ?? ''}` : null;
    if (previousIdentity.current !== identity) {
      // Cached rows and drafts belong to the previous organization, not merely
      // to the previous page. Drop them before the new session is resolved.
      queryClient.clear();
      previousIdentity.current = identity;
    }

    let active = true;
    setUser(null);
    setWorkspaceRequired(false);
    setSessionError(false);
    setIsPlatformAdmin(false);

    if (!isSignedIn) {
      setSessionLoading(false);
      return () => { active = false; };
    }

    setSessionLoading(true);
    void Promise.all([
      request<{ user: SessionUser }>('/api/auth/me'),
      request<{ isPlatformAdmin: boolean }>('/api/platform/me'),
    ]).then(([session, platform]) => {
      if (!active) return;
      setIsPlatformAdmin(platform.data?.isPlatformAdmin ?? false);

      if (session.error instanceof ApiRequestError && session.error.code === 'workspace_required') {
        setWorkspaceRequired(true);
        return;
      }
      if (session.error || !session.data?.user) {
        setSessionError(true);
        return;
      }
      setUser(session.data.user);
    }).finally(() => {
      if (active) setSessionLoading(false);
    });

    return () => { active = false; };
  }, [isLoaded, isSignedIn, userId, orgId, queryClient]);

  useEffect(() => {
    onUnauthorized(() => { void signOut({ redirectUrl: '/login' }); });
  }, [signOut]);

  const login = useCallback(async () => ({
    success: false,
    error: 'Legacy login is not available in Clerk mode.',
  }), []);

  const logout = useCallback(async () => {
    await signOut({ redirectUrl: '/login' });
    queryClient.clear();
    setUser(null);
  }, [queryClient, signOut]);

  const value = useMemo<AuthContextValue>(() => ({
    isAuthenticated: user !== null,
    isLoading: !isLoaded || sessionLoading,
    user,
    provider: 'clerk',
    workspaceId: orgId ?? null,
    workspaceRequired,
    isPlatformAdmin,
    login,
    logout,
  }), [isLoaded, sessionLoading, user, orgId, workspaceRequired, isPlatformAdmin, login, logout]);

  const arabic = language === 'ar';
  return (
    <AuthContext.Provider value={value}>
      {sessionError ? (
        <main className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="space-y-4 text-center" role="alert">
            <p>{arabic ? 'تعذر تحميل جلسة المستخدم. حاول مرة أخرى.' : 'Your session could not be loaded. Please try again.'}</p>
            <Button onClick={() => window.location.reload()}>{arabic ? 'إعادة المحاولة' : 'Retry'}</Button>
          </div>
        </main>
      ) : children}
    </AuthContext.Provider>
  );
}
