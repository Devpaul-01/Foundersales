// Characterization + regression tests for services/streaming.js streamAndSave
// (the main chat streaming path; previously untested). Full audit 1.56.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tokenTracker.js', () => ({ recordGroqUsage: vi.fn().mockResolvedValue(null) }));

const { streamAndSave } = await import('../streaming.js');

const makeRes = () => {
  const events = [];
  const handlers = {};
  return {
    events, handlers, headersSent: false,
    setHeader() {}, flushHeaders() {}, end() { events.push(['__end__']); },
    on(ev, cb) { handlers[ev] = cb; },
    write(chunk) {
      const m = /^event: (.+)\ndata: (.*)\n\n$/s.exec(chunk);
      events.push([m[1], JSON.parse(m[2])]);
    },
  };
};

let updates, updateResult, rpcResult;
const makeSupabase = () => ({
  from: () => {
    const q = {
      _op: null,
      insert() { q._op = 'insert'; return q; },
      select() { return q; },
      single() { return Promise.resolve(q._op === 'insert' ? { data: { id: 'm1' }, error: null } : { data: { message_count: 3 } }); },
      update(v) { q._op = 'update'; q._v = v; return q; },
      eq() { if (q._op === 'update') { updates.push(q._v); return Promise.resolve(updateResult); } return q; },
    };
    return q;
  },
  rpc: () => Promise.resolve(rpcResult),
});

const run = async (streamFn, extra = {}) => {
  const res = extra.res || makeRes();
  await streamAndSave({ systemPrompt: 's', messages: [], chatId: 'c1', userId: 'u1', workspaceId: 'w1', supabase: makeSupabase(), streamFn, res });
  // onComplete/onError are fire-and-forget in multiProvider; let them settle.
  await new Promise((r) => setTimeout(r, 20));
  return res;
};

beforeEach(() => {
  updates = []; updateResult = { error: null }; rpcResult = { error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('streamAndSave', () => {
  it('happy path: streams tokens, saves as delivered, then sends complete + done', async () => {
    const res = await run(async ({ onToken, onComplete }) => {
      onToken('Hel'); onToken('lo');
      onComplete('Hello', { tokens_in: 5, tokens_out: 2, model_used: 'groq:x' });
    });
    expect(res.events.map((e) => e[0])).toEqual(['message_id', 'token', 'token', 'complete', 'done', '__end__']);
    expect(updates[0]).toMatchObject({ content: 'Hello', delivery_status: 'delivered', model_used: 'groq:x' });
  });

  it('empty model output is saved as a placeholder, not an empty string', async () => {
    await run(async ({ onComplete }) => { onComplete('   ', {}); });
    expect(updates[0].content).toMatch(/empty response/i);
  });

  it('onError marks the message failed and tells the client', async () => {
    const res = await run(async ({ onError }) => { onError(new Error('all providers failed')); });
    expect(updates[0]).toMatchObject({ delivery_status: 'failed' });
    expect(res.events.map((e) => e[0])).toEqual(['message_id', 'error', 'done', '__end__']);
  });

  it('client disconnect: no more SSE events, but the reply is still saved', async () => {
    const res = makeRes();
    await run(async ({ onToken, onComplete }) => {
      res.handlers.close(); // simulate disconnect
      onToken('x');
      onComplete('full reply', {});
    }, { res });
    expect(res.events.map((e) => e[0])).toEqual(['message_id']);
    expect(updates[0]).toMatchObject({ content: 'full reply', delivery_status: 'delivered' });
  });

  it('logs loudly when persisting the completed message fails (audit 1.56)', async () => {
    updateResult = { error: { message: 'db down' } };
    await run(async ({ onComplete }) => { onComplete('hi', {}); });
    const logged = console.error.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/FAILED to persist completed message m1/);
    expect(logged).toMatch(/db down/);
  });

  it('logs when marking a failed message as failed also fails', async () => {
    updateResult = { error: { message: 'db down' } };
    await run(async ({ onError }) => { onError(new Error('x')); });
    expect(console.error.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/Failed to mark message m1 as failed/);
  });
});

