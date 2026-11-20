// Fallback-chain behavior of services/multiProvider.js, rewritten for the
// single-endpoint llm-gateway integration (feat/llm-gateway-provider).
// There is now exactly one upstream (the gateway), which does its own
// provider-level fallback server-side via `fallback_models` — this file's
// job is just: speak the gateway's OpenAI-compatible wire format
// correctly, and cool the gateway key on a genuine KEY_FAULT so repeated
// calls don't hammer a known-bad credential.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const okChat = (text = 'hi', modelUsed = 'groq:openai/gpt-oss-120b') => ({
  ok: true, status: 200,
  json: async () => ({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    gateway: { model_used: modelUsed },
  }),
});
const errResp = (status, body) => ({ ok: false, status, statusText: 'x', text: async () => JSON.stringify(body ?? { error: { message: 'nope' } }) });

let fetchMock; let chatCalls; let mod;

const setup = async (env) => {
  delete process.env.GATEWAY_API_KEY;
  delete process.env.GATEWAY_BASE_URL;
  delete process.env.GATEWAY_TEXT_MODEL;
  delete process.env.GATEWAY_TEXT_FALLBACK_MODELS;
  delete process.env.GATEWAY_VISION_MODEL;
  delete process.env.GATEWAY_VISION_FALLBACK_MODELS;
  process.env.MULTIPROVIDER_REDIS_STATE_ENABLED = 'false';
  delete process.env.REDIS_URL;
  Object.assign(process.env, env);
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.doMock('../tokenTracker.js', () => ({ recordGroqUsage: vi.fn().mockResolvedValue(null) }));
  mod = await import('../multiProvider.js');
};

const stubFetch = (route) => {
  chatCalls = [];
  fetchMock = vi.fn(async (url, opts) => {
    chatCalls.push(String(url));
    const r = route(String(url), chatCalls.length, opts);
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fetchMock);
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = (opts = {}) => mod.callWithFallback({ messages: [{ role: 'user', content: 'x' }], systemPrompt: 's', ...opts });

describe('callWithFallback (gateway)', () => {
  beforeEach(async () => { await setup({ GATEWAY_API_KEY: 'gw-key-1' }); });

  it('calls the gateway at {base}/chat/completions with the text model + fallback_models, and reports the gateway-chosen model_used', async () => {
    stubFetch(() => okChat('hello from gateway', 'cerebras:gpt-oss-120b'));
    const r = await ask();
    expect(r.content).toBe('hello from gateway');
    expect(r.model_used).toBe('cerebras:gpt-oss-120b');
    expect(chatCalls).toEqual(['https://llm-gateway.fly.dev/v1/chat/completions']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.fallback_models).toEqual(['mistral-large-latest', 'meta-llama/llama-3.1-8b-instruct']);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer gw-key-1');
  });

  it('uses the vision model + vision fallback_models when images are present', async () => {
    stubFetch(() => okChat('I see it'));
    const r = await ask({ images: [{ url: 'data:image/png;base64,abc' }] });
    expect(r.used_vision).toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(body.fallback_models).toEqual(['gemini-2.5-flash-lite']);
  });

  it('respects GATEWAY_* env overrides for base URL and model names', async () => {
    await setup({
      GATEWAY_API_KEY: 'gw-key-1',
      GATEWAY_BASE_URL: 'https://staging-gateway.internal/v1/',
      GATEWAY_TEXT_MODEL: 'custom/text-model',
      GATEWAY_TEXT_FALLBACK_MODELS: 'fallback-a, fallback-b',
    });
    stubFetch(() => okChat());
    await ask();
    expect(chatCalls).toEqual(['https://staging-gateway.internal/v1/chat/completions']);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('custom/text-model');
    expect(body.fallback_models).toEqual(['fallback-a', 'fallback-b']);
  });

  it('a 429 with a plain rate-limit body is KEY_FAULT: cools the key and rejects', async () => {
    stubFetch(() => errResp(429, { error: { message: 'rate limited', code: 'rate_limit_error' } }));
    await expect(ask()).rejects.toThrow(/ALL_PROVIDERS_FAILED/);
    // second call should short-circuit on the cooldown check without even
    // hitting fetch again
    await expect(ask()).rejects.toThrow(/cooling down/);
    expect(chatCalls.length).toBe(1);
  });

  it('a 429 with daily_token_budget_exceeded does NOT cool the key (PROVIDER_TRANSIENT)', async () => {
    stubFetch(() => errResp(429, { error: { message: 'budget exceeded', code: 'daily_token_budget_exceeded' } }));
    await expect(ask()).rejects.toThrow(/ALL_PROVIDERS_FAILED/);
    // key should NOT be cooling — a second call still attempts fetch
    stubFetch(() => okChat('recovered after budget reset'));
    await expect(ask()).resolves.toMatchObject({ content: 'recovered after budget reset' });
  });

  it('a 429 with too_many_concurrent_requests does NOT cool the key (PROVIDER_TRANSIENT)', async () => {
    stubFetch(() => errResp(429, { error: { message: 'too many concurrent', code: 'too_many_concurrent_requests' } }));
    await expect(ask()).rejects.toThrow(/ALL_PROVIDERS_FAILED/);
    stubFetch(() => okChat('recovered after concurrency freed up'));
    await expect(ask()).resolves.toMatchObject({ content: 'recovered after concurrency freed up' });
  });

  it('treats a timeout as transient (does not cool the key)', async () => {
    stubFetch(() => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await expect(ask()).rejects.toThrow(/ALL_PROVIDERS_FAILED/);
    stubFetch(() => okChat('ok after timeout'));
    await expect(ask()).resolves.toMatchObject({ content: 'ok after timeout' });
  });

  it('rejects immediately with a clear error when GATEWAY_API_KEY is missing', async () => {
    await setup({});
    stubFetch(() => okChat());
    await expect(ask()).rejects.toThrow(/GATEWAY_API_KEY is not configured/);
    expect(chatCalls.length).toBe(0);
  });

  it('passes an abort signal so calls cannot hang forever', async () => {
    stubFetch(() => okChat());
    await ask();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('callWithFallbackGroq', () => {
  beforeEach(async () => { await setup({ GATEWAY_API_KEY: 'gw-key-1' }); });

  it('records usage via tokenTracker with the gateway-reported model_used', async () => {
    stubFetch(() => okChat('hi', 'groq:openai/gpt-oss-120b'));
    const { recordGroqUsage } = await import('../tokenTracker.js');
    await mod.callWithFallbackGroq({
      messages: [{ role: 'user', content: 'x' }], systemPrompt: 's',
      workspaceId: 'w1', userId: 'u1', tier: 'quality',
    });
    expect(recordGroqUsage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w1', userId: 'u1', model: 'groq:openai/gpt-oss-120b', tier: 'quality',
    }));
  });
});

describe('streamWithFallback (gateway)', () => {
  beforeEach(async () => { await setup({ GATEWAY_API_KEY: 'gw-key-1' }); });

  it('streams tokens and reports usage + model_used on completion', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5},"gateway":{"model_used":"groq:openai/gpt-oss-120b"}}\n',
      'data: [DONE]\n',
    ].join('');
    let delivered = false;
    const body = { getReader: () => ({
      read: async () => {
        if (delivered) return { done: true, value: undefined };
        delivered = true;
        return { done: false, value: new TextEncoder().encode(sseBody) };
      },
      cancel: async () => {},
    }) };
    stubFetch(() => ({ ok: true, status: 200, body }));

    const tokens = []; const onComplete = vi.fn(); const onError = vi.fn();
    await mod.streamWithFallback({
      messages: [{ role: 'user', content: 'x' }], systemPrompt: 's',
      onToken: (t) => tokens.push(t), onComplete, onError,
    });

    expect(tokens).toEqual(['Hel', 'lo']);
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith('Hello', expect.objectContaining({
      tokens_in: 3, tokens_out: 2, tokens_total: 5, model_used: 'groq:openai/gpt-oss-120b',
    }));
  });

  it('a stream that stalls mid-reply ends via onError (no second provider to fall back to)', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const stallingBody = { getReader: () => ({
        read: () => (reads++ === 0
          ? Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n') })
          : new Promise(() => {})), // never resolves
        cancel: async () => {},
      }) };
      stubFetch(() => ({ ok: true, status: 200, body: stallingBody }));
      const tokens = []; const onError = vi.fn(); const onComplete = vi.fn();
      const p = mod.streamWithFallback({ messages: [{ role: 'user', content: 'x' }], systemPrompt: 's', onToken: (t) => tokens.push(t), onComplete, onError });
      await vi.advanceTimersByTimeAsync(46_000);
      await p;
      expect(tokens).toEqual(['Hel']);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(String(onError.mock.calls[0][0].message)).toMatch(/stalled/);
      expect(chatCalls.length).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});

describe('getProviderStatus (gateway)', () => {
  it('reports a single gateway entry', async () => {
    await setup({ GATEWAY_API_KEY: 'gw-key-1' });
    const status = await mod.getProviderStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ provider: 'gateway', status: 'healthy' });
  });
});
