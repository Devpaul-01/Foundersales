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

export const parseAIJson = (content) => {
  const cleaned = (content || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new AIParseError(`Failed to parse AI response as JSON: ${err.message}`, cleaned);
  }
};
