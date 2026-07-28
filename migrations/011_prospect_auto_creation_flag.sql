-- 012_prospect_auto_creation_flag.sql
-- Makes the CRM-write side effect of event creation an explicit, visible
-- part of the API contract instead of an invisible always-on behavior.

ALTER TABLE user_events
  ADD COLUMN prospect_auto_created boolean DEFAULT false;
