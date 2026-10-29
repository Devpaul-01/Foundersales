import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Regression test for docs/backend-takeover/AUDIT.md: 'pattern_insights'
// was enqueued onto the scheduled-jobs queue (by patternDetectionJob.js,
// chained off pattern_detection's completion) but had no entry in
// scheduledWorker.js's HANDLERS map. runPatternInsightsJob was fully
// implemented and imported, just never wired in — every enqueued
// pattern_insights job hit scheduledWorker's "No handler registered"
// throw and failed (attempts: 2, then dead-lettered), silently.
//
// This test guards against the general bug class, not just this one
// instance: every job name registerSchedules.js's SCHEDULES array puts
// on a cron, plus 'pattern_insights' (the one job chained from code
// rather than a cron entry), must have a HANDLERS entry in
// scheduledWorker.js. If a future schedule or chained job is added
// without wiring up its handler, this test fails instead of the gap
// only surfacing as silent job failures in production logs.
//
// Needs placeholder Supabase/Groq env vars because scheduledWorker.js
// transitively imports job files that construct supabaseAdmin at module
// load time (see docs/backend-takeover/AUDIT.md 1.1 for why that's a
// separate, already-tracked concern, not something this test is
// evaluating) — no real network calls happen in this test, since it only
// inspects the HANDLERS/SCHEDULES objects after import.
describe('scheduledWorker HANDLERS completeness', () => {
  const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'GROQ_API_KEY'];
  const originalEnv = {};

  beforeAll(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'fake-anon-key';
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'fake-groq-key';
  });

  afterAll(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('has a HANDLERS entry for every cron-scheduled job name in SCHEDULES', async () => {
    const { HANDLERS } = await import('../scheduledWorker.js');
    const { SCHEDULES } = await import('../registerSchedules.js');

    const missing = SCHEDULES.map((s) => s.name).filter((name) => typeof HANDLERS[name] !== 'function');

    expect(missing, `Scheduled job(s) with no registered handler: ${missing.join(', ')}`).toEqual([]);
  });

  it('has a HANDLERS entry for pattern_insights (chained off pattern_detection, not its own cron)', async () => {
    const { HANDLERS } = await import('../scheduledWorker.js');

    expect(typeof HANDLERS.pattern_insights).toBe('function');
  });
});
