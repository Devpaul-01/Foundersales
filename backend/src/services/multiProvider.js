// src/services/multiProvider.js
// ============================================================
// MULTI-PROVIDER AI FALLBACK — Cerebras + Groq + Mistral
//
// Provider priority (highest free TPM first):
//   1. Cerebras  (~60K TPM free)  — llama3.1-8b / llama3.3-70b
//   2. Groq      (~30K TPM free)  — llama-3.1-8b-instant / llama-3.3-70b-versatile
//   3. Mistral   (500K TPM free*) — open-mistral-7b / open-mixtral-8x7b
//      *Mistral free tier may use your prompts for training.
//
// Multi-key support per provider (add real keys from separate accounts):
//   CEREBRAS_API_KEY_1 … CEREBRAS_API_KEY_5
//   GROQ_API_KEY_1     … GROQ_API_KEY_10
//   MISTRAL_API_KEY_1  … MISTRAL_API_KEY_5
//   (single-key fallback: CEREBRAS_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY)
//
// All three use OpenAI-compatible APIs — no separate SDKs needed.
// Failed keys cool down for 1 hour (in-memory).
//
// NOTE: groq.js is no longer imported. This file handles all
// provider calls directly via fetch against each provider's
// OpenAI-compatible endpoint.
// ============================================================

// ──────────────────────────────────────────
// PROVIDER REGISTRY
// ──────────────────────────────────────────
const PROVIDER_REGISTRY = {
  cerebras: {
    name:      'cerebras',
    baseURL:   'https://api.cerebras.ai/v1',
    models:    ['llama-3.1-8b', 'llama-3.3-70b'],  // fixed: hyphens not dots
    envPrefix: 'CEREBRAS_API_KEY',
    maxKeys:   5,
  },
  groq: {
    name:      'groq',
    baseURL:   'https://api.groq.com/openai/v1',
    // Updated to llama-3.1-8b-instant as primary — highest free TPM on Groq
    models:    ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    envPrefix: 'GROQ_API_KEY',
    maxKeys:   10,
  },
  mistral: {
    name:      'mistral',
    baseURL:   'https://api.mistral.ai/v1',
    models:    ['mistral-small-2506', 'ministral-8b-2410'],
    envPrefix: 'MISTRAL_API_KEY',
    maxKeys:   5,
  },
};

// Attempt order: highest free TPM first
const PROVIDER_ORDER = ['cerebras', 'groq', 'mistral'];

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

const getPools = () => {
  if (!_pools) {
    _pools = {};
    let total = 0;

    for (const id of PROVIDER_ORDER) {
      _pools[id] = buildKeyPool(PROVIDER_REGISTRY[id]);
      total += _pools[id].length;
    }

    if (total === 0) {
      console.error('[MultiProvider] CRITICAL: No API keys found for any provider!');
    } else {
      console.log(`[MultiProvider] Ready — ${total} total key(s) across ${PROVIDER_ORDER.length} providers`);
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
  baseURL, apiKey, model,
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
  baseURL, apiKey, model,
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
// Within each provider: primary model first, then fallback.
// Only healthy (non-cooling) keys are included.
// ──────────────────────────────────────────
const buildProviderQueue = () => {
  const pools = getPools();
  const queue = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];
    const healthy = keyPool.filter(k => !isKeyCooling(k.provider, k.index));

    if (healthy.length === 0) continue;

    for (const model of def.models) {
      for (const keyEntry of healthy) {
        queue.push({
          providerId,
          model,
          keyEntry,
          baseURL: def.baseURL,
          name:    `${providerId}-${model}-key${keyEntry.index}`,
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
  const queue = buildProviderQueue();

  if (queue.length === 0) {
    throw new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, or Mistral');
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
        messages:     opts.messages,
        systemPrompt: opts.systemPrompt,
        temperature:  opts.temperature,
        maxTokens:    opts.maxTokens,
      });

      console.log(`[MultiProvider] ✓ Success via ${provider.name}`);
      return { ...result, model_used: provider.name };

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
    onError?.(new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, or Mistral'));
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
        provider:      providerId,
        models:        def.models,
        key_index:     k.index,
        status:        cooling ? 'cooling' : 'healthy',
        fail_count:    cd?.failCount || 0,
        cooling_until: cooling
          ? new Date(cd.failedAt + KEY_COOLDOWN_MS).toISOString()
          : null,
      });
    }
  }

  return status;
};

export default { callWithFallback, streamWithFallback, getProviderStatus };
