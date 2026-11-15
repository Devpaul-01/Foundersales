// Regression test for full audit 1.51: with REDIS_URL set but Redis
// unreachable, redis.js used to hang forever (node-redis retries forever,
// so connect() never rejects). It must now fail open: return null after a
// bounded timeout, then immediately (cooldown) on later calls.
import { describe, it, expect, vi } from 'vitest';

describe('redis.js with REDIS_URL set but Redis unreachable', () => {
  it('fails open (null) instead of hanging, and does not re-pay the timeout', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // closed port
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const redis = await import('../redis.js');

    expect(await redis.getCache('some-key')).toBeNull();

    const t = Date.now();
    expect(await redis.getCache('some-key')).toBeNull();
    expect(await redis.getRawClient()).toBeNull();
    expect(Date.now() - t).toBeLessThan(500);

    delete process.env.REDIS_URL;
  }, 15000);
});
