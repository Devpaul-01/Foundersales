// src/services/groq-client.js
// ============================================================
// CORE API LAYER — Groq HTTP client, model config, and API key
// ============================================================

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const PRIMARY_MODEL = process.env.GROQ_PRIMARY_MODEL || 'llama-3.1-8b-instant';
export const PRO_MODEL     = process.env.GROQ_PRO_MODEL     || 'llama-3.3-70b-versatile';
export const FLASH_MODEL   = process.env.GROQ_FLASH_MODEL   || 'llama-3.1-8b-instant';

const getApiKey = () => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set in .env');
  return key;
};

// ──────────────────────────────────────────
// CORE: Non-streaming Groq call (with 3-attempt retry)
// ──────────────────────────────────────────
export const callGroq = async ({
  messages,
  systemPrompt = '',
  temperature  = 0.7,
  maxTokens    = 1200,
  modelName    = PRIMARY_MODEL,
  _apiKey      = null,
}) => {
  const apiKey = _apiKey || getApiKey();

  const body = {
    model:      modelName,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' }))
    ]
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(GROQ_BASE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(30000), // 30s hard timeout per attempt
      });

      if (!res.ok) {
        const err    = await res.json().catch(() => ({}));
        const status = res.status;
        if (status === 401 || status === 403) throw new Error('GROQ_AUTH_ERROR: Invalid API key');
        if (status === 429) throw new Error(`GROQ_RATE_LIMIT: ${err?.error?.message || 'Too many requests'}`);
        if (status === 400) throw new Error(`GROQ_BAD_REQUEST: ${err?.error?.message || 'Bad request'}`);
        throw new Error(`GROQ_UNAVAILABLE: HTTP ${status} — ${err?.error?.message || 'Unknown error'}`);
      }

      const data    = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const usage   = data.usage || {};

      return {
        content,
        tokens_in:    usage.prompt_tokens     || 0,
        tokens_out:   usage.completion_tokens || 0,
        tokens_total: usage.total_tokens      || 0,
        model_used:   modelName
      };
    } catch (err) {
      if (err.message.startsWith('GROQ_AUTH') || err.message.startsWith('GROQ_BAD')) throw err;
      if (attempt === 3) throw new Error(`GROQ_UNAVAILABLE: ${err.message}`);
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
};

// ──────────────────────────────────────────
// CORE: Streaming Groq call
// ──────────────────────────────────────────
export const streamGroq = async ({
  messages,
  systemPrompt = '',
  temperature  = 0.7,
  maxTokens    = 1200,
  modelName    = PRIMARY_MODEL,
  _apiKey      = null,
  onToken,
  onComplete,
  onError
}) => {
  try {
    const apiKey = _apiKey || getApiKey();

    const body = {
      model:      modelName,
      temperature,
      max_tokens: maxTokens,
      stream:     true,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' }))
      ]
    };

    const res = await fetch(GROQ_BASE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60000), // 60s for streaming
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GROQ_UNAVAILABLE: HTTP ${res.status} — ${err?.error?.message || 'stream failed'}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let tokensIn = 0, tokensOut = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const token  = parsed.choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken?.(token); }
          if (parsed.x_groq?.usage) {
            tokensIn  = parsed.x_groq.usage.prompt_tokens     || 0;
            tokensOut = parsed.x_groq.usage.completion_tokens || 0;
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    onComplete?.(fullContent, {
      tokens_in:  tokensIn,
      tokens_out: tokensOut || Math.ceil(fullContent.length / 4),
      model_used: modelName
    });
  } catch (err) {
    onError?.(err);
  }
};
