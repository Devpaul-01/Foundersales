// src/utils/downloadAudio.js
// Full audit 1.65: voiceMemoService used `fetch(url).then(r => r.arrayBuffer())`
// with no status or size check, so a 404/403/5xx from the storage CDN had its
// error page handed to the transcriber as if it were audio (and surfaced as a
// confusing transcription error). This fails clearly instead.
export const downloadAudioBuffer = async (url, { maxBytes } = {}) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Audio download failed: HTTP ${res.status}`);
  }
  const declared = Number(res.headers?.get?.('content-length'));
  if (maxBytes && declared > maxBytes) {
    throw new Error(`Audio download too large: ${declared} bytes (max ${maxBytes})`);
  }
  const buf = await res.arrayBuffer();
  if (maxBytes && buf.byteLength > maxBytes) {
    throw new Error(`Audio download too large: ${buf.byteLength} bytes (max ${maxBytes})`);
  }
  if (buf.byteLength === 0) {
    throw new Error('Audio download returned an empty body');
  }
  return buf;
};
