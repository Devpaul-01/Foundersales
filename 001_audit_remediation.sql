-- ============================================================================
-- Foundersales — Audit Remediation Migration
-- Run top to bottom in a single transaction where possible.
-- Sections that require manual confirmation before running are marked.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. skill_progression — add columns the app already computes (HIGH-12 fix
--    landed in code, never got a matching migration)
-- ----------------------------------------------------------------------------
ALTER TABLE public.skill_progression
  ADD COLUMN IF NOT EXISTS discovery_score_avg numeric(4,2),
  ADD COLUMN IF NOT EXISTS objection_score_avg numeric(4,2),
  ADD COLUMN IF NOT EXISTS brevity_score_avg   numeric(4,2);

-- ----------------------------------------------------------------------------
-- 2. practice_sessions.workspace_id
--    MANUAL STEP FIRST: run this SELECT before applying the block below.
--    If it returns a row, the column already exists in your live DB and the
--    schema export given to the audit was stale — skip straight to the
--    backfill UPDATE (harmless no-op if already populated) and the index.
--
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'practice_sessions' AND column_name = 'workspace_id';
-- ----------------------------------------------------------------------------
ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE public.practice_sessions ps
SET workspace_id = c.workspace_id
FROM public.chats c
WHERE ps.chat_id = c.id
  AND ps.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_practice_sessions_workspace_user
  ON public.practice_sessions (workspace_id, user_id);

-- Do NOT run this until you've confirmed zero remaining NULLs — practice
-- sessions with no chat_id (if any exist) will not have been backfilled:
--   SELECT count(*) FROM practice_sessions WHERE workspace_id IS NULL;
--   ALTER TABLE public.practice_sessions ALTER COLUMN workspace_id SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. job_logs — add a metadata bucket so logJob() never has to drop or fail
--    on a field name it doesn't recognize (root cause of Finding #6)
-- ----------------------------------------------------------------------------
ALTER TABLE public.job_logs
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 4. Defensive unique constraints backing every onConflict() the application
--    code relies on. Schema export excluded constraints, so these are
--    guarded (skip silently if already present) rather than assumed missing.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_performance_profiles_user_workspace_key') THEN
    ALTER TABLE public.user_performance_profiles
      ADD CONSTRAINT user_performance_profiles_user_workspace_key UNIQUE (user_id, workspace_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_workspace_user_url_key') THEN
    ALTER TABLE public.opportunities
      ADD CONSTRAINT opportunities_workspace_user_url_key UNIQUE (workspace_id, user_id, source_url);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_patterns_ws_user_label_key') THEN
    ALTER TABLE public.communication_patterns
      ADD CONSTRAINT communication_patterns_ws_user_label_key UNIQUE (workspace_id, user_id, pattern_label);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_curriculum_user_workspace_key') THEN
    ALTER TABLE public.practice_curriculum
      ADD CONSTRAINT practice_curriculum_user_workspace_key UNIQUE (user_id, workspace_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_progression_ws_user_week_key') THEN
    ALTER TABLE public.skill_progression
      ADD CONSTRAINT skill_progression_ws_user_week_key UNIQUE (workspace_id, user_id, week_start);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_metrics_user_workspace_date_key') THEN
    ALTER TABLE public.daily_metrics
      ADD CONSTRAINT daily_metrics_user_workspace_date_key UNIQUE (user_id, workspace_id, date);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objection_tracker_ws_user_type_key') THEN
    ALTER TABLE public.objection_tracker
      ADD CONSTRAINT objection_tracker_ws_user_type_key UNIQUE (workspace_id, user_id, objection_type);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Legacy function migration — increment_performance_stats
--    feedback.js already calls a 3-arg version (p_user_id, p_is_positive,
--    p_workspace_id) that did not exist in the schema — this was a live,
--    confirmed-broken call site (PostgREST "no function matches" error on
--    every feedback submission). Create it for real, and turn the original
--    2-arg signature into a compatibility shim instead of deleting it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_performance_stats(
  p_user_id uuid,
  p_is_positive boolean,
  p_workspace_id uuid
) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO user_performance_profiles
    (user_id, workspace_id, total_sent, total_positive, total_negative, positive_rate)
  VALUES (
    p_user_id, p_workspace_id, 1,
    CASE WHEN p_is_positive THEN 1 ELSE 0 END,
    CASE WHEN p_is_positive THEN 0 ELSE 1 END,
    CASE WHEN p_is_positive THEN 1.0 ELSE 0.0 END
  )
  ON CONFLICT (user_id, workspace_id) DO UPDATE SET
    total_sent     = user_performance_profiles.total_sent + 1,
    total_positive = user_performance_profiles.total_positive
                     + (CASE WHEN p_is_positive THEN 1 ELSE 0 END),
    total_negative = user_performance_profiles.total_negative
                     + (CASE WHEN p_is_positive THEN 0 ELSE 1 END),
    positive_rate  = ROUND(
      (user_performance_profiles.total_positive
       + (CASE WHEN p_is_positive THEN 1 ELSE 0 END))::NUMERIC
      / (user_performance_profiles.total_sent + 1), 4
    ),
    updated_at = now();
END;
$$;

-- Compatibility shim for the old 2-arg signature, in case any route outside
-- the reviewed codebase still calls it. Resolves workspace via the user's
-- active workspace instead of crashing with a NOT NULL violation.
CREATE OR REPLACE FUNCTION public.increment_performance_stats(
  p_user_id uuid,
  p_is_positive boolean
) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT active_workspace_id INTO v_workspace_id FROM users WHERE id = p_user_id;
  IF v_workspace_id IS NULL THEN
    RAISE WARNING 'increment_performance_stats(2-arg): user % has no active_workspace_id, skipping', p_user_id;
    RETURN;
  END IF;
  PERFORM public.increment_performance_stats(p_user_id, p_is_positive, v_workspace_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Legacy function migration — objection_tracker
--    The 4-arg upsert_objection_count(workspace_id, user_id, type, phrase)
--    is already correct and matches its only known caller
--    (conversationAnalysisJob.js) — left untouched.
--
--    The two 3-arg legacy overloads insert without workspace_id (NOT NULL,
--    no default) and will crash if invoked. No caller was found anywhere in
--    the reviewed codebase, but per instructions we don't delete blind —
--    convert both into compatibility shims that resolve workspace via the
--    user's active workspace and delegate into the safe 4-arg version.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_objection_count(
  p_user_id uuid,
  p_objection_type text,
  p_phrase text
) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT active_workspace_id INTO v_workspace_id FROM users WHERE id = p_user_id;
  IF v_workspace_id IS NULL THEN
    RAISE WARNING 'upsert_objection_count(3-arg): user % has no active_workspace_id, skipping', p_user_id;
    RETURN;
  END IF;
  PERFORM public.upsert_objection_count(v_workspace_id, p_user_id, p_objection_type, p_phrase);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_objection_tracker(
  p_user_id uuid,
  p_objection_type text,
  p_objection_phrase text
) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT active_workspace_id INTO v_workspace_id FROM users WHERE id = p_user_id;
  IF v_workspace_id IS NULL THEN
    RAISE WARNING 'upsert_objection_tracker: user % has no active_workspace_id, skipping', p_user_id;
    RETURN;
  END IF;
  PERFORM public.upsert_objection_count(v_workspace_id, p_user_id, p_objection_type, p_objection_phrase);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Token tracking redesign — drop the old, unreliable tables/functions.
--    Confirmed with stakeholder: no production users, no backfill required.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.increment_token_usage(uuid, date, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.increment_monthly_token_usage(uuid, date, bigint, bigint, integer);
DROP FUNCTION IF EXISTS public.increment_perplexity_usage(uuid, date, integer);
DROP FUNCTION IF EXISTS public.increment_perplexity_user_usage(uuid, text);
DROP FUNCTION IF EXISTS public.increment_perplexity_global_usage(text);
DROP FUNCTION IF EXISTS public.increment_workspace_perplexity_usage(uuid, text);

DROP TABLE IF EXISTS public.usage_tracking;
DROP TABLE IF EXISTS public.monthly_token_usage;
DROP TABLE IF EXISTS public.perplexity_usage;
DROP TABLE IF EXISTS public.workspace_perplexity_usage;
DROP TABLE IF EXISTS public.global_usage;

-- ----------------------------------------------------------------------------
-- 8. Token tracking redesign — new schema
--    ai_usage_events  = granular, append-only, source of truth (billing-ready)
--    workspace_ai_usage_daily = fast rollup for quota checks, both workspace
--    AND global totals can be derived from this one table (sum across
--    workspace_id for a date), so there's only one place that can drift.
-- ----------------------------------------------------------------------------
CREATE TABLE public.ai_usage_events (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         uuid NOT NULL,
  user_id              uuid NOT NULL,
  provider             text NOT NULL,             -- 'groq' | 'exa'
  event_type           text NOT NULL,              -- 'completion' | 'search'
  model                text,                       -- groq model id; null for exa
  tier                 text,                       -- 'fast' | 'quality' (groq only)
  tokens_in            integer DEFAULT 0 NOT NULL,
  tokens_out           integer DEFAULT 0 NOT NULL,
  total_tokens         integer DEFAULT 0 NOT NULL,
  credits_used         numeric(10,4) DEFAULT 0 NOT NULL,   -- exa search credits
  estimated_cost_cents integer DEFAULT 0 NOT NULL,
  source_job           text,                       -- e.g. 'memory_extraction'
  metadata             jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at           timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_ai_usage_events_workspace_date ON public.ai_usage_events (workspace_id, created_at);
CREATE INDEX idx_ai_usage_events_user_date      ON public.ai_usage_events (user_id, created_at);
CREATE INDEX idx_ai_usage_events_provider_date  ON public.ai_usage_events (provider, created_at);

CREATE TABLE public.workspace_ai_usage_daily (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         uuid NOT NULL,
  date                 date NOT NULL,
  provider             text NOT NULL,              -- 'groq' | 'exa'
  call_count           integer DEFAULT 0 NOT NULL,
  total_tokens         integer DEFAULT 0 NOT NULL,
  total_credits        numeric(10,4) DEFAULT 0 NOT NULL,
  estimated_cost_cents integer DEFAULT 0 NOT NULL,
  updated_at           timestamptz DEFAULT now() NOT NULL,
  UNIQUE (workspace_id, date, provider)
);

CREATE INDEX idx_workspace_ai_usage_daily_date ON public.workspace_ai_usage_daily (date);

-- Atomic write helper: one event row + one rollup upsert, in a single
-- function call (one round trip, race-condition-safe).
CREATE OR REPLACE FUNCTION public.record_ai_usage(
  p_workspace_id  uuid,
  p_user_id       uuid,
  p_provider      text,
  p_event_type    text,
  p_model         text,
  p_tier          text,
  p_tokens_in     integer,
  p_tokens_out    integer,
  p_credits_used  numeric,
  p_cost_cents    integer,
  p_source_job    text,
  p_metadata      jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_event_id     uuid;
  v_total_tokens integer := COALESCE(p_tokens_in, 0) + COALESCE(p_tokens_out, 0);
  v_today        date := CURRENT_DATE;
BEGIN
  INSERT INTO ai_usage_events (
    workspace_id, user_id, provider, event_type, model, tier,
    tokens_in, tokens_out, total_tokens, credits_used,
    estimated_cost_cents, source_job, metadata
  ) VALUES (
    p_workspace_id, p_user_id, p_provider, p_event_type, p_model, p_tier,
    COALESCE(p_tokens_in, 0), COALESCE(p_tokens_out, 0), v_total_tokens,
    COALESCE(p_credits_used, 0), COALESCE(p_cost_cents, 0), p_source_job,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO workspace_ai_usage_daily (
    workspace_id, date, provider, call_count, total_tokens, total_credits, estimated_cost_cents
  ) VALUES (
    p_workspace_id, v_today, p_provider, 1, v_total_tokens, COALESCE(p_credits_used, 0), COALESCE(p_cost_cents, 0)
  )
  ON CONFLICT (workspace_id, date, provider) DO UPDATE SET
    call_count            = workspace_ai_usage_daily.call_count + 1,
    total_tokens          = workspace_ai_usage_daily.total_tokens + v_total_tokens,
    total_credits         = workspace_ai_usage_daily.total_credits + COALESCE(p_credits_used, 0),
    estimated_cost_cents  = workspace_ai_usage_daily.estimated_cost_cents + COALESCE(p_cost_cents, 0),
    updated_at            = now();

  RETURN v_event_id;
END;
$$;

COMMIT;

-- ============================================================================
-- Post-migration verification queries (run manually, not part of the
-- transaction above):
--
--   SELECT count(*) FROM practice_sessions WHERE workspace_id IS NULL;
--   SELECT * FROM pg_proc WHERE proname = 'increment_performance_stats';
--   SELECT * FROM pg_proc WHERE proname IN ('upsert_objection_count','upsert_objection_tracker');
-- ============================================================================
