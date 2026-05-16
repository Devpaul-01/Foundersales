// src/lib/auth.ts
const ACCESS_TOKEN_KEY  = 'fs_access_token';
const REFRESH_TOKEN_KEY = 'fs_refresh_token'; // KEPT FOR BACKWARDS COMPATIBILITY BUT NOT USED
const EXPIRES_AT_KEY    = 'fs_token_expires_at';

export interface StoredTokens {
  accessToken:  string | null;
  refreshToken: string | null; // Will always be null now (stored in HTTP-only cookie)
  expiresAt:    number | null; // unix ms
}

export function getTokens(): StoredTokens {
  return {
    accessToken:  localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: null, // ❌ No longer stored in localStorage
    expiresAt:    Number(localStorage.getItem(EXPIRES_AT_KEY)) || null,
  };
}

export function setTokens(
  accessToken:  string,
  refreshToken: string, // Kept for API compatibility but not stored
  expiresIn:    number, // seconds
): void {
  const expiresAt = Date.now() + expiresIn * 1000;
  localStorage.setItem(ACCESS_TOKEN_KEY,  accessToken);
  // ❌ DO NOT store refresh token in localStorage anymore
  // localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(EXPIRES_AT_KEY,    String(expiresAt));
  
  // Optional: Clear old refresh token if exists
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

/** Returns remaining TTL in seconds (can be negative if expired) */
export function getRemainingTTL(): number {
  const { expiresAt } = getTokens();
  if (!expiresAt) return 0;
  return Math.floor((expiresAt - Date.now()) / 1000);
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
        // Interceptor handles 401 fallback
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