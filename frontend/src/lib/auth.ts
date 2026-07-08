// src/lib/auth.ts
// Access token stored in memory ONLY — not in localStorage
// Refresh token is stored in HttpOnly cookie (not managed here)

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let _inMemoryAccessToken: string | null = null;
let _tokenExpiresAt: number | null = null;

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: null; // Always null — stored in HttpOnly cookie
  expiresAt: number | null;
}

export function getTokens(): StoredTokens {
  return {
    accessToken: _inMemoryAccessToken,
    refreshToken: null,
    expiresAt: _tokenExpiresAt,
  };
}

export function setTokens(
  accessToken: string,
  _refreshToken: string, // Kept for API compatibility, not stored
  expiresIn: number,
): void {
  _inMemoryAccessToken = accessToken;
  _tokenExpiresAt = Date.now() + expiresIn * 1000;
}

export function clearTokens(): void {
  _inMemoryAccessToken = null;
  _tokenExpiresAt = null;
}

/** Returns remaining TTL in seconds (can be negative if expired) */
export function getRemainingTTL(): number {
  if (!_tokenExpiresAt) return 0;
  return Math.floor((_tokenExpiresAt - Date.now()) / 1000);
}

export function isTokenExpired(): boolean {
  return getRemainingTTL() <= 0;
}

export function isTokenExpiringSoon(thresholdSeconds = 300): boolean {
  const remaining = getRemainingTTL();
  return remaining > 0 && remaining < thresholdSeconds;
}

// ── Proactive Refresh Scheduling ─────────────────────────────
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshCallback: (() => Promise<void>) | null = null;

export function setRefreshCallback(fn: () => Promise<void>): void {
  _refreshCallback = fn;
}

export function scheduleRefresh(expiresInSeconds: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);

  // Refresh 90 seconds before expiry
  const delayMs = Math.max((expiresInSeconds - 90) * 1000, 0);

  _refreshTimer = setTimeout(async () => {
    if (_refreshCallback) {
      try {
        await _refreshCallback();
      } catch {
        // performTokenRefresh()/interceptor handles the failure fallback
      }
    }
  }, delayMs);
}

export function cancelScheduledRefresh(): void {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

/** Call once in AuthProvider to refresh token on tab focus */
export function setupVisibilityRefreshGuard(
  onExpiring: () => Promise<void>,
): () => void {
  const handler = async () => {
    if (document.visibilityState === 'visible' && isTokenExpiringSoon()) {
      await onExpiring();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

// ── Single source of truth for refreshing the access token ──────────
//
// IMPORTANT: this used to be implemented twice (once inline in the axios
// interceptor in client.ts, once again in AuthContext.tsx), each with its
// own "isRefreshing" guard. That's the root cause of the intermittent
// "refresh token not found" errors:
//
//   - The two implementations didn't share any lock, so it was possible for
//     both to fire an /api/auth/refresh request around the same time.
//   - If the backend rotates the refresh cookie on every use (typical),
//     whichever request wins invalidates the cookie for the other — which
//     then fails with "refresh token not found / invalid".
//   - The same race happens across browser tabs, since each tab has its own
//     JS memory and its own "isRefreshing" flag — two tabs can each think
//     they're the only one refreshing.
//
// Fix: one function, with an in-flight promise (dedupes concurrent calls in
// the same tab) wrapped in a Web Locks API lock (serializes calls *across*
// tabs, when the browser supports it — all evergreen browsers do).
let _inFlightRefresh: Promise<{ access_token: string; expires_in: number }> | null = null;

async function callRefreshEndpoint(): Promise<{ access_token: string; expires_in: number }> {
  // Plain axios (not apiClient) — we don't want this call passing through
  // the response interceptor and potentially looping back into itself.
  const res = await axios.post(
    `${BASE_URL}/api/auth/refresh`,
    {},
    { withCredentials: true },
  );

  const { access_token, expires_in } = res.data ?? {};
  if (!access_token) {
    throw new Error('Refresh response did not include an access_token');
  }

  setTokens(access_token, '', expires_in);
  scheduleRefresh(expires_in);
  return { access_token, expires_in };
}

export async function performTokenRefresh(): Promise<{ access_token: string; expires_in: number }> {
  if (_inFlightRefresh) return _inFlightRefresh;

  const run = async () => {
    try {
      return await callRefreshEndpoint();
    } finally {
      _inFlightRefresh = null;
    }
  };

  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    // Serializes this across all tabs of the same origin.
    _inFlightRefresh = (navigator as any).locks.request('auth-token-refresh', run);
  } else {
    _inFlightRefresh = run();
  }

  return _inFlightRefresh;
}

// ✅ For debugging (remove in production)
if (import.meta.env.DEV) {
  (window as any).__debugAuth = () => ({
    hasToken: !!_inMemoryAccessToken,
    expiresAt: _tokenExpiresAt ? new Date(_tokenExpiresAt).toISOString() : null,
    remainingSeconds: getRemainingTTL(),
  });
}
