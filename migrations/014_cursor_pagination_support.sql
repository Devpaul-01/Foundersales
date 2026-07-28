-- 014_cursor_pagination_support.sql
-- Stable monotonic ordering column for cursor-based pagination on
-- GET /api/calendar and GET /api/calendar/search, mirroring the existing
-- `seq` pattern already used on chats/chat_messages elsewhere in this
-- codebase. Adding a bigserial column populates existing rows with
-- sequential values automatically as part of the column definition —
-- this is not manual backfill logic, so it stays forward-only.

ALTER TABLE user_events
  ADD COLUMN seq bigserial;

CREATE UNIQUE INDEX idx_user_events_seq ON user_events(seq);

-- Composite index supporting the cursor query shape:
-- WHERE workspace_id = $1 AND user_id = $2 AND (event_date, seq) < ($cursor_date, $cursor_seq)
CREATE INDEX idx_user_events_cursor
  ON user_events(workspace_id, user_id, event_date DESC, seq DESC);
