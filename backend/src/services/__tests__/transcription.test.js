// Tests for services/transcription.js key-fallback behavior (full audit 1.57).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { transcribeAudio } = await import('../transcription.js');

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ text }) });
const fail = (status, body = 'nope') => ({ ok: false, status, statusText: 'x', text: async () => body });
const audio = Buffer.from('fake-audio');

let fetchMock;
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('GROQ_API_KEY')) delete process.env[k];
  process.env.GROQ_API_KEY_1 = 'key-one';
  process.env.GROQ_API_KEY_2 = 'key-two';
  process.env.GROQ_API_KEY_3 = 'key-three';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

const authOf = (call) => call[1].headers.Authorization;

describe('transcribeAudio', () => {
  it('returns trimmed text from the first working key', async () => {
    fetchMock.mockResolvedValueOnce(ok('  hello world  '));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).resolves.toEqual({ text: 'hello world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('moves to the next key on a key fault (401 / 429)', async () => {
    fetchMock.mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok('third'));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).resolves.toEqual({ text: 'third' });
    expect(fetchMock.mock.calls.map(authOf)).toEqual(['Bearer key-one', 'Bearer key-two', 'Bearer key-three']);
  });

  it('moves to the next key on a provider-wide transient failure (503)', async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok('recovered'));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).resolves.toEqual({ text: 'recovered' });
  });

  it('moves to the next key on a network failure', async () => {
    const netErr = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    fetchMock.mockRejectedValueOnce(netErr).mockResolvedValueOnce(ok('after reset'));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).resolves.toEqual({ text: 'after reset' });
  });

  it.each([400, 413, 415, 422])('stops after ONE request when the input itself is rejected (%i)', async (status) => {
    fetchMock.mockResolvedValue(fail(status, 'bad audio'));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).rejects.toThrow(`TRANSCRIPTION_FAILED: HTTP ${status}: bad audio`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('after exhausting every key reports the last error', async () => {
    fetchMock.mockResolvedValue(fail(429, 'rate limited'));
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).rejects.toThrow('TRANSCRIPTION_FAILED: HTTP 429: rate limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a clear error when no key is configured', async () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('GROQ_API_KEY')) delete process.env[k];
    await expect(transcribeAudio(audio, { mimeType: 'audio/webm' })).rejects.toThrow('No GROQ_API_KEY configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
