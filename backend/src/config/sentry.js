// src/config/sentry.js
// ============================================================
// SENTRY ERROR TRACKING & ALERTING — Phase 2 refactor (L4)
//
// Closes the original L4 finding (jobHelpers.js's logJob swallowing its
// own insert failure with only a console.warn, leaving background job
// health with zero external visibility) and extends coverage to the
// other choke points identified during this refactor: multiProvider.js's
// ALL_PROVIDERS_FAILED / NON_RETRYABLE classification, and every BullMQ
// worker's existing 'failed' handler.
//
// IMPORTANT — see services/multiProvider.js's own comments for why most
// AI-call failures in this codebase never reach Sentry's automatic
// Express-level capture at all: the overwhelming majority of groq-*.js
// functions catch their own errors locally and return a fallback value
// rather than rethrowing, so explicit Sentry.captureException calls are
// placed at deliberate choke points (see multiProvider.js, jobHelpers.js,
// and each BullMQ worker file) rather than relied upon to bubble up here.
//
// initSentry() is fully optional at runtime: with no SENTRY_DSN set, this
// entire integration is a no-op and the application behaves exactly as it
// did before this refactor. Add SENTRY_DSN (and optionally
// SENTRY_ENVIRONMENT / SENTRY_RELEASE / SENTRY_TRACES_SAMPLE_RATE) to
// your environment whenever you're ready to activate it — no code change
// needed at that point.
// ============================================================

import * as Sentry from '@sentry/node';

let _initialized = false;

export const initSentry = () => {
  if (_initialized) return;
  _initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled.');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      // Explicit, not left to whatever the SDK's own default happens to
      // be — this codebase has separately-known verbose logging elsewhere
      // (outside this refactor's scope) and Sentry should not become an
      // additional place PII can leak to.
      sendDefaultPii: false,
    });
    console.log('[Sentry] Initialized', {
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    });
  } catch (err) {
    // Sentry itself going down or being misconfigured must never be able
    // to take down the actual product — fail open, exactly like every
    // other piece of infrastructure introduced in this refactor.
    console.warn('[Sentry] Initialization failed (non-fatal) — error tracking disabled:', err.message);
  }
};

// Registered in app.js AFTER all routes are mounted but BEFORE
// errorHandler.js's own error-handling middleware, so Sentry captures
// first and then hands off to the existing custom error handler
// unchanged. Safe to call even if Sentry was never initialized
// (SENTRY_DSN unset) — it simply won't have anywhere to send events.
export const setupSentryErrorHandler = (app) => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.setupExpressErrorHandler(app);
  } catch (err) {
    console.warn('[Sentry] setupExpressErrorHandler failed (non-fatal):', err.message);
  }
};

export default Sentry;
