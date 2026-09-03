import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../pagination.js';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a valid row through encode and decode', () => {
    const row = { event_date: '2026-03-15', seq: 42 };

    const cursor = encodeCursor(row);
    const decoded = decodeCursor(cursor);

    expect(decoded).toEqual({ date: '2026-03-15', seq: 42 });
  });

  it('safely rejects null, malformed, and incomplete cursors without throwing', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('not-valid-base64!!!')).toBeNull();

    const incompleteCursor = Buffer.from(
      JSON.stringify({ date: '2026-03-15' }) // missing `seq`
    ).toString('base64url');
    expect(decodeCursor(incompleteCursor)).toBeNull();
  });
});
