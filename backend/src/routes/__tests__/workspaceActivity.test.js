// Tests for routes/workspace-activity.js (full audit 1.61).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ calls: null, result: null }));

vi.mock('../../middleware/workspace.js', () => ({ requirePermission: () => (_req, _res, next) => next() }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { _table: table, _eq: [] };
      q.select = (cols, opts) => { q._select = cols; q._opts = opts; return q; };
      q.eq = (c, v) => { q._eq.push([c, v]); return q; };
      q.order = () => q;
      q.range = (a, b) => { state.calls = { table, eq: q._eq, from: a, to: b }; return Promise.resolve(state.result); };
      return q;
    },
  },
}));

const router = (await import('../workspace-activity.js')).default;
// The route's final handler (after the permission middleware).
const handler = router.stack.find((l) => l.route?.path === '/activity').route.stack.at(-1).handle;

const call = async (query) => {
  let body; let status = 200;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; } };
  await handler({ query, workspace: { id: 'ws1' }, user: { id: 'u1' } }, res, (e) => { throw e; });
  return { body, status };
};

beforeEach(() => {
  state.calls = null;
  state.result = { data: [{ id: 'e1' }], error: null, count: 1 };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /activity', () => {
  it('is scoped to the caller workspace', async () => {
    await call({});
    expect(state.calls.table).toBe('workspace_activity');
    expect(state.calls.eq).toContainEqual(['workspace_id', 'ws1']);
  });

  it('uses defaults of 20 / 0', async () => {
    const { body } = await call({});
    expect([state.calls.from, state.calls.to]).toEqual([0, 19]);
    expect(body).toMatchObject({ limit: 20, offset: 0, total: 1, workspace_id: 'ws1' });
  });

  it('caps limit at 100', async () => {
    await call({ limit: '5000' });
    expect([state.calls.from, state.calls.to]).toEqual([0, 99]);
  });

  it('clamps a negative limit and offset instead of sending an invalid range', async () => {
    const { body } = await call({ limit: '-5', offset: '-10' });
    expect(body).toMatchObject({ limit: 1, offset: 0 }); // -5 is truthy, so it clamps up to the minimum of 1
    expect([state.calls.from, state.calls.to]).toEqual([0, 0]);
  });

  it('ignores non-numeric values', async () => {
    const { body } = await call({ limit: 'abc', offset: 'xyz' });
    expect(body).toMatchObject({ limit: 20, offset: 0 });
  });

  it('propagates a database error', async () => {
    state.result = { data: null, error: new Error('db down'), count: null };
    await expect(call({})).rejects.toThrow('db down');
  });
});
