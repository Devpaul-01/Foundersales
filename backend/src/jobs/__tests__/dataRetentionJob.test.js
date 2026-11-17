import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ deletes: [], results: {}, logs: [] }));
vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => ({ delete: (opts) => ({ lt: (col, cutoff) => { state.deletes.push({ table, col, cutoff, opts }); return Promise.resolve(state.results[table] ?? { count: 0, error: null }); } }) }) },
}));
vi.mock('../../utils/jobHelpers.js', () => ({ logJob: async (...a) => { state.logs.push(a); } }));

const { runDataRetentionJob, RETENTION_DAYS } = await import('../dataRetentionJob.js');

beforeEach(() => { state.deletes = []; state.results = {}; state.logs = []; vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('runDataRetentionJob', () => {
  it('prunes both tables using the right timestamp column and a ~90 day cutoff', async () => {
    state.results = { job_logs: { count: 12, error: null }, push_notification_log: { count: 5, error: null } };
    const r = await runDataRetentionJob();
    expect(state.deletes.map((d) => [d.table, d.col])).toEqual([['job_logs', 'created_at'], ['push_notification_log', 'sent_at']]);
    for (const d of state.deletes) {
      const ageDays = (Date.now() - new Date(d.cutoff).getTime()) / 86_400_000;
      expect(ageDays).toBeGreaterThan(RETENTION_DAYS[d.table].days - 0.01);
      expect(ageDays).toBeLessThan(RETENTION_DAYS[d.table].days + 0.01);
      expect(d.opts).toEqual({ count: 'exact' });
    }
    expect(r).toEqual({ deleted: { job_logs: 12, push_notification_log: 5 }, failures: [] });
    expect(state.logs.at(-1)[1]).toBe('completed');
  });

  it('one table failing does not stop the other, and the job does not throw', async () => {
    state.results = { job_logs: { count: null, error: { message: 'db down' } }, push_notification_log: { count: 3, error: null } };
    const r = await runDataRetentionJob();
    expect(r.deleted).toEqual({ push_notification_log: 3 });
    expect(r.failures).toEqual(['job_logs: db down']);
    expect(state.logs.at(-1)[1]).toBe('failed');
  });
});
