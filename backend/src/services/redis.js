// src/services/redis.js
// ============================================================
// REDIS SERVICE — Distributed Cache & Concurrency Utilities
//
// Fixes applied:
//   Issue 8  — Replaces the process-local intelligenceCache Map in metrics.js
//   Issue 9  — Provides a distributed counter for the onboarding ConcurrencyGuard
//   Issue 28 — Caches why-losing and patterns AI responses across instances
//   Issue 29 — Caches pipeline-insight across instances
//
// All operations degrade gracefully when Redis is unavailable — every
// function catches its own error and returns a safe null/no-op so callers
// never need to guard against Redis being down.
//
// Required env:
//   REDIS_URL — e.g. redis://localhost:6379 or rediss://user:pass@host:port
//
// Install: npm install redis
// ============================================================

import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL;

let _client = null;

// Lazy-connect singleton — only connects if REDIS_URL is set.
const getClient = async () => {
  if (_client) return _client;
  if (!REDIS_URL) {
    // Redis not configured — all operations will silently no-op.
    return null;
  }

  const client = createClient({ url: REDIS_URL });
  client.on('error', (err) =>
    console.error('[Redis] Client error (non-fatal):', err.message)
  );

  try {
    await client.connect();
    _client = client;
    console.log('[Redis] Connected');
    return _client;
  } catch (err) {
    console.warn('[Redis] Could not connect — caching will be skipped:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// GET — deserialise a cached value.
// Returns null on cache miss, parse error, or Redis unavailable.
// ──────────────────────────────────────────
export const getCache = async (key) => {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Redis] getCache(${key}) failed:`, err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// SET — serialise and store with an optional TTL (seconds).
// ──────────────────────────────────────────
export const setCache = async (key, value, ttlSeconds) => {
  try {
    const c = await getClient();
    if (!c) return;
    const opts = ttlSeconds ? { EX: ttlSeconds } : {};
    await c.set(key, JSON.stringify(value), opts);
  } catch (err) {
    console.warn(`[Redis] setCache(${key}) failed:`, err.message);
  }
};

// ──────────────────────────────────────────
// DELETE — remove a cache key.
// ──────────────────────────────────────────
export const deleteCache = async (key) => {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del(key);
  } catch (err) {
    console.warn(`[Redis] deleteCache(${key}) failed:`, err.message);
  }
};

// ──────────────────────────────────────────
// INCR — atomically increment a counter (used by ConcurrencyGuard).
// Sets TTL on the first increment so the key auto-expires if the
// process crashes mid-operation.
// Returns the new count, or 1 (fail-open) if Redis is unavailable.
// ──────────────────────────────────────────
export const incrementCounter = async (key, ttlSeconds = 60) => {
  try {
    const c = await getClient();
    if (!c) return 1;
    const count = await c.incr(key);
    if (count === 1) await c.expire(key, ttlSeconds); // set TTL on first use
    return count;
  } catch (err) {
    console.warn(`[Redis] incrementCounter(${key}) failed:`, err.message);
    return 1; // fail open — allows the call through
  }
};

// ──────────────────────────────────────────
// DECR — atomically decrement a counter.
// Cleans up the key when it reaches ≤ 0.
// ──────────────────────────────────────────
export const decrementCounter = async (key) => {
  try {
    const c = await getClient();
    if (!c) return;
    const val = await c.decr(key);
    if (val <= 0) await c.del(key);
  } catch (err) {
    console.warn(`[Redis] decrementCounter(${key}) failed:`, err.message);
  }
};

export default { getCache, setCache, deleteCache, incrementCounter, decrementCounter };
