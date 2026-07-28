// src/services/transcription.js
// ============================================================
// AUDIO TRANSCRIPTION — Groq Whisper-compatible endpoint
//
// multiProvider.js's callWithFallback/callWithFallbackGroq are shaped for
// /chat/completions (JSON in, JSON out) and cannot be reused directly for
// audio transcription, which requires a multipart/form-data POST to a
// DIFFERENT endpoint (/audio/transcriptions) and returns transcript text,
// not a chat completion. This module is a focused sibling to
// multiProvider.js — same provider (Groq), same API-key-pool convention
// (GROQ_API_KEY_1..10 / GROQ_API_KEY fallback), same cooldown-on-failure
// behavior, but a distinct request shape.
//
// Deliberately NOT added to multiProvider.js's PROVIDER_REGISTRY /
// buildProviderQueue machinery, since that machinery is built entirely
// around JSON chat-completion bodies and fallback across FOUR providers
// (Cerebras/Groq/Mistral/OpenRouter) — only Groq offers Whisper-compatible
// transcription today, so there is no meaningful multi-provider fallback
// to build here yet. If that changes, this is the module to extend.
// ============================================================

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = 'whisper-large-v3-turbo'; // Groq's fast Whisper-compatible model

const getGroqKeys = () => {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key?.trim()) keys.push(key.trim());
  }
  if (keys.length === 0 && process.env.GROQ_API_KEY?.trim()) {
    keys.push(process.env.GROQ_API_KEY.trim());
  }
  return keys;
};

/**
 * Transcribes an audio buffer via Groq's Whisper-compatible endpoint.
 * Tries each configured Groq key in order on failure (simple sequential
 * fallback — no cooldown/multi-provider machinery needed for a single
 * provider; see file header).
 *
 * @param {ArrayBuffer|Buffer} audioData
 * @param {{ mimeType: string, filename?: string }} opts
 * @returns {{ text: string }}
 */
export const transcribeAudio = async (audioData, { mimeType, filename = 'audio.webm' } = {}) => {
  const keys = getGroqKeys();
  if (!keys.length) {
    throw new Error('No GROQ_API_KEY configured — audio transcription unavailable.');
  }

  const buffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);
  let lastError;

  for (const apiKey of keys) {
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType }), filename);
      form.append('model', WHISPER_MODEL);
      form.append('response_format', 'json');

      const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return { text: (data.text || '').trim() };
    } catch (err) {
      lastError = err;
      console.warn(`[Transcription] Groq key attempt failed: ${err.message}`);
    }
  }

  throw new Error(`TRANSCRIPTION_FAILED: ${lastError?.message || 'all Groq keys exhausted'}`);
};

export default { transcribeAudio };
