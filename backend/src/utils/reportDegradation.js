// src/utils/reportDegradation.js
// ============================================================
// DEGRADED-MODE ALERT THROTTLING — Phase 2 refactor (L4 / doc 07)
//
// Used by every Redis-unavailable fail-open branch introduced in this
// refactor (services/multiProvider.js, config/rateLimitStore.js,
// utils/concurrencyGuard.js, services/exa.js) to report "I'm running in
// degraded mode because Redis is unreachable" without flooding Sentry
// with one event per request during a sustained outage.
//
// Deliberately IN-MEMORY / PER-PROCESS, unlike almost every other piece
// of state introduced in this refactor — and deliberately so: this
// throttle exists specifically to reduce alert noise DURING a Redis
// outage. Coordinating that throttle via Redis would be circular — if
// Redis is down, it can't also be the thing deduplicating alerts about
// itself being down. The accepted trade-off: in a multi-instance
// deployment, each instance may independently send one throttled alert
// during a shared outage rather than exactly one alert cluster-wide.
// That's a minor, intentional redundancy, not a design flaw.
// ============================================================

import * as Sentry from '@sentry/node';

const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
const _lastReportedAt = new Map();

/**
 * Report a degraded-mode condition (e.g. "Redis unreachable, falling back
 * to in-memory behavior"), throttled to at most once per `key` per
 * THROTTLE_MS. Falls back to a plain console.warn if Sentry was never
 * initialized (no SENTRY_DSN configured), so the signal isn't lost even
 * before Sentry is wired up.
 *
 * @param {string} key - a short, stable identifier for the degraded
 *   condition (e.g. 'multiprovider-redis-unavailable',
 *   'ratelimit-store-fallback', 'concurrency-guard-redis-unavailable').
 * @param {object} [details] - extra context attached to the Sentry event.
 */
export const reportDegradedMode = (key, details = {}) => {
  const now = Date.now();
  const last = _lastReportedAt.get(key) || 0;

  if (now - last < THROTTLE_MS) return; // throttled — recently reported

  _lastReportedAt.set(key, now);

  const message = `Degraded mode: ${key}`;

  if (!process.env.SENTRY_DSN) {
    console.warn(`[Degradation] ${message}`, details);
    return;
  }

  try {
    Sentry.captureMessage(message, { level: 'warning', extra: details });
  } catch (err) {
    console.warn(`[Degradation] Failed to report to Sentry (non-fatal): ${err.message}`);
  }
};

export default { reportDegradedMode };
