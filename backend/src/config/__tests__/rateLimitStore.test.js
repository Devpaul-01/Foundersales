// Regression test for full audit 1.62: concurrent createRateLimitStore() calls
// must all share the same in-flight Redis connection attempt. Previously only
// the first caller received the client; the rest silently got in-memory stores.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ client: null, calls: 0 }));
vi.mock('../../services/redis.js', () => ({
  getRawClient: async () => { state.calls += 1; await new Promise((r) => setTimeout(r, 50)); return state.client; },
}));
vi.mock('../../utils/reportDegradation.js', () => ({ reportDegradedMode: vi.fn() }));

let createRateLimitStore;
beforeEach(async () => {
  vi.resetModules();
  state.calls = 0;
  state.client = { sendCommand: async () => 'sha' };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ({ createRateLimitStore } = await import('../rateLimitStore.js'));
});

describe('createRateLimitStore concurrency', () => {
  it('gives EVERY concurrently-started limiter a Redis store, from one connection attempt', async () => {
    const namespaces = Array.from({ length: 20 }, (_, i) => `ns${i}`);
    const stores = await Promise.all(namespaces.map((n) => createRateLimitStore(n)));
    expect(stores.every(Boolean)).toBe(true);
    expect(new Set(stores).size).toBe(20);   // a distinct store per namespace
    expect(state.calls).toBe(1);             // but only one client lookup
  });

  it('falls back (undefined) for all of them when Redis is unavailable, with one warning', async () => {
    state.client = null;
    const stores = await Promise.all(['a', 'b', 'c'].map((n) => createRateLimitStore(n)));
    expect(stores).toEqual([undefined, undefined, undefined]);
    const fallbackWarnings = console.warn.mock.calls.filter((c) => String(c[0]).includes('falling back to per-instance'));
    expect(fallbackWarnings).toHaveLength(1);
  });

  it('returns the same store instance for the same namespace', async () => {
    const [a, b] = await Promise.all([createRateLimitStore('same'), createRateLimitStore('same')]);
    expect(a).toBe(b);
  });
});
