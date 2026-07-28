-- 010_followup_tracking.sql

ALTER TABLE user_events
  ADD COLUMN follow_up_variant_sent text, -- 'brief' | 'substantive' | 're_engagement' | NULL
  ADD COLUMN follow_up_sent_at timestamptz;
