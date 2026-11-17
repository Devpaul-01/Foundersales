// src/utils/parseAIJson.js
// Shared JSON parser for all AI responses.
// Replaces 6+ inline JSON.parse(content.replace(...).trim()) calls.
// Throws a typed AIParseError on failure so callers can distinguish
// a parse failure from other runtime errors.

export class AIParseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'AIParseError';
    this.raw  = raw;
  }
}

// Full audit 1.70: the old version removed every triple-backtick anywhere,
// including inside JSON string values (e.g. a drafted message containing a code
// block), corrupting otherwise valid JSON. Now tried in order, and the original
// behavior is kept as the final fallback, so nothing that parsed before stops parsing:
//   1. the text as-is, 2. with only leading/trailing code fences removed,
//   3. with every fence removed (previous behavior).
export const parseAIJson = (content) => {
  const raw = (content || '').trim();
  const edgeStripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const allStripped = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  let firstError;
  for (const candidate of [raw, edgeStripped, allStripped]) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      firstError ??= err;
    }
  }
  throw new AIParseError(`Failed to parse AI response as JSON: ${firstError.message}`, allStripped);
};
