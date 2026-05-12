// src/services/multiProvider.js
// ============================================================
// MULTI-PROVIDER AI FALLBACK — Multi-Account Key Rotation
//
// Reads GROQ_API_KEY_1 through GROQ_API_KEY_10 from env.
// Falls back to GROQ_API_KEY for single-key setups.
//
// Provider chain per healthy key:
//   1. llama-3.1-8b-instant  (primary — free, fast)
//   2. llama-3.3-70b-versatile (fallback — smarter)
//   3. llama-3.1-8b-instant   (last resort retry)
//
// Failed keys are cooled down for 1 hour (in-memory).
// Cool-down state is tracked per key index so we never
// immediately retry a key that just rate-limited us.
//
// FIX PERF-1: Removed the probe call in streamWithFallback.
// Previously, every streaming chat request made an extra
// callGroq({ maxTokens: 1, content: 'ping' }) before the real
// stream — adding ~300-500ms latency to EVERY message. This was
// redundant because the cooldown system already tracks failed keys.
// The probe is now gone: we attempt the real stream directly and
// fall through to the next key if it fails.
// ============================================================

import { callGroq, streamGroq, PRIMARY_MODEL, PRO_MODEL, FLASH_MODEL } from './groq.js';

// ──────────────────────────────────────────
// KEY POOL BUILDER
// ──────────────────────────────────────────
const buildKeyPool = () => {
  const keys = [];

  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key?.trim()) keys.push({ key: key.trim(), index: i });
  }

  // Single-key fallback
  if (keys.length === 0 && process.env.GROQ_API_KEY?.trim()) {
    keys.push({ key: process.env.GROQ_API_KEY.trim(), index: 0 });
  }

  if (keys.length === 0) {
    console.error('[MultiProvider] CRITICAL: No Groq API keys found in environment!');
  } else {
    console.log(`[MultiProvider] Key pool initialized: ${keys.length} key(s) available`);
  }

  return keys;
};

// ──────────────────────────────────────────
// COOLDOWN STATE (in-memory)
// Map<keyIndex, { failedAt: timestamp, failCount: number }>
// ──────────────────────────────────────────
const KEY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const keyCooldowns    = new Map();

const markKeyFailed = (keyIndex) => {
  const existing = keyCooldowns.get(keyIndex) || { failCount: 0 };
  const next = { failedAt: Date.now(), failCount: existing.failCount + 1 };
  keyCooldowns.set(keyIndex, next);
  console.warn(`[MultiProvider] Key #${keyIndex} cooling down (fail #${next.failCount}) — retrying in 1h`);
};

const isKeyCooling = (keyIndex) => {
  const cd = keyCooldowns.get(keyIndex);
  if (!cd) return false;
  if (Date.now() - cd.failedAt >= KEY_COOLDOWN_MS) {
    keyCooldowns.delete(keyIndex);
    console.log(`[MultiProvider] Key #${keyIndex} cooldown expired — back in rotation`);
    return false;
  }
  return true;
};

const getHealthyKeys = (pool) => pool.filter(k => !isKeyCooling(k.index));

// ──────────────────────────────────────────
// ERROR CLASSIFICATION
// ──────────────────────────────────────────
const RETRYABLE_ERRORS = [
  'GROQ_RATE_LIMIT', 'GROQ_UNAVAILABLE', 'GROQ_AUTH_ERROR',
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'socket hang up',
];

const isRetryableError = (err) =>
  RETRYABLE_ERRORS.some(code => err?.message?.includes(code));

const shouldCoolKey = (err) =>
  err?.message?.includes('GROQ_RATE_LIMIT') ||
  err?.message?.includes('GROQ_AUTH_ERROR') ||
  err?.message?.includes('GROQ_UNAVAILABLE');

// ──────────────────────────────────────────
// LAZY KEY POOL
// ──────────────────────────────────────────
let _keyPool = null;
const getKeyPool = () => {
  if (!_keyPool) _keyPool = buildKeyPool();
  return _keyPool;
};

// ──────────────────────────────────────────
// PROVIDER QUEUE BUILDER
// Primary model across all healthy keys first,
// then fallback model, then last resort.
// ──────────────────────────────────────────
const CHAT_MODELS = [PRIMARY_MODEL, PRO_MODEL, FLASH_MODEL];

const buildProviderQueue = (pool) => {
  const healthy = getHealthyKeys(pool);
  if (healthy.length === 0) return [];

  const queue = [];
  for (const model of CHAT_MODELS) {
    for (const keyEntry of healthy) {
      queue.push({
        model,
        keyEntry,
        name: `groq-${model}-key${keyEntry.index}`,
      });
    }
  }
  return queue;
};

// ──────────────────────────────────────────
// NON-STREAMING: callWithFallback
// ──────────────────────────────────────────
export const callWithFallback = async (opts) => {
  const keyPool = getKeyPool();
  const queue   = buildProviderQueue(keyPool);

  if (queue.length === 0) {
    throw new Error('ALL_PROVIDERS_FAILED: All Groq API keys are currently cooling down');
  }

  let lastError;
  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Trying ${provider.name}...`);
      const result = await callGroq({
        ...opts,
        modelName: provider.model,
        _apiKey:   provider.keyEntry.key,
      });
      console.log(`[MultiProvider] Success via ${provider.name}`);
      return { ...result, model_used: provider.name };
    } catch (err) {
      lastError = err;
      console.warn(`[MultiProvider] ${provider.name} failed: ${err.message}`);

      if (shouldCoolKey(err) && !cooledThisCall.has(provider.keyEntry.index)) {
        markKeyFailed(provider.keyEntry.index);
        cooledThisCall.add(provider.keyEntry.index);
      }

      if (!isRetryableError(err)) throw err; // Non-retryable — bail immediately
    }
  }

  console.error('[MultiProvider] All providers exhausted:', lastError?.message);
  throw new Error(`ALL_PROVIDERS_FAILED: ${lastError?.message}`);
};

// ──────────────────────────────────────────
// STREAMING: streamWithFallback
//
// FIX PERF-1: Removed the probe call. Previously this fired
// callGroq({ content: 'ping', maxTokens: 1 }) before every real
// stream, adding ~300-500ms to every user message with zero benefit
// since the cooldown system already handles failed keys.
//
// Now we attempt the stream directly. If a key fails during
// streaming, the error propagates to onError and the caller
// can retry via a fresh request (SSE streams can't be mid-streamed
// to a different key anyway without client-side restitch).
// ──────────────────────────────────────────
export const streamWithFallback = async ({
  messages, systemPrompt, temperature, maxTokens,
  onToken, onComplete, onError,
}) => {
  const keyPool = getKeyPool();
  const queue   = buildProviderQueue(keyPool);

  if (queue.length === 0) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: All Groq API keys are currently cooling down'));
    return;
  }

  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Streaming via ${provider.name}`);

      // Attempt the stream directly — no probe call needed.
      // If the key is bad, streamGroq will throw and we fall through.
      await streamGroq({
        messages, systemPrompt, temperature, maxTokens,
        modelName: provider.model,
        _apiKey:   provider.keyEntry.key,
        onToken,
        onComplete: (content, usage) =>
          onComplete?.(content, { ...usage, model_used: provider.name }),
        onError: (err) => {
          // Re-throw so we fall through to the next provider
          throw err;
        },
      });
      return; // Stream completed successfully

    } catch (err) {
      console.warn(`[MultiProvider] Stream failed for ${provider.name}: ${err.message}`);

      if (shouldCoolKey(err) && !cooledThisCall.has(provider.keyEntry.index)) {
        markKeyFailed(provider.keyEntry.index);
        cooledThisCall.add(provider.keyEntry.index);
      }

      if (!isRetryableError(err)) { onError?.(err); return; }
      // Otherwise continue to next provider in queue
    }
  }

  onError?.(new Error('ALL_PROVIDERS_FAILED: No healthy Groq providers available'));
};

// ──────────────────────────────────────────
// UTILITY: Key health status (for debugging / admin)
// ──────────────────────────────────────────
export const getProviderStatus = () => {
  const keyPool = getKeyPool();
  return keyPool.map(k => {
    const cd      = keyCooldowns.get(k.index);
    const cooling = isKeyCooling(k.index);
    return {
      key_index:     k.index,
      status:        cooling ? 'cooling' : 'healthy',
      fail_count:    cd?.failCount || 0,
      cooling_until: cooling ? new Date(cd.failedAt + KEY_COOLDOWN_MS).toISOString() : null,
    };
  });
};

export default { callWithFallback, streamWithFallback, getProviderStatus };
