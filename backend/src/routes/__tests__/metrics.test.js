import { describe, it, expect, vi } from 'vitest';

// metrics.js imports several modules with real side effects at load time
// (Supabase client construction, Redis client construction, a logger).
// None of them are touched by the two pure functions under test, so they
// are mocked here purely to make the import graph resolve in isolation.
vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../../services/redis.js', () => ({ getCache: vi.fn(), setCache: vi.fn() }));
vi.mock('../../utils/parseAIJson.js', () => ({ parseAIJson: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ log: vi.fn(), logError: vi.fn() }),
}));
vi.mock('../../middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
vi.mock('../../middleware/workspace.js', () => ({
  buildUserContext: vi.fn(),
  requirePermission: () => (req, res, next) => next(),
}));

const { computeMomentumScore, calculateOutreachStreakFromOpps } = await import('../metrics.js');

describe('computeMomentumScore', () => {
  it('weights each factor correctly and never exceeds 100', () => {
    const input = {
      outreachStreak: 5,
      sentCount30d: 20,
      positiveRate: 0.5,
      pipelineMetrics: { call_demo_count: 2, replied_count: 0, contacted_count: 0 },
      goals: [{ target_value: 10, current_value: 10, status: 'active' }],
      practiceCount: 10,
    };

    const result = computeMomentumScore(input);

    expect(result.breakdown.activity).toBe(25);
    expect(result.breakdown.conversion).toBe(30);
    expect(result.breakdown.pipeline).toBe(20);
    expect(result.breakdown.goals).toBe(14);
    expect(result.breakdown.practice).toBe(5);
    expect(result.score).toBe(94);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns a zero score with no NaN values for empty/missing input', () => {
    const result = computeMomentumScore({
      outreachStreak: 0,
      sentCount30d: 0,
      positiveRate: 0,
      pipelineMetrics: null,
      goals: [],
      practiceCount: 0,
    });

    expect(result.score).toBe(0);
    Object.values(result.breakdown).forEach((v) => {
      expect(Number.isNaN(v)).toBe(false);
    });
  });
});

describe('calculateOutreachStreakFromOpps', () => {
  it('counts consecutive days sent and stops at the first gap', () => {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const sentOpps = [
      { marked_sent_at: day(0) },
      { marked_sent_at: day(1) },
      { marked_sent_at: day(2) },
      // day(3) intentionally missing
      { marked_sent_at: day(4) },
    ];

    expect(calculateOutreachStreakFromOpps(sentOpps)).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(calculateOutreachStreakFromOpps([])).toBe(0);
  });
});
