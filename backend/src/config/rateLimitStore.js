// src/config/rateLimitStore.js
// ============================================================
// SHARED REDIS-BACKED RATE LIMIT STORE — Phase 2 refactor (C2 +
// horizontal-scaling instruction), PHASE 3 hardening (this revision)
//
// Every rate limiter in this codebase previously used
// express-rate-limit's default in-memory store, meaning each of N
// horizontally-scaled instances enforced its own independent counter —
// the EFFECTIVE limit a user experienced was closer to
// (configured limit) × (number of instances), not the configured limit
// itself.
//
// IMPL-RATELIMIT-02: this module used to hand every limiter the exact
// same RedisStore instance, all sharing one 'ratelimit:' prefix. That's
// wrong on its own: RedisStore's key is just `prefix + keyGenerator(req)`,
// with NO awareness of which limiter it's attached to. aiRateLimiter and
// pipelineRateLimiter both key on `req.user?.id || req.ip`, so a single
// user hitting an AI route and a pipeline route was incrementing the
// SAME Redis counter — the two "independent" limits were silently
// merged. authRateLimiter avoided this by accident (it keys on req.ip
// instead of user id), not by design.
//
// createRateLimitStore(namespace) now returns one RedisStore PER
// namespace, each with its own prefix ('ratelimit:<namespace>:'), so
// every limiter's counters live in their own key space. All namespaced
// stores still share a single underlying Redis client connection (via
// services/redis.js's getRawClient()) — we only open one connection to
// Redis, we just partition the keyspace per limiter on top of it.
// Stores are constructed lazily and cached per namespace, so calling
// createRateLimitStore('ai') twice returns the same instance.
//
// PHASE 3 (this revision): IMPL-RATELIMIT-02's fix only works if every
// call site actually supplies a distinct namespace. An audit found SIX
// call sites (app.js ×4 limiters, auth.js, calendar.js, opportunities.js
// ×2 limiters, upload.js) calling `createRateLimitStore()` with NO
// argument at all — which silently fell back to the 'default' namespace
// below, putting authRateLimiter, aiRateLimiter, pipelineRateLimiter,
// analyticsRateLimiter, the auth email limiter, the calendar AI limiter,
// both opportunities limiters, and the upload limiter all in the SAME
// 'ratelimit:default:' Redis key space — reintroducing the exact
// collision class this module was built to prevent, just one level up
// (namespace collision instead of no-namespace-at-all collision).
//
// Two changes address this:
//   1. Every limiter is now defined in config/limiters.js, which forces
//      an explicit, unique namespace string per limiter via
//      buildLimiter() — see that file for the full limiter registry.
//   2. This module now WARNS loudly (not throws — see fail-open
//      reasoning below) any time the 'default' namespace is actually
//      requested, since after the config/limiters.js migration nothing
//      in this codebase should ever hit that path again. A stray future
//      call site that forgets to pass a namespace will now be visible in
//      logs immediately instead of silently sharing counters with
//      whatever else also forgot.
//
// CONFIGURABLE BACKEND (per the explicit instruction that this remain
// swappable with minimal effort): createRateLimitStore() is still the
// single choke point every limiter in this codebase calls to obtain its
// store. Swapping the backend later (a different Redis client, a
// database-backed store, whatever) means changing the implementation of
// this one function — no limiter definition anywhere else needs to change.
//
// Fallback: if Redis is unavailable when a store is first requested,
// this returns undefined (for every namespace), and express-rate-limit
// falls back to its own default in-memory store for that limiter —
// degraded (per-instance, not distributed) but functional, never a hard
// failure. A warning is logged once via reportDegradedMode so this
// doesn't fail silently. We only ever attempt the Redis connection once
// per process lifetime, regardless of how many namespaces are requested.
// ============================================================
// IMPL-RATELIMIT-03: rate-limit-redis's export shape differs by version —
// v4+ exposes a named `RedisStore` export, older v3.x only exposes a
// default export. Importing the whole module as a namespace and picking
// whichever is present avoids hard-failing on either version.
import * as RateLimitRedis from 'rate-limit-redis';
const RedisStore = RateLimitRedis.RedisStore || RateLimitRedis.default;

import { getRawClient } from '../services/redis.js';
import { reportDegradedMode } from '../utils/reportDegradation.js';

const _stores = new Map(); // namespace -> RedisStore instance
let _client;                // cached raw redis client — ONE connection shared by every namespaced store
let _clientAttempted = false;
let _redisUnavailable = false;

const getSharedClient = async () => {
  if (_client) return _client;
  if (_redisUnavailable) return null;
  if (_clientAttempted) return null; // already tried and failed this process lifetime — don't retry every call
  _clientAttempted = true;

  const client = await getRawClient();
  if (!client) {
    console.warn('[RateLimit] Redis unavailable — falling back to per-instance in-memory rate limiting.');
    reportDegradedMode('ratelimit-store-fallback', { reason: 'redis_unavailable_at_store_construction' });
    _redisUnavailable = true;
    return null;
  }

  _client = client;
  return _client;
};

/**
 * Returns a RedisStore scoped to `namespace` (e.g. 'auth', 'ai', 'pipeline'),
 * so different limiters never share counters even if their keyGenerator
 * functions happen to produce the same key value. Every namespaced store
 * still rides on one shared Redis connection.
 *
 * Falls back to `undefined` (per-namespace, per-instance in-memory store)
 * if Redis is unreachable — see module header for the fail-open reasoning.
 *
 * PHASE 3: `namespace` should always be supplied explicitly by callers —
 * in practice this means every limiter should be defined in
 * config/limiters.js via buildLimiter(), which enforces this itself.
 * The 'default' fallback below still exists (removing the parameter
 * default would be a breaking API change for this exported function),
 * but any actual use of it is now logged loudly, since after this
 * refactor nothing in the codebase is expected to hit it.
 */
export const createRateLimitStore = async (namespace = 'default') => {
  if (namespace === 'default') {
    console.warn(
      '[RateLimit] createRateLimitStore() called with no namespace — falling back to "default". ' +
      'This is almost certainly a bug: every limiter should pass a unique namespace ' +
      '(see config/limiters.js). Multiple limiters sharing "default" will share Redis ' +
      'counters and silently merge their limits.'
    );
  }

  if (_stores.has(namespace)) return _stores.get(namespace);

  const client = await getSharedClient();
  if (!client) return undefined;

  const store = new RedisStore({
    // rate-limit-redis integrates with a raw `redis` v4 client via its
    // sendCommand interface — see services/redis.js's getRawClient()
    // comment for why this needs direct client access rather than the
    // wrapped cache/lock helpers.
    sendCommand: (...args) => client.sendCommand(args),
    prefix: `ratelimit:${namespace}:`, // per-limiter key space — see IMPL-RATELIMIT-02 above
  });

  _stores.set(namespace, store);
  console.log(`[RateLimit] Redis-backed rate limit store initialized (namespace: "${namespace}").`);
  return store;
};

export default { createRateLimitStore };
