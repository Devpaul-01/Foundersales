--
-- PostgreSQL database dump
--

\restrict JAYd5WShn4Frbnh8BydktaFSp420oOBgifoW2FwVN7X2bD1zN8E2CW8g4yOq2WH

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_workspace_invite(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_workspace_invite(p_user_id uuid, p_token_hash text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_member       workspace_members%ROWTYPE;
    v_workspace_id UUID;
      v_role         TEXT;
        v_owner_id     UUID;
          v_owner_profile workspace_profiles%ROWTYPE;
          BEGIN
            -- Get the pending invite
              SELECT * INTO v_member
                FROM   workspace_members
                  WHERE  invite_token  = p_token_hash
                      AND  status        = 'pending_invite'
                          AND  (invite_expires_at IS NULL OR invite_expires_at > NOW())
                            LIMIT 1
                              FOR UPDATE;

                                IF NOT FOUND THEN
                                    RETURN json_build_object('error', 'INVALID_OR_EXPIRED_TOKEN');
                                      END IF;

                                        -- Check if already a member
                                          IF EXISTS (
                                              SELECT 1 FROM workspace_members
                                                  WHERE workspace_id = v_member.workspace_id
                                                        AND user_id      = p_user_id
                                                              AND status       = 'active'
                                                                ) THEN
                                                                    RETURN json_build_object('error', 'ALREADY_A_MEMBER');
                                                                      END IF;

                                                                        v_workspace_id := v_member.workspace_id;
                                                                          v_role         := v_member.role;

                                                                            -- Get workspace owner
                                                                              SELECT owner_user_id INTO v_owner_id
                                                                                FROM workspaces
                                                                                  WHERE id = v_workspace_id;

                                                                                    -- Get owner's profile
                                                                                      SELECT * INTO v_owner_profile
                                                                                        FROM workspace_profiles
                                                                                          WHERE workspace_id = v_workspace_id
                                                                                              AND user_id = v_owner_id
                                                                                                LIMIT 1;

                                                                                                  -- Update invite to active membership
                                                                                                    UPDATE workspace_members
                                                                                                      SET    user_id      = p_user_id,
                                                                                                               status       = 'active',
                                                                                                                        joined_at    = NOW(),
                                                                                                                                 invite_token = NULL
                                                                                                                                   WHERE  id = v_member.id;

                                                                                                                                     -- Insert profile with defaults from owner (NO DUPLICATES)
                                                                                                                                       INSERT INTO workspace_profiles (
                                                                                                                                           workspace_id,
                                                                                                                                               user_id,
                                                                                                                                                   onboarding_completed,
                                                                                                                                                       onboarding_step,
                                                                                                                                                           onboarding_questions,
                                                                                                                                                               preferred_platforms,
                                                                                                                                                                   product_description,
                                                                                                                                                                       target_audience,
                                                                                                                                                                           voice_profile,
                                                                                                                                                                               onboarding_answers,
                                                                                                                                                                                   primary_goal,
                                                                                                                                                                                       archetype,
                                                                                                                                                                                           industry,
                                                                                                                                                                                               business_stage
                                                                                                                                                                                                 )
                                                                                                                                                                                                   VALUES (
                                                                                                                                                                                                       v_workspace_id,
                                                                                                                                                                                                           p_user_id,
                                                                                                                                                                                                               false,
                                                                                                                                                                                                                   1,
                                                                                                                                                                                                                       COALESCE(v_owner_profile.onboarding_questions, '{}'::jsonb),
                                                                                                                                                                                                                           COALESCE(v_owner_profile.preferred_platforms, '{}'::text[]),
                                                                                                                                                                                                                               v_owner_profile.product_description,
                                                                                                                                                                                                                                   v_owner_profile.target_audience,
                                                                                                                                                                                                                                       COALESCE(v_owner_profile.voice_profile, '{}'::jsonb),
                                                                                                                                                                                                                                           COALESCE(v_owner_profile.onboarding_answers, '{}'::jsonb),
                                                                                                                                                                                                                                               v_owner_profile.primary_goal,
                                                                                                                                                                                                                                                   v_owner_profile.archetype,
                                                                                                                                                                                                                                                       v_owner_profile.industry,
                                                                                                                                                                                                                                                           v_owner_profile.business_stage
                                                                                                                                                                                                                                                             )
                                                                                                                                                                                                                                                               ON CONFLICT (workspace_id, user_id) DO UPDATE SET
                                                                                                                                                                                                                                                                   onboarding_questions = EXCLUDED.onboarding_questions,
                                                                                                                                                                                                                                                                       preferred_platforms = EXCLUDED.preferred_platforms,
                                                                                                                                                                                                                                                                           product_description = EXCLUDED.product_description,
                                                                                                                                                                                                                                                                               target_audience = EXCLUDED.target_audience,
                                                                                                                                                                                                                                                                                   voice_profile = EXCLUDED.voice_profile,
                                                                                                                                                                                                                                                                                       onboarding_answers = EXCLUDED.onboarding_answers,
                                                                                                                                                                                                                                                                                           primary_goal = EXCLUDED.primary_goal,
                                                                                                                                                                                                                                                                                               archetype = EXCLUDED.archetype,
                                                                                                                                                                                                                                                                                                   industry = EXCLUDED.industry,
                                                                                                                                                                                                                                                                                                       business_stage = EXCLUDED.business_stage;

                                                                                                                                                                                                                                                                                                         -- Update user's active workspace
                                                                                                                                                                                                                                                                                                           UPDATE users
                                                                                                                                                                                                                                                                                                             SET active_workspace_id = v_workspace_id
                                                                                                                                                                                                                                                                                                               WHERE id = p_user_id;

                                                                                                                                                                                                                                                                                                                 RETURN json_build_object(
                                                                                                                                                                                                                                                                                                                     'workspace_id', v_workspace_id,
                                                                                                                                                                                                                                                                                                                         'role',         v_role
                                                                                                                                                                                                                                                                                                                           );

                                                                                                                                                                                                                                                                                                                           EXCEPTION
                                                                                                                                                                                                                                                                                                                             WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                 RAISE;
                                                                                                                                                                                                                                                                                                                                 END;
                                                                                                                                                                                                                                                                                                                                 $$;


--
-- Name: create_user_profile(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_profile(p_id uuid, p_email text, p_name text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
          BEGIN
            INSERT INTO users (id, email, name, tier, created_at)
              VALUES (p_id, p_email, p_name, p_tier, NOW())
                ON CONFLICT (id) DO NOTHING;  -- safe if called twice
                END;
                $$;


--
-- Name: create_user_with_workspace(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_with_workspace(p_user_id uuid, p_email text, p_name text, p_tier text DEFAULT 'free'::text, p_workspace_name text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id UUID;
  v_slug         TEXT;
  v_ws_name      TEXT;
BEGIN
  INSERT INTO users (id, email, name, tier)
  VALUES (p_user_id, p_email, p_name, p_tier)
  ON CONFLICT (id) DO NOTHING;

  v_ws_name := COALESCE(
    p_workspace_name,
    COALESCE(p_name, split_part(p_email, '@', 1)) || '''s Workspace'
  );
  v_slug := lower(regexp_replace(
    COALESCE(p_name, split_part(p_email, '@', 1)),
    '[^a-z0-9]+', '-', 'g'
  )) || '-' || substring(p_user_id::TEXT, 1, 8);

  INSERT INTO workspaces (name, slug, plan, owner_user_id)
  VALUES (v_ws_name, v_slug, p_tier, p_user_id)
  RETURNING id INTO v_workspace_id;

  INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
  VALUES (v_workspace_id, p_user_id, 'owner', 'active', now());

  INSERT INTO workspace_profiles (workspace_id, user_id)
  VALUES (v_workspace_id, p_user_id);

  UPDATE users SET active_workspace_id = v_workspace_id WHERE id = p_user_id;

  RETURN json_build_object('workspace_id', v_workspace_id, 'slug', v_slug);
END;
$$;


--
-- Name: create_workspace_for_user(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_workspace_for_user(p_user_id uuid, p_name text, p_slug text, p_plan text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id UUID;
  v_result       JSON;
BEGIN
  -- 1. Insert workspace
  INSERT INTO workspaces (name, slug, plan, owner_user_id, is_deleted, settings)
  VALUES (p_name, p_slug, p_plan, p_user_id, false, '{}')
  RETURNING id INTO v_workspace_id;

  -- 2. Insert owner membership
  INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
  VALUES (v_workspace_id, p_user_id, 'owner', 'active', NOW());

  -- 3. Insert empty workspace_profile (filled during onboarding)
  INSERT INTO workspace_profiles (workspace_id, user_id, onboarding_completed, onboarding_step)
  VALUES (v_workspace_id, p_user_id, false, 0);

  -- 4. Set active_workspace_id on users
  UPDATE users
  SET active_workspace_id = v_workspace_id
  WHERE id = p_user_id;

  -- Return the created workspace as JSON
  SELECT row_to_json(w) INTO v_result
  FROM workspaces w
  WHERE w.id = v_workspace_id;

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- Any step failure automatically rolls back all 4 steps
    RAISE;
END;
$$;


--
-- Name: expire_stale_invites(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_stale_invites() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE expired_count INTEGER;
BEGIN
  UPDATE workspace_members
  SET status     = 'removed',
      updated_at = now()
  WHERE status          = 'pending_invite'
    AND invite_expires_at < now();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;


--
-- Name: find_similar_prospects(uuid, uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_similar_prospects(p_workspace_id uuid, p_prospect_id uuid, p_name text, p_threshold numeric) RETURNS TABLE(id uuid, similarity numeric)
    LANGUAGE sql STABLE
    AS $$
  SELECT p.id, similarity(p.name, p_name) AS similarity
  FROM prospects p
  WHERE p.workspace_id = p_workspace_id
    AND p.id != p_prospect_id
    AND similarity(p.name, p_name) >= p_threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$;


--
-- Name: increment_chat_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_chat_stats(p_chat_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE chats
  SET message_count    = COALESCE(message_count, 0) + 1,
      last_message_at  = NOW()
  WHERE id = p_chat_id;
$$;


--
-- Name: increment_goal_progress(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_goal_progress(p_goal_id uuid, p_delta numeric) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE user_goals
  SET current_value = COALESCE(current_value, 0) + p_delta,
      updated_at    = now()
  WHERE id = p_goal_id;
$$;


--
-- Name: increment_performance_stats(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_performance_stats(p_user_id uuid, p_is_positive boolean) RETURNS void
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


--
-- Name: increment_performance_stats(uuid, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_performance_stats(p_user_id uuid, p_is_positive boolean, p_workspace_id uuid) RETURNS void
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


--
-- Name: increment_performance_stats(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_performance_stats(p_workspace_id uuid, p_user_id uuid, p_is_positive boolean) RETURNS void
    LANGUAGE plpgsql
    AS $$
                    BEGIN
                      INSERT INTO user_performance_profiles
                          (workspace_id, user_id, total_sent, total_positive, total_negative, positive_rate)
                            VALUES (
                                p_workspace_id,
                                    p_user_id,
                                        1,
                                            CASE WHEN p_is_positive THEN 1 ELSE 0 END,
                                                CASE WHEN p_is_positive THEN 0 ELSE 1 END,
                                                    CASE WHEN p_is_positive THEN 1.0 ELSE 0.0 END
                                                      )
                                                        ON CONFLICT (workspace_id, user_id) DO UPDATE SET
                                                            total_sent     = user_performance_profiles.total_sent + 1,
                                                                total_positive = user_performance_profiles.total_positive
                                                                                     + (CASE WHEN p_is_positive THEN 1 ELSE 0 END),
                                                                                         total_negative = user_performance_profiles.total_negative
                                                                                                              + (CASE WHEN p_is_positive THEN 0 ELSE 1 END),
                                                                                                                  positive_rate  = ROUND(
                                                                                                                        (user_performance_profiles.total_positive
                                                                                                                               + (CASE WHEN p_is_positive THEN 1 ELSE 0 END))::NUMERIC
                                                                                                                                     / (user_performance_profiles.total_sent + 1), 4
                                                                                                                                         );
                                                                                                                                         END;
                                                                                                                                         $$;


--
-- Name: is_workspace_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_workspace_member(ws_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id      = auth.uid()
      AND status       = 'active'
  );
$$;


--
-- Name: record_ai_usage(uuid, uuid, text, text, text, text, integer, integer, numeric, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ai_usage(p_workspace_id uuid, p_user_id uuid, p_provider text, p_event_type text, p_model text, p_tier text, p_tokens_in integer, p_tokens_out integer, p_credits_used numeric, p_cost_cents integer, p_source_job text, p_metadata jsonb) RETURNS uuid
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: transfer_workspace_ownership(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_workspace_ownership(p_workspace_id uuid, p_current_owner_id uuid, p_new_owner_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Demote current owner to admin
  UPDATE workspace_members
  SET role = 'admin'
  WHERE workspace_id = p_workspace_id
    AND user_id      = p_current_owner_id
    AND status       = 'active';

  -- Promote new owner
  UPDATE workspace_members
  SET role = 'owner'
  WHERE workspace_id = p_workspace_id
    AND user_id      = p_new_owner_id
    AND status       = 'active';

  -- Update workspaces.owner_user_id
  UPDATE workspaces
  SET owner_user_id = p_new_owner_id
  WHERE id = p_workspace_id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;


--
-- Name: truncate_all_public_tables(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.truncate_all_public_tables() RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  r RECORD;
  BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
          END LOOP;
          END;
          $$;


--
-- Name: update_stage_changed_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_stage_changed_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
      NEW.last_stage_changed_at = now();
        END IF;
          RETURN NEW;
          END;
          $$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
    RETURN NEW;
    END;
    $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
        RETURN NEW;
        END;
        $$;


--
-- Name: upsert_objection_count(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_objection_count(p_user_id uuid, p_objection_type text, p_phrase text) RETURNS void
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


--
-- Name: upsert_objection_count(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_objection_count(p_workspace_id uuid, p_user_id uuid, p_objection_type text, p_phrase text) RETURNS void
    LANGUAGE sql
    AS $$
                  INSERT INTO objection_tracker
                      (workspace_id, user_id, objection_type, objection_phrase, occurrence_count, last_seen_at)
                        VALUES (p_workspace_id, p_user_id, p_objection_type, p_phrase, 1, now())
                          ON CONFLICT (workspace_id, user_id, objection_type)
                            DO UPDATE SET
                                occurrence_count = objection_tracker.occurrence_count + 1,
                                    last_seen_at     = now();
                                    $$;


--
-- Name: upsert_objection_tracker(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_objection_tracker(p_user_id uuid, p_objection_type text, p_objection_phrase text) RETURNS void
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


--
-- Name: voice_memos_tsv_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.voice_memos_tsv_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.transcript_tsv := to_tsvector('english', COALESCE(NEW.transcript_text, ''));
  RETURN NEW;
END;
$$;


--
-- Name: workspace_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_role(ws_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT role FROM workspace_members
  WHERE workspace_id = ws_id
    AND user_id      = auth.uid()
    AND status       = 'active'
  LIMIT 1;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    model text,
    tier text,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    credits_used numeric(10,4) DEFAULT 0 NOT NULL,
    estimated_cost_cents integer DEFAULT 0 NOT NULL,
    source_job text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: availability_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    timezone text NOT NULL,
    is_active boolean DEFAULT true,
    CONSTRAINT availability_windows_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT chk_window_order CHECK ((start_time < end_time))
);


--
-- Name: booking_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    slug text NOT NULL,
    title text DEFAULT 'Book a meeting'::text,
    duration_minutes integer DEFAULT 30,
    buffer_minutes integer DEFAULT 10,
    max_days_ahead integer DEFAULT 30,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: cached_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cached_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    suggestions jsonb NOT NULL,
    profile_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_ai_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_ai_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    event_id uuid,
    ai_function text NOT NULL,
    gate_decision text NOT NULL,
    gate_reason text,
    model_tier text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    role text NOT NULL,
    content text NOT NULL,
    delivery_status text DEFAULT 'sent'::text,
    delivered_at timestamp with time zone,
    seen_at timestamp with time zone,
    replied_at timestamp with time zone,
    ghosted_at timestamp with time zone,
    model_used text,
    tokens_used integer,
    is_streamed boolean DEFAULT false,
    attachments jsonb DEFAULT '[]'::jsonb,
    citations jsonb DEFAULT '[]'::jsonb,
    scenario_type text,
    coaching_tip text,
    internal_monologue text,
    monologue_revealed boolean DEFAULT false,
    is_interruption boolean DEFAULT false,
    chunk_index integer DEFAULT 0,
    parent_message_id uuid,
    workspace_id uuid NOT NULL,
    attachment_context jsonb,
    seq bigint NOT NULL,
    CONSTRAINT chat_messages_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['sent'::text, 'delivered'::text, 'seen'::text, 'replied'::text, 'ghosted'::text]))),
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);


--
-- Name: COLUMN chat_messages.internal_monologue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_messages.internal_monologue IS 'Hidden buyer thought. Only returned from /replay endpoint. Scrubbed from active session endpoints.';


--
-- Name: COLUMN chat_messages.monologue_revealed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_messages.monologue_revealed IS 'Set to TRUE when session completes or replay is accessed.';


--
-- Name: COLUMN chat_messages.is_interruption; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_messages.is_interruption IS 'TRUE for buyer mid-session interruption messages.';


--
-- Name: COLUMN chat_messages.chunk_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_messages.chunk_index IS 'For multi-chunk messages. Primary=0, subsequent chunks=1,2,etc.';


--
-- Name: COLUMN chat_messages.parent_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.chat_messages.parent_message_id IS 'Links chunk messages back to their parent for frontend reassembly.';


--
-- Name: chat_messages_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_seq_seq OWNED BY public.chat_messages.seq;


--
-- Name: chat_topic_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_topic_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid,
    user_id uuid,
    topic text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_topic_tags_topic_check CHECK ((topic = ANY (ARRAY['outreach'::text, 'objections'::text, 'strategy'::text, 'pricing'::text, 'mindset'::text, 'pipeline'::text])))
);


--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    title text,
    chat_type text DEFAULT 'general'::text,
    opportunity_id uuid,
    practice_session_id uuid,
    is_archived boolean DEFAULT false,
    message_count integer DEFAULT 0,
    last_message_at timestamp with time zone,
    memory_last_extracted_at timestamp with time zone,
    chat_mode text DEFAULT 'general'::text,
    prospect_id uuid,
    event_id uuid,
    commitments_extracted boolean DEFAULT false,
    signals_extracted boolean DEFAULT false,
    debrief_generated boolean DEFAULT false,
    workspace_id uuid NOT NULL,
    growth_card_id uuid,
    seq bigint NOT NULL,
    summary text,
    last_summarized_message_count integer DEFAULT 0,
    summary_updated_at timestamp with time zone,
    CONSTRAINT chats_chat_type_check CHECK ((chat_type = ANY (ARRAY['general'::text, 'opportunity'::text, 'practice'::text])))
);


--
-- Name: chats_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chats_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chats_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chats_seq_seq OWNED BY public.chats.seq;


--
-- Name: communication_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    pattern_type text NOT NULL,
    pattern_label text NOT NULL,
    pattern_detail text,
    affected_outcome text DEFAULT 'negative'::text,
    confidence_score numeric(4,2),
    evidence_count integer DEFAULT 0,
    example_ids uuid[] DEFAULT '{}'::uuid[],
    recommendation text,
    is_active boolean DEFAULT true,
    first_detected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_reinforced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL
);


--
-- Name: conversation_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    opportunity_id uuid,
    feedback_id uuid,
    message_text text NOT NULL,
    outcome text,
    outcome_note text,
    platform text,
    hook_score numeric(4,2),
    clarity_score numeric(4,2),
    value_prop_score numeric(4,2),
    personalization_score numeric(4,2),
    cta_score numeric(4,2),
    tone_score numeric(4,2),
    composite_score numeric(4,2),
    word_count integer,
    self_referential_ratio numeric(5,4),
    has_social_proof boolean DEFAULT false,
    has_specific_ask boolean DEFAULT false,
    failure_categories text[] DEFAULT '{}'::text[],
    success_signals text[] DEFAULT '{}'::text[],
    analysis_text text,
    improvement_suggestions jsonb DEFAULT '[]'::jsonb,
    rewritten_message text,
    analysis_model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    line_annotations jsonb DEFAULT '[]'::jsonb,
    workspace_id uuid NOT NULL
);


--
-- Name: conversation_commitments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_commitments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    prospect_id uuid,
    source_type text NOT NULL,
    source_id uuid,
    commitment_text text NOT NULL,
    owner text DEFAULT 'founder'::text NOT NULL,
    due_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    follow_up_message text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL
);


--
-- Name: conversation_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    prospect_id uuid,
    source_type text NOT NULL,
    source_id uuid,
    signal_type text NOT NULL,
    signal_text text NOT NULL,
    confidence numeric(3,2) DEFAULT 0.7,
    is_active boolean DEFAULT true,
    detected_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL
);


--
-- Name: daily_check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_check_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    questions jsonb DEFAULT '[]'::jsonb,
    answers jsonb DEFAULT '{}'::jsonb,
    ai_response text,
    mood_score integer,
    chat_context text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    workspace_id uuid NOT NULL,
    CONSTRAINT daily_check_ins_mood_score_check CHECK (((mood_score >= 1) AND (mood_score <= 5)))
);


--
-- Name: daily_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date date NOT NULL,
    opportunities_shown integer DEFAULT 0,
    opportunities_viewed integer DEFAULT 0,
    links_clicked integer DEFAULT 0,
    messages_copied integer DEFAULT 0,
    messages_sent integer DEFAULT 0,
    positive_outcomes integer DEFAULT 0,
    negative_outcomes integer DEFAULT 0,
    execution_rate numeric DEFAULT 0,
    positive_rate numeric DEFAULT 0,
    workspace_id uuid NOT NULL
);


--
-- Name: event_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_attendees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    prospect_id uuid,
    name text NOT NULL,
    email text,
    role text DEFAULT 'attendee'::text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: feature_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_usage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    feature text NOT NULL,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    outcome text NOT NULL,
    outcome_note text,
    practice_suggested boolean DEFAULT false,
    practice_accepted boolean DEFAULT false,
    prompted_at timestamp with time zone,
    deal_value_usd integer,
    scheduled_call boolean DEFAULT false,
    is_final boolean DEFAULT false,
    scheduled_call_date timestamp with time zone,
    scheduled_call_notes text,
    workspace_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feedback_outcome_check CHECK ((outcome = ANY (ARRAY['positive'::text, 'negative'::text, 'pending'::text])))
);


--
-- Name: file_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    storage_provider text DEFAULT 'supabase'::text,
    storage_path text NOT NULL,
    public_url text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer,
    file_type text,
    chat_id uuid,
    message_id uuid,
    resource_type text,
    CONSTRAINT file_uploads_file_type_check CHECK ((file_type = ANY (ARRAY['image'::text, 'pdf'::text, 'document'::text, 'other'::text])))
);


--
-- Name: goal_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goal_id uuid,
    user_id uuid,
    note_text text NOT NULL,
    ai_response text,
    progress_delta numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    sentiment text DEFAULT 'neutral'::text,
    CONSTRAINT goal_notes_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])))
);


--
-- Name: growth_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    card_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    action_label text,
    action_url text,
    action_type text,
    archetype_target text,
    priority integer DEFAULT 5,
    expires_at timestamp with time zone,
    is_read boolean DEFAULT false,
    is_dismissed boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    generated_by text DEFAULT 'ai_daily'::text,
    created_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL,
    CONSTRAINT growth_cards_action_type_check CHECK ((action_type = ANY (ARRAY['internal_chat'::text, 'external_link'::text, 'practice'::text, 'checkin'::text, 'goal'::text, NULL::text]))),
    CONSTRAINT growth_cards_card_type_check CHECK ((card_type = ANY (ARRAY['tip'::text, 'strategy'::text, 'resource'::text, 'reflection'::text, 'challenge'::text, 'community'::text, 'insight'::text]))),
    CONSTRAINT growth_cards_generated_by_check CHECK ((generated_by = ANY (ARRAY['ai_daily'::text, 'ai_weekly'::text, 'ai_realtime'::text, 'system'::text, 'ai_checkin'::text]))),
    CONSTRAINT growth_cards_priority_check CHECK (((priority >= 1) AND (priority <= 10)))
);


--
-- Name: job_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    job_name text NOT NULL,
    status text NOT NULL,
    users_processed integer DEFAULT 0,
    opportunities_found integer DEFAULT 0,
    error_message text,
    duration_ms integer,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: message_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    scheduled_for timestamp with time zone NOT NULL,
    executed_at timestamp with time zone,
    status text DEFAULT 'pending'::text,
    job_type text NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    last_error text,
    CONSTRAINT message_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'executing'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: objection_tracker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objection_tracker (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    objection_type text NOT NULL,
    objection_phrase text,
    occurrence_count integer DEFAULT 1,
    best_response text,
    response_score numeric(4,2),
    outcome_after text,
    practice_score numeric(4,2),
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    market_intel_generated_at timestamp with time zone,
    workspace_id uuid NOT NULL
);


--
-- Name: opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    platform text DEFAULT 'reddit'::text NOT NULL,
    source_url text NOT NULL,
    target_context text,
    target_name text,
    prepared_message text NOT NULL,
    fit_score integer,
    timing_score integer,
    intent_score integer,
    composite_score numeric GENERATED ALWAYS AS (((((COALESCE(fit_score, 0) + COALESCE(timing_score, 0)) + COALESCE(intent_score, 0)))::numeric / 3.0)) STORED,
    message_style text,
    message_length integer,
    status text DEFAULT 'pending'::text,
    viewed_at timestamp with time zone,
    link_clicked_at timestamp with time zone,
    message_copied_at timestamp with time zone,
    marked_sent_at timestamp with time zone,
    generated_by text DEFAULT 'grok'::text,
    stage text DEFAULT 'new'::text,
    score_reason text,
    is_example boolean DEFAULT false,
    follow_up_sent_at timestamp with time zone,
    follow_up_count integer DEFAULT 0,
    follow_up_message text,
    last_stage_changed_at timestamp with time zone DEFAULT now(),
    intel_snapshot jsonb,
    intel_generated_at timestamp with time zone,
    intel_fetch_failed boolean DEFAULT false,
    engagement_time_seconds integer,
    lost_reason text,
    message_score_data jsonb,
    message_scored_at timestamp with time zone,
    feedback_prompted_at timestamp with time zone,
    intel_needed boolean DEFAULT false,
    workspace_id uuid NOT NULL,
    assigned_to uuid,
    updated_at timestamp with time zone DEFAULT now(),
    follow_up_dismissed_at timestamp with time zone,
    follow_up_viewed_at timestamp with time zone,
    CONSTRAINT opportunities_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'contacted'::text, 'replied'::text, 'call_demo'::text, 'closed_won'::text, 'closed_lost'::text])))
);


--
-- Name: pipeline_metrics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pipeline_metrics AS
 SELECT o.workspace_id,
    o.user_id,
    count(*) FILTER (WHERE (o.stage = 'contacted'::text)) AS contacted_count,
    count(*) FILTER (WHERE (o.stage = 'replied'::text)) AS replied_count,
    count(*) FILTER (WHERE (o.stage = 'call_demo'::text)) AS call_demo_count,
    count(*) FILTER (WHERE (o.stage = 'closed_won'::text)) AS closed_won_count,
    count(*) FILTER (WHERE (o.stage = 'closed_lost'::text)) AS closed_lost_count,
    COALESCE(sum(f.deal_value_usd) FILTER (WHERE (o.stage = 'closed_won'::text)), (0)::bigint) AS total_revenue,
    COALESCE(sum(f.deal_value_usd) FILTER (WHERE (o.stage = ANY (ARRAY['call_demo'::text, 'replied'::text, 'contacted'::text]))), (0)::bigint) AS pipeline_value,
        CASE
            WHEN (count(*) FILTER (WHERE (o.stage = ANY (ARRAY['closed_won'::text, 'closed_lost'::text]))) > 0) THEN round((((count(*) FILTER (WHERE (o.stage = 'closed_won'::text)))::numeric * 100.0) / (count(*) FILTER (WHERE (o.stage = ANY (ARRAY['closed_won'::text, 'closed_lost'::text]))))::numeric), 1)
            ELSE (0)::numeric
        END AS win_rate_pct
   FROM (public.opportunities o
     LEFT JOIN public.feedback f ON ((f.opportunity_id = o.id)))
  WHERE (o.stage <> 'new'::text)
  GROUP BY o.workspace_id, o.user_id;


--
-- Name: practice_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    earned_at timestamp with time zone DEFAULT now(),
    badge_type text NOT NULL,
    badge_label text,
    badge_description text,
    workspace_id uuid NOT NULL
);


--
-- Name: practice_curriculum; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_curriculum (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    curriculum jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL
);


--
-- Name: practice_drills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_drills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    drill_type text NOT NULL,
    target_axis text NOT NULL,
    session_id uuid,
    score_before numeric(5,2),
    score_after numeric(5,2),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL
);


--
-- Name: practice_interruptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_interruptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    chat_id uuid,
    message_id uuid,
    exchange_index integer NOT NULL,
    interruption_text text NOT NULL,
    topic_shift text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE practice_interruptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.practice_interruptions IS 'Tracks buyer interruptions per session. Used by coaching annotation job.';


--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    scenario_type text NOT NULL,
    practice_prompt text,
    user_message text,
    ai_response text,
    coaching_tip text,
    result text,
    completed boolean DEFAULT false,
    triggered_by_feedback_id uuid,
    rating integer,
    rating_note text,
    chat_id uuid,
    completed_at timestamp with time zone,
    difficulty_level text DEFAULT 'standard'::text,
    session_debrief jsonb,
    reply_received boolean DEFAULT false,
    exchanges_count integer DEFAULT 0,
    message_strength_score integer,
    retry_of_session_id uuid,
    messages_exchanged integer DEFAULT 0,
    asked_questions boolean DEFAULT false,
    handled_objection boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    session_goal text,
    bio_note text,
    drill_type text,
    buyer_profile jsonb,
    buyer_state jsonb,
    buyer_state_history jsonb DEFAULT '[]'::jsonb,
    goal_achieved boolean DEFAULT false,
    goal_achieved_at timestamp with time zone,
    final_interest_score integer,
    final_trust_score integer,
    outcome text,
    coaching_annotations jsonb DEFAULT '[]'::jsonb,
    word_highlights jsonb DEFAULT '[]'::jsonb,
    retry_comparison jsonb,
    skill_scores jsonb,
    coaching_chat_id uuid,
    playbook jsonb,
    playbook_generated boolean DEFAULT false,
    pressure_modifier text,
    conversation_outcome jsonb,
    outcome_determined_at timestamp with time zone,
    ai_ended_session boolean DEFAULT false,
    interruption_count integer DEFAULT 0,
    workspace_id uuid NOT NULL,
    CONSTRAINT practice_sessions_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: COLUMN practice_sessions.pressure_modifier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.practice_sessions.pressure_modifier IS 'One of: investor_present, aggressive_buyer, competitor_mentioned, security_audit. NULL for no modifier.';


--
-- Name: COLUMN practice_sessions.conversation_outcome; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.practice_sessions.conversation_outcome IS 'AI-determined outcome object: {type, reason, internal_reaction, triggered_at_exchange}';


--
-- Name: COLUMN practice_sessions.ai_ended_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.practice_sessions.ai_ended_session IS 'TRUE if session was closed by AI outcome engine, not by user clicking Complete.';


--
-- Name: prospect_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    insight_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    affected_count integer DEFAULT 1,
    suggested_action text,
    is_dismissed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    workspace_id uuid NOT NULL
);


--
-- Name: prospect_merge_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_merge_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    prospect_id_a uuid NOT NULL,
    prospect_id_b uuid NOT NULL,
    similarity_score numeric(4,3),
    match_reason text NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT chk_distinct_prospects CHECK ((prospect_id_a <> prospect_id_b))
);


--
-- Name: prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    company text,
    title text,
    email text,
    linkedin_url text,
    platform text,
    first_contact_at timestamp with time zone,
    last_contact_at timestamp with time zone,
    relationship_health_score smallint DEFAULT 50,
    health_updated_at timestamp with time zone,
    ai_summary text,
    ai_summary_updated_at timestamp with time zone,
    total_interactions integer DEFAULT 0,
    stage text DEFAULT 'prospect'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    workspace_id uuid NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(regexp_replace(TRIM(BOTH FROM name), '\s+'::text, ' '::text, 'g'::text))) STORED
);


--
-- Name: push_notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_notification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    push_type text NOT NULL,
    title text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: skill_progression; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_progression (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    week_start date NOT NULL,
    hook_score_avg numeric(4,2),
    clarity_score_avg numeric(4,2),
    value_prop_score_avg numeric(4,2),
    personalization_score_avg numeric(4,2),
    cta_score_avg numeric(4,2),
    tone_score_avg numeric(4,2),
    composite_score_avg numeric(4,2),
    composite_delta numeric(4,2),
    positive_outcome_rate numeric(5,4),
    messages_analyzed integer DEFAULT 0,
    practice_sessions integer DEFAULT 0,
    top_weakness text,
    top_strength text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL,
    discovery_score_avg numeric(4,2),
    objection_score_avg numeric(4,2),
    brevity_score_avg numeric(4,2)
);


--
-- Name: user_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    title text NOT NULL,
    event_date date NOT NULL,
    event_type text,
    notes text,
    prep_generated boolean DEFAULT false,
    prep_content jsonb,
    opportunity_id uuid,
    reminder_sent boolean DEFAULT false,
    prep_generated_at timestamp with time zone,
    attendee_name text,
    attendee_context text,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    prospect_id uuid,
    outcome text,
    energy_score smallint,
    meeting_notes text,
    debrief_content jsonb,
    debrief_completed_at timestamp with time zone,
    signals_extracted boolean DEFAULT false,
    perplexity_research jsonb,
    research_generated_at timestamp with time zone,
    follow_up_options jsonb,
    follow_up_generated_at timestamp with time zone,
    workspace_id uuid NOT NULL,
    timezone text,
    recurrence_rule text,
    recurrence_parent_id uuid,
    recurrence_exception_dates date[] DEFAULT '{}'::date[],
    prep_failed boolean DEFAULT false,
    prep_failed_at timestamp with time zone,
    prep_failure_reason text,
    reschedule_count integer DEFAULT 0,
    original_event_date date,
    original_start_time timestamp with time zone,
    follow_up_variant_sent text,
    follow_up_sent_at timestamp with time zone,
    prospect_auto_created boolean DEFAULT false,
    seq bigint NOT NULL
);


--
-- Name: COLUMN user_events.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_events.timezone IS 'Per-event timezone override. NULL means the event inherits workspace_profiles.default_timezone at read time.';


--
-- Name: user_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_events_seq_seq OWNED BY public.user_events.seq;


--
-- Name: user_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    goal_text text NOT NULL,
    goal_type text DEFAULT 'custom'::text,
    target_value numeric,
    target_unit text,
    target_date date,
    current_value numeric DEFAULT 0,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_goal_nudge_at timestamp with time zone,
    workspace_id uuid NOT NULL,
    CONSTRAINT user_goals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'paused'::text])))
);


--
-- Name: user_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    fact text NOT NULL,
    source_chat_id uuid,
    reinforcement_count integer DEFAULT 1,
    last_reinforced_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    fact_category text DEFAULT 'business_context'::text,
    workspace_id uuid NOT NULL
);


--
-- Name: user_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    data jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_performance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_performance_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    total_sent integer DEFAULT 0,
    total_positive integer DEFAULT 0,
    total_negative integer DEFAULT 0,
    positive_rate numeric DEFAULT 0,
    best_platform text,
    best_message_style text,
    best_message_length text,
    learned_patterns text,
    last_summarized_at timestamp with time zone,
    messages_at_last_summary integer DEFAULT 0,
    workspace_id uuid NOT NULL
);


--
-- Name: user_skill_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_skill_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    clarity_avg numeric(5,2),
    value_avg numeric(5,2),
    discovery_avg numeric(5,2),
    objection_avg numeric(5,2),
    brevity_avg numeric(5,2),
    cta_avg numeric(5,2),
    overall_avg numeric(5,2),
    sessions_count integer DEFAULT 0,
    weakest_axis text,
    strongest_axis text,
    created_at timestamp with time zone DEFAULT now(),
    weekly_monologue_score numeric(5,2) DEFAULT NULL::numeric,
    outcome_distribution jsonb,
    pressure_scores jsonb,
    workspace_id uuid NOT NULL
);


--
-- Name: COLUMN user_skill_profile.outcome_distribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_skill_profile.outcome_distribution IS 'Tracks outcome types across sessions: {meeting_booked: 3, follow_up: 8, ...}';


--
-- Name: COLUMN user_skill_profile.pressure_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_skill_profile.pressure_scores IS 'Avg skill score per pressure modifier type.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name text,
    email text NOT NULL,
    tier text DEFAULT 'free'::text,
    subscription_status text DEFAULT 'active'::text,
    fcm_token text,
    onboarding_completed boolean DEFAULT false,
    onboarding_step integer DEFAULT 0,
    platforms_used jsonb DEFAULT '[]'::jsonb,
    outreach_goals jsonb DEFAULT '[]'::jsonb,
    company_size text,
    monthly_revenue text,
    debug_mode boolean DEFAULT false,
    notification_preferences jsonb DEFAULT '{"practice_replies": true, "new_opportunities": true, "feedback_reminders": true, "calendar_prep_ready": true}'::jsonb,
    is_deleted boolean DEFAULT false,
    auth_provider text DEFAULT 'email'::text,
    industry_deep_dive text,
    last_tip_generated_at timestamp with time zone,
    last_check_in_at timestamp with time zone,
    check_in_time text DEFAULT '15:00'::text,
    goal_set_at timestamp with time zone,
    deleted_at timestamp with time zone,
    memory_enabled boolean DEFAULT true,
    email_digest_enabled boolean DEFAULT true,
    last_digest_sent_at timestamp with time zone,
    digest_email text,
    check_in_streak integer DEFAULT 0,
    goal_target_value numeric,
    goal_target_unit text,
    goal_target_date date,
    active_workspace_id uuid,
    CONSTRAINT users_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])))
);


--
-- Name: voice_memos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_memos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_id uuid,
    source text DEFAULT 'recorded'::text NOT NULL,
    original_filename text,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    duration_seconds integer,
    file_size_bytes integer,
    transcription_status text DEFAULT 'pending'::text,
    transcription_error text,
    transcript_text text,
    transcript_tsv tsvector,
    ai_summary jsonb,
    debrief_generated boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    transcribed_at timestamp with time zone,
    summarized_at timestamp with time zone
);


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    business_description text,
    signup_source text DEFAULT 'landing_page'::text,
    email_sent boolean DEFAULT false,
    email_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: workspace_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_activity (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_ai_usage_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_ai_usage_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    date date NOT NULL,
    provider text NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    total_credits numeric(10,4) DEFAULT 0 NOT NULL,
    estimated_cost_cents integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by uuid,
    invite_token text,
    invite_email text,
    invite_expires_at timestamp with time zone,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'member'::text, 'viewer'::text]))),
    CONSTRAINT workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'pending_invite'::text, 'removed'::text])))
);


--
-- Name: workspace_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    business_name text,
    product_description text,
    target_audience text,
    voice_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    onboarding_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    onboarding_completed boolean DEFAULT false NOT NULL,
    onboarding_step integer DEFAULT 0 NOT NULL,
    primary_goal text,
    archetype text,
    archetype_detected_at timestamp with time zone,
    industry text,
    role text,
    preferred_platforms text[] DEFAULT '{}'::text[] NOT NULL,
    business_stage text,
    experience_level text,
    country text,
    state text,
    bio text,
    website text,
    websites text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    onboarding_questions jsonb DEFAULT '{}'::jsonb,
    default_timezone text DEFAULT 'UTC'::text NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    owner_user_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])))
);


--
-- Name: chat_messages seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN seq SET DEFAULT nextval('public.chat_messages_seq_seq'::regclass);


--
-- Name: chats seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats ALTER COLUMN seq SET DEFAULT nextval('public.chats_seq_seq'::regclass);


--
-- Name: user_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events ALTER COLUMN seq SET DEFAULT nextval('public.user_events_seq_seq'::regclass);


--
-- Name: ai_usage_events ai_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_pkey PRIMARY KEY (id);


--
-- Name: availability_windows availability_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_windows
    ADD CONSTRAINT availability_windows_pkey PRIMARY KEY (id);


--
-- Name: booking_pages booking_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_pages
    ADD CONSTRAINT booking_pages_pkey PRIMARY KEY (id);


--
-- Name: booking_pages booking_pages_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_pages
    ADD CONSTRAINT booking_pages_slug_key UNIQUE (slug);


--
-- Name: cached_suggestions cached_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_suggestions
    ADD CONSTRAINT cached_suggestions_pkey PRIMARY KEY (id);


--
-- Name: cached_suggestions cached_suggestions_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_suggestions
    ADD CONSTRAINT cached_suggestions_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: calendar_ai_events calendar_ai_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_ai_events
    ADD CONSTRAINT calendar_ai_events_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_topic_tags chat_topic_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_topic_tags
    ADD CONSTRAINT chat_topic_tags_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: communication_patterns communication_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_patterns
    ADD CONSTRAINT communication_patterns_pkey PRIMARY KEY (id);


--
-- Name: communication_patterns communication_patterns_workspace_id_user_id_pattern_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_patterns
    ADD CONSTRAINT communication_patterns_workspace_id_user_id_pattern_label_key UNIQUE (workspace_id, user_id, pattern_label);


--
-- Name: communication_patterns communication_patterns_ws_user_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_patterns
    ADD CONSTRAINT communication_patterns_ws_user_label_key UNIQUE (workspace_id, user_id, pattern_label);


--
-- Name: conversation_analyses conversation_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analyses
    ADD CONSTRAINT conversation_analyses_pkey PRIMARY KEY (id);


--
-- Name: conversation_commitments conversation_commitments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_commitments
    ADD CONSTRAINT conversation_commitments_pkey PRIMARY KEY (id);


--
-- Name: conversation_signals conversation_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_signals
    ADD CONSTRAINT conversation_signals_pkey PRIMARY KEY (id);


--
-- Name: daily_check_ins daily_check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_check_ins
    ADD CONSTRAINT daily_check_ins_pkey PRIMARY KEY (id);


--
-- Name: daily_check_ins daily_check_ins_user_workspace_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_check_ins
    ADD CONSTRAINT daily_check_ins_user_workspace_date_unique UNIQUE (user_id, workspace_id, date);


--
-- Name: daily_metrics daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_pkey PRIMARY KEY (id);


--
-- Name: daily_metrics daily_metrics_user_workspace_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_user_workspace_date_key UNIQUE (user_id, workspace_id, date);


--
-- Name: daily_metrics daily_metrics_user_workspace_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_user_workspace_date_unique UNIQUE (user_id, workspace_id, date);


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (id);


--
-- Name: feature_usage_events feature_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage_events
    ADD CONSTRAINT feature_usage_events_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_opportunity_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_opportunity_id_unique UNIQUE (opportunity_id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: file_uploads file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);


--
-- Name: goal_notes goal_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_notes
    ADD CONSTRAINT goal_notes_pkey PRIMARY KEY (id);


--
-- Name: growth_cards growth_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_cards
    ADD CONSTRAINT growth_cards_pkey PRIMARY KEY (id);


--
-- Name: job_logs job_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_pkey PRIMARY KEY (id);


--
-- Name: message_queue message_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_queue
    ADD CONSTRAINT message_queue_pkey PRIMARY KEY (id);


--
-- Name: objection_tracker objection_tracker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objection_tracker
    ADD CONSTRAINT objection_tracker_pkey PRIMARY KEY (id);


--
-- Name: objection_tracker objection_tracker_workspace_id_user_id_objection_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objection_tracker
    ADD CONSTRAINT objection_tracker_workspace_id_user_id_objection_type_key UNIQUE (workspace_id, user_id, objection_type);


--
-- Name: objection_tracker objection_tracker_ws_user_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objection_tracker
    ADD CONSTRAINT objection_tracker_ws_user_type_key UNIQUE (workspace_id, user_id, objection_type);


--
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);


--
-- Name: opportunities opportunities_workspace_user_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_workspace_user_url_key UNIQUE (workspace_id, user_id, source_url);


--
-- Name: practice_badges practice_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_badges
    ADD CONSTRAINT practice_badges_pkey PRIMARY KEY (id);


--
-- Name: practice_curriculum practice_curriculum_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_curriculum
    ADD CONSTRAINT practice_curriculum_pkey PRIMARY KEY (id);


--
-- Name: practice_curriculum practice_curriculum_user_workspace_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_curriculum
    ADD CONSTRAINT practice_curriculum_user_workspace_key UNIQUE (user_id, workspace_id);


--
-- Name: practice_curriculum practice_curriculum_user_workspace_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_curriculum
    ADD CONSTRAINT practice_curriculum_user_workspace_unique UNIQUE (user_id, workspace_id);


--
-- Name: practice_drills practice_drills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_drills
    ADD CONSTRAINT practice_drills_pkey PRIMARY KEY (id);


--
-- Name: practice_interruptions practice_interruptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_interruptions
    ADD CONSTRAINT practice_interruptions_pkey PRIMARY KEY (id);


--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: prospect_insights prospect_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_insights
    ADD CONSTRAINT prospect_insights_pkey PRIMARY KEY (id);


--
-- Name: prospect_merge_candidates prospect_merge_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_merge_candidates
    ADD CONSTRAINT prospect_merge_candidates_pkey PRIMARY KEY (id);


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: push_notification_log push_notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notification_log
    ADD CONSTRAINT push_notification_log_pkey PRIMARY KEY (id);


--
-- Name: skill_progression skill_progression_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_progression
    ADD CONSTRAINT skill_progression_pkey PRIMARY KEY (id);


--
-- Name: skill_progression skill_progression_workspace_id_user_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_progression
    ADD CONSTRAINT skill_progression_workspace_id_user_id_week_start_key UNIQUE (workspace_id, user_id, week_start);


--
-- Name: skill_progression skill_progression_ws_user_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_progression
    ADD CONSTRAINT skill_progression_ws_user_week_key UNIQUE (workspace_id, user_id, week_start);


--
-- Name: user_performance_profiles uq_perf_profile_workspace_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT uq_perf_profile_workspace_user UNIQUE (workspace_id, user_id);


--
-- Name: user_performance_profiles uq_user_performance_profiles_user_workspace; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT uq_user_performance_profiles_user_workspace UNIQUE (user_id, workspace_id);


--
-- Name: user_events user_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_pkey PRIMARY KEY (id);


--
-- Name: user_goals user_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_pkey PRIMARY KEY (id);


--
-- Name: user_memory user_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_pkey PRIMARY KEY (id);


--
-- Name: user_notifications user_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);


--
-- Name: user_performance_profiles user_performance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT user_performance_profiles_pkey PRIMARY KEY (user_id, workspace_id);


--
-- Name: user_performance_profiles user_performance_profiles_user_workspace_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT user_performance_profiles_user_workspace_key UNIQUE (user_id, workspace_id);


--
-- Name: user_performance_profiles user_performance_profiles_user_workspace_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT user_performance_profiles_user_workspace_unique UNIQUE (user_id, workspace_id);


--
-- Name: user_skill_profile user_skill_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_profile
    ADD CONSTRAINT user_skill_profile_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: voice_memos voice_memos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_memos
    ADD CONSTRAINT voice_memos_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_email_key UNIQUE (email);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: workspace_activity workspace_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_activity
    ADD CONSTRAINT workspace_activity_pkey PRIMARY KEY (id);


--
-- Name: workspace_ai_usage_daily workspace_ai_usage_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_usage_daily
    ADD CONSTRAINT workspace_ai_usage_daily_pkey PRIMARY KEY (id);


--
-- Name: workspace_ai_usage_daily workspace_ai_usage_daily_workspace_id_date_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_usage_daily
    ADD CONSTRAINT workspace_ai_usage_daily_workspace_id_date_provider_key UNIQUE (workspace_id, date, provider);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspace_profiles workspace_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_pkey PRIMARY KEY (id);


--
-- Name: workspace_profiles workspace_profiles_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: daily_metrics_user_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_metrics_user_workspace_idx ON public.daily_metrics USING btree (user_id, workspace_id);


--
-- Name: daily_metrics_workspace_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_metrics_workspace_date_idx ON public.daily_metrics USING btree (workspace_id, date);


--
-- Name: idx_ai_usage_events_provider_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_events_provider_date ON public.ai_usage_events USING btree (provider, created_at);


--
-- Name: idx_ai_usage_events_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_events_user_date ON public.ai_usage_events USING btree (user_id, created_at);


--
-- Name: idx_ai_usage_events_workspace_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_events_workspace_date ON public.ai_usage_events USING btree (workspace_id, created_at);


--
-- Name: idx_availability_windows_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_availability_windows_user ON public.availability_windows USING btree (workspace_id, user_id) WHERE (is_active = true);


--
-- Name: idx_booking_pages_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_pages_user ON public.booking_pages USING btree (workspace_id, user_id);


--
-- Name: idx_ca_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_created ON public.conversation_analyses USING btree (workspace_id, user_id, created_at DESC);


--
-- Name: idx_ca_feedback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_feedback ON public.conversation_analyses USING btree (feedback_id);


--
-- Name: idx_ca_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_workspace ON public.conversation_analyses USING btree (workspace_id);


--
-- Name: idx_ca_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ca_ws_user ON public.conversation_analyses USING btree (workspace_id, user_id);


--
-- Name: idx_cached_suggestions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cached_suggestions_lookup ON public.cached_suggestions USING btree (workspace_id, user_id, expires_at);


--
-- Name: idx_calendar_ai_events_function; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_ai_events_function ON public.calendar_ai_events USING btree (ai_function, gate_decision);


--
-- Name: idx_calendar_ai_events_workspace_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_ai_events_workspace_date ON public.calendar_ai_events USING btree (workspace_id, created_at DESC);


--
-- Name: idx_chat_messages_chat_role_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chat_role_seq ON public.chat_messages USING btree (chat_id, role, seq);


--
-- Name: idx_chat_messages_chat_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chat_seq ON public.chat_messages USING btree (chat_id, seq DESC);


--
-- Name: idx_chat_messages_chunks; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chunks ON public.chat_messages USING btree (parent_message_id, chunk_index) WHERE (parent_message_id IS NOT NULL);


--
-- Name: idx_chat_messages_monologue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_monologue ON public.chat_messages USING btree (chat_id, role) WHERE (internal_monologue IS NOT NULL);


--
-- Name: idx_chat_messages_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_chat_messages_seq ON public.chat_messages USING btree (seq);


--
-- Name: idx_chat_msgs_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_msgs_chat ON public.chat_messages USING btree (chat_id, created_at);


--
-- Name: idx_chat_msgs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_msgs_workspace ON public.chat_messages USING btree (workspace_id);


--
-- Name: idx_chat_topic_tags_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_topic_tags_chat ON public.chat_topic_tags USING btree (chat_id);


--
-- Name: idx_chat_topic_tags_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_topic_tags_user ON public.chat_topic_tags USING btree (user_id, topic, created_at DESC);


--
-- Name: idx_chats_last_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_last_msg ON public.chats USING btree (workspace_id, last_message_at DESC);


--
-- Name: idx_chats_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_opportunity ON public.chats USING btree (opportunity_id);


--
-- Name: idx_chats_title_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_title_search ON public.chats USING gin (title public.gin_trgm_ops);


--
-- Name: idx_chats_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_workspace ON public.chats USING btree (workspace_id);


--
-- Name: idx_chats_workspace_user_recency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_workspace_user_recency ON public.chats USING btree (workspace_id, user_id, is_archived, last_message_at DESC, seq DESC);


--
-- Name: idx_chats_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_ws_user ON public.chats USING btree (workspace_id, user_id);


--
-- Name: idx_comm_patterns_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_patterns_user_id ON public.communication_patterns USING btree (user_id, is_active, confidence_score DESC);


--
-- Name: idx_comm_patterns_user_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_comm_patterns_user_label ON public.communication_patterns USING btree (user_id, pattern_label);


--
-- Name: idx_commitments_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commitments_prospect ON public.conversation_commitments USING btree (prospect_id);


--
-- Name: idx_commitments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commitments_user ON public.conversation_commitments USING btree (user_id, status);


--
-- Name: idx_commitments_workspace_user_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commitments_workspace_user_owner_status ON public.conversation_commitments USING btree (workspace_id, user_id, owner, status);


--
-- Name: idx_commits_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commits_prospect ON public.conversation_commitments USING btree (prospect_id);


--
-- Name: idx_commits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commits_status ON public.conversation_commitments USING btree (workspace_id, status);


--
-- Name: idx_commits_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commits_workspace ON public.conversation_commitments USING btree (workspace_id);


--
-- Name: idx_commits_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commits_ws_user ON public.conversation_commitments USING btree (workspace_id, user_id);


--
-- Name: idx_conv_analyses_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_analyses_created_at ON public.conversation_analyses USING btree (user_id, created_at DESC);


--
-- Name: idx_conv_analyses_feedback_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_analyses_feedback_id ON public.conversation_analyses USING btree (feedback_id);


--
-- Name: idx_conv_analyses_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_analyses_outcome ON public.conversation_analyses USING btree (user_id, outcome);


--
-- Name: idx_conv_analyses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_analyses_user_id ON public.conversation_analyses USING btree (user_id);


--
-- Name: idx_cp_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_workspace ON public.communication_patterns USING btree (workspace_id);


--
-- Name: idx_cp_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cp_ws_user ON public.communication_patterns USING btree (workspace_id, user_id);


--
-- Name: idx_daily_check_ins_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_check_ins_date ON public.daily_check_ins USING btree (user_id, date DESC);


--
-- Name: idx_daily_check_ins_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_check_ins_user_id ON public.daily_check_ins USING btree (user_id);


--
-- Name: idx_daily_check_ins_workspace_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_check_ins_workspace_user_date ON public.daily_check_ins USING btree (workspace_id, user_id, date);


--
-- Name: idx_event_attendees_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_attendees_event ON public.event_attendees USING btree (event_id);


--
-- Name: idx_event_attendees_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_attendees_prospect ON public.event_attendees USING btree (prospect_id) WHERE (prospect_id IS NOT NULL);


--
-- Name: idx_event_attendees_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_attendees_workspace ON public.event_attendees USING btree (workspace_id);


--
-- Name: idx_events_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_prospect ON public.user_events USING btree (prospect_id);


--
-- Name: idx_events_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_workspace ON public.user_events USING btree (workspace_id);


--
-- Name: idx_events_ws_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_ws_date ON public.user_events USING btree (workspace_id, event_date);


--
-- Name: idx_events_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_ws_user ON public.user_events USING btree (workspace_id, user_id);


--
-- Name: idx_feature_usage_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_usage_feature ON public.feature_usage_events USING btree (feature, action, created_at DESC);


--
-- Name: idx_feature_usage_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_usage_user ON public.feature_usage_events USING btree (user_id, feature, created_at DESC);


--
-- Name: idx_feedback_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_opp ON public.feedback USING btree (opportunity_id);


--
-- Name: idx_feedback_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_opportunity ON public.feedback USING btree (opportunity_id);


--
-- Name: idx_feedback_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_user_created ON public.feedback USING btree (user_id, created_at DESC);


--
-- Name: idx_feedback_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_workspace ON public.feedback USING btree (workspace_id);


--
-- Name: idx_feedback_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_ws_user ON public.feedback USING btree (workspace_id, user_id);


--
-- Name: idx_gc_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gc_priority ON public.growth_cards USING btree (workspace_id, user_id, priority DESC);


--
-- Name: idx_gc_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gc_workspace ON public.growth_cards USING btree (workspace_id);


--
-- Name: idx_gc_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gc_ws_user ON public.growth_cards USING btree (workspace_id, user_id);


--
-- Name: idx_goal_notes_goal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_notes_goal ON public.goal_notes USING btree (goal_id, created_at DESC);


--
-- Name: idx_goal_notes_sentiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_notes_sentiment ON public.goal_notes USING btree (user_id, sentiment, created_at DESC);


--
-- Name: idx_goal_notes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_notes_user ON public.goal_notes USING btree (user_id, created_at DESC);


--
-- Name: idx_goals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_status ON public.user_goals USING btree (workspace_id, user_id, status);


--
-- Name: idx_goals_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_workspace ON public.user_goals USING btree (workspace_id);


--
-- Name: idx_goals_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_ws_user ON public.user_goals USING btree (workspace_id, user_id);


--
-- Name: idx_growth_cards_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_cards_active ON public.growth_cards USING btree (user_id, is_dismissed, expires_at);


--
-- Name: idx_growth_cards_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_cards_expires ON public.growth_cards USING btree (expires_at);


--
-- Name: idx_growth_cards_generated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_cards_generated_by ON public.growth_cards USING btree (user_id, generated_by, created_at DESC);


--
-- Name: idx_growth_cards_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_growth_cards_unread ON public.growth_cards USING btree (user_id, is_read, is_dismissed, priority DESC) WHERE (is_dismissed = false);


--
-- Name: idx_insights_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insights_user ON public.prospect_insights USING btree (user_id, is_dismissed);


--
-- Name: idx_merge_candidates_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_merge_candidates_pair ON public.prospect_merge_candidates USING btree (LEAST(prospect_id_a, prospect_id_b), GREATEST(prospect_id_a, prospect_id_b));


--
-- Name: idx_merge_candidates_workspace_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merge_candidates_workspace_pending ON public.prospect_merge_candidates USING btree (workspace_id, status) WHERE (status = 'pending'::text);


--
-- Name: idx_message_queue_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_queue_pending ON public.message_queue USING btree (status, scheduled_for) WHERE (status = 'pending'::text);


--
-- Name: idx_messages_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat ON public.chat_messages USING btree (chat_id, created_at);


--
-- Name: idx_messages_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_delivery ON public.chat_messages USING btree (delivery_status) WHERE (delivery_status <> 'replied'::text);


--
-- Name: idx_metrics_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_user_date ON public.daily_metrics USING btree (user_id, date DESC);


--
-- Name: idx_objection_tracker_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_objection_tracker_user_type ON public.objection_tracker USING btree (user_id, objection_type);


--
-- Name: idx_opp_followup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opp_followup ON public.opportunities USING btree (user_id, stage, last_stage_changed_at) WHERE (status <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text]));


--
-- Name: idx_opportunities_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_assigned_to ON public.opportunities USING btree (workspace_id, assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_opportunities_scored; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_scored ON public.opportunities USING btree (user_id, message_scored_at DESC) WHERE (message_score_data IS NOT NULL);


--
-- Name: idx_opportunities_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_stage ON public.opportunities USING btree (user_id, stage);


--
-- Name: idx_opportunities_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_user_created ON public.opportunities USING btree (user_id, created_at DESC);


--
-- Name: idx_opportunities_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_user_status ON public.opportunities USING btree (user_id, status);


--
-- Name: idx_opps_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opps_workspace ON public.opportunities USING btree (workspace_id);


--
-- Name: idx_opps_ws_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opps_ws_score ON public.opportunities USING btree (workspace_id, composite_score DESC);


--
-- Name: idx_opps_ws_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opps_ws_stage ON public.opportunities USING btree (workspace_id, stage);


--
-- Name: idx_opps_ws_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opps_ws_status ON public.opportunities USING btree (workspace_id, status);


--
-- Name: idx_opps_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opps_ws_user ON public.opportunities USING btree (workspace_id, user_id);


--
-- Name: idx_ot_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ot_workspace ON public.objection_tracker USING btree (workspace_id);


--
-- Name: idx_ot_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ot_ws_user ON public.objection_tracker USING btree (workspace_id, user_id);


--
-- Name: idx_pi_dismissed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_dismissed ON public.prospect_insights USING btree (workspace_id, is_dismissed);


--
-- Name: idx_pi_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_workspace ON public.prospect_insights USING btree (workspace_id);


--
-- Name: idx_pi_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_ws_user ON public.prospect_insights USING btree (workspace_id, user_id);


--
-- Name: idx_practice_interruptions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_interruptions_session ON public.practice_interruptions USING btree (session_id, exchange_index);


--
-- Name: idx_practice_sessions_difficulty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_difficulty ON public.practice_sessions USING btree (user_id, difficulty_level);


--
-- Name: idx_practice_sessions_message_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_message_score ON public.practice_sessions USING btree (user_id, message_strength_score DESC NULLS LAST);


--
-- Name: idx_practice_sessions_outcome_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_outcome_type ON public.practice_sessions USING btree (((conversation_outcome ->> 'type'::text))) WHERE (conversation_outcome IS NOT NULL);


--
-- Name: idx_practice_sessions_pressure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_pressure ON public.practice_sessions USING btree (user_id, pressure_modifier) WHERE (pressure_modifier IS NOT NULL);


--
-- Name: idx_practice_sessions_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_retry ON public.practice_sessions USING btree (retry_of_session_id) WHERE (retry_of_session_id IS NOT NULL);


--
-- Name: idx_practice_sessions_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_user_date ON public.practice_sessions USING btree (user_id, created_at DESC) WHERE (completed = true);


--
-- Name: idx_practice_sessions_workspace_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_sessions_workspace_user ON public.practice_sessions USING btree (workspace_id, user_id);


--
-- Name: idx_practice_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_user ON public.practice_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_prospects_health; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_health ON public.prospects USING btree (user_id, relationship_health_score);


--
-- Name: idx_prospects_name_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_name_normalized ON public.prospects USING btree (workspace_id, user_id, name_normalized);


--
-- Name: idx_prospects_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_name_trgm ON public.prospects USING gin (name public.gin_trgm_ops);


--
-- Name: idx_prospects_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_workspace ON public.prospects USING btree (workspace_id);


--
-- Name: idx_prospects_ws_health; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_ws_health ON public.prospects USING btree (workspace_id, relationship_health_score DESC);


--
-- Name: idx_prospects_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_ws_user ON public.prospects USING btree (workspace_id, user_id);


--
-- Name: idx_push_log_user_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_log_user_sent ON public.push_notification_log USING btree (user_id, sent_at DESC);


--
-- Name: idx_signals_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_prospect ON public.conversation_signals USING btree (prospect_id, is_active);


--
-- Name: idx_signals_prospect_workspace_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_prospect_workspace_user_active ON public.conversation_signals USING btree (prospect_id, workspace_id, user_id, is_active);


--
-- Name: idx_signals_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_workspace ON public.conversation_signals USING btree (workspace_id);


--
-- Name: idx_signals_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_ws_user ON public.conversation_signals USING btree (workspace_id, user_id);


--
-- Name: idx_skill_progression_user_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_progression_user_week ON public.skill_progression USING btree (user_id, week_start DESC);


--
-- Name: idx_sp_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_week ON public.skill_progression USING btree (workspace_id, user_id, week_start DESC);


--
-- Name: idx_sp_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_workspace ON public.skill_progression USING btree (workspace_id);


--
-- Name: idx_sp_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_ws_user ON public.skill_progression USING btree (workspace_id, user_id);


--
-- Name: idx_uploads_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uploads_user ON public.file_uploads USING btree (user_id);


--
-- Name: idx_user_events_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_events_cursor ON public.user_events USING btree (workspace_id, user_id, event_date DESC, seq DESC);


--
-- Name: idx_user_events_prep_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_events_prep_pending ON public.user_events USING btree (event_date) WHERE ((prep_generated = false) AND (prep_failed = false));


--
-- Name: idx_user_events_recurrence_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_events_recurrence_parent ON public.user_events USING btree (recurrence_parent_id) WHERE (recurrence_parent_id IS NOT NULL);


--
-- Name: idx_user_events_reminder_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_events_reminder_scan ON public.user_events USING btree (event_date, start_time) WHERE (reminder_sent = false);


--
-- Name: idx_user_events_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_events_seq ON public.user_events USING btree (seq);


--
-- Name: idx_user_events_workspace_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_events_workspace_user_date ON public.user_events USING btree (workspace_id, user_id, event_date);


--
-- Name: idx_user_goals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_goals_status ON public.user_goals USING btree (user_id, status);


--
-- Name: idx_user_memory_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_memory_category ON public.user_memory USING btree (user_id, fact_category, is_active);


--
-- Name: idx_user_memory_reinforcement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_memory_reinforcement ON public.user_memory USING btree (user_id, reinforcement_count DESC, is_active) WHERE (is_active = true);


--
-- Name: idx_user_memory_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_memory_source ON public.user_memory USING btree (source_chat_id);


--
-- Name: idx_user_memory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_memory_user ON public.user_memory USING btree (user_id, is_active);


--
-- Name: idx_user_memory_workspace_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_memory_workspace_user ON public.user_memory USING btree (workspace_id, user_id);


--
-- Name: idx_user_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_notifications_created_at ON public.user_notifications USING btree (created_at);


--
-- Name: idx_user_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_notifications_is_read ON public.user_notifications USING btree (is_read);


--
-- Name: idx_user_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_notifications_user_id ON public.user_notifications USING btree (user_id);


--
-- Name: idx_user_perf_profiles_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_perf_profiles_workspace ON public.user_performance_profiles USING btree (workspace_id);


--
-- Name: idx_user_skill_profile_user_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_skill_profile_user_period ON public.user_skill_profile USING btree (user_id, period_start DESC);


--
-- Name: idx_users_active_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active_ws ON public.users USING btree (active_workspace_id);


--
-- Name: idx_users_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_not_deleted ON public.users USING btree (id) WHERE (is_deleted = false);


--
-- Name: idx_voice_memos_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_memos_event ON public.voice_memos USING btree (event_id);


--
-- Name: idx_voice_memos_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_memos_pending ON public.voice_memos USING btree (transcription_status) WHERE (transcription_status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_voice_memos_transcript_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_memos_transcript_search ON public.voice_memos USING gin (transcript_tsv);


--
-- Name: idx_voice_memos_workspace_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_memos_workspace_user ON public.voice_memos USING btree (workspace_id, user_id);


--
-- Name: idx_waitlist_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_created_at ON public.waitlist USING btree (created_at);


--
-- Name: idx_waitlist_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_email ON public.waitlist USING btree (email);


--
-- Name: idx_wm_invite_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wm_invite_email ON public.workspace_members USING btree (invite_email) WHERE (invite_email IS NOT NULL);


--
-- Name: idx_wm_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wm_invite_token ON public.workspace_members USING btree (invite_token) WHERE (invite_token IS NOT NULL);


--
-- Name: idx_wm_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wm_status ON public.workspace_members USING btree (workspace_id, status);


--
-- Name: idx_wm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wm_user ON public.workspace_members USING btree (user_id);


--
-- Name: idx_wm_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wm_workspace ON public.workspace_members USING btree (workspace_id);


--
-- Name: idx_workspace_activity_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_activity_user ON public.workspace_activity USING btree (user_id);


--
-- Name: idx_workspace_activity_workspace_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_activity_workspace_created ON public.workspace_activity USING btree (workspace_id, created_at DESC);


--
-- Name: idx_workspace_ai_usage_daily_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_ai_usage_daily_date ON public.workspace_ai_usage_daily USING btree (date);


--
-- Name: idx_workspace_members_ws_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_members_ws_user_status ON public.workspace_members USING btree (workspace_id, user_id, status);


--
-- Name: idx_workspace_profiles_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_profiles_ws_user ON public.workspace_profiles USING btree (workspace_id, user_id);


--
-- Name: idx_workspaces_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_owner ON public.workspaces USING btree (owner_user_id);


--
-- Name: idx_workspaces_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_slug ON public.workspaces USING btree (slug);


--
-- Name: idx_wp_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_user ON public.workspace_profiles USING btree (user_id);


--
-- Name: idx_wp_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_workspace ON public.workspace_profiles USING btree (workspace_id);


--
-- Name: idx_wp_ws_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wp_ws_user ON public.workspace_profiles USING btree (workspace_id, user_id);


--
-- Name: objection_tracker_user_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX objection_tracker_user_type_idx ON public.objection_tracker USING btree (user_id, objection_type);


--
-- Name: user_memory_user_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_memory_user_workspace_idx ON public.user_memory USING btree (user_id, workspace_id) WHERE (is_active = true);


--
-- Name: user_perf_profiles_user_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_perf_profiles_user_workspace_idx ON public.user_performance_profiles USING btree (user_id, workspace_id);


--
-- Name: user_skill_profile_user_workspace_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_skill_profile_user_workspace_period_idx ON public.user_skill_profile USING btree (user_id, workspace_id, period_start DESC);


--
-- Name: chats chats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chats_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: cached_suggestions trg_cached_suggestions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cached_suggestions_updated_at BEFORE UPDATE ON public.cached_suggestions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: chats trg_chats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chats_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: conversation_commitments trg_conversation_commitments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_conversation_commitments_updated_at BEFORE UPDATE ON public.conversation_commitments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: feedback trg_feedback_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_feedback_updated_at BEFORE UPDATE ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: opportunities trg_opportunities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospects trg_prospects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prospects_updated_at BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: opportunities trg_stage_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stage_changed BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.update_stage_changed_at();


--
-- Name: user_events trg_user_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_events_updated_at BEFORE UPDATE ON public.user_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_goals trg_user_goals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_goals_updated_at BEFORE UPDATE ON public.user_goals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: voice_memos trg_voice_memos_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_voice_memos_tsv BEFORE INSERT OR UPDATE OF transcript_text ON public.voice_memos FOR EACH ROW EXECUTE FUNCTION public.voice_memos_tsv_trigger();


--
-- Name: workspace_members trg_workspace_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_members_updated_at BEFORE UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_profiles trg_workspace_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_profiles_updated_at BEFORE UPDATE ON public.workspace_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces trg_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cached_suggestions update_cached_suggestions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cached_suggestions_updated_at BEFORE UPDATE ON public.cached_suggestions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: feedback update_feedback_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_feedback_updated_at BEFORE UPDATE ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: cached_suggestions cached_suggestions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_suggestions
    ADD CONSTRAINT cached_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cached_suggestions cached_suggestions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cached_suggestions
    ADD CONSTRAINT cached_suggestions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_parent_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: chat_topic_tags chat_topic_tags_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_topic_tags
    ADD CONSTRAINT chat_topic_tags_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_topic_tags chat_topic_tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_topic_tags
    ADD CONSTRAINT chat_topic_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chats chats_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.user_events(id) ON DELETE SET NULL;


--
-- Name: chats chats_growth_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_growth_card_id_fkey FOREIGN KEY (growth_card_id) REFERENCES public.growth_cards(id);


--
-- Name: chats chats_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: chats chats_practice_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_practice_session_id_fkey FOREIGN KEY (practice_session_id) REFERENCES public.practice_sessions(id) ON DELETE SET NULL;


--
-- Name: chats chats_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: chats chats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chats chats_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: communication_patterns communication_patterns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_patterns
    ADD CONSTRAINT communication_patterns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: communication_patterns communication_patterns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_patterns
    ADD CONSTRAINT communication_patterns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_analyses conversation_analyses_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analyses
    ADD CONSTRAINT conversation_analyses_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedback(id) ON DELETE SET NULL;


--
-- Name: conversation_analyses conversation_analyses_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analyses
    ADD CONSTRAINT conversation_analyses_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: conversation_analyses conversation_analyses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analyses
    ADD CONSTRAINT conversation_analyses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_analyses conversation_analyses_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analyses
    ADD CONSTRAINT conversation_analyses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_commitments conversation_commitments_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_commitments
    ADD CONSTRAINT conversation_commitments_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: conversation_commitments conversation_commitments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_commitments
    ADD CONSTRAINT conversation_commitments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_commitments conversation_commitments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_commitments
    ADD CONSTRAINT conversation_commitments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: conversation_signals conversation_signals_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_signals
    ADD CONSTRAINT conversation_signals_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: conversation_signals conversation_signals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_signals
    ADD CONSTRAINT conversation_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_signals conversation_signals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_signals
    ADD CONSTRAINT conversation_signals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: daily_check_ins daily_check_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_check_ins
    ADD CONSTRAINT daily_check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: daily_check_ins daily_check_ins_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_check_ins
    ADD CONSTRAINT daily_check_ins_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: daily_metrics daily_metrics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: daily_metrics daily_metrics_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.user_events(id) ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: feature_usage_events feature_usage_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage_events
    ADD CONSTRAINT feature_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: file_uploads file_uploads_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;


--
-- Name: file_uploads file_uploads_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: file_uploads file_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users fk_users_active_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_active_workspace FOREIGN KEY (active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: goal_notes goal_notes_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_notes
    ADD CONSTRAINT goal_notes_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.user_goals(id) ON DELETE CASCADE;


--
-- Name: goal_notes goal_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_notes
    ADD CONSTRAINT goal_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: growth_cards growth_cards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_cards
    ADD CONSTRAINT growth_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: growth_cards growth_cards_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_cards
    ADD CONSTRAINT growth_cards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: objection_tracker objection_tracker_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objection_tracker
    ADD CONSTRAINT objection_tracker_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: objection_tracker objection_tracker_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objection_tracker
    ADD CONSTRAINT objection_tracker_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: opportunities opportunities_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: opportunities opportunities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: opportunities opportunities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: practice_badges practice_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_badges
    ADD CONSTRAINT practice_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: practice_badges practice_badges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_badges
    ADD CONSTRAINT practice_badges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: practice_curriculum practice_curriculum_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_curriculum
    ADD CONSTRAINT practice_curriculum_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: practice_curriculum practice_curriculum_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_curriculum
    ADD CONSTRAINT practice_curriculum_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: practice_drills practice_drills_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_drills
    ADD CONSTRAINT practice_drills_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id);


--
-- Name: practice_drills practice_drills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_drills
    ADD CONSTRAINT practice_drills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: practice_drills practice_drills_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_drills
    ADD CONSTRAINT practice_drills_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: practice_interruptions practice_interruptions_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_interruptions
    ADD CONSTRAINT practice_interruptions_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id);


--
-- Name: practice_interruptions practice_interruptions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_interruptions
    ADD CONSTRAINT practice_interruptions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: practice_interruptions practice_interruptions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_interruptions
    ADD CONSTRAINT practice_interruptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: practice_sessions practice_sessions_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;


--
-- Name: practice_sessions practice_sessions_retry_of_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_retry_of_session_id_fkey FOREIGN KEY (retry_of_session_id) REFERENCES public.practice_sessions(id) ON DELETE SET NULL;


--
-- Name: practice_sessions practice_sessions_triggered_by_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_triggered_by_feedback_id_fkey FOREIGN KEY (triggered_by_feedback_id) REFERENCES public.feedback(id);


--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: prospect_insights prospect_insights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_insights
    ADD CONSTRAINT prospect_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: prospect_insights prospect_insights_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_insights
    ADD CONSTRAINT prospect_insights_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_merge_candidates prospect_merge_candidates_prospect_id_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_merge_candidates
    ADD CONSTRAINT prospect_merge_candidates_prospect_id_a_fkey FOREIGN KEY (prospect_id_a) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_merge_candidates prospect_merge_candidates_prospect_id_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_merge_candidates
    ADD CONSTRAINT prospect_merge_candidates_prospect_id_b_fkey FOREIGN KEY (prospect_id_b) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospects prospects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: prospects prospects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: push_notification_log push_notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notification_log
    ADD CONSTRAINT push_notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: skill_progression skill_progression_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_progression
    ADD CONSTRAINT skill_progression_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: skill_progression skill_progression_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_progression
    ADD CONSTRAINT skill_progression_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_events user_events_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: user_events user_events_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: user_events user_events_recurrence_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_recurrence_parent_id_fkey FOREIGN KEY (recurrence_parent_id) REFERENCES public.user_events(id) ON DELETE SET NULL;


--
-- Name: user_events user_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_events user_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_events
    ADD CONSTRAINT user_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_goals user_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_goals user_goals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_goals
    ADD CONSTRAINT user_goals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_memory user_memory_source_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_source_chat_id_fkey FOREIGN KEY (source_chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;


--
-- Name: user_memory user_memory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_memory user_memory_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: user_notifications user_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_performance_profiles user_performance_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT user_performance_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_performance_profiles user_performance_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_performance_profiles
    ADD CONSTRAINT user_performance_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: user_skill_profile user_skill_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_profile
    ADD CONSTRAINT user_skill_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_skill_profile user_skill_profile_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_profile
    ADD CONSTRAINT user_skill_profile_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: voice_memos voice_memos_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_memos
    ADD CONSTRAINT voice_memos_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.user_events(id) ON DELETE CASCADE;


--
-- Name: workspace_activity workspace_activity_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_activity
    ADD CONSTRAINT workspace_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_activity workspace_activity_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_activity
    ADD CONSTRAINT workspace_activity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_profiles workspace_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_profiles workspace_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict JAYd5WShn4Frbnh8BydktaFSp420oOBgifoW2FwVN7X2bD1zN8E2CW8g4yOq2WH

