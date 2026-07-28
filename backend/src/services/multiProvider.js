// src/services/multiProvider.js
// ============================================================
// MULTI-PROVIDER AI FALLBACK — Cerebras + Groq + Mistral + OpenRouter
//
// Provider priority (highest free TPM first):
//   1. Cerebras    (~60K TPM free)  — gpt-oss-120b (production) + dynamic discovery
//   2. Groq        (~30K TPM free)  — llama-4-scout (vision!) + llama-3.3-70b + dynamic discovery
//   3. Mistral     (500K TPM free*) — mistral-small-latest / mistral-medium-latest (provider aliases)
//      *Mistral free tier may use your prompts for training.
//   4. OpenRouter  (paid, many models) — dynamic discovery; fallback of last resort
//
// Multi-key support per provider (add real keys from separate accounts):
//   CEREBRAS_API_KEY_1    … CEREBRAS_API_KEY_5
//   GROQ_API_KEY_1        … GROQ_API_KEY_10
//   MISTRAL_API_KEY_1     … MISTRAL_API_KEY_5
//   OPENROUTER_API_KEY_1  … OPENROUTER_API_KEY_5
//   (single-key fallback: CEREBRAS_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY)
//
// All four use OpenAI-compatible APIs — no separate SDKs needed.
// Failed keys cool down for 1 hour (in-memory fallback path) or via Redis
// (default path — see IMPL-MULTIPROVIDER-01 below).
//
// CHAT AUDIT CHANGES (this revision):
//   - VISION SUPPORT (audit §5.8): callWithFallback / callWithFallbackGroq /
//     streamWithFallback now accept an optional `images` array
//     ([{ url: 'data:<mime>;base64,...' }]). Images are only actually
//     attached to the outgoing request when the model chosen for that
//     specific attempt is in VISION_CAPABLE_MODELS — every other model in
//     the fallback queue still gets the plain-text messages exactly as
//     before. This avoids sending multi-part `content` arrays to providers
//     that may not expect them, while giving the one vision-capable model
//     in the queue (Groq's llama-4-scout) the actual image bytes instead
//     of a "there's an image here, describe it" placeholder it can never
//     act on.
//   - model_used is now a clean `${providerId}:${model}` string instead of
//     the compound `${providerId}-${model}-key${index}` debug string
//     (audit §5.3). The key index is still used internally for cooldown
//     bookkeeping and logging — it just isn't leaked into persisted data
//     / analytics anymore.
//
// IMPL-MULTIPROVIDER-01 (Phase 2 refactor): key cooldown state, model
// discovery cache, and (new, observe-only) usage counters are now backed
// by Redis by default, so this file's runtime state is correctly shared
// across every instance in a horizontally-scaled deployment, rather than
// silently diverging per-process. Previously: an instance that saw a key
// fail had no way to tell any other instance, so other instances kept
// sending traffic to a known-bad key; and every instance independently
// performed model discovery at boot, hitting every provider's /models
// endpoint redundantly on every deploy.
//
// Pool construction (_pools, buildKeyPool) is DELIBERATELY left local /
// per-process, unchanged — this is configuration read from process.env at
// startup, not runtime state. Every instance in a correctly-configured
// deployment has identical environment variables, so every instance
// independently builds an identical pool; there is nothing to
// synchronize, and synchronizing already-identical configuration would
// add a Redis dependency at boot for zero benefit.
//
// Kill switch: MULTIPROVIDER_REDIS_STATE_ENABLED (default enabled — set
// to the string 'false' to disable). When disabled, this file falls back
// entirely to the original in-memory Map-based cooldown/discovery
// behavior (kept in this file, not deleted, specifically so this switch
// works). This file is the single highest-traffic file in the codebase —
// every AI feature routes through it — so a single environment-variable
// toggle that reverts to the previously-working, well-understood
// in-memory behavior, with no code deploy required, is the highest-value
// risk mitigation available for a change this central. Recommend running
// with this explicitly set to 'false' for an initial canary rollout,
// flipping to enabled (or simply unsetting it) once validated under real
// multi-instance load. Plan to remove the in-memory fallback path
// entirely only after the Redis-backed path has run in production for a
// deliberate observation period (1-2 weeks of stable operation).
//
// IMPL-H8-01 (Phase 2 refactor): retry classification now uses
// utils/providerErrors.js's classifyProviderError() instead of the old
// isRetryableError/shouldCoolKey string-substring matching. See that
// file's header comment for the full reasoning. The old functions and
// signal-list constants are kept below (renamed with an `InMemory`/`Old`
// suffix where they overlap with new names) for one release cycle as a
// safety net, matching this file's own kill-switch conservatism — remove
// them in a follow-up cleanup once the new classifier has run in
// production without surprises.
//
// IMPL-SENTRY-01 (Phase 2 refactor / L4): most AI-call failures in this
// codebase never reach Sentry's automatic Express-level error capture,
// because the overwhelming majority of groq-*.js functions catch their
// own errors locally and return a fallback value rather than rethrowing.
// Relying on automatic capture alone would mean the failures most worth
// surfacing (NON_RETRYABLE classifications, ALL_PROVIDERS_FAILED) would
// frequently never reach Sentry at all. Explicit Sentry.captureException
// calls are placed at exactly these two choke points below — deliberately
// NOT scattered across every individual groq-*.js catch block, which
// would reintroduce the kind of duplicated-logic-across-many-files
// problem already flagged elsewhere in this codebase's audit history.
// KEY_FAULT and PROVIDER_TRANSIENT classifications are deliberately NOT
// sent to Sentry — these are expected, routinely-handled conditions the
// fallback chain is specifically designed to absorb, and capturing every
// one would generate enormous, signal-drowning volume under completely
// normal operating conditions.
// ============================================================

import * as Sentry from '@sentry/node';
import { ProviderCallError, classifyProviderError } from '../utils/providerErrors.js';
import {
  getCache, setCache, withLock, getRawClient,
  hashIncrementField,
  incrementCounter,
} from './redis.js';
import {
  markKeyFailed, isKeyCooling, getCooldownState, isRedisStateEnabled,
  isKeyCoolingInMemorySync, getInMemoryCooldownState,
} from './providerCooldown.js';
import { reportDegradedMode } from '../utils/reportDegradation.js';

const MODEL_PRIORITY = {
  cerebras: [
    'gpt-oss-120b',
  ],

  groq: [
    'openai/gpt-oss-120b',
    'qwen/qwen3-32b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],

  mistral: [
    'mistral-large-2512',
    'mistral-medium-latest',
    'ministral-3b-2512',
  ],

  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-4-31b-it:free',
    'nousresearch/hermes-3-405b:free',
  ],
};

const FAST_MODEL_PRIORITY = {
  cerebras: MODEL_PRIORITY.cerebras,
  groq: [
    'llama-3.1-8b-instant',
    ...MODEL_PRIORITY.groq,
  ],
  mistral: [
    'ministral-3b-2512',
    ...MODEL_PRIORITY.mistral,
  ],
  openrouter: MODEL_PRIORITY.openrouter,
};

const getModelPriorityForTier = (providerId, tier) =>
  tier === 'fast'
    ? (FAST_MODEL_PRIORITY[providerId] || MODEL_PRIORITY[providerId])
    : MODEL_PRIORITY[providerId];

// ──────────────────────────────────────────
// VISION-CAPABLE MODELS
// Only models actually able to interpret image content. Everything else
// in the fallback queue still receives the text-only messages array —
// see buildMessagesForProvider below.
// ──────────────────────────────────────────
const VISION_CAPABLE_MODELS = new Set([
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'google/gemma-4-31b-it:free',
]);

const NON_CHAT_PATTERN = /whisper|embed|guard|tts|moderation|transcribe|ocr|safeguard|vision-only/i;

const PROVIDER_REGISTRY = {
  cerebras: {
    name:      'cerebras',
    baseURL:   'https://api.cerebras.ai/v1',
    models:    MODEL_PRIORITY.cerebras,
    envPrefix: 'CEREBRAS_API_KEY',
    maxKeys:   5,
  },
  groq: {
    name:      'groq',
    baseURL:   'https://api.groq.com/openai/v1',
    models:    MODEL_PRIORITY.groq,
    envPrefix: 'GROQ_API_KEY',
    maxKeys:   10,
  },
  mistral: {
    name:      'mistral',
    baseURL:   'https://api.mistral.ai/v1',
    models:    MODEL_PRIORITY.mistral,
    envPrefix: 'MISTRAL_API_KEY',
    maxKeys:   5,
  },
  openrouter: {
    name:      'openrouter',
    baseURL:   'https://openrouter.ai/api/v1',
    models:    MODEL_PRIORITY.openrouter,
    envPrefix: 'OPENROUTER_API_KEY',
    maxKeys:   5,
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER ?? 'https://localhost',
      'X-Title':      process.env.OPENROUTER_APP_TITLE ?? 'MultiProvider',
    },
  },
};

const PROVIDER_ORDER = ['cerebras', 'groq', 'mistral', 'openrouter'];

const buildKeyPool = (providerDef) => {
  const { name, envPrefix, maxKeys } = providerDef;
  const keys = [];

  for (let i = 1; i <= maxKeys; i++) {
    const key = process.env[`${envPrefix}_${i}`];
    if (key?.trim()) keys.push({ key: key.trim(), index: i, provider: name });
  }

  if (keys.length === 0 && process.env[envPrefix]?.trim()) {
    keys.push({ key: process.env[envPrefix].trim(), index: 0, provider: name });
  }

  if (keys.length > 0) {
    console.log(`[MultiProvider] ${name}: ${keys.length} key(s) loaded`);
  }

  return keys;
};

// ══════════════════════════════════════════════════════════════
// IMPL-MULTIPROVIDER-01 — Redis key builders for state that stays local
// to THIS file (model discovery cache, usage counters, provider-health
// counters). Key cooldown state (markKeyFailed/isKeyCooling) has been
// extracted into services/providerCooldown.js so it can be shared
// verbatim with exa.js's key rotation — see that module's header
// comment for the full reasoning. isRedisStateEnabled is also sourced
// from there, since both this file and exa.js are meant to move in
// lockstep on the same kill switch.
// ══════════════════════════════════════════════════════════════

const MODEL_CACHE_TTL_S    = 6 * 60 * 60;    // 6 hours
const MODEL_LOCK_TTL_S     = 15;             // comfortably covers the 8s discovery HTTP timeout below
const USAGE_COUNTER_TTL_S  = 60;             // not refreshed on each increment — rolls over naturally
const PROVIDER_HEALTH_TTL_S = 60 * 60;

const modelsRedisKey         = (provider)         => `mp:models:${provider}`;
const modelsLockRedisKey     = (provider)         => `mp:models:${provider}:lock`;
const usageRedisKey          = (provider, index)  => `mp:usage:${provider}:${index}`;
const providerHealthRedisKey = (provider)         => `mp:providerhealth:${provider}`;

// ──────────────────────────────────────────
// IMPL-MULTIPROVIDER-01 — Redis-backed model discovery cache

//
// Shared across every instance: only one instance ever performs the real
// /models HTTP call per provider per 6-hour window (lock-guarded); every
// other instance either reads the shared cache or — if it loses the lock
// race before the winner has finished writing — falls back to the static
// MODEL_PRIORITY list for that one request cycle, exactly like the
// pre-Redis "discovery hasn't finished yet" fallback already did. This
// also fixes a real, if subtler, correctness gap beyond just reducing
// redundant HTTP calls: without a shared cache, two instances could
// independently discover slightly different model lists from a
// transiently-inconsistent provider response, meaning two requests to the
// same feature, routed to different instances, could silently use
// different underlying models for reasons invisible to anyone debugging
// a "why did this response seem different" report.
// ──────────────────────────────────────────
const fetchAndRankModelsFromProvider = async (providerId, baseURL, apiKey) => {
  if (providerId === 'mistral') {
    return MODEL_PRIORITY.mistral;
  }

  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal:  AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json   = await res.json();
  const allIds = (json.data || []).map(m => m.id).filter(Boolean);

  const priorityList = MODEL_PRIORITY[providerId] || [];
  const known   = priorityList.filter(id => allIds.includes(id));
  const unknown = allIds.filter(id =>
    !priorityList.includes(id) && !NON_CHAT_PATTERN.test(id)
  ).sort();

  const ranked = [...known, ...unknown];
  return ranked.length > 0 ? ranked : priorityList;
};

const getModelsFromRedisCache = async (providerId) => {
  const raw = await getCache(modelsRedisKey(providerId));
  return Array.isArray(raw) ? raw : null;
};

const discoverModelsRedisBacked = async (providerId, baseURL, apiKey) => {
  const cached = await getModelsFromRedisCache(providerId);
  if (cached) return cached;

  const lockKey = modelsLockRedisKey(providerId);
  const { acquired, result } = await withLock(lockKey, MODEL_LOCK_TTL_S, async () => {
    // Re-check in case another process finished discovery while we were
    // waiting to acquire the lock.
    const recheck = await getModelsFromRedisCache(providerId);
    if (recheck) return recheck;

    try {
      const ranked = await fetchAndRankModelsFromProvider(providerId, baseURL, apiKey);
      await setCache(modelsRedisKey(providerId), ranked, MODEL_CACHE_TTL_S);
      console.log(`[MultiProvider] ${providerId}: discovered ${ranked.length} chat model(s) (Redis-cached, 6h)`);
      return ranked;
    } catch (err) {
      console.warn(`[MultiProvider] ${providerId}: Redis-backed discovery failed (${err.message}) — will use static priority list`);
      return null;
    }
  });

  if (acquired) return result; // may be null if the fetch itself failed — falls through to static list at the call site
  // Someone else holds the lock right now — don't perform the HTTP call
  // ourselves this cycle.
  return null;
};

// Evict a specific model from the Redis-backed cache (BAD_MODEL
// classification — see providerErrors.js). Preserves the cache entry's
// remaining TTL rather than resetting to the full 6-hour window, so this
// eviction doesn't artificially extend the cache's natural refresh
// schedule.
const evictModelFromRedisCache = async (providerId, modelId) => {
  try {
    const current = await getModelsFromRedisCache(providerId);
    if (!current) return;
    const updated = current.filter(m => m !== modelId);
    if (updated.length === current.length) return; // nothing to evict

    let remainingTtl = MODEL_CACHE_TTL_S;
    const client = await getRawClient();
    if (client) {
      try {
        const ttl = await client.ttl(modelsRedisKey(providerId));
        if (ttl > 0) remainingTtl = ttl;
      } catch { /* fall back to full TTL if reading it fails */ }
    }

    await setCache(modelsRedisKey(providerId), updated, remainingTtl);
    console.warn(`[MultiProvider] Evicted bad model "${modelId}" from ${providerId}'s Redis-cached model list`);
  } catch (err) {
    console.warn(`[MultiProvider] evictModelFromRedisCache(${providerId}, ${modelId}) failed (non-fatal):`, err.message);
  }
};

// Fire-and-forget observability counters — never awaited at the call
// site, never block the real request path. Observe-only in this
// rollout: not read by any decision logic yet (see file header and
// providerErrors.js's PROVIDER_TRANSIENT reasoning) — deliberately
// staged this way so real production traffic data can inform sensible
// thresholds before anything acts on these numbers.
const recordUsageAttempt = (providerId, index) => {
  incrementCounter(usageRedisKey(providerId, index), USAGE_COUNTER_TTL_S).catch(() => {});
};

const recordProviderTransient = (providerId) => {
  hashIncrementField(providerHealthRedisKey(providerId), 'count', 1, PROVIDER_HEALTH_TTL_S).catch(() => {});
};

// ══════════════════════════════════════════════════════════════
// Original in-memory implementation — kept as the fallback path when
// MULTIPROVIDER_REDIS_STATE_ENABLED is explicitly set to 'false', or
// when a Redis operation itself fails at runtime (fail-open: a Redis
// hiccup degrades precision, never takes down AI features). See the
// file header for why this is deliberately not deleted yet.
// ══════════════════════════════════════════════════════════════

// Cooldown in-memory fallback now lives in providerCooldown.js (shared
// with exa.js) — see this file's markKeyFailed/isKeyCooling imports above.

let _pools = null;

const _discoveredModels = {};
const _discoveryDone    = {};

const _discoverProviderModelsInMemory = async (providerId, baseURL, apiKey) => {
  try {
    const ranked = await fetchAndRankModelsFromProvider(providerId, baseURL, apiKey);
    _discoveredModels[providerId] = ranked;
    console.log(`[MultiProvider] ${providerId}: discovered ${ranked.length} chat model(s) — using dynamic list (in-memory fallback)`);
  } catch (err) {
    console.warn(`[MultiProvider] ${providerId}: model discovery failed (${err.message}) — using static priority list`);
    _discoveredModels[providerId] = MODEL_PRIORITY[providerId] || [];
  }
  _discoveryDone[providerId] = true;
};

const getEffectiveModelsInMemory = (providerId, tier = 'quality') => {
  if (_discoveryDone[providerId] && _discoveredModels[providerId]?.length > 0) {
    if (tier === 'fast') {
      const fastIds = FAST_MODEL_PRIORITY[providerId] || [];
      const matched = _discoveredModels[providerId].filter(id => fastIds.includes(id));
      if (matched.length > 0) return matched;
    }
    return _discoveredModels[providerId];
  }
  return getModelPriorityForTier(providerId, tier) || PROVIDER_REGISTRY[providerId]?.models || [];
};

// ══════════════════════════════════════════════════════════════
// IMPL-MULTIPROVIDER-01 — dispatchers: route to Redis-backed logic by
// default, fall back to the in-memory implementation when the kill
// switch is off OR when a Redis operation fails at runtime. Every
// caller elsewhere in this file goes through these dispatchers rather
// than calling either implementation directly, so the rest of the file
// doesn't need to know which mode is active.
// ══════════════════════════════════════════════════════════════

// Local id helper used only for this file's own per-call dedup Set
// (cooledThisCall) — not the source of truth for cooldown state itself,
// which now lives in providerCooldown.js.
const cooldownId = (provider, keyIndex) => `${provider}-${keyIndex}`;

const getEffectiveModels = async (providerId, tier = 'quality', baseURL, apiKey) => {
  if (isRedisStateEnabled()) {
    try {
      const discovered = await discoverModelsRedisBacked(providerId, baseURL, apiKey);
      const source = discovered || (await getModelsFromRedisCache(providerId));
      if (source?.length > 0) {
        if (tier === 'fast') {
          const fastIds = FAST_MODEL_PRIORITY[providerId] || [];
          const matched = source.filter(id => fastIds.includes(id));
          if (matched.length > 0) return matched;
        }
        return source;
      }
    } catch (err) {
      console.warn(`[MultiProvider] Redis-backed model discovery failed, falling back to static list for this call:`, err.message);
      reportDegradedMode('multiprovider-redis-unavailable', { operation: 'getEffectiveModels', providerId, error: err.message });
    }
    // Redis enabled but no cached/discovered list available yet this
    // cycle (cache miss + lost the lock race, or discovery itself
    // failed) — fall through to the static list, same as the original
    // pre-Redis "discovery hasn't finished yet" behavior.
    return getModelPriorityForTier(providerId, tier) || PROVIDER_REGISTRY[providerId]?.models || [];
  }

  // Kill switch off — original in-memory path, including its own
  // fire-and-forget discovery kickoff (triggered from getPools() below,
  // unchanged from the original design).
  return getEffectiveModelsInMemory(providerId, tier);
};

const getPools = () => {
  if (!_pools) {
    _pools = {};
    let total = 0;

    for (const id of PROVIDER_ORDER) {
      _pools[id] = buildKeyPool(PROVIDER_REGISTRY[id]);
      total += _pools[id].length;

      const firstKey = _pools[id][0];
      if (firstKey && !isRedisStateEnabled()) {
        // Only kick off the old fire-and-forget in-memory discovery when
        // the Redis path is disabled — the Redis-backed path performs
        // discovery lazily, lock-guarded, at the point getEffectiveModels
        // is actually called (see discoverModelsRedisBacked above), not
        // eagerly at pool-construction time.
        _discoverProviderModelsInMemory(id, PROVIDER_REGISTRY[id].baseURL, firstKey.key)
          .catch((err) => console.warn(`[MultiProvider] ${id} discovery kickoff failed: ${err.message}`));
      }
    }

    if (total === 0) {
      console.error('[MultiProvider] CRITICAL: No API keys found for any provider!');
    } else {
      console.log(`[MultiProvider] Ready — ${total} total key(s) across ${PROVIDER_ORDER.length} providers: Cerebras, Groq, Mistral, OpenRouter (Redis-backed state: ${isRedisStateEnabled() ? 'enabled' : 'disabled'})`);
    }
  }
  return _pools;
};

// ──────────────────────────────────────────
// VISION HELPER
// Attaches image parts to the LAST message in the array (assumed to be
// the current user turn), but only when the model actually receiving
// this request is vision-capable. History/system messages are always
// left as plain strings — we only ever have image bytes for the
// current turn anyway (see chat.js).
// ──────────────────────────────────────────
const buildMessagesForProvider = (messages, images, isVisionCapable) => {
  if (!isVisionCapable || !images?.length || messages.length === 0) return messages;

  const lastIdx = messages.length - 1;
  const last    = messages[lastIdx];
  if (!last || last.role !== 'user' || typeof last.content !== 'string') return messages;

  const content = [
    { type: 'text', text: last.content || '' },
    ...images.map(img => ({ type: 'image_url', image_url: { url: img.url } })),
  ];

  return [...messages.slice(0, lastIdx), { ...last, content }];
};

// IMPL-H8-01: callProvider/streamProvider now accept `providerId` (threaded
// through from the caller's queue entry) and throw ProviderCallError with
// the real structured status/parsedBody/networkErrorCode instead of a
// bare Error carrying only a formatted message string. Network-level
// failures (fetch itself throwing, before any HTTP response exists) are
// now distinguished from HTTP-level failures (a response came back with
// !res.ok) — the original code did not make this distinction explicitly,
// relying on whatever shape fetch's own thrown error happened to have.
const callProvider = async ({
  baseURL, apiKey, model, extraHeaders, providerId,
  messages, systemPrompt, temperature, maxTokens, images,
}) => {
  const isVisionCapable = VISION_CAPABLE_MODELS.has(model);
  const finalMessages   = buildMessagesForProvider(messages, images, isVisionCapable);

  const body = {
    model,
    max_tokens:  maxTokens   ?? 1024,
    temperature: temperature ?? 0.7,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...finalMessages,
    ],
  };

  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new ProviderCallError(networkErr.message, {
      providerId,
      networkErrorCode: networkErr.cause?.code || null,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    let parsedBody = null;
    try { parsedBody = JSON.parse(errText); } catch { /* not JSON — parsedBody stays null, classified conservatively */ }
    throw new ProviderCallError(`HTTP ${res.status}: ${errText}`, { status: res.status, providerId, parsedBody });
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const usage   = data.usage ?? {};
  return { content, usage, used_vision: isVisionCapable && !!images?.length };
};

const streamProvider = async ({
  baseURL, apiKey, model, extraHeaders, providerId,
  messages, systemPrompt, temperature, maxTokens, images,
  onToken, onComplete,
}) => {
  const isVisionCapable = VISION_CAPABLE_MODELS.has(model);
  const finalMessages   = buildMessagesForProvider(messages, images, isVisionCapable);

  const body = {
    model,
    max_tokens:  maxTokens   ?? 1024,
    temperature: temperature ?? 0.7,
    stream:      true,
    // Required by OpenAI-compatible providers (Groq/Cerebras/Mistral/
    // OpenRouter) to emit a final SSE chunk containing `usage` — without
    // this, streamed responses have no token accounting at all (see
    // onComplete below, which previously always sent tokens_in/tokens_out
    // as undefined).
    stream_options: { include_usage: true },
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...finalMessages,
    ],
  };

  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new ProviderCallError(networkErr.message, {
      providerId,
      networkErrorCode: networkErr.cause?.code || null,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    let parsedBody = null;
    try { parsedBody = JSON.parse(errText); } catch { /* not JSON — parsedBody stays null */ }
    throw new ProviderCallError(`HTTP ${res.status}: ${errText}`, { status: res.status, providerId, parsedBody });
  }

  const reader      = res.body.getReader();
  const decoder     = new TextDecoder();
  let   fullContent = '';
  let   buffer      = '';
  // Populated from the final SSE chunk's `usage` field (present because
  // of stream_options.include_usage above). Providers emit this on the
  // last chunk, typically alongside an empty `choices` array.
  let   usage       = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const token  = parsed.choices?.[0]?.delta?.content;
        if (token) {
          fullContent += token;
          onToken?.(token);
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch {
        // Malformed SSE chunk — skip silently (upstream provider framing
        // issue, not something the caller can act on).
      }
    }
  }

  onComplete?.(fullContent, {
    used_vision:  isVisionCapable && !!images?.length,
    tokens_in:    usage?.prompt_tokens     || 0,
    tokens_out:   usage?.completion_tokens || 0,
    tokens_total: usage?.total_tokens      || 0,
  });
};

// IMPL-MULTIPROVIDER-01: buildProviderQueue is now async — it awaits the
// (now-async) cooldown check per key and the (now-async) effective-models
// lookup per provider, both of which may involve a Redis round trip.
// Every caller below (callWithFallback, streamWithFallback) awaits this.
const buildProviderQueue = async (tier = 'quality') => {
  const pools = getPools();
  const queue = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];

    const coolingFlags = await Promise.all(keyPool.map(k => isKeyCooling(k.provider, k.index)));
    const healthy = keyPool.filter((_, i) => !coolingFlags[i]);

    if (healthy.length === 0) continue;

    const firstHealthyKey = healthy[0];
    const models = await getEffectiveModels(providerId, tier, def.baseURL, firstHealthyKey.key);

    for (const model of models) {
      for (const keyEntry of healthy) {
        queue.push({
          providerId,
          model,
          keyEntry,
          baseURL:      def.baseURL,
          extraHeaders: def.extraHeaders ?? {},
          // Debug-only label with key index — used for logs and cooldown
          // bookkeeping. NOT what gets persisted as model_used anymore
          // (audit §5.3) — see cleanModelUsed below.
          debugName:    `${providerId}-${model}-key${keyEntry.index}`,
        });
      }
    }
  }

  return queue;
};

const cleanModelUsed = (providerId, model) => `${providerId}:${model}`;

export const callWithFallback = async ({ images, ...opts }) => {
  const queue = await buildProviderQueue(opts.tier || 'quality');

  if (queue.length === 0) {
    throw new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter');
  }

  let lastError;
  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Trying ${provider.debugName}...`);
      recordUsageAttempt(provider.providerId, provider.keyEntry.index); // fire-and-forget, observe-only

      const result = await callProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
        providerId:   provider.providerId,
        messages:     opts.messages,
        systemPrompt: opts.systemPrompt,
        temperature:  opts.temperature,
        maxTokens:    opts.maxTokens,
        images,
      });

      console.log(`[MultiProvider] ✓ Success via ${provider.debugName}${result.used_vision ? ' (vision)' : ''}`);
      return {
        content:      result.content,
        tokens_in:    result.usage?.prompt_tokens     || 0,
        tokens_out:   result.usage?.completion_tokens || 0,
        tokens_total: result.usage?.total_tokens       || 0,
        model_used:   cleanModelUsed(provider.providerId, provider.model),
        used_vision:  result.used_vision,
      };

    } catch (err) {
      lastError = err;
      console.warn(`[MultiProvider] ✗ ${provider.debugName} failed: ${err.message}`);

      // IMPL-H8-01: structured classification replaces the old
      // isRetryableError/shouldCoolKey string-matching — see
      // utils/providerErrors.js for the full taxonomy and reasoning.
      const category = classifyProviderError(err);
      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);

      if (category === 'KEY_FAULT') {
        if (!cooledThisCall.has(cid)) {
          await markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
          cooledThisCall.add(cid);
        }
      } else if (category === 'PROVIDER_TRANSIENT') {
        // Deliberately do NOT cool the key — this failure is provider-wide
        // or network-related, not attributable to this specific key.
        recordProviderTransient(provider.providerId);
      } else if (category === 'BAD_MODEL') {
        // Deliberately do NOT cool the key — the model reference is what's
        // wrong, not the key. Evict it so other requests/instances stop
        // hitting the same known-dead model.
        evictModelFromRedisCache(provider.providerId, provider.model).catch(() => {});
      } else {
        // NON_RETRYABLE — likely a genuine application bug in how this
        // request was constructed. Report to Sentry (see file header for
        // why this must happen HERE, not left to bubble up) and abort the
        // fallback chain immediately rather than wasting time retrying
        // the same malformed payload against every remaining provider.
        try {
          Sentry.captureException(err, {
            tags: { source: 'multiProvider', provider: provider.providerId, model: provider.model, category },
          });
        } catch { /* Sentry must never be able to break the call path */ }
        throw err;
      }
      // KEY_FAULT / PROVIDER_TRANSIENT / BAD_MODEL all fall through to the
      // next queue entry.
    }
  }

  console.error('[MultiProvider] All providers exhausted:', lastError?.message);
  try {
    Sentry.captureException(lastError || new Error('ALL_PROVIDERS_FAILED'), {
      tags: { source: 'multiProvider', reason: 'all_providers_failed' },
    });
  } catch { /* Sentry must never be able to break the call path */ }
  throw new Error(`ALL_PROVIDERS_FAILED: ${lastError?.message}`);
};

export const callWithFallbackGroq = async ({
  messages, systemPrompt, temperature, maxTokens, tier = 'quality',
  workspaceId = null, userId = null, sourceJob = null, images = undefined,
}) => {
  const result = await callWithFallback({ messages, systemPrompt, temperature, maxTokens, tier, images });

  if (workspaceId && userId) {
    const { recordGroqUsage } = await import('./tokenTracker.js');
    await recordGroqUsage({
      workspaceId, userId, model: result.model_used, tier,
      tokensIn: result.tokens_in, tokensOut: result.tokens_out, sourceJob,
    });
  }

  return result;
};

export const streamWithFallback = async ({
  messages, systemPrompt, temperature, maxTokens,
  onToken, onComplete, onError, images = undefined,
}) => {
  const queue = await buildProviderQueue();

  if (queue.length === 0) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter'));
    return;
  }

  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Streaming via ${provider.debugName}`);
      recordUsageAttempt(provider.providerId, provider.keyEntry.index); // fire-and-forget, observe-only

      await streamProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
        providerId:   provider.providerId,
        messages,
        systemPrompt,
        temperature,
        maxTokens,
        images,
        onToken,
        onComplete: (content, meta) =>
          onComplete?.(content, {
            ...meta,
            model_used: cleanModelUsed(provider.providerId, provider.model),
          }),
      });

      return;

    } catch (err) {
      console.warn(`[MultiProvider] Stream failed for ${provider.debugName}: ${err.message}`);

      const category = classifyProviderError(err);
      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);

      if (category === 'KEY_FAULT') {
        if (!cooledThisCall.has(cid)) {
          await markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
          cooledThisCall.add(cid);
        }
      } else if (category === 'PROVIDER_TRANSIENT') {
        recordProviderTransient(provider.providerId);
      } else if (category === 'BAD_MODEL') {
        evictModelFromRedisCache(provider.providerId, provider.model).catch(() => {});
      } else {
        try {
          Sentry.captureException(err, {
            tags: { source: 'multiProvider-stream', provider: provider.providerId, model: provider.model, category },
          });
        } catch { /* Sentry must never be able to break the call path */ }
        onError?.(err);
        return;
      }
    }
  }

  const finalErr = new Error('ALL_PROVIDERS_FAILED: All providers and keys exhausted');
  try {
    Sentry.captureException(finalErr, { tags: { source: 'multiProvider-stream', reason: 'all_providers_failed' } });
  } catch { /* Sentry must never be able to break the call path */ }
  onError?.(finalErr);
};

// IMPL-MULTIPROVIDER-01: reads from Redis (or the in-memory fallback,
// depending on the kill switch) instead of only ever reflecting this
// one process's local view. Return shape is unchanged — this is a
// data-source change, not a contract change. Not currently exposed via
// any HTTP route in this codebase, so there is no external
// backward-compatibility concern.
export const getProviderStatus = async () => {
  const pools  = getPools();
  const status = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];

    for (const k of keyPool) {
      let cooling = false;
      let failCount = 0;
      let failedAt = null;

      if (isRedisStateEnabled()) {
        try {
          const state = await getCooldownState(k.provider, k.index);
          cooling   = !!state;
          failCount = state ? parseInt(state.failCount || '0', 10) : 0;
          failedAt  = state?.failedAt ? new Date(parseInt(state.failedAt, 10)).toISOString() : null;
        } catch {
          cooling = isKeyCoolingInMemorySync(k.provider, k.index);
        }
      } else {
        cooling = isKeyCoolingInMemorySync(k.provider, k.index);
        const cd = getInMemoryCooldownState(k.provider, k.index);
        failCount = cd?.failCount || 0;
        failedAt  = cd?.failedAt ? new Date(cd.failedAt).toISOString() : null;
      }

      status.push({
        provider:      providerId,
        models_static: def.models,
        key_index:     k.index,
        status:        cooling ? 'cooling' : 'healthy',
        fail_count:    failCount,
        cooling_since: failedAt,
        state_source:  isRedisStateEnabled() ? 'redis' : 'in-memory',
      });
    }
  }

  return status;
};

export default { callWithFallback, callWithFallbackGroq, streamWithFallback, getProviderStatus };
