-- 003_recurring_events.sql
-- RFC 5545 RRULE subset stored on a parent row; occurrences expanded at read
-- time. Only materialized into a real row when a specific occurrence is
-- edited or debriefed (see calendarPrep.js / calendar.js GET / for expansion).

ALTER TABLE user_events
  ADD COLUMN recurrence_rule text,
  ADD COLUMN recurrence_parent_id uuid REFERENCES user_events(id) ON DELETE SET NULL,
  ADD COLUMN recurrence_exception_dates date[] DEFAULT '{}'::date[];

CREATE INDEX idx_user_events_recurrence_parent
  ON user_events(recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;
