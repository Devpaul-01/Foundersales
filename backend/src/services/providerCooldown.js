// src/services/providerCooldown.js
// ============================================================
// SHARED PROVIDER KEY COOLDOWN — Phase 2 refactor
//
// Extracted from multiProvider.js so the same Redis-backed (with
// in-memory fallback) key-cooldown mechanism can be shared by BOTH
// multiProvider.js (Cerebras/Groq/Mistral/OpenRouter) and exa.js (Exa
// search), rather than each maintaining its own separate,
// structurally-identical implementation of the same pattern — see
// exa.js's own header comment for the full reasoning behind this
// consolidation.
//
// Generic over an arbitrary `provider` string and numeric key `index` —
// nothing here is specific to any one of the providers that use it.
// All keys live under the shared `mp:cooldown:{provider}:{index}` Redis
// namespace (see redis.js's key-naming convention) — `mp:` is used for
// Exa too, since it's conceptually the same kind of state (which of this
// provider's keys is currently known-bad), just for a different provider
// family.
//
// Kill switch: MULTIPROVIDER_REDIS_STATE_ENABLED — deliberately shared
// across every consumer of this module rather than a separate flag per
// provider family, since this refactor's explicit goal is a consistent,
// single AI-infrastructure story. If you later want independent control
// per provider family, splitting the flag is a small, isolated change
// confined to this file.
// ============================================================

import { hashSet, hashGetAll, hashIncrementField } from './redis.js';
import { reportDegradedMode } from '../utils/reportDegradation.js';

export const isRedisStateEnabled = () => process.env.MULTIPROVIDER_REDIS_STATE_ENABLED !== 'false';

export const KEY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — unchanged from the original in-memory design

const cooldownRedisKey = (provider, index) => `mp:cooldown:${provider}:${index}`;

// ── Redis-backed path ────────────────────────────────────────
// See multiProvider.js's original IMPL-MULTIPROVIDER-01 comment (kept
// there in this file's history) for why the cooldown DECISION is a
// simple Redis key-existence check rather than application-side
// timestamp arithmetic, and why markKeyFailed issues two sequential
// calls rather than a single pipelined one.
const markKeyFailedRedis = async (provider, index) => {
  const key = cooldownRedisKey(provider, index);
  await hashIncrementField(key, 'failCount', 1, KEY_COOLDOWN_MS / 1000);
  await hashSet(key, { failedAt: String(Date.now()) }, KEY_COOLDOWN_MS / 1000);
  console.warn(`[ProviderCooldown] ${provider} key #${index} cooling down (Redis, cross-instance) — retrying in 1h`);
};

const isKeyCoolingRedis = async (provider, index) => {
  const data = await hashGetAll(cooldownRedisKey(provider, index));
  return !!data;
};

export const getCooldownState = async (provider, index) => hashGetAll(cooldownRedisKey(provider, index));

// ── In-memory fallback path (kill switch off, or a Redis op fails) ──
const keyCooldownsInMemory = new Map();
const cooldownId = (provider, index) => `${provider}-${index}`;

const markKeyFailedInMemory = (provider, index) => {
  const id       = cooldownId(provider, index);
  const existing = keyCooldownsInMemory.get(id) || { failCount: 0 };
  const next     = { failedAt: Date.now(), failCount: existing.failCount + 1 };
  keyCooldownsInMemory.set(id, next);
  console.warn(`[ProviderCooldown] ${provider} key #${index} cooling down (in-memory fallback, fail #${next.failCount}) — retrying in 1h`);
};

const isKeyCoolingInMemory = (provider, index) => {
  const id = cooldownId(provider, index);
  const cd = keyCooldownsInMemory.get(id);
  if (!cd) return false;
  if (Date.now() - cd.failedAt >= KEY_COOLDOWN_MS) {
    keyCooldownsInMemory.delete(id);
    console.log(`[ProviderCooldown] ${provider} key #${index} cooldown expired — back in rotation`);
    return false;
  }
  return true;
};

// Exposed for getProviderStatus-style status reporting when the kill
// switch is off (synchronous, matches the shape callers already expect
// for the in-memory fallback path).
export const getInMemoryCooldownState = (provider, index) => keyCooldownsInMemory.get(cooldownId(provider, index)) || null;
export const isKeyCoolingInMemorySync = isKeyCoolingInMemory;

// ── Public dispatchers — every consumer of this module calls these,
// never the Redis/in-memory implementations directly, so callers never
// need to know which mode is active. ──────────────────────────────
export const markKeyFailed = async (provider, index) => {
  if (isRedisStateEnabled()) {
    try {
      await markKeyFailedRedis(provider, index);
      return;
    } catch (err) {
      console.warn(`[ProviderCooldown] Redis cooldown write failed, falling back to in-memory for this call:`, err.message);
      reportDegradedMode('provider-cooldown-redis-unavailable', { operation: 'markKeyFailed', provider, index, error: err.message });
    }
  }
  markKeyFailedInMemory(provider, index);
};

export const isKeyCooling = async (provider, index) => {
  if (isRedisStateEnabled()) {
    try {
      return await isKeyCoolingRedis(provider, index);
    } catch (err) {
      console.warn(`[ProviderCooldown] Redis cooldown read failed, falling back to in-memory for this call:`, err.message);
      reportDegradedMode('provider-cooldown-redis-unavailable', { operation: 'isKeyCooling', provider, index, error: err.message });
    }
  }
  return isKeyCoolingInMemory(provider, index);
};

export default { markKeyFailed, isKeyCooling, getCooldownState, isRedisStateEnabled, KEY_COOLDOWN_MS };
