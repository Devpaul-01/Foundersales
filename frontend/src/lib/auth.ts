// src/lib/auth.ts
// Access token stored in memory ONLY — not in localStorage
// Refresh token is stored in HttpOnly cookie (not managed here)

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

// ✅ For debugging (remove in production)
if (import.meta.env.DEV) {
  (window as any).__debugAuth = () => ({
    hasToken: !!_inMemoryAccessToken,
    expiresAt: _tokenExpiresAt ? new Date(_tokenExpiresAt).toISOString() : null,
    remainingSeconds: getRemainingTTL(),
  });
}