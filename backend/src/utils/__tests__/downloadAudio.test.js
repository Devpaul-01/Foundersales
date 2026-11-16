import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadAudioBuffer } from '../downloadAudio.js';

const resp = ({ ok = true, status = 200, bytes = 10, length } = {}) => ({
  ok, status,
  headers: { get: (h) => (h.toLowerCase() === 'content-length' && length != null ? String(length) : null) },
  arrayBuffer: async () => new ArrayBuffer(bytes),
});
afterEach(() => vi.unstubAllGlobals());

describe('downloadAudioBuffer', () => {
  it('returns the bytes on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ bytes: 12 })));
    expect((await downloadAudioBuffer('https://x/a.webm')).byteLength).toBe(12);
  });
  it.each([403, 404, 500])('throws a clear error on HTTP %i instead of returning the error page', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ ok: false, status })));
    await expect(downloadAudioBuffer('https://x/a.webm')).rejects.toThrow(`Audio download failed: HTTP ${status}`);
  });
  it('rejects an oversized declared content-length without reading the body', async () => {
    const r = resp({ length: 999 }); r.arrayBuffer = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));
    await expect(downloadAudioBuffer('https://x', { maxBytes: 100 })).rejects.toThrow(/too large/);
    expect(r.arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects an oversized body when no content-length was sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ bytes: 500 })));
    await expect(downloadAudioBuffer('https://x', { maxBytes: 100 })).rejects.toThrow(/too large/);
  });
  it('rejects an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ bytes: 0 })));
    await expect(downloadAudioBuffer('https://x')).rejects.toThrow(/empty body/);
  });
});
