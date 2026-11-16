// Tests for services/intelligenceReport.js (full audit 1.64).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../config/supabase.js', () => ({ default: {} }));
const { buildIntelligencePrompt, deriveIntelligenceMetrics, generateRuleBasedInsights, normalizeInsights } = await import('../intelligenceReport.js');

const baseCtx = (over = {}) => ({ profile: null, pipeline: null, goals: [], checkIns: [], signals: [], patterns: [], objections: [], commitments: [], practice: [], skillTrends: [], recentOpps: [], unreadTips: [], ...over });
const promptFor = (ctx) => buildIntelligencePrompt({}, ctx, deriveIntelligenceMetrics(ctx));

describe('skill trend wording in the prompt', () => {
  it.each([[0.5, 'Improving'], [-0.5, 'Declining'], [0, 'Flat']])('delta %s -> %s', (delta, word) => {
    const p = promptFor(baseCtx({ skillTrends: [{ composite_delta: delta }] }));
    expect(p).toContain(`Skill trend: `);
    expect(p).toMatch(new RegExp(`Skill trend: \\S+ ${word}`));
  });
  it('omits the line when there is no trend row', () => {
    expect(promptFor(baseCtx())).not.toContain('Skill trend');
  });
});

describe('normalizeInsights', () => {
  const good = { type: 'warning', icon: '⏳', title: 'T', body: 'B', action: 'Do it' };
  it('passes a well-formed array through', () => expect(normalizeInsights([good])).toEqual([good]));
  it('rejects non-arrays (object wrapper, string, null)', () => {
    for (const bad of [{ insights: [good] }, 'text', null, undefined, 42]) expect(normalizeInsights(bad)).toBeNull();
  });
  it('drops items without a usable title/body, and returns null if none remain', () => {
    expect(normalizeInsights([{ title: 'x' }, { body: 'y' }, null, 'str', { title: ' ', body: 'z' }])).toBeNull();
    expect(normalizeInsights([{ title: 'x' }, good])).toEqual([good]);
  });
  it('fills defaults and nulls a non-string action', () => {
    expect(normalizeInsights([{ title: 'T', body: 'B', action: 7 }])).toEqual([{ type: 'coaching', icon: '💡', title: 'T', body: 'B', action: null }]);
  });
  it('caps at 5', () => expect(normalizeInsights(Array.from({ length: 9 }, () => good))).toHaveLength(5));
});

describe('generateRuleBasedInsights', () => {
  it('always returns at least one insight', () => {
    const ctx = baseCtx();
    expect(generateRuleBasedInsights(ctx, deriveIntelligenceMetrics(ctx)).length).toBeGreaterThanOrEqual(1);
  });
});
