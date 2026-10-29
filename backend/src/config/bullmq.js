// src/config/bullmq.js
// ============================================================
// BULLMQ CONNECTION — IORedis instance for BullMQ workers/queues
//
// ⚠️  BullMQ requires the `ioredis` package — this is SEPARATE from the
//     existing redis.js (which uses the `redis` npm package for caching).
//     Both can share the same REDIS_URL env variable.
//
// Install: npm install bullmq ioredis
//
// Required env:
//   REDIS_URL — e.g. rediss://default:token@host.upstash.io:6379
// ============================================================

import IORedis from 'ioredis';

// NOTE: this used to throw synchronously here if REDIS_URL was unset. That
// throw happens at MODULE IMPORT TIME (this file is imported transitively
// from jobs/index.js, which is statically imported at the top of all three
// process entry points — app.js, server.js, and workers/index.js). Since
// ES module imports are resolved before any of those files' own top-level
// code runs, a missing REDIS_URL crashed the ENTIRE process before
// app.listen() was ever reached — including in server.js, the API-only
// process, which doesn't even call startAllJobs() and is documented as
// not needing workers to function. This directly contradicted both
// validateEnv.js (which classifies REDIS_URL as optional-with-warning,
// not required) and app.js's own header comment ("Start listening FIRST
// so a Redis/BullMQ outage never takes down the whole API — only
// background jobs are affected"). See docs/backend-takeover/AUDIT.md for
// the finding this fixes.
//
// Fix: construct the IORedis connection unconditionally. If REDIS_URL is
// genuinely absent, point at a syntactically-valid loopback placeholder
// instead of a real target — connection attempts to it fail the same way
// an unreachable real Redis would, and are handled by this file's
// existing retryStrategy/reconnectOnError below exactly as a configured-
// but-down Redis already was. No call site of bullmqConnection changes;
// BullMQ's Queue/Worker constructors (queues.js, scheduledWorker.js,
// practiceWorker.js, backgroundWorker.js) require a real connection
// object, not null/undefined, so this preserves that contract while
// removing the import-time throw.
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';
const redisUrlWasConfigured = Boolean(process.env.REDIS_URL);

if (!redisUrlWasConfigured) {
  console.warn(
    '[BullMQ] REDIS_URL not set — background jobs will not run. ' +
    'The API server will still start; this only affects async job processing. ' +
    'Set REDIS_URL to enable background jobs.'
  );
}

// Track connection health so the rest of the app can check it if needed
// (e.g. an admin/health endpoint) without importing ioredis internals.
export const bullmqConnectionState = {
  status: redisUrlWasConfigured ? 'connecting' : 'unconfigured',
  lastError: null,
};

// ── Parse URL to extract hostname for SNI ──
const url = new URL(REDIS_URL);
const hostname = url.hostname;
const isTLS = REDIS_URL.startsWith('rediss://');

// ── Build TLS options ──
const tlsOptions = isTLS
  ? {
      servername: hostname, // ← Fix: Add SNI support
      rejectUnauthorized: false, // required for Upstash TLS
    }
  : undefined;

// BullMQ requires maxRetriesPerRequest: null — without this the worker will
// throw on startup.
export const bullmqConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: tlsOptions,

  // Fix: previously there was no retryStrategy, so ioredis used its default
  // of retrying FOREVER (every ~2s max) on any connection error — including
  // unrecoverable ones like DNS/ENOTFOUND. That's what caused the endless
  // repeated error spam. Now we back off and give up after a bounded number
  // of attempts, going quiet instead of looping indefinitely.
  retryStrategy: (times) => {
    // No REDIS_URL was ever configured — fail fast after one attempt
    // instead of running through the normal 10-attempt backoff schedule
    // for a target we already know is a placeholder, not a real outage.
    if (!redisUrlWasConfigured) {
      bullmqConnectionState.status = 'unconfigured';
      return null;
    }
    if (times > 10) {
      console.error(
        `[BullMQ] Redis unreachable after ${times} attempts — giving up retries. ` +
        'Background jobs will stay paused until the process is restarted with a working REDIS_URL/network.'
      );
      bullmqConnectionState.status = 'failed';
      return null; // returning null stops ioredis from retrying further
    }
    const delay = Math.min(times * 500, 5000);
    console.warn(`[BullMQ] Redis connection attempt ${times} failed — retrying in ${delay}ms`);
    return delay;
  },

  // Only reconnect automatically for errors that are actually transient
  // (e.g. READONLY on a failed-over Upstash node). Anything else falls
  // through to the normal retryStrategy above instead of forcing a retry.
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
    return targetErrors.some((code) => err.message.includes(code));
  },
});

bullmqConnection.on('connect', () => {
  bullmqConnectionState.status = 'connected';
  bullmqConnectionState.lastError = null;
  console.log('[BullMQ] Redis connected');
});

bullmqConnection.on('error', (err) => {
  bullmqConnectionState.lastError = err.message;
  // Skip the per-attempt error log when REDIS_URL was never configured —
  // the warning already printed once above explains this clearly; logging
  // every failed connection attempt to a known placeholder target as an
  // "error" would be noise, not signal.
  if (redisUrlWasConfigured) {
    console.error('[BullMQ] Redis error:', err.message);
  }
});

bullmqConnection.on('end', () => {
  bullmqConnectionState.status = 'disconnected';
  console.warn('[BullMQ] Redis connection closed — background jobs will not process until reconnected.');
});

export default bullmqConnection;