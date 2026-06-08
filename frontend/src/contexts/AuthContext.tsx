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
  const isPublicRoute = (): boolean => {
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/invite'];
  return publicPaths.some(path => window.location.pathname.startsWith(path));
};

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
  // In AuthContext.tsx
  let isRefreshing = false; // Add outside useCallback

const doTokenRefresh = useCallback(async () => {
  // ✅ Prevent multiple simultaneous refresh attempts
  if (isRefreshing) {
    console.log('[Auth] Refresh already in progress, skipping');
    return;
  }

  isRefreshing = true;
  try {
    const { data } = await authApi.refresh();
    setTokens(data.access_token, '', data.expires_in);
    scheduleRefresh(data.expires_in);
    console.log('[Auth] Refresh successful');
  } catch (err) {
    console.error('[Auth] Refresh failed', err);
    clearTokens();
    throw err;
  } finally {
    isRefreshing = false;
  }
}, []);

  // ── Initialize on mount ──────────────────────────────────────
  // src/contexts/AuthContext.tsx — Update the init useEffect
  
  useEffect(() => {
  let isMounted = true;

  const init = async () => {
    // Public routes — skip auth entirely
    if (isPublicRoute()) {
      console.log('[Auth] Public route, skipping token refresh');
      setIsLoading(false);
      return;
    }

    const { accessToken } = getTokens();

    if (!accessToken) {
      // Page was reloaded — access token is gone from memory but the
      // HTTP-only refresh cookie may still be valid. Attempt a silent refresh.
      console.log('[Auth] No access token (likely page reload) — attempting silent refresh');
      try {
        await doTokenRefresh();         // hits /api/auth/refresh with the cookie
        await refreshUser();            // hydrates user state
        scheduleRefresh(getRemainingTTL());
      } catch {
        // Cookie is expired or missing — user is genuinely logged out.
        // ProtectedRoute will handle the redirect.
        console.log('[Auth] Silent refresh failed — user is logged out');
      }
    } else {
      // Access token still in memory (same tab session, no reload).
      // Just hydrate the user; only refresh token if /me returns 401.
      console.log('[Auth] Access token found — hydrating user');
      try {
        await refreshUser();
        scheduleRefresh(getRemainingTTL());
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          try {
            await doTokenRefresh();
            await refreshUser();
            scheduleRefresh(getRemainingTTL());
          } catch {
            clearTokens();
          }
        } else {
          clearTokens();
        }
      }
    }

    if (isMounted) {
      setIsLoading(false);
    }
  };

  init();

  return () => {
    isMounted = false;
  };
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