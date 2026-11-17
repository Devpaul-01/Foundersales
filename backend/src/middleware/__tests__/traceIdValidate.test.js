import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { traceId } from '../traceId.js';
import { validate } from '../validate.js';

const run = (mw, req) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; let nexted = false; mw(req, res, () => { nexted = true; }); return { res, nexted }; };

describe('traceId', () => {
  it.each(['abc123', '550e8400-e29b-41d4-a716-446655440000', 'req:42.7-x_y'])('keeps a well-formed incoming id %s', (id) => {
    const req = { headers: { 'x-trace-id': id } }; const { res } = run(traceId, req);
    expect(req.traceId).toBe(id); expect(res.headers['X-Trace-Id']).toBe(id);
  });
  it.each(['has space', 'a'.repeat(129), 'x\ty', 'fake log line=1 level=ERROR', '', 'é'])('replaces a malformed incoming id (%j)', (id) => {
    const req = { headers: { 'x-trace-id': id } }; run(traceId, req);
    expect(req.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('generates one when absent', () => { const req = { headers: {} }; run(traceId, req); expect(req.traceId).toMatch(/^[0-9a-f-]{36}$/); });
});

describe('validate', () => {
  const schema = z.object({ n: z.coerce.number() });
  it('replaces req.body with parsed data and calls next', () => {
    const req = { body: { n: '5' } }; const { nexted } = run(validate(schema), req);
    expect(nexted).toBe(true); expect(req.body).toEqual({ n: 5 });
  });
  it('works when req.query is a read-only getter (Express 5 behavior)', () => {
    const req = {}; Object.defineProperty(req, 'query', { get: () => ({ n: '7' }), configurable: true });
    const { nexted } = run(validate(schema, 'query'), req);
    expect(nexted).toBe(true); expect(req.query).toEqual({ n: 7 });
  });
  it('returns 400 with field errors and does not call next', () => {
    const req = { body: { n: 'abc' } }; const { res, nexted } = run(validate(schema), req);
    expect(nexted).toBe(false); expect(res.code).toBe(400); expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
