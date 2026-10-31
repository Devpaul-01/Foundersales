import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for docs/backend-takeover/AUDIT.md: config/bullmq.js
// used to `throw` synchronously at MODULE IMPORT TIME if REDIS_URL was
// unset. Because this file is imported transitively by all three process
// entry points (app.js, server.js, workers/index.js) via jobs/index.js,
// and ES module imports are hoisted/resolved before any of those files'
// own top-level code runs, that throw crashed the entire process before
// app.listen() was ever reached — including in server.js, the API-only
// process, which doesn't even call startAllJobs(). This contradicted
// validateEnv.js's own classification of REDIS_URL as optional, and
// app.js's documented design ("a Redis/BullMQ outage never takes down
// the whole API — only background jobs are affected").
//
// This test verifies the specific regression: importing config/bullmq.js
// with no REDIS_URL set must not throw.

describe('config/bullmq.js', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    vi.restoreAllMocks();
  });

  it('does not throw when imported with REDIS_URL unset', async () => {
    await expect(import('../bullmq.js')).resolves.toBeDefined();
  });

  it('exposes bullmqConnectionState as "unconfigured" when REDIS_URL is unset', async () => {
    const { bullmqConnectionState, bullmqConnection } = await import('../bullmq.js');
    expect(bullmqConnectionState.status).toBe('unconfigured');
    // Still a real connection object — BullMQ's Queue/Worker constructors
    // require one, not null/undefined. This asserts the fix preserves
    // that contract rather than returning nothing.
    expect(bullmqConnection).toBeDefined();
    bullmqConnection.disconnect();
  });
});
