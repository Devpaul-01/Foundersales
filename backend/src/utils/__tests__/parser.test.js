import { describe, it, expect } from 'vitest';
import { parseJSON, parseScore } from '../parser.js';

describe('parseJSON', () => {
  it('recovers JSON wrapped in a markdown code fence', () => {
    const raw = '```json\n{"reply":"hello","score":7}\n```';

    const result = parseJSON(raw, null);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ reply: 'hello', score: 7 });
    expect(result.method).toMatch(/^attempt_/);
  });

  it('returns the fallback (never throws) on unrecoverable input', () => {
    const raw = "Sorry, I can't help with that request.";
    const fallback = { fallbackKey: true };

    const result = parseJSON(raw, fallback);

    expect(result.success).toBe(false);
    expect(result.data).toEqual(fallback);
    expect(result.method).toBe('fallback');
  });
});

describe('parseScore', () => {
  it('parses fraction-format scores, clamps out-of-range numbers, and falls back on unparseable input', () => {
    const opts = { min: 1, max: 10, defaultVal: 5 };

    expect(parseScore('8/10', opts)).toBe(8);
    expect(parseScore(15, opts)).toBe(10);
    expect(parseScore('not a number', opts)).toBe(5);
  });
});
