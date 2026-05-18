// src/contexts/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { authApi } from '@/api/auth';
import {
  getTokens,
  setTokens,
  clearTokens,
  scheduleRefresh,
  getRemainingTTL,
  setRefreshCallback,
  setupVisibilityRefreshGuard,
} from '@/lib/auth';
import type { User, Workspace, ActiveMembership } from '@/api/types';

interface AuthContextValue {
  user:              User | null;
  activeWorkspace:   Workspace | null;
  activeMembership:  ActiveMembership | null;
  accessToken:       string | null;
  isAuthenticated:   boolean;
  isLoading:         boolean;
  onboardingStep:    number;      // ✅ NEW
  onboardingCompleted: boolean;   // ✅ NEW
  login:             (email: string, password: string) => Promise<{ onboarding: { step: number; completed: boolean } }>;
  logout:            () => Promise<void>;
  refreshUser:       () => Promise<void>;
  setUser:           (user: User) => void;
  setActiveWorkspace:(ws: Workspace | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
  const [activeMembership, setActiveMembership] = useState<ActiveMembership | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // ✅ NEW: Onboarding state
  const [onboardingStep, setOnboardingStep] = useState<number>(0);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(false);

  // ── Core: fetch /me and hydrate state ───────────────────────
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await authApi.getMe();
      setUserState(data.user);
      setActiveWorkspaceState(data.active_workspace);
      setActiveMembership(data.active_membership);
    } catch {
      // Interceptor handles 401 → redirect
    }
  }, []);

  // ── Token refresh helper ────────────────────────────────────
  const doTokenRefresh = useCallback(async () => {
    const { data } = await authApi.refresh();
    setTokens(data.access_token, '', data.expires_in);
    scheduleRefresh(data.expires_in);
  }, []);

  // ── Initialize on mount ──────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { accessToken } = getTokens();

      if (!accessToken) {
        setIsLoading(false);
        return;
      }

      try {
        await refreshUser();
        scheduleRefresh(getRemainingTTL());
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          try {
            await doTokenRefresh();
            await refreshUser();
          } catch {
            clearTokens();
          }
        } else {
          clearTokens();
        }
      } finally {
        setIsLoading(false);
      }
    };

    setRefreshCallback(doTokenRefresh);
    init();
    const cleanup = setupVisibilityRefreshGuard(doTokenRefresh);
    return cleanup;
  }, [doTokenRefresh, refreshUser]);

  // ── login ────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    setTokens(data.access_token, data.refresh_token || '', data.expires_in);
    scheduleRefresh(data.expires_in);
    await refreshUser();
    
    // ✅ Update onboarding states
    setOnboardingStep(data.onboarding.step);
    setOnboardingCompleted(data.onboarding.completed);
    
    return { onboarding: data.onboarding };
  }, [refreshUser]);

  // ── logout ───────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { 
      await authApi.logout(); 
    } catch { 
      /* ignore */ 
    }
    clearTokens();
    setUserState(null);
    setActiveWorkspaceState(null);
    setActiveMembership(null);
    // ✅ Reset onboarding states on logout
    setOnboardingStep(0);
    setOnboardingCompleted(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      activeWorkspace,
      activeMembership,
      accessToken: getTokens().accessToken,
      isAuthenticated: !!user,
      isLoading,
      onboardingStep,
      onboardingCompleted,
      login,
      logout,
      refreshUser,
      setUser: setUserState,
      setActiveWorkspace: setActiveWorkspaceState,
    }),
    [user, activeWorkspace, activeMembership, isLoading, onboardingStep, onboardingCompleted, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}