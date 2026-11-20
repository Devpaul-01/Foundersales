// ============================================================
// services/multiProvider.js
//
// REWRITE (feat/llm-gateway-provider): this file previously maintained
// its own multi-provider fallback chain across Cerebras, Groq, Mistral
// and OpenRouter directly — multi-key pools per provider, Redis-backed
// per-key cooldown, dynamic model discovery with a lock-guarded cache,
// and a hand-rolled queue that tried every (provider x model x key)
// combination in priority order.
//
// All AI chat traffic now goes through a single self-hosted gateway
// (github.com/Devpaul-01/llm-gateway) instead. The gateway is itself an
// OpenAI-compatible multi-provider router: it already does model-alias
// resolution, per-request `fallback_models` chaining, and upstream key
// rotation/cooldown server-side. Reimplementing that same logic again
// on this side would just be two layers doing the same job — so this
// file now only has to:
//   1. speak the (already OpenAI-compatible) wire format to ONE
//      endpoint, with ONE key,
//   2. keep a cooldown on that one gateway key in case IT starts
//      getting rejected (revoked/rotated key, gateway auth misconfig),
//      since that's a failure mode the gateway itself can't self-heal,
//   3. preserve the exact external contract every caller in this
//      codebase already depends on (callWithFallback,
//      callWithFallbackGroq, streamWithFallback, getProviderStatus) so
//      none of those ~20+ call sites need to change.
//
// Model discovery, per-provider health counters, and vision-model
// detection via a hardcoded provider+model list are gone — the gateway
// decides what "openai/gpt-oss-120b" or "meta-llama/llama-4-scout-..."
// actually resolve to, including its own fallback behavior, so this
// file no longer needs to know provider internals at all.
//
// Error classification (KEY_FAULT vs PROVIDER_TRANSIENT vs BAD_MODEL vs
// NON_RETRYABLE) still goes through utils/providerErrors.js — see that
// file for the taxonomy, and for the admission-limit carve-out added
// alongside this rewrite (a 429 from the gateway can mean "this key is
// bad" OR "daily token budget exceeded" OR "too many concurrent
// requests", distinguished by error.code — only the first should cool
// the key).
// ============================================================

import * as Sentry from '@sentry/node';
import { ProviderCallError, classifyProviderError } from '../utils/providerErrors.js';
import {
  markKeyFailed, isKeyCooling, getCooldownState, isRedisStateEnabled,
  isKeyCoolingInMemorySync, getInMemoryCooldownState,
} from './providerCooldown.js';

// ──────────────────────────────────────────
// GATEWAY CONFIG
//
// GATEWAY_API_KEY is the only required credential — this replaces every
// CEREBRAS_API_KEY_n / GROQ_API_KEY_n / MISTRAL_API_KEY_n /
// OPENROUTER_API_KEY_n that used to live here. GATEWAY_BASE_URL defaults
// to the gateway's own documented /v1 path convention
// (OpenAI-compatible: POST {baseURL}/chat/completions) but is
// overridable per-environment (local gateway instance, staging
// deployment, etc).
// ──────────────────────────────────────────
const PROVIDER_ID    = 'gateway';
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || 'https://llm-gateway.fly.dev/v1').replace(/\/+$/, '');
const GATEWAY_API_KEY  = process.env.GATEWAY_API_KEY || '';

// Primary model + the gateway-side fallback chain requested alongside
// it. These are resolved by the gateway itself (see
// internal/providers/resolve.go in llm-gateway) — bare names like
// "mistral-large-latest" and "meta-llama/llama-3.1-8b-instruct" are the
// gateway's own default priority list, so this mirrors what the
// gateway would already try on its own; sending it explicitly keeps
// that choice visible and overridable from this side without needing a
// gateway redeploy.
const TEXT_MODEL   = process.env.GATEWAY_TEXT_MODEL   || 'openai/gpt-oss-120b';
const TEXT_FALLBACK_MODELS = (process.env.GATEWAY_TEXT_FALLBACK_MODELS || 'mistral-large-latest,meta-llama/llama-3.1-8b-instruct')
  .split(',').map(s => s.trim()).filter(Boolean);

// gpt-oss-120b has no vision input, so an image-bearing request needs a
// genuinely vision-capable model as the PRIMARY `model` — the gateway
// can still fall back from there, but the first attempt has to be able
// to see the image at all. meta-llama/llama-4-scout is the gateway's
// vision-capable alias (see resolve.go); gemini-2.5-flash-lite is a
// second vision-capable option used only as a gateway-side fallback.
const VISION_MODEL  = process.env.GATEWAY_VISION_MODEL  || 'meta-llama/llama-4-scout-17b-16e-instruct';
const VISION_FALLBACK_MODELS = (process.env.GATEWAY_VISION_FALLBACK_MODELS || 'gemini-2.5-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);

const CALL_TIMEOUT_MS         = 90_000; // whole non-streaming request
const STREAM_HEADERS_TIMEOUT_MS = 30_000; // waiting for the response to start
const STREAM_STALL_TIMEOUT_MS   = 45_000; // silence between streamed chunks

// Single conceptual "key index" — kept as 0 rather than removing the
// provider/index-shaped cooldown API entirely, since providerCooldown.js
// is shared with other services (see exa.js) and is already
// provider-name-agnostic; this just means there's exactly one slot to
// cool instead of a pool of them.
const KEY_INDEX = 0;

let warnedMissingKey = false;
const warnIfMisconfigured = () => {
  if (!GATEWAY_API_KEY && !warnedMissingKey) {
    console.error('[MultiProvider] CRITICAL: GATEWAY_API_KEY is not set — all AI calls will fail.');
    warnedMissingKey = true;
  }
};

// ──────────────────────────────────────────
// VISION HELPER
// Attaches image parts to the LAST message in the array (assumed to be
// the current user turn). History/system messages are always left as
// plain strings — we only ever have image bytes for the current turn
// anyway (see chat.js).
// ──────────────────────────────────────────
const buildMessagesForProvider = (messages, images, hasImages) => {
  if (!hasImages || messages.length === 0) return messages;

  const lastIdx = messages.length - 1;
  const last    = messages[lastIdx];
  if (!last || last.role !== 'user' || typeof last.content !== 'string') return messages;

  const content = [
    { type: 'text', text: last.content || '' },
    ...images.map(img => ({ type: 'image_url', image_url: { url: img.url } })),
  ];

  return [...messages.slice(0, lastIdx), { ...last, content }];
};

// A timeout surfaces as a DOMException named TimeoutError/AbortError with no
// `cause.code`, which the classifier would treat as NON_RETRYABLE and abort
// the whole chain. A timed-out or unreadable response is a transient
// connection failure, so give it a code the classifier already treats as such.
const toTransientError = (err) =>
  new ProviderCallError(err.message, {
    providerId: PROVIDER_ID,
    networkErrorCode:
      err.cause?.code ||
      (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'ETIMEDOUT' : 'ECONNRESET'),
  });

const buildRequestBody = ({ messages, systemPrompt, temperature, maxTokens, images, stream }) => {
  const hasImages = !!images?.length;
  const finalMessages = buildMessagesForProvider(messages, images, hasImages);

  return {
    model:           hasImages ? VISION_MODEL : TEXT_MODEL,
    fallback_models: hasImages ? VISION_FALLBACK_MODELS : TEXT_FALLBACK_MODELS,
    max_tokens:  maxTokens   ?? 1024,
    temperature: temperature ?? 0.7,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...finalMessages,
    ],
  };
};

const callProvider = async ({ messages, systemPrompt, temperature, maxTokens, images }) => {
  const hasImages = !!images?.length;
  const body = buildRequestBody({ messages, systemPrompt, temperature, maxTokens, images, stream: false });

  let res;
  try {
    res = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GATEWAY_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (networkErr) {
    throw new ProviderCallError(networkErr.message, {
      providerId: PROVIDER_ID,
      networkErrorCode: networkErr.cause?.code
        || (networkErr.name === 'TimeoutError' || networkErr.name === 'AbortError' ? 'ETIMEDOUT' : null),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    let parsedBody = null;
    try { parsedBody = JSON.parse(errText); } catch { /* not JSON — parsedBody stays null, classified conservatively */ }
    throw new ProviderCallError(`HTTP ${res.status}: ${errText}`, { status: res.status, providerId: PROVIDER_ID, parsedBody });
  }

  let data;
  try {
    data = await res.json();
  } catch (bodyErr) {
    // A 200 whose body can't be read/parsed (connection cut mid-body, or a
    // timeout while reading it) is a transient failure: let the caller retry.
    throw toTransientError(bodyErr);
  }
  const content    = data.choices?.[0]?.message?.content ?? '';
  const usage      = data.usage ?? {};
  // The gateway's own actually-used upstream model/provider, from its
  // `gateway` metadata block (see llm-gateway README) — falls back to
  // the model we requested if that block is ever absent so model_used
  // is never empty.
  const modelUsed  = data.gateway?.model_used || data.model || (hasImages ? VISION_MODEL : TEXT_MODEL);

  return { content, usage, used_vision: hasImages, model_used: modelUsed };
};

const streamProvider = async ({
  messages, systemPrompt, temperature, maxTokens, images,
  onToken, onComplete,
}) => {
  const hasImages = !!images?.length;
  const body = buildRequestBody({ messages, systemPrompt, temperature, maxTokens, images, stream: true });

  // Abort only if the response hasn't STARTED within the headers timeout;
  // cleared as soon as fetch resolves so long streams are not cut off.
  const startController = new AbortController();
  const startTimer = setTimeout(() => startController.abort(), STREAM_HEADERS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GATEWAY_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: startController.signal,
    });
  } catch (networkErr) {
    throw new ProviderCallError(networkErr.message, {
      providerId: PROVIDER_ID,
      networkErrorCode: networkErr.cause?.code
        || (networkErr.name === 'AbortError' || networkErr.name === 'TimeoutError' ? 'ETIMEDOUT' : null),
    });
  } finally {
    clearTimeout(startTimer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    let parsedBody = null;
    try { parsedBody = JSON.parse(errText); } catch { /* not JSON — parsedBody stays null */ }
    throw new ProviderCallError(`HTTP ${res.status}: ${errText}`, { status: res.status, providerId: PROVIDER_ID, parsedBody });
  }

  const reader      = res.body.getReader();
  const decoder     = new TextDecoder();
  let   fullContent = '';
  let   buffer      = '';
  let   usage       = null;
  let   modelUsed   = hasImages ? VISION_MODEL : TEXT_MODEL;

  while (true) {
    // Stall guard: a stream that goes silent mid-reply is cancelled. This is a
    // plain Error (not a ProviderCallError), so it classifies NON_RETRYABLE and
    // ends the call via onError rather than being retried.
    let stallTimer;
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        stallTimer = setTimeout(
          () => reject(new Error(`stream stalled: no data for ${STREAM_STALL_TIMEOUT_MS / 1000}s`)),
          STREAM_STALL_TIMEOUT_MS
        );
      }),
    ]).catch((e) => { reader.cancel().catch(() => {}); throw e; })
      .finally(() => clearTimeout(stallTimer));
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
        if (parsed.gateway?.model_used) {
          modelUsed = parsed.gateway.model_used;
        } else if (parsed.model) {
          modelUsed = parsed.model;
        }
      } catch {
        // Malformed SSE chunk — skip silently (upstream framing issue,
        // not something the caller can act on).
      }
    }
  }

  onComplete?.(fullContent, {
    used_vision:  hasImages,
    tokens_in:    usage?.prompt_tokens     || 0,
    tokens_out:   usage?.completion_tokens || 0,
    tokens_total: usage?.total_tokens      || 0,
    model_used:   modelUsed,
  });
};

export const callWithFallback = async ({ images, ...opts }) => {
  warnIfMisconfigured();

  if (!GATEWAY_API_KEY) {
    throw new Error('ALL_PROVIDERS_FAILED: GATEWAY_API_KEY is not configured');
  }

  if (await isKeyCooling(PROVIDER_ID, KEY_INDEX)) {
    throw new Error('ALL_PROVIDERS_FAILED: gateway key is currently cooling down after a recent auth/rate-limit failure');
  }

  try {
    console.log(`[MultiProvider] Calling gateway (${images?.length ? 'vision' : 'text'})...`);

    const result = await callProvider({
      messages:     opts.messages,
      systemPrompt: opts.systemPrompt,
      temperature:  opts.temperature,
      maxTokens:    opts.maxTokens,
      images,
    });

    console.log(`[MultiProvider] ✓ Success via gateway${result.used_vision ? ' (vision)' : ''} — upstream model: ${result.model_used}`);
    return {
      content:      result.content,
      tokens_in:    result.usage?.prompt_tokens     || 0,
      tokens_out:   result.usage?.completion_tokens || 0,
      tokens_total: result.usage?.total_tokens       || 0,
      model_used:   result.model_used,
      used_vision:  result.used_vision,
    };

  } catch (err) {
    console.warn(`[MultiProvider] ✗ gateway call failed: ${err.message}`);

    const category = classifyProviderError(err);

    if (category === 'KEY_FAULT') {
      // A genuine bad/rejected gateway credential — see
      // providerErrors.js's ADMISSION_LIMIT_CODES carve-out for why a
      // 429 doesn't always land here (daily budget / concurrency caps
      // land in PROVIDER_TRANSIENT instead, since those aren't this
      // key's fault and will resolve on their own).
      await markKeyFailed(PROVIDER_ID, KEY_INDEX);
    } else if (category === 'PROVIDER_TRANSIENT' || category === 'BAD_MODEL') {
      // Nothing further to do: there is no second provider/key to fall
      // back to — the gateway itself is responsible for its own
      // upstream fallback_models chain. These categories are not
      // reported to Sentry (expected, routinely-handled conditions).
    } else {
      // NON_RETRYABLE — likely a genuine application bug in how this
      // request was constructed.
      try {
        Sentry.captureException(err, {
          tags: { source: 'multiProvider', provider: PROVIDER_ID, category },
        });
      } catch { /* Sentry must never be able to break the call path */ }
    }

    try {
      Sentry.captureException(err, {
        tags: { source: 'multiProvider', reason: 'gateway_call_failed', category },
      });
    } catch { /* Sentry must never be able to break the call path */ }
    throw new Error(`ALL_PROVIDERS_FAILED: ${err.message}`);
  }
};

export const callWithFallbackGroq = async ({
  messages, systemPrompt, temperature, maxTokens, tier = 'quality',
  workspaceId = null, userId = null, sourceJob = null, images = undefined,
}) => {
  // `tier` is accepted for call-site compatibility but is no longer
  // acted on here — the gateway resolves its own model chain. If
  // tier-based routing (e.g. a cheaper model for "fast") is wanted
  // again later, it belongs as a second GATEWAY_*_MODEL pair selected
  // on `tier` here, not as a reintroduction of the old per-provider
  // pool.
  const result = await callWithFallback({ messages, systemPrompt, temperature, maxTokens, images });

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
  warnIfMisconfigured();

  if (!GATEWAY_API_KEY) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: GATEWAY_API_KEY is not configured'));
    return;
  }

  if (await isKeyCooling(PROVIDER_ID, KEY_INDEX)) {
    onError?.(new Error('ALL_PROVIDERS_FAILED: gateway key is currently cooling down after a recent auth/rate-limit failure'));
    return;
  }

  try {
    console.log(`[MultiProvider] Streaming via gateway (${images?.length ? 'vision' : 'text'})...`);

    await streamProvider({
      messages, systemPrompt, temperature, maxTokens, images,
      onToken,
      onComplete,
    });

  } catch (err) {
    console.warn(`[MultiProvider] Stream failed for gateway: ${err.message}`);

    const category = classifyProviderError(err);

    if (category === 'KEY_FAULT') {
      await markKeyFailed(PROVIDER_ID, KEY_INDEX);
    } else if (category === 'PROVIDER_TRANSIENT' || category === 'BAD_MODEL') {
      // See callWithFallback above — no second provider to fall back to.
    } else {
      try {
        Sentry.captureException(err, {
          tags: { source: 'multiProvider-stream', provider: PROVIDER_ID, category },
        });
      } catch { /* Sentry must never be able to break the call path */ }
    }

    const finalErr = new Error(`ALL_PROVIDERS_FAILED: ${err.message}`);
    try {
      Sentry.captureException(finalErr, { tags: { source: 'multiProvider-stream', reason: 'gateway_call_failed', category } });
    } catch { /* Sentry must never be able to break the call path */ }
    onError?.(finalErr);
  }
};

// Return shape is unchanged from the previous multi-provider version —
// this is a data-source change (one gateway key instead of N
// per-provider pools), not a contract change. Not currently exposed via
// any HTTP route in this codebase.
export const getProviderStatus = async () => {
  let cooling = false;
  let failCount = 0;
  let failedAt = null;

  if (isRedisStateEnabled()) {
    try {
      const state = await getCooldownState(PROVIDER_ID, KEY_INDEX);
      cooling   = !!state;
      failCount = state ? parseInt(state.failCount || '0', 10) : 0;
      failedAt  = state?.failedAt ? new Date(parseInt(state.failedAt, 10)).toISOString() : null;
    } catch {
      cooling = isKeyCoolingInMemorySync(PROVIDER_ID, KEY_INDEX);
    }
  } else {
    cooling = isKeyCoolingInMemorySync(PROVIDER_ID, KEY_INDEX);
    const cd = getInMemoryCooldownState(PROVIDER_ID, KEY_INDEX);
    failCount = cd?.failCount || 0;
    failedAt  = cd?.failedAt ? new Date(cd.failedAt).toISOString() : null;
  }

  return [{
    provider:      PROVIDER_ID,
    models_static: [TEXT_MODEL, VISION_MODEL],
    key_index:     KEY_INDEX,
    status:        cooling ? 'cooling' : 'healthy',
    fail_count:    failCount,
    cooling_since: failedAt,
    state_source:  isRedisStateEnabled() ? 'redis' : 'in-memory',
  }];
};

export default { callWithFallback, callWithFallbackGroq, streamWithFallback, getProviderStatus };
