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
//
// IMPL-REDIS-01 (Phase 2 refactor): this file was extended with locking,
// hash, set, and sorted-set primitives to support three new pieces of
// distributed infrastructure introduced in this refactor:
//   - MultiProvider Redis-backed key cooldown / model discovery cache
//     (services/multiProvider.js)
//   - Redis-backed distributed rate limiting (config/rateLimitStore.js)
//   - Redis-backed onboarding/AI-call concurrency coordination
//     (utils/concurrencyGuard.js)
//
// Key naming convention for everything added by this refactor:
//   {domain}:{subdomain}:{identifier}
// Reserved prefixes: `mp:` (MultiProvider — services/multiProvider.js and,
// as of this refactor, services/exa.js), `stagger:` (concurrency
// coordination). `ratelimit:` is managed internally by the rate-limit-redis
// library itself, configured with that prefix at the point it's constructed.
//
// Every new key introduced by this refactor carries a TTL — nothing added
// here is a permanent key. Redis is used purely as ephemeral shared
// coordination/cache state, never as a system of record. See each new
// function's own comment for its specific TTL policy and reasoning.
//
// Failure philosophy for everything below (unchanged from the rest of this
// file, made explicit here because the newly-added primitives are used by
// higher-stakes call sites than the original cache/counter functions were):
// every new function is fail-open. If Redis is unreachable, locks report as
// "not acquired" or acquisition simply proceeds without coordination
// depending on the caller's own fallback design (see each consumer's own
// comments), hash/set/sorted-set reads return empty results, and nothing
// here ever throws out to its caller. A Redis outage should degrade the
// precision of caching/coordination/rate-limiting, never take down the
// features built on top of it.
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

  // ── Parse the URL to extract hostname for SNI ──
  const url = new URL(REDIS_URL);
  const hostname = url.hostname;

  const client = createClient({
    url: REDIS_URL,
    socket: {
      tls: true,
      servername: hostname,  // ← Fix: Add SNI support
    },
  });

  client.on('error', (err) =>
    console.error('[Redis] Client error (non-fatal):', err.message)
  );

  // ── Connect and store client

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
//
// IMPL-REDIS-01: this counter's TTL-refresh-only-on-0→1-transition
// behavior is CORRECT for windowed rate-limit-style counters (its
// original intended use), but is NOT suitable for use as a live
// "how many things are currently running" gauge — under continuous
// traffic the counter may never return to zero, so its TTL is never
// refreshed after the first increment and the key can silently expire
// while still conceptually "active". This is exactly why the new
// onboarding/AI-call concurrency coordination (utils/concurrencyGuard.js)
// uses the new sorted-set primitives below instead of this function —
// see that file's own comments for the full reasoning. This function is
// left completely unchanged and is still the right tool for genuine
// windowed-counter use cases.
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

// ══════════════════════════════════════════════════════════════
// IMPL-REDIS-01 (Phase 2 refactor) — new primitives below this line
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────
// GET RAW CLIENT — exposes the underlying connected `redis` client
// directly, for third-party libraries that need to issue their own
// arbitrary Redis commands rather than going through the wrapped
// helpers above (specifically: rate-limit-redis, via
// config/rateLimitStore.js, which integrates with a raw client's
// `sendCommand` interface). Returns null if Redis is unavailable —
// callers must handle that by falling back to a non-Redis-backed
// mode rather than crashing.
// ──────────────────────────────────────────
export const getRawClient = async () => {
  try {
    return await getClient();
  } catch (err) {
    console.warn('[Redis] getRawClient() failed:', err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// DISTRIBUTED LOCK — acquire
// Implements SET key ownerToken NX PX ttlMs. Returns true if the lock
// was acquired, false if already held by someone else (or if Redis is
// unavailable — fail toward "someone else has it" for locks specifically,
// since a caller that fails to acquire a lock has a well-defined fallback
// path in every consumer of this function, whereas silently granting a
// lock during a Redis outage could let two callers believe they both
// hold it).
//
// ownerToken MUST be a random, per-attempt value (e.g. crypto.randomUUID())
// generated by the caller — never a fixed/predictable token. This is what
// makes releaseLock's compare-and-delete safe (see below).
// ──────────────────────────────────────────
export const acquireLock = async (key, ttlSeconds, ownerToken) => {
  try {
    const c = await getClient();
    if (!c) return false;
    const result = await c.set(key, ownerToken, { NX: true, PX: ttlSeconds * 1000 });
    return result === 'OK';
  } catch (err) {
    console.warn(`[Redis] acquireLock(${key}) failed:`, err.message);
    return false;
  }
};

// ──────────────────────────────────────────
// DISTRIBUTED LOCK — release
// Atomically checks the lock is still owned by this exact ownerToken
// before deleting it, via a Lua script (GET + conditional DEL in one
// atomic EVAL). This is required for correctness: doing this as two
// separate commands (GET then DEL) would create a race where the lock
// could expire and be re-acquired by a different owner in between the
// two commands, and a naive unconditional DEL would delete that new
// owner's lock instead of the (already-expired) original one.
// Returns true if this call actually deleted the lock, false otherwise
// (already released, expired, owned by someone else, or Redis unavailable
// — the caller does not need to distinguish these cases for correctness,
// only for optional debug logging).
// ──────────────────────────────────────────
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export const releaseLock = async (key, ownerToken) => {
  try {
    const c = await getClient();
    if (!c) return false;
    const result = await c.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [ownerToken] });
    return result === 1;
  } catch (err) {
    console.warn(`[Redis] releaseLock(${key}) failed:`, err.message);
    return false;
  }
};

// ──────────────────────────────────────────
// DISTRIBUTED LOCK — convenience wrapper
// Acquires a lock, runs fn(), and always releases in a finally block
// regardless of whether fn() throws. If the lock can't be acquired,
// returns { acquired: false } immediately without running fn() — callers
// decide whether "someone else is already doing this" is expected
// (usually yes, for the use cases in this codebase) or an error.
// ──────────────────────────────────────────
export const withLock = async (key, ttlSeconds, fn) => {
  const ownerToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await acquireLock(key, ttlSeconds, ownerToken);
  if (!acquired) return { acquired: false };

  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    await releaseLock(key, ownerToken);
  }
};

// ──────────────────────────────────────────
// HASH operations — used for MultiProvider's per-key cooldown state
// (multiple fields — failCount, failedAt — that are always read/written
// together, so a single hash is the natural fit over separate keys).
//
// TTL is applied via a separate EXPIRE call after the HSET, since a
// single atomic "HSET with TTL" command (HEXPIRE) is only available from
// Redis 7.4 onward and cannot be assumed present. The small window this
// creates (a crash between HSET and EXPIRE leaving a hash with no TTL)
// is an accepted, low-consequence risk for the cache/cooldown use cases
// this supports — worst case is a stale entry that gets overwritten on
// the next successful write, never a correctness violation.
// ──────────────────────────────────────────
export const hashSet = async (key, fields, ttlSeconds) => {
  try {
    const c = await getClient();
    if (!c) return null;
    await c.hSet(key, fields);
    if (ttlSeconds) await c.expire(key, ttlSeconds);
    return true;
  } catch (err) {
    console.warn(`[Redis] hashSet(${key}) failed:`, err.message);
    return null;
  }
};

export const hashGetAll = async (key) => {
  try {
    const c = await getClient();
    if (!c) return null;
    const result = await c.hGetAll(key);
    return Object.keys(result).length ? result : null;
  } catch (err) {
    console.warn(`[Redis] hashGetAll(${key}) failed:`, err.message);
    return null;
  }
};

export const hashIncrementField = async (key, field, amount, ttlSeconds) => {
  try {
    const c = await getClient();
    if (!c) return null;
    const newValue = await c.hIncrBy(key, field, amount);
    if (ttlSeconds) await c.expire(key, ttlSeconds);
    return newValue;
  } catch (err) {
    console.warn(`[Redis] hashIncrementField(${key}, ${field}) failed:`, err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// SET operations — used for discoverability of which provider+key
// combinations currently have state, where needed.
// ──────────────────────────────────────────
export const setAdd = async (key, member) => {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.sAdd(key, member);
  } catch (err) {
    console.warn(`[Redis] setAdd(${key}) failed:`, err.message);
    return null;
  }
};

export const setMembers = async (key) => {
  try {
    const c = await getClient();
    if (!c) return [];
    return await c.sMembers(key);
  } catch (err) {
    console.warn(`[Redis] setMembers(${key}) failed:`, err.message);
    return [];
  }
};

export const setRemove = async (key, member) => {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.sRem(key, member);
  } catch (err) {
    console.warn(`[Redis] setRemove(${key}) failed:`, err.message);
    return null;
  }
};

// ──────────────────────────────────────────
// SORTED SET operations — used by the distributed onboarding/AI-call
// concurrency guard (utils/concurrencyGuard.js): each in-flight call is
// a member with its acquisition timestamp as score, which allows
// self-healing cleanup of abandoned slots (a crashed holder's member
// simply ages past a staleness cutoff and gets swept by the next
// acquire attempt) without depending on a single shared key-level TTL,
// which — per incrementCounter's comment above — is the wrong tool for
// this "many independent in-flight members" shape.
// ──────────────────────────────────────────
export const sortedSetAdd = async (key, score, member) => {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.zAdd(key, [{ score, value: member }]);
  } catch (err) {
    console.warn(`[Redis] sortedSetAdd(${key}) failed:`, err.message);
    return null;
  }
};

export const sortedSetRange = async (key, start, stop) => {
  try {
    const c = await getClient();
    if (!c) return [];
    return await c.zRange(key, start, stop);
  } catch (err) {
    console.warn(`[Redis] sortedSetRange(${key}) failed:`, err.message);
    return [];
  }
};

export const sortedSetRemove = async (key, member) => {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.zRem(key, member);
  } catch (err) {
    console.warn(`[Redis] sortedSetRemove(${key}) failed:`, err.message);
    return null;
  }
};

export const sortedSetCount = async (key, min, max) => {
  try {
    const c = await getClient();
    if (!c) return 0;
    return await c.zCount(key, min, max);
  } catch (err) {
    console.warn(`[Redis] sortedSetCount(${key}) failed:`, err.message);
    return 0;
  }
};

// Thin wrapper around ZREMRANGEBYSCORE — removes sorted-set members whose
// score (an acquisition timestamp, for the concurrency-guard use case)
// falls within [min, max]. This is the primitive the concurrency guard's
// stale-slot sweep relies on; none of the other sorted-set wrappers above
// cover bulk removal by score range (they operate by member value or by
// rank), so it's added here as its own function.
export const sortedSetRemoveRangeByScore = async (key, min, max) => {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.zRemRangeByScore(key, min, max);
  } catch (err) {
    console.warn(`[Redis] sortedSetRemoveRangeByScore(${key}) failed:`, err.message);
    return null;
  }
};

export const sortedSetCard = async (key) => {
  try {
    const c = await getClient();
    if (!c) return 0;
    return await c.zCard(key);
  } catch (err) {
    console.warn(`[Redis] sortedSetCard(${key}) failed:`, err.message);
    return 0;
  }
};

export default {
  getCache, setCache, deleteCache, incrementCounter, decrementCounter,
  getRawClient, acquireLock, releaseLock, withLock,
  hashSet, hashGetAll, hashIncrementField,
  setAdd, setMembers, setRemove,
  sortedSetAdd, sortedSetRange, sortedSetRemove, sortedSetCount,
  sortedSetRemoveRangeByScore, sortedSetCard,
};
