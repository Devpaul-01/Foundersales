-- 006_reschedule_tracking.sql
-- Backs POST /api/calendar/:id/reschedule and the repeated-reschedule
-- risk-signal heuristic.

ALTER TABLE user_events
  ADD COLUMN reschedule_count integer DEFAULT 0,
  ADD COLUMN original_event_date date,
  ADD COLUMN original_start_time timestamptz;
