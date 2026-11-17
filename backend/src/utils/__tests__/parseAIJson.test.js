import { describe, it, expect } from 'vitest';
import { parseAIJson, AIParseError } from '../parseAIJson.js';

describe('parseAIJson', () => {
  // Everything the previous implementation could parse must still parse identically.
  it.each([
    ['bare object', '{"a":1}', { a: 1 }],
    ['bare array', '[1,2]', [1, 2]],
    ['fenced with json tag', '```json\n{"a":1}\n```', { a: 1 }],
    ['fenced without tag', '```\n[1]\n```', [1]],
    ['leading fence, truncated closing fence', '```json\n{"a":1}', { a: 1 }],
    ['whitespace around', '  \n {"a":1} \n ', { a: 1 }],
    ['uppercase tag', '```JSON\n{"a":1}\n```', { a: 1 }],
  ])('parses %s', (_n, input, expected) => expect(parseAIJson(input)).toEqual(expected));

  it('keeps triple backticks that are INSIDE a string value (previously corrupted)', () => {
    const out = parseAIJson('{"msg":"use ```npm i``` first"}');
    expect(out).toEqual({ msg: 'use ```npm i``` first' });
    expect(parseAIJson('```json\n{"msg":"a ```b``` c"}\n```')).toEqual({ msg: 'a ```b``` c' });
  });

  it('throws AIParseError for non-JSON, empty and nullish input', () => {
    for (const bad of ['Here is your JSON: {"a":1}', '', null, undefined, '{"a":']) {
      expect(() => parseAIJson(bad)).toThrow(AIParseError);
    }
  });
});
