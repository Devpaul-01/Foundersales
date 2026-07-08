-- ================================================================
-- MIGRATION: unique constraint on user_performance_profiles
--
-- Required by the upsert in summarizeUserPerformance:
--   .upsert({ ... }, { onConflict: 'user_id,workspace_id' })
--
-- Without this constraint Supabase/Postgres can't resolve the
-- ON CONFLICT target and the upsert throws a runtime error.
-- ================================================================

-- 1. Remove any accidental duplicate rows before adding the constraint
--    (keeps the most recently updated row per user+workspace pair).
DELETE FROM public.user_performance_profiles
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, workspace_id) id
  FROM   public.user_performance_profiles
  ORDER  BY user_id, workspace_id, updated_at DESC NULLS LAST
);

-- 2. Add the unique constraint the upsert relies on.
ALTER TABLE public.user_performance_profiles
  ADD CONSTRAINT uq_user_performance_profiles_user_workspace
  UNIQUE (user_id, workspace_id);
