// Tests for utils/jobHelpers.js logJob (full audit 1.59).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ inserted: null, result: { error: null }, sentry: null }));

vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => ({ insert: (row) => { state.inserted = { table, row }; return Promise.resolve(state.result); } }) },
}));
vi.mock('@sentry/node', () => ({ captureException: (...a) => state.sentry(...a) }));

const { logJob } = await import('../jobHelpers.js');

beforeEach(() => {
  state.inserted = null; state.result = { error: null }; state.sentry = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('logJob', () => {
  it("puts non-column keys (e.g. the growth job's `sent`) into metadata, keeps real columns", async () => {
    await logJob('growth_push_morning', 'completed', { sent: 12, duration_ms: 340 });
    expect(state.inserted.table).toBe('job_logs');
    expect(state.inserted.row).toEqual({ job_name: 'growth_push_morning', status: 'completed', duration_ms: 340, metadata: { sent: 12 } });
  });

  it('does not report anything on success', async () => {
    await logJob('j', 'started');
    expect(state.sentry).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns and reports to Sentry when Supabase RETURNS an error (not only when it throws)', async () => {
    state.result = { error: { message: 'column "x" of relation "job_logs" does not exist' } };
    await expect(logJob('j', 'completed', { duration_ms: 1 })).resolves.toBeUndefined(); // still never kills a job
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(state.sentry).toHaveBeenCalledTimes(1);
    const [err, ctx] = state.sentry.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/does not exist/);
    expect(ctx.tags).toMatchObject({ source: 'jobHelpers.logJob', jobName: 'j', jobStatus: 'completed' });
  });
});
