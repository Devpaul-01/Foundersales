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
// ============================================================

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

let _pools = null;

const _discoveredModels = {};
const _discoveryDone    = {};

const _discoverProviderModels = async (providerId, baseURL, apiKey) => {
  if (providerId === 'mistral') {
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

const getEffectiveModels = (providerId, tier = 'quality') => {
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

const getPools = () => {
  if (!_pools) {
    _pools = {};
    let total = 0;

    for (const id of PROVIDER_ORDER) {
      _pools[id] = buildKeyPool(PROVIDER_REGISTRY[id]);
      total += _pools[id].length;

      const firstKey = _pools[id][0];
      if (firstKey) {
        _discoverProviderModels(id, PROVIDER_REGISTRY[id].baseURL, firstKey.key)
          .catch((err) => console.warn(`[MultiProvider] ${id} discovery kickoff failed: ${err.message}`));
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

const callProvider = async ({
  baseURL, apiKey, model, extraHeaders,
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
  return { content, usage, used_vision: isVisionCapable && !!images?.length };
};

const streamProvider = async ({
  baseURL, apiKey, model, extraHeaders,
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
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...finalMessages,
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
      } catch {
        // Malformed SSE chunk — skip silently (upstream provider framing
        // issue, not something the caller can act on).
      }
    }
  }

  onComplete?.(fullContent, { used_vision: isVisionCapable && !!images?.length });
};

const buildProviderQueue = (tier = 'quality') => {
  const pools = getPools();
  const queue = [];

  for (const providerId of PROVIDER_ORDER) {
    const def     = PROVIDER_REGISTRY[providerId];
    const keyPool = pools[providerId];
    const healthy = keyPool.filter(k => !isKeyCooling(k.provider, k.index));

    if (healthy.length === 0) continue;

    const models = getEffectiveModels(providerId, tier);

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
  const queue = buildProviderQueue(opts.tier || 'quality');

  if (queue.length === 0) {
    throw new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter');
  }

  let lastError;
  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Trying ${provider.debugName}...`);

      const result = await callProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
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

      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);
      if (shouldCoolKey(err) && !cooledThisCall.has(cid)) {
        markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
        cooledThisCall.add(cid);
      }

      if (!isRetryableError(err)) throw err;
    }
  }

  console.error('[MultiProvider] All providers exhausted:', lastError?.message);
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
  const queue = buildProviderQueue();

  if (queue.length === 0) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: No healthy keys available across Cerebras, Groq, Mistral, or OpenRouter'));
    return;
  }

  const cooledThisCall = new Set();

  for (const provider of queue) {
    try {
      console.log(`[MultiProvider] Streaming via ${provider.debugName}`);

      await streamProvider({
        baseURL:      provider.baseURL,
        apiKey:       provider.keyEntry.key,
        model:        provider.model,
        extraHeaders: provider.extraHeaders,
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

      const cid = cooldownId(provider.keyEntry.provider, provider.keyEntry.index);
      if (shouldCoolKey(err) && !cooledThisCall.has(cid)) {
        markKeyFailed(provider.keyEntry.provider, provider.keyEntry.index);
        cooledThisCall.add(cid);
      }

      if (!isRetryableError(err)) { onError?.(err); return; }
    }
  }

  onError?.(new Error('ALL_PROVIDERS_FAILED: All providers and keys exhausted'));
};

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
