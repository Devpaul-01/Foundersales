// Tests for utils/logger.js (full audit 1.59): a logger must never throw.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from '../logger.js';

const { log, logError, logJob } = createLogger('T');
let out;
beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((m) => out.push(m));
  vi.spyOn(console, 'error').mockImplementation((m) => out.push(m));
});

describe('createLogger', () => {
  it('formats scalars and objects as before', () => {
    log('EVENT', { a: 1, b: { c: 2 }, skip: null });
    expect(out[0]).toBe('[T] EVENT → a=1 b={"c":2}');
  });

  it('does not throw on circular structures', () => {
    const circ = { name: 'x' }; circ.self = circ;
    expect(() => log('EVENT', { circ })).not.toThrow();
    expect(out[0]).toContain('circ=[unserializable]');
  });

  it('does not throw on BigInt inside an object', () => {
    expect(() => logJob('j', { big: { n: 10n } })).not.toThrow();
    expect(out[0]).toContain('big=[unserializable]');
  });

  it('logError keeps the original error message even when its data is unserializable', () => {
    const circ = {}; circ.self = circ;
    expect(() => logError('fn', new Error('real problem'), { circ })).not.toThrow();
    expect(out[0]).toContain('real problem');
  });
});

describe('log-line safety (audit 1.70)', () => {
  it('escapes CR/LF in string values so a value cannot forge extra log lines', () => {
    log('EVENT', { note: 'hello\n[T] FORGED → admin=true\r\nmore' });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toMatch(/[\r\n]/);
    expect(out[0]).toContain('hello\\n[T] FORGED');
  });
});
