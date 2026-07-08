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

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error('[BullMQ] REDIS_URL env variable is not set. BullMQ requires Redis.');
}

// Track connection health so the rest of the app can check it if needed
// (e.g. an admin/health endpoint) without importing ioredis internals.
export const bullmqConnectionState = { status: 'connecting', lastError: null };

// BullMQ requires maxRetriesPerRequest: null — without this the worker will
// throw on startup.
export const bullmqConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
  tls: REDIS_URL.startsWith('rediss://')
    ? { rejectUnauthorized: false }  // required for Upstash TLS
    : undefined,

  // Fix: previously there was no retryStrategy, so ioredis used its default
  // of retrying FOREVER (every ~2s max) on any connection error — including
  // unrecoverable ones like DNS/ENOTFOUND. That's what caused the endless
  // repeated error spam. Now we back off and give up after a bounded number
  // of attempts, going quiet instead of looping indefinitely.
  retryStrategy: (times) => {
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
  console.error('[BullMQ] Redis error:', err.message);
});

bullmqConnection.on('end', () => {
  bullmqConnectionState.status = 'disconnected';
  console.warn('[BullMQ] Redis connection closed — background jobs will not process until reconnected.');
});

export default bullmqConnection;
