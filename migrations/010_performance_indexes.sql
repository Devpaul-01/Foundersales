-- 011_performance_indexes.sql

CREATE INDEX IF NOT EXISTS idx_user_events_workspace_user_date
  ON user_events(workspace_id, user_id, event_date);

CREATE INDEX IF NOT EXISTS idx_commitments_workspace_user_owner_status
  ON conversation_commitments(workspace_id, user_id, owner, status);

CREATE INDEX IF NOT EXISTS idx_signals_prospect_workspace_user_active
  ON conversation_signals(prospect_id, workspace_id, user_id, is_active);

-- Partial index for the pre-meeting reminder scan job
CREATE INDEX IF NOT EXISTS idx_user_events_reminder_scan
  ON user_events(event_date, start_time)
  WHERE reminder_sent = false;

-- Partial index for the consolidated prep-generation sweep
CREATE INDEX IF NOT EXISTS idx_user_events_prep_pending
  ON user_events(event_date)
  WHERE prep_generated = false AND prep_failed = false;
