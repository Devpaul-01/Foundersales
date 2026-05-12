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

// BullMQ requires maxRetriesPerRequest: null — without this the worker will
// throw on startup.
export const bullmqConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
  tls: REDIS_URL.startsWith('rediss://')
    ? { rejectUnauthorized: false }  // required for Upstash TLS
    : undefined,
});

bullmqConnection.on('connect', () => console.log('[BullMQ] Redis connected'));
bullmqConnection.on('error',   (err) => console.error('[BullMQ] Redis error:', err.message));

export default bullmqConnection;
