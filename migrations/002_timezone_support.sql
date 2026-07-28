-- 002_timezone_support.sql
-- Adds timezone support: workspace-level default + per-event override.
-- Forward-only — no production users yet, no backfill needed.

ALTER TABLE workspace_profiles
  ADD COLUMN default_timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE user_events
  ADD COLUMN timezone text; -- IANA tz string, e.g. 'America/New_York'; NULL = inherit workspace default

COMMENT ON COLUMN user_events.timezone IS
  'Per-event timezone override. NULL means the event inherits workspace_profiles.default_timezone at read time.';
