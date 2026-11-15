// Regression test for full audit 1.50: with Redis unconfigured (the
// default-enabled Redis-state mode, REDIS_URL unset), the cooldown must
// fall back to in-memory instead of silently recording nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('providerCooldown with Redis unavailable (REDIS_URL unset)', () => {
  let mod;
  beforeEach(async () => {
    delete process.env.REDIS_URL;
    delete process.env.MULTIPROVIDER_REDIS_STATE_ENABLED; // default: Redis path ON
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod = await import('../providerCooldown.js');
  });

  it('defaults to the Redis-state path being enabled', () => {
    expect(mod.isRedisStateEnabled()).toBe(true);
  });

  it('actually cools a failed key via the in-memory fallback', async () => {
    expect(await mod.isKeyCooling('groq', 1)).toBe(false);
    await mod.markKeyFailed('groq', 1);
    expect(await mod.isKeyCooling('groq', 1)).toBe(true);
  });

  it('does not cool unrelated keys or providers', async () => {
    await mod.markKeyFailed('groq', 1);
    expect(await mod.isKeyCooling('groq', 2)).toBe(false);
    expect(await mod.isKeyCooling('cerebras', 1)).toBe(false);
  });
});
