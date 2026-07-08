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
// Failed keys cool down for 1 hour (in-memory).
//
// MODEL SELECTION STRATEGY:
//   - Mistral: uses provider-managed alias IDs (mistral-small-latest etc.) that
//     Mistral automatically keeps pointing to their current best model — no manual
//     updates needed.
//   - Groq & Cerebras: dynamic model discovery via GET /v1/models at startup,
//     ranked by MODEL_PRIORITY. Unknown new models are appended automatically.
//     Falls back gracefully to the static priority list if discovery fails.
//
// NOTE: groq.js is no longer imported. This file handles all
// provider calls directly via fetch against each provider's
// OpenAI-compatible endpoint.
// ============================================================

// ──────────────────────────────────────────
// MODEL PRIORITY LISTS (static fallback + ranking template)
//
// For Groq & Cerebras: these lists drive the ranking of dynamically
// discovered models. Models listed here that are found at /v1/models
// are used first (in order). Newly discovered models not in this list
// are appended at the end as additional fallbacks.
//
// For Mistral: used as-is. The alias IDs (e.g. mistral-small-latest)
// are provider-managed and always resolve to Mistral's current
// recommended version — no /v1/models discovery needed.
// ──────────────────────────────────────────

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
    'meta-llama/llama-3.3-70b-instruct:free', // Best default free model
    'google/gemma-4-31b-it:free',             // Vision + reasoning
    'nousresearch/hermes-3-405b:free',        // Highest intelligence
  ],
};

// FAST tier — cheaper/smaller models for high-volume, low-stakes calls
// (state-delta scoring, quick classification, etc.). Falls back to the
// quality-tier list per provider if a provider has no fast-tier entry.
const FAST_MODEL_PRIORITY = {
  cerebras: MODEL_PRIORITY.cerebras,           // Cerebras is already fast; no separate tier
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
// NON-CHAT MODEL FILTER
// Patterns matching model IDs that are NOT chat/text-generation models.
// Used during dynamic discovery to exclude embeddings, speech, guard, etc.
// ──────────────────────────────────────────
const NON_CHAT_PATTERN = /whisper|embed|guard|tts|moderation|transcribe|ocr|safeguard|vision-only/i;

// ──────────────────────────────────────────
// PROVIDER REGISTRY
// `models` = static fallback list used when dynamic discovery is unavailable.
//            Also serves as the ranking template for discovery results.
// ──────────────────────────────────────────
const PROVIDER_REGISTRY = {
  cerebras: {
    name:      'cerebras',
    baseURL:   'https://api.cerebras.ai/v1',
    // gpt-oss-120b is the current production model on Cerebras (June 2026).
    // Legacy llama models kept as fallbacks in case a dedicated endpoint still exposes them.
    models:    MODEL_PRIORITY.cerebras,
    envPrefix: 'CEREBRAS_API_KEY',
    maxKeys:   5,
  },
  groq: {
    name:      'groq',
    baseURL:   'https://api.groq.com/openai/v1',
    // llama-4-scout: latest Groq production model; also vision-capable (multimodal).
    // llama-3.3-70b-versatile + llama-3.1-8b-instant remain Groq production models.
    models:    MODEL_PRIORITY.groq,
    envPrefix: 'GROQ_API_KEY',
    maxKeys:   10,
  },
  mistral: {
    name:      'mistral',
    baseURL:   'https://api.mistral.ai/v1',
    // Provider-managed aliases: Mistral keeps these pointing to the current recommended
    // version. mistral-small-2506 (Small 3.2) and ministral-8b-2410 are now legacy.
    models:    MODEL_PRIORITY.mistral,
    envPrefix: 'MISTRAL_API_KEY',
    maxKeys:   5,
  },
  openrouter: {
    name:      'openrouter',
    baseURL:   'https://openrouter.ai/api/v1',
    // Dynamic discovery via /v1/models. Static list here is the ranking template
    // and fallback in case discovery fails.
    models:    MODEL_PRIORITY.openrouter,
    envPrefix: 'OPENROUTER_API_KEY',
    maxKeys:   5,
    // OpenRouter recommends sending Referer + X-Title headers for attribution/ranking.
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_REFERER ?? 'https://localhost',
      'X-Title':      process.env.OPENROUTER_APP_TITLE ?? 'MultiProvider',
    },
  },
};

// Attempt order: highest free TPM first; OpenRouter is paid so it goes last
const PROVIDER_ORDER = ['cerebras', 'groq', 'mistral', 'openrouter'];

// ──────────────────────────────────────────
// KEY POOL BUILDER
// Reads PROVIDER_API_KEY_1 … _N from env.
// Falls back to PROVIDER_API_KEY (no suffix).
// ──────────────────────────────────────────
const buildKeyPool = (providerDef) => {
  const { name, envPrefix, maxKeys } = providerDef;
  const keys = [];

  for (let i = 1; i <= maxKeys; i++) {
    const key = process.env[`${envPrefix}_${i}`];
    if (key?.trim()) keys.push({ key: key.trim(), index: i, provider: name });
  }

  // Single-key fallback (no suffix)
  if (keys.length === 0 && process.env[envPrefix]?.trim()) {
    keys.push({ key: process.env[envPrefix].trim(), index: 0, provider: name });
  }

  if (keys.length > 0) {
    console.log(`[MultiProvider] ${name}: ${keys.length} key(s) loaded`);
  }

  return keys;
};

// ──────────────────────────────────────────
// COOLDOWN STATE (in-memory)
// Keyed by `providerName-keyIndex`
// ──────────────────────────────────────────
const KEY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const keyCooldowns    = new Map();

const cooldownId = (provider, keyIndex) => `${provider}-${keyIndex}`;

const markKeyFailed = (provider, keyIndex) => {
  const id       = cooldownId(provider, keyIndex);
  const existing = keyCooldowns.get(id) || { failCount: 0 };
  const next     = { failedAt: Date.now(), failCount: existing.failCount + 1 };
  keyCooldowns.set(id, next);
  console.warn(`[MultiProvider] ${provider} key #${keyIndex} cooling down (fail #${next.failCount}) — retrying in 1h`);
};

const isKeyCooling = (provider, keyIndex) => {
  const id = cooldownId(provider, keyIndex);
  const cd = keyCooldowns.get(id);
  if (!cd) return false;
  if (Date.now() - cd.failedAt >= KEY_COOLDOWN_MS) {
    keyCooldowns.delete(id);
    console.log(`[MultiProvider] ${provider} key #${keyIndex} cooldown expired — back in rotation`);
    return false;
  }
  return true;
};

// ──────────────────────────────────────────
// ERROR CLASSIFICATION
// Provider-agnostic — matches HTTP status codes
// and common error strings from all three APIs.
// ──────────────────────────────────────────
const RATE_LIMIT_SIGNALS = ['rate_limit', 'rate limit', '429', 'too many requests', 'quota exceeded'];
const AUTH_ERROR_SIGNALS = ['401', 'unauthorized', 'invalid api key', 'invalid_api_key', 'authentication'];
const UNAVAIL_SIGNALS    = ['503', '502', '500', 'unavailable', 'overloaded', 'server error'];
const NETWORK_SIGNALS    = ['econnrefused', 'etimedout', 'enotfound', 'socket hang up', 'fetch failed'];

const matchesAny = (msg, signals) =>
  signals.some(s => msg?.toLowerCase().includes(s.toLowerCase()));

const isRetryableError = (err) =>
  matchesAny(err?.message, [
    ...RATE_LIMIT_SIGNALS, ...AUTH_ERROR_SIGNALS,
    ...UNAVAIL_SIGNALS,    ...NETWORK_SIGNALS,
  ]);

const shouldCoolKey = (err) =>
  matchesAny(err?.message, [...RATE_LIMIT_SIGNALS, ...AUTH_ERROR_SIGNALS, ...UNAVAIL_SIGNALS]);

// ──────────────────────────────────────────
// LAZY KEY POOLS (initialized on first use)
// ──────────────────────────────────────────
let _pools = null;

// ──────────────────────────────────────────
// DYNAMIC MODEL DISCOVERY
//
// Fetches /v1/models once per provider at startup (fire-and-forget).
// Results are cached indefinitely for the process lifetime — restart
// to re-discover after a provider adds/removes models.
//
// Mistral is excluded from discovery because it uses provider-managed
// alias IDs (e.g. mistral-small-latest) that already auto-track the
// current recommended version.
// ──────────────────────────────────────────
const _discoveredModels = {};   // { providerId: string[] }
const _discoveryDone    = {};   // { providerId: boolean }

const _discoverProviderModels = async (providerId, baseURL, apiKey) => {
  if (providerId === 'mistral') {
    // Aliases are provider-managed — no discovery needed.
    _discoveredModels[providerId] = MODEL_PRIORITY.mistral;
    _discoveryDone[providerId] = true;
    return;
  }

  try {
    const res = await fetch(`${baseURL}/models`, {
      headers:  { Authorization: `Bearer ${apiKey}` },
      signal:   AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json   = await res.json();
    const allIds = (json.data || []).map(m => m.id).filter(Boolean);

    // Separate into known-priority models and newly discovered unknown models.
    const priorityList = MODEL_PRIORITY[providerId] || [];
    const known   = priorityList.filter(id => allIds.includes(id));
    const unknown = allIds.filter(id =>
      !priorityList.includes(id) && !NON_CHAT_PATTERN.test(id)
    ).sort();

    const ranked = [...known, ...unknown];
    if (ranked.length > 0) {
      _discoveredModels[providerId] = ranked;
      console.log(`[MultiProvider] ${providerId}: discovered ${ranked.length} chat model(s) — using dynamic list`);
    } else {
      console.warn(`[MultiProvider] ${providerId}: discovery returned 0 usable models — falling back to static list`);
      _discoveredModels[providerId] = priorityList;
    }
  } catch (err) {
    console.warn(`[MultiProvider] ${providerId}: model discovery failed (${err.message}) — using static priority list`);
    _discoveredModels[providerId] = MODEL_PRIORITY[providerId] || [];
  }

  _discoveryDone[providerId] = true;
};

/**
 * Returns the effective model list for a provider.
 * Uses dynamically discovered models when available; falls back to MODEL_PRIORITY.
 */
const getEffectiveModels = (providerId, tier = 'quality') => {
  if (_discoveryDone[providerId] && _discoveredModels[providerId]?.length > 0) {
    // Discovered models are already ranked by the quality-tier priority
    // template. For fast tier, prefer any discovered model that also
    // appears in the fast-tier static list, otherwise fall back to the
    // full discovered list (still resilient, just not size-optimized).
    if (tier === 'fast') {
      const fastIds = FAST_MODEL_PRIORITY[providerId] || [];
      const matched = _discoveredModels[providerId].filter(id => fastIds.includes(id));
      if (matched.length > 0) return matched;
    }
    return _discoveredModels[providerId];
  }
  return getModelPriorityForTier(providerId, tier) || PROVIDER_REGISTRY[providerId]?.models || [];
};

const getPools = () => {
  if (!_pools) {
    _pools = {};
    let total = 0;

    for (const id of PROVIDER_ORDER) {
      _pools[id] = buildKeyPool(PROVIDER_REGISTRY[id]);
      total += _pools[id].length;

      // Kick off dynamic model discovery in the background (fire-and-forget).
      // The first few requests will use the static MODEL_PRIORITY list; once
      // discovery completes, getEffectiveModels() returns the live list.
      const firstKey = _pools[id][0];
      if (firstKey) {
        _discoverProviderModels(id, PROVIDER_REGISTRY[id].baseURL, firstKey.key)
          .catch(() => {}); // errors are already logged inside _discoverProviderModels
      }
    }

    if (total === 0) {
      console.error('[MultiProvider] CRITICAL: No API keys found for any provider!');
    } else {
      console.log(`[MultiProvider] Ready — ${total} total key(s) across ${PROVIDER_ORDER.length} providers: Cerebras, Groq, Mistral, OpenRouter (model discovery warming up)`);
    }
  }
  return _pools;
};

// ──────────────────────────────────────────
// GENERIC OpenAI-COMPATIBLE CALLER (non-streaming)
// Works with Cerebras, Groq, and Mistral — all
// expose the same /chat/completions endpoint shape.
// ──────────────────────────────────────────
const callProvider = async ({
  baseURL, apiKey, model, extraHeaders,
  messages, systemPrompt, temperature, maxTokens,
}) => {
  const body = {
    model,
    max_tokens:  maxTokens   ?? 1024,
    temperature: temperature ?? 0.7,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
  };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const usage   = data.usage ?? {};
  return { content, usage };
};

// ──────────────────────────────────────────
// GENERIC OpenAI-COMPATIBLE STREAMER
// Reads SSE chunks and calls onToken per delta.
// ──────────────────────────────────────────
const streamProvider = async ({
  baseURL, apiKey, model, extraHeaders,
  messages, systemPrompt, temperature, maxTokens,
  onToken, onComplete,
}) => {
  const body = {
    model,
    max_tokens:  maxTokens   ?? 1024,
    temperature: temperature ?? 0.7,
    stream:      true,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
  };

  const res = await fetch(`${baseURL}/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const reader      = res.body.getReader();
  const decoder     = new TextDecoder();
  let   fullContent = '';
  let   buffer      = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // hold incomplete line for next chunk

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
      } catch {
        // Malformed SSE chunk — skip silently
      }
    }
  }

  onComplete?.(fullContent, {});
};

// ──────────────────────────────────────────
// PROVIDER QUEUE BUILDER
//
// Order: Cerebras → Groq → Mistral
// Within each provider: models are ordered by getEffectiveModels() —
// either the dynamically discovered + ranked list, or MODEL_PRIORITY fallback.
// Only healthy (non-cooling) keys are included.
// ──────────────────────────────────────────
const buildProviderQueue = (tier = 'quality') => {
  const pools = getPools();
  const queue = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];
    const healthy = keyPool.filter(k => !isKeyCooling(k.provider, k.index));

    if (healthy.length === 0) continue;

    // Use dynamically discovered models when available, otherwise static priority list.
    const models = getEffectiveModels(providerId, tier);

    for (const model of models) {
      for (const keyEntry of healthy) {
        queue.push({
          providerId,
          model,
          keyEntry,
          baseURL:      def.baseURL,
          extraHeaders: def.extraHeaders ?? {},
          name:         `${providerId}-${model}-key${keyEntry.index}`,
        });
      }
    }
  }

  return queue;
};

// ──────────────────────────────────────────
// NON-STREAMING: callWithFallback
// ──────────────────────────────────────────
export const callWithFallback = async (opts) => {
  const queue = buildProviderQueue(opts.tier || 'quality');

  if (queue.length === 0) {
    throw new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter');
  }

  let lastError;
  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Trying ${provider.name}...`);

      const result = await callProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
        messages:     opts.messages,
        systemPrompt: opts.systemPrompt,
        temperature:  opts.temperature,
        maxTokens:    opts.maxTokens,
      });

      console.log(`[MultiProvider] ✓ Success via ${provider.name}`);
      // Normalize to the same shape callGroq() has always returned —
      // every existing caller destructures tokens_in/tokens_out, and
      // until now they were silently getting `undefined` for both.
      return {
        content:      result.content,
        tokens_in:    result.usage?.prompt_tokens     || 0,
        tokens_out:   result.usage?.completion_tokens || 0,
        tokens_total: result.usage?.total_tokens       || 0,
        model_used:   provider.name,
      };

    } catch (err) {
      lastError = err;
      console.warn(`[MultiProvider] ✗ ${provider.name} failed: ${err.message}`);

      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);
      if (shouldCoolKey(err) && !cooledThisCall.has(cid)) {
        markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
        cooledThisCall.add(cid);
      }

      if (!isRetryableError(err)) throw err; // Non-retryable — bail immediately
    }
  }

  console.error('[MultiProvider] All providers exhausted:', lastError?.message);
  throw new Error(`ALL_PROVIDERS_FAILED: ${lastError?.message}`);
};

// ──────────────────────────────────────────
// callWithFallbackGroq — standardized entry point for all LLM calls.
// Wraps callWithFallback and auto-records usage via tokenTracker when
// workspaceId/userId are provided. This is the function every groq-*.js
// business-logic file should call instead of groq-client.js's callGroq().
//
// workspaceId/userId are optional on purpose: a handful of groq-practice.js
// functions (evaluateBuyerStateChange, generatePracticeInterruption) aren't
// invoked by any route currently in scope, and their real call sites may or
// may not have workspace context. Omitting them just means usage isn't
// tracked for that call (logged via console.warn inside tokenTracker), not
// a thrown error — this is intentional fail-open behavior so an unseen
// caller never breaks.
// ──────────────────────────────────────────
export const callWithFallbackGroq = async ({
  messages, systemPrompt, temperature, maxTokens, tier = 'quality',
  workspaceId = null, userId = null, sourceJob = null,
}) => {
  const result = await callWithFallback({ messages, systemPrompt, temperature, maxTokens, tier });

  if (workspaceId && userId) {
    const { recordGroqUsage } = await import('./tokenTracker.js');
    await recordGroqUsage({
      workspaceId, userId, model: result.model_used, tier,
      tokensIn: result.tokens_in, tokensOut: result.tokens_out, sourceJob,
    });
  }

  return result;
};

// ──────────────────────────────────────────
// STREAMING: streamWithFallback
//
// Attempts each provider/key in queue order.
// SSE streams can't switch mid-stream, so if a
// key fails during streaming we fall through to
// the next provider for a fresh stream attempt.
// ──────────────────────────────────────────
export const streamWithFallback = async ({
  messages, systemPrompt, temperature, maxTokens,
  onToken, onComplete, onError,
}) => {
  const queue = buildProviderQueue();

  if (queue.length === 0) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter'));
    return;
  }

  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Streaming via ${provider.name}`);

      await streamProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
        messages,
        systemPrompt,
        temperature,
        maxTokens,
        onToken,
        onComplete: (content, usage) =>
          onComplete?.(content, { ...usage, model_used: provider.name }),
      });

      return; // Stream completed successfully

    } catch (err) {
      console.warn(`[MultiProvider] Stream failed for ${provider.name}: ${err.message}`);

      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);
      if (shouldCoolKey(err) && !cooledThisCall.has(cid)) {
        markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
        cooledThisCall.add(cid);
      }

      if (!isRetryableError(err)) { onError?.(err); return; }
      // Otherwise continue to next provider
    }
  }

  onError?.(new Error('ALL_PROVIDERS_FAILED: All providers and keys exhausted'));
};

// ──────────────────────────────────────────
// UTILITY: Full provider health status
// Useful for /admin/status or debug endpoints.
// ──────────────────────────────────────────
export const getProviderStatus = () => {
  const pools  = getPools();
  const status = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];

    for (const k of keyPool) {
      const id      = cooldownId(k.provider, k.index);
      const cd      = keyCooldowns.get(id);
      const cooling = isKeyCooling(k.provider, k.index);

      status.push({
        provider:         providerId,
        models_static:    def.models,
        models_effective: getEffectiveModels(providerId),
        model_discovery:  _discoveryDone[providerId] ? 'complete' : 'pending',
        key_index:        k.index,
        status:           cooling ? 'cooling' : 'healthy',
        fail_count:       cd?.failCount || 0,
        cooling_until:    cooling
          ? new Date(cd.failedAt + KEY_COOLDOWN_MS).toISOString()
          : null,
      });
    }
  }

  return status;
};

export default { callWithFallback, callWithFallbackGroq, streamWithFallback, getProviderStatus };
