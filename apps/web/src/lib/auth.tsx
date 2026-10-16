/**
 * Auth state for the dashboard: JWT session in localStorage, role-aware helpers.
 * Mock mode signs in any credentials as the demo admin (clearly marked);
 * production mode delegates to the NestJS auth module via HttpApiClient.
 */
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api, isMockMode, writeSession } from './api-client';
import type { AuthUser, Role } from './types';

const SESSION_KEY = 'mtk.auth.session';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isMock: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  /** technician may onboard + view, but never mutate firewall/queues (ARCH §6). */
  canEditNetwork: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { user: AuthUser }).user : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Restore session on mount; validate against /auth/me in production.
    const stored = readStoredUser();
    if (!stored) {
      setIsLoading(false);
      return;
    }
    if (isMockMode) {
      setUser(stored);
      setIsLoading(false);
      return;
    }
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => {
        writeSession(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.login(email, password);
    writeSession(session);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      writeSession(null);
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  const hasRole = useCallback((...roles: Role[]) => (user ? roles.includes(user.role) : false), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      isMock: isMockMode,
      login,
      logout,
      hasRole,
      canEditNetwork: !!user && (user.role === 'admin' || user.role === 'operator'),
    }),
    [user, isLoading, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
