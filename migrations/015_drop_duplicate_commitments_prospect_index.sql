-- 015_drop_duplicate_commitments_prospect_index.sql
-- conversation_commitments had two exact-duplicate indexes on prospect_id
-- (idx_commitments_prospect and idx_commits_prospect — same table, same
-- column, same index type), almost certainly from two separate migration
-- passes that didn't check for an existing equivalent before adding one.
-- Confirmed by repo-wide grep that neither index name is referenced by
-- any application code or tooling, so dropping either is safe; kept
-- idx_commitments_prospect (the one schema.sql already listed first) as
-- canonical. See docs/backend-takeover/AUDIT.md.
--
-- Forward-only, non-destructive to data: this drops an index, not a
-- column or any rows. Safe to run on an existing database at any time;
-- the query planner will keep using the remaining identical index.

DROP INDEX IF EXISTS idx_commits_prospect;
