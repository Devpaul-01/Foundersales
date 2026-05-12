// src/utils/parser.js
// ============================================================
// ROBUST AI RESPONSE PARSER
// Handles every edge case gracefully so the app never crashes
// from bad AI output. This is the most important utility.
// ============================================================

/**
 * Attempts to extract and parse JSON from an AI response string.
 * Handles: markdown code blocks, leading/trailing text, nested quotes,
 * single quotes instead of double quotes, trailing commas, and more.
 *
 * @param {string} rawResponse - Raw string from AI model
 * @param {*} fallback - Value to return if all parsing attempts fail
 * @returns {{ data: any, success: boolean, method: string }}
 */
export const parseJSON = (rawResponse, fallback = null) => {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return { data: fallback, success: false, method: 'empty_input' };
  }

  const attempts = [
    // Attempt 1: Direct parse (AI sometimes returns clean JSON)
    () => {
      const trimmed = rawResponse.trim();
      return JSON.parse(trimmed);
    },

    // Attempt 2: Strip markdown code blocks (```json ... ``` or ``` ... ```)
    () => {
      const stripped = rawResponse
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      return JSON.parse(stripped);
    },

    // Attempt 3: Extract first JSON object found in the string
    () => {
      const objectMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!objectMatch) throw new Error('No object found');
      return JSON.parse(objectMatch[0]);
    },

    // Attempt 4: Extract first JSON array found in the string
    () => {
      const arrayMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error('No array found');
      return JSON.parse(arrayMatch[0]);
    },

    // Attempt 5: Fix common AI JSON mistakes then parse
    () => {
      let fixed = rawResponse
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      // Fix trailing commas before closing brackets
      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

      // Fix single quotes used instead of double quotes (tricky - only outside values)
      // This is a best-effort fix for simple cases
      fixed = fixed.replace(/'/g, '"');

      // Fix unquoted keys: { key: "value" } → { "key": "value" }
      fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

      return JSON.parse(fixed);
    },

    // Attempt 6: Extract any valid JSON substring using bracket balancing
    () => {
      const findBalancedJSON = (str, startChar, endChar) => {
        const start = str.indexOf(startChar);
        if (start === -1) return null;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < str.length; i++) {
          const char = str[i];

          if (escaped) { escaped = false; continue; }
          if (char === '\\' && inString) { escaped = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (inString) continue;

          if (char === startChar) depth++;
          if (char === endChar) {
            depth--;
            if (depth === 0) return str.slice(start, i + 1);
          }
        }
        return null;
      };

      const jsonObj = findBalancedJSON(rawResponse, '{', '}');
      if (jsonObj) return JSON.parse(jsonObj);

      const jsonArr = findBalancedJSON(rawResponse, '[', ']');
      if (jsonArr) return JSON.parse(jsonArr);

      throw new Error('No balanced JSON found');
    }
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const data = attempts[i]();
      if (data !== null && data !== undefined) {
        return { data, success: true, method: `attempt_${i + 1}` };
      }
    } catch {
      // Try next attempt
    }
  }

  // All attempts failed - log for debugging, return fallback
  console.warn('[Parser] All JSON parse attempts failed for response:', rawResponse?.slice(0, 200));
  return { data: fallback, success: false, method: 'fallback' };
};

/**
 * Parse a JSON array from AI response.
 * Returns empty array on failure (never throws).
 */
export const parseJSONArray = (rawResponse, fallback = []) => {
  const result = parseJSON(rawResponse, fallback);
  if (result.success && Array.isArray(result.data)) {
    return result.data;
  }

  // If we got an object with an array inside, try to find it
  if (result.success && typeof result.data === 'object') {
    const arrayValue = Object.values(result.data).find(v => Array.isArray(v));
    if (arrayValue) return arrayValue;
  }

  return fallback;
};

/**
 * Parse a JSON object from AI response.
 * Returns empty object on failure (never throws).
 */
export const parseJSONObject = (rawResponse, fallback = {}) => {
  const result = parseJSON(rawResponse, fallback);
  if (result.success && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return result.data;
  }
  return fallback;
};

/**
 * Validate a parsed object has required fields.
 * Fills missing fields with defaults rather than failing.
 *
 * @param {object} obj - Parsed object
 * @param {object} schema - { fieldName: defaultValue }
 * @returns {object} - Object guaranteed to have all fields
 */
export const validateAndFill = (obj, schema) => {
  if (!obj || typeof obj !== 'object') {
    return { ...schema };
  }

  const result = { ...obj };
  for (const [key, defaultValue] of Object.entries(schema)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = defaultValue;
    }
  }
  return result;
};

/**
 * Extract plain text response from AI, cleaning up any markdown artifacts.
 * Used for things like message generation where we just want clean text.
 */
export const parseTextResponse = (rawResponse, fallback = '') => {
  if (!rawResponse || typeof rawResponse !== 'string') return fallback;

  return rawResponse
    .replace(/```[\w]*\n?/g, '')  // Remove code block markers
    .replace(/^(Here's|Here is|Sure,|Certainly,)[^:]*:/i, '')  // Remove preamble
    .replace(/^(Message:|Response:|Draft:)/im, '')  // Remove labels
    .trim();
};

/**
 * Safe number parser from AI response - handles "8/10", "8 out of 10", "8"
 * Returns a number between min and max, or the default if parsing fails.
 */
export const parseScore = (value, { min = 1, max = 10, defaultVal = 5 } = {}) => {
  if (typeof value === 'number') {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  if (typeof value === 'string') {
    // Handle "8/10" format
    const fractionMatch = value.match(/(\d+)\s*\/\s*\d+/);
    if (fractionMatch) return Math.min(max, Math.max(min, parseInt(fractionMatch[1])));

    // Handle plain number string
    const num = parseInt(value);
    if (!isNaN(num)) return Math.min(max, Math.max(min, num));
  }

  return defaultVal;
};
