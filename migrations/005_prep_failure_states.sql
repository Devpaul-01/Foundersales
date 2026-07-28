-- 005_prep_failure_states.sql
-- Lets the UI show a real failure branch instead of an infinite
-- "Preparing..." pulse when a BullMQ job exhausts its retries.

ALTER TABLE user_events
  ADD COLUMN prep_failed boolean DEFAULT false,
  ADD COLUMN prep_failed_at timestamptz,
  ADD COLUMN prep_failure_reason text;
