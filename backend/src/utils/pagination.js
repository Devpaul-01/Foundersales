// src/utils/pagination.js
// ============================================================
// CURSOR-BASED PAGINATION HELPERS
//
// Cursor shape: base64url(JSON.stringify({ date, seq })), ordered by
// (event_date DESC, seq DESC) — matches migration 014's composite index
// exactly, so this is an index-backed keyset pagination, not a scan.
// ============================================================

export const encodeCursor = (row) => {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ date: row.event_date, seq: row.seq })).toString('base64url');
};

export const decodeCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed.date || parsed.seq == null) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Applies a keyset WHERE clause to a Supabase query builder for
 * (event_date, seq) DESC ordering: fetch rows strictly "before" the cursor.
 * Expressed as an OR of two conditions equivalent to
 * (event_date, seq) < (cursor.date, cursor.seq):
 *   event_date < cursor.date
 *   OR (event_date = cursor.date AND seq < cursor.seq)
 */
export const applyCursor = (query, cursor) => {
  if (!cursor) return query;
  return query.or(`event_date.lt.${cursor.date},and(event_date.eq.${cursor.date},seq.lt.${cursor.seq})`);
};

export const buildPageResponse = (rows, limit) => {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page,
    pagination: {
      next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
      has_more: hasMore,
    },
  };
};
