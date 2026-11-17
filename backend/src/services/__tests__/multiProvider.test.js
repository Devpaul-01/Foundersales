// Fallback-chain behavior of services/multiProvider.js (full audit 1.68).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const okChat = (text = 'hi') => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) });
const errResp = (status, body) => ({ ok: false, status, statusText: 'x', text: async () => JSON.stringify(body ?? { error: { message: 'nope' } }) });
const modelsResp = (ids = []) => ({ ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) });

let fetchMock; let chatCalls; let mod;

const setup = async (env) => {
  for (const k of Object.keys(process.env)) if (/^(CEREBRAS|GROQ|MISTRAL|OPENROUTER)_API_KEY/.test(k)) delete process.env[k];
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

// route: (url, call#) => response | Error
const stubFetch = (route) => {
  chatCalls = [];
  fetchMock = vi.fn(async (url, opts) => {
    if (String(url).endsWith('/models')) return modelsResp();
    chatCalls.push(String(url));
    const r = route(String(url), chatCalls.length);
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fetchMock);
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ask = () => mod.callWithFallback({ messages: [{ role: 'user', content: 'x' }], systemPrompt: 's' });

describe('callWithFallback', () => {
  beforeEach(async () => { await setup({ GROQ_API_KEY_1: 'g1', MISTRAL_API_KEY_1: 'm1' }); });

  it('skips the rest of a provider after 2 transient failures, then uses the next provider', async () => {
    stubFetch((url) => (url.includes('groq') ? errResp(503) : okChat('from mistral')));
    const r = await ask();
    expect(r.content).toBe('from mistral');
    const groq = chatCalls.filter((u) => u.includes('groq')).length;
    expect(groq).toBe(2);                 // was: one per static groq model (3+)
    expect(chatCalls.length).toBe(3);
  });

  it('treats a timeout as transient and moves on (was: aborted the whole chain)', async () => {
    stubFetch((url) => (url.includes('groq') ? Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) : okChat('ok after timeout')));
    await expect(ask()).resolves.toMatchObject({ content: 'ok after timeout' });
  });

  it('treats an unreadable 200 body as transient and moves on (was: aborted the whole chain)', async () => {
    stubFetch((url) => (url.includes('groq') ? { ok: true, status: 200, json: async () => { throw new TypeError('terminated'); } } : okChat('recovered')));
    await expect(ask()).resolves.toMatchObject({ content: 'recovered' });
  });

  it('treats a 404 model-not-found as a bad model, not a fatal error', async () => {
    let n = 0;
    stubFetch((url) => (url.includes('groq') && n++ === 0
      ? errResp(404, { error: { code: 'model_not_found', message: 'The model `x` does not exist' } })
      : okChat('next model')));
    await expect(ask()).resolves.toMatchObject({ content: 'next model' });
  });

  it('still aborts immediately on a genuine application error (generic 400)', async () => {
    stubFetch(() => errResp(400, { error: { message: 'invalid temperature' } }));
    await expect(ask()).rejects.toThrow(/invalid temperature/);
    expect(chatCalls.length).toBe(1);
  });

  it('passes an abort signal so calls cannot hang forever', async () => {
    stubFetch(() => okChat());
    await ask();
    const chatOpts = fetchMock.mock.calls.find(([u]) => !String(u).endsWith('/models'))[1];
    expect(chatOpts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('streamWithFallback', () => {
  it('a stream that stalls mid-reply ends via onError and does NOT restart on another provider', async () => {
    await setup({ GROQ_API_KEY_1: 'g1', MISTRAL_API_KEY_1: 'm1' });
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
      expect(chatCalls.length).toBe(1); // no second provider, so no duplicated tokens
    } finally { vi.useRealTimers(); }
  });
});
