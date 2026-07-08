-- Public schema only (extracted from full Supabase dump)

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
BEGIN
  -- Look up the pending invite
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

  -- Check if user is already an active member
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

  -- Activate the membership
  UPDATE workspace_members
  SET    user_id      = p_user_id,
         status       = 'active',
         joined_at    = NOW(),
         invite_token = NULL
  WHERE  id = v_member.id;

  -- Ensure a workspace_profile row exists for the new member
  INSERT INTO workspace_profiles (workspace_id, user_id, onboarding_completed, onboarding_step)
  VALUES (v_workspace_id, p_user_id, false, 0)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Set active_workspace_id so the user can immediately use the workspace
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
-- Name: increment_chat_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_chat_stats(p_chat_id uuid) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE chats
  SET message_count   = COALESCE(message_count, 0) + 1,
      last_message_at = NOW()
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
-- Name: increment_monthly_token_usage(uuid, date, bigint, bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_monthly_token_usage(p_user_id uuid, p_month date, p_grok_tokens bigint DEFAULT 0, p_perplexity_tokens bigint DEFAULT 0, p_cost_cents integer DEFAULT 0) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
            BEGIN
              INSERT INTO monthly_token_usage (
                  user_id,
                      month,
                          grok_tokens_total,
                              perplexity_tokens_total,
                                  total_cost_cents,
                                      allowance_used_pct,
                                          created_at,
                                              updated_at
                                                )
                                                  VALUES (
                                                      p_user_id,
                                                          p_month,
                                                              p_grok_tokens,
                                                                  p_perplexity_tokens,
                                                                      p_cost_cents,
                                                                          0,
                                                                              NOW(),
                                                                                  NOW()
                                                                                    )
                                                                                      ON CONFLICT (user_id, month)
                                                                                        DO UPDATE SET
                                                                                            grok_tokens_total       = monthly_token_usage.grok_tokens_total       + EXCLUDED.grok_tokens_total,
                                                                                                perplexity_tokens_total = monthly_token_usage.perplexity_tokens_total + EXCLUDED.perplexity_tokens_total,
                                                                                                    total_cost_cents        = monthly_token_usage.total_cost_cents        + EXCLUDED.total_cost_cents,
                                                                                                        allowance_used_pct      = LEAST(100, ROUND(
                                                                                                              (monthly_token_usage.perplexity_tokens_total + EXCLUDED.perplexity_tokens_total)::NUMERIC
                                                                                                                    / NULLIF(COALESCE(monthly_token_usage.token_allowance, 50000), 0)
                                                                                                                          * 100
                                                                                                                              )),
                                                                                                                                  updated_at              = NOW();
                                                                                                                                  END;
                                                                                                                                  $$;


--
-- Name: increment_performance_stats(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_performance_stats(p_user_id uuid, p_is_positive boolean) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO user_performance_profiles
    (user_id, total_sent, total_positive, total_negative, positive_rate)
  VALUES (
    p_user_id, 1,
    CASE WHEN p_is_positive THEN 1 ELSE 0 END,
    CASE WHEN p_is_positive THEN 0 ELSE 1 END,
    CASE WHEN p_is_positive THEN 1.0 ELSE 0.0 END
  )
  ON CONFLICT (user_id) DO UPDATE SET
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
-- Name: increment_perplexity_global_usage(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_perplexity_global_usage(p_date text) RETURNS void
    LANGUAGE sql
    AS $$
  INSERT INTO global_usage (date, perplexity_calls)
  VALUES (p_date::DATE, 1)
  ON CONFLICT (date)
  DO UPDATE SET perplexity_calls = global_usage.perplexity_calls + 1;
$$;


--
-- Name: increment_perplexity_usage(uuid, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_perplexity_usage(p_user_id uuid, p_date date, p_cost_cents integer DEFAULT 5) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
        BEGIN
          -- Per-user usage
            INSERT INTO perplexity_usage (user_id, date, call_count)
              VALUES (p_user_id, p_date, 1)
                ON CONFLICT (user_id, date)
                  DO UPDATE SET call_count = perplexity_usage.call_count + 1;

                    -- Global usage
                      INSERT INTO global_usage (date, perplexity_calls)
                        VALUES (p_date, 1)
                          ON CONFLICT (date)
                            DO UPDATE SET
                                perplexity_calls = global_usage.perplexity_calls + 1,
                                    updated_at       = NOW();
                                    END;
                                    $$;


--
-- Name: increment_perplexity_user_usage(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_perplexity_user_usage(p_user_id uuid, p_date text) RETURNS void
    LANGUAGE sql
    AS $$
  INSERT INTO perplexity_usage (user_id, date, call_count)
  VALUES (p_user_id, p_date::DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET call_count = perplexity_usage.call_count + 1;
$$;


--
-- Name: increment_token_usage(uuid, date, text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_token_usage(p_user_id uuid, p_date date, p_model text, p_tokens_in integer DEFAULT 0, p_tokens_out integer DEFAULT 0, p_cost_cents integer DEFAULT 0) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
              BEGIN
                INSERT INTO usage_tracking (
                    user_id, date,
                        grok_calls, grok_tokens, grok_tokens_in, grok_tokens_out,
                            perplexity_calls, perplexity_tokens, perplexity_tokens_in, perplexity_tokens_out,
                                estimated_cost_cents
                                  )
                                    VALUES (
                                        p_user_id, p_date,

                                            CASE WHEN p_model = 'grok' THEN 1 ELSE 0 END,
                                                CASE WHEN p_model = 'grok' THEN p_tokens_in + p_tokens_out ELSE 0 END,
                                                    CASE WHEN p_model = 'grok' THEN p_tokens_in ELSE 0 END,
                                                        CASE WHEN p_model = 'grok' THEN p_tokens_out ELSE 0 END,

                                                            CASE WHEN p_model = 'perplexity' THEN 1 ELSE 0 END,
                                                                CASE WHEN p_model = 'perplexity' THEN p_tokens_in + p_tokens_out ELSE 0 END,
                                                                    CASE WHEN p_model = 'perplexity' THEN p_tokens_in ELSE 0 END,
                                                                        CASE WHEN p_model = 'perplexity' THEN p_tokens_out ELSE 0 END,

                                                                            p_cost_cents
                                                                              )
                                                                                ON CONFLICT (user_id, date)
                                                                                  DO UPDATE SET

                                                                                      grok_calls =
                                                                                            usage_tracking.grok_calls +
                                                                                                  CASE WHEN p_model = 'grok' THEN 1 ELSE 0 END,

                                                                                                      grok_tokens =
                                                                                                            usage_tracking.grok_tokens +
                                                                                                                  CASE WHEN p_model = 'grok'
                                                                                                                        THEN p_tokens_in + p_tokens_out ELSE 0 END,

                                                                                                                            grok_tokens_in =
                                                                                                                                  usage_tracking.grok_tokens_in +
                                                                                                                                        CASE WHEN p_model = 'grok'
                                                                                                                                              THEN p_tokens_in ELSE 0 END,

                                                                                                                                                  grok_tokens_out =
                                                                                                                                                        usage_tracking.grok_tokens_out +
                                                                                                                                                              CASE WHEN p_model = 'grok'
                                                                                                                                                                    THEN p_tokens_out ELSE 0 END,

                                                                                                                                                                        perplexity_calls =
                                                                                                                                                                              usage_tracking.perplexity_calls +
                                                                                                                                                                                    CASE WHEN p_model = 'perplexity'
                                                                                                                                                                                          THEN 1 ELSE 0 END,

                                                                                                                                                                                              perplexity_tokens =
                                                                                                                                                                                                    usage_tracking.perplexity_tokens +
                                                                                                                                                                                                          CASE WHEN p_model = 'perplexity'
                                                                                                                                                                                                                THEN p_tokens_in + p_tokens_out ELSE 0 END,

                                                                                                                                                                                                                    perplexity_tokens_in =
                                                                                                                                                                                                                          usage_tracking.perplexity_tokens_in +
                                                                                                                                                                                                                                CASE WHEN p_model = 'perplexity'
                                                                                                                                                                                                                                      THEN p_tokens_in ELSE 0 END,

                                                                                                                                                                                                                                          perplexity_tokens_out =
                                                                                                                                                                                                                                                usage_tracking.perplexity_tokens_out +
                                                                                                                                                                                                                                                      CASE WHEN p_model = 'perplexity'
                                                                                                                                                                                                                                                            THEN p_tokens_out ELSE 0 END,

                                                                                                                                                                                                                                                                estimated_cost_cents =
                                                                                                                                                                                                                                                                      usage_tracking.estimated_cost_cents +
                                                                                                                                                                                                                                                                            p_cost_cents;

                                                                                                                                                                                                                                                                            END;
                                                                                                                                                                                                                                                                            $$;


--
-- Name: increment_workspace_perplexity_usage(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_workspace_perplexity_usage(p_workspace_id uuid, p_date text) RETURNS void
    LANGUAGE sql
    AS $$
  INSERT INTO workspace_perplexity_usage (workspace_id, date, call_count)
  VALUES (p_workspace_id, p_date::DATE, 1)
  ON CONFLICT (workspace_id, date)
  DO UPDATE SET call_count = workspace_perplexity_usage.call_count + 1;
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
-- Name: upsert_objection_count(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_objection_count(p_user_id uuid, p_objection_type text, p_phrase text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO objection_tracker
          (user_id, objection_type, objection_phrase, occurrence_count, last_seen_at)
            VALUES (p_user_id, p_objection_type, p_phrase, 1, NOW())
              ON CONFLICT (user_id, objection_type)
                DO UPDATE SET
                    occurrence_count = objection_tracker.occurrence_count + 1,
                        last_seen_at = NOW();
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
        BEGIN
          INSERT INTO objection_tracker
              (user_id, objection_type, objection_phrase, occurrence_count, last_seen_at)
                VALUES
                    (p_user_id, p_objection_type, p_objection_phrase, 1, NOW())
                      ON CONFLICT (user_id, objection_type) DO UPDATE SET
                          occurrence_count = objection_tracker.occurrence_count + 1,
                              last_seen_at     = NOW(),
                                  objection_phrase = EXCLUDED.objection_phrase;
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
    CONSTRAINT chats_chat_type_check CHECK ((chat_type = ANY (ARRAY['general'::text, 'opportunity'::text, 'practice'::text])))
);


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
    CONSTRAINT feedback_outcome_check CHECK ((outcome = ANY (ARRAY['positive'::text, 'negative'::text])))
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
    CONSTRAINT file_uploads_file_type_check CHECK ((file_type = ANY (ARRAY['image'::text, 'pdf'::text, 'document'::text, 'other'::text])))
);


--
-- Name: global_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.global_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date DEFAULT CURRENT_DATE,
    perplexity_calls integer DEFAULT 0,
    total_estimated_cost_cents integer DEFAULT 0
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
    duration_ms integer
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
-- Name: monthly_token_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_token_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    month date NOT NULL,
    grok_tokens_total integer DEFAULT 0,
    perplexity_tokens_total integer DEFAULT 0,
    total_cost_cents integer DEFAULT 0,
    token_allowance integer DEFAULT 100000,
    allowance_used_pct numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
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
    CONSTRAINT opportunities_stage_check CHECK ((stage = ANY (ARRAY['new'::text, 'contacted'::text, 'replied'::text, 'call_demo'::text, 'closed_won'::text, 'closed_lost'::text])))
);


--
-- Name: perplexity_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.perplexity_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date date NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
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
    badge_description text
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
    created_at timestamp with time zone DEFAULT now()
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
    workspace_id uuid NOT NULL
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
    workspace_id uuid NOT NULL
);


--
-- Name: usage_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE,
    perplexity_calls integer DEFAULT 0,
    grok_calls integer DEFAULT 0,
    perplexity_tokens integer DEFAULT 0,
    grok_tokens integer DEFAULT 0,
    grok_tokens_in integer DEFAULT 0,
    grok_tokens_out integer DEFAULT 0,
    perplexity_tokens_in integer DEFAULT 0,
    perplexity_tokens_out integer DEFAULT 0,
    estimated_cost_cents integer DEFAULT 0
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
    workspace_id uuid NOT NULL
);


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
-- Name: workspace_perplexity_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_perplexity_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    date text NOT NULL,
    call_count integer DEFAULT 0 NOT NULL
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
    onboarding_questions jsonb DEFAULT '{}'::jsonb
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
-- Name: daily_metrics daily_metrics_user_workspace_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_user_workspace_date_unique UNIQUE (user_id, workspace_id, date);


--
-- Name: feature_usage_events feature_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_usage_events
    ADD CONSTRAINT feature_usage_events_pkey PRIMARY KEY (id);


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
-- Name: global_usage global_usage_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_usage
    ADD CONSTRAINT global_usage_date_key UNIQUE (date);


--
-- Name: global_usage global_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_usage
    ADD CONSTRAINT global_usage_pkey PRIMARY KEY (id);


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
-- Name: monthly_token_usage monthly_token_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_token_usage
    ADD CONSTRAINT monthly_token_usage_pkey PRIMARY KEY (id);


--
-- Name: monthly_token_usage monthly_token_usage_user_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_token_usage
    ADD CONSTRAINT monthly_token_usage_user_id_month_key UNIQUE (user_id, month);


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
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);


--
-- Name: perplexity_usage perplexity_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perplexity_usage
    ADD CONSTRAINT perplexity_usage_pkey PRIMARY KEY (id);


--
-- Name: perplexity_usage perplexity_usage_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perplexity_usage
    ADD CONSTRAINT perplexity_usage_user_id_date_key UNIQUE (user_id, date);


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
-- Name: usage_tracking usage_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_pkey PRIMARY KEY (id);


--
-- Name: usage_tracking usage_tracking_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_user_id_date_key UNIQUE (user_id, date);


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
-- Name: workspace_perplexity_usage workspace_perplexity_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_perplexity_usage
    ADD CONSTRAINT workspace_perplexity_usage_pkey PRIMARY KEY (id);


--
-- Name: workspace_perplexity_usage workspace_perplexity_usage_workspace_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_perplexity_usage
    ADD CONSTRAINT workspace_perplexity_usage_workspace_id_date_key UNIQUE (workspace_id, date);


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
-- Name: idx_chat_messages_chunks; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_chunks ON public.chat_messages USING btree (parent_message_id, chunk_index) WHERE (parent_message_id IS NOT NULL);


--
-- Name: idx_chat_messages_monologue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_monologue ON public.chat_messages USING btree (chat_id, role) WHERE (internal_monologue IS NOT NULL);


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
-- Name: idx_chats_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chats_workspace ON public.chats USING btree (workspace_id);


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
-- Name: idx_monthly_usage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_usage ON public.monthly_token_usage USING btree (user_id, month DESC);


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
-- Name: idx_opps_ws_source_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_opps_ws_source_url ON public.opportunities USING btree (workspace_id, user_id, source_url) WHERE (source_url IS NOT NULL);


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
-- Name: idx_practice_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_user ON public.practice_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_prospects_health; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_health ON public.prospects USING btree (user_id, relationship_health_score);


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
-- Name: idx_usage_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_user_date ON public.usage_tracking USING btree (user_id, date);


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
-- Name: idx_wpu_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wpu_workspace ON public.workspace_perplexity_usage USING btree (workspace_id, date);


--
-- Name: objection_tracker_user_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX objection_tracker_user_type_idx ON public.objection_tracker USING btree (user_id, objection_type);


--
-- Name: perplexity_usage_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX perplexity_usage_user_date_idx ON public.perplexity_usage USING btree (user_id, date);


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
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


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
-- Name: monthly_token_usage monthly_token_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_token_usage
    ADD CONSTRAINT monthly_token_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: perplexity_usage perplexity_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.perplexity_usage
    ADD CONSTRAINT perplexity_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: practice_badges practice_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_badges
    ADD CONSTRAINT practice_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: usage_tracking usage_tracking_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: workspace_perplexity_usage workspace_perplexity_usage_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_perplexity_usage
    ADD CONSTRAINT workspace_perplexity_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


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
-- Name: push_notification_log Service role manages push log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages push log" ON public.push_notification_log USING ((auth.role() = 'service_role'::text));


--
-- Name: practice_curriculum Users can read own curriculum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own curriculum" ON public.practice_curriculum FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: practice_drills Users can read own drills; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own drills" ON public.practice_drills FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_skill_profile Users can read own skill profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own skill profile" ON public.user_skill_profile FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: feature_usage_events Users see own feature events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own feature events" ON public.feature_usage_events FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: chat_topic_tags Users see own topic tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own topic tags" ON public.chat_topic_tags FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: practice_badges badges_own_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY badges_own_data ON public.practice_badges USING ((auth.uid() = user_id));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: chat_messages chat_messages_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_write_own ON public.chat_messages USING ((user_id = auth.uid()));


--
-- Name: chat_topic_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_topic_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: chats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

--
-- Name: chats chats_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chats_select ON public.chats FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: chats chats_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chats_write_own ON public.chats USING ((user_id = auth.uid()));


--
-- Name: communication_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_patterns communication_patterns_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_patterns_select ON public.communication_patterns FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: communication_patterns communication_patterns_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communication_patterns_write_own ON public.communication_patterns USING ((user_id = auth.uid()));


--
-- Name: conversation_analyses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_analyses ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_analyses conversation_analyses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_analyses_select ON public.conversation_analyses FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: conversation_analyses conversation_analyses_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_analyses_write_own ON public.conversation_analyses USING ((user_id = auth.uid()));


--
-- Name: conversation_commitments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_commitments ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_commitments conversation_commitments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_commitments_select ON public.conversation_commitments FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: conversation_commitments conversation_commitments_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_commitments_write_own ON public.conversation_commitments USING ((user_id = auth.uid()));


--
-- Name: conversation_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_signals conversation_signals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_signals_select ON public.conversation_signals FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: conversation_signals conversation_signals_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_signals_write_own ON public.conversation_signals USING ((user_id = auth.uid()));


--
-- Name: daily_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback feedback_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_select ON public.feedback FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: feedback feedback_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_write_own ON public.feedback USING ((user_id = auth.uid()));


--
-- Name: file_uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.file_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: growth_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.growth_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: growth_cards growth_cards_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY growth_cards_select ON public.growth_cards FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: growth_cards growth_cards_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY growth_cards_write_own ON public.growth_cards USING ((user_id = auth.uid()));


--
-- Name: message_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_metrics metrics_own_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY metrics_own_data ON public.daily_metrics USING ((auth.uid() = user_id));


--
-- Name: monthly_token_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_token_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_token_usage monthly_usage_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY monthly_usage_own ON public.monthly_token_usage USING ((auth.uid() = user_id));


--
-- Name: objection_tracker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.objection_tracker ENABLE ROW LEVEL SECURITY;

--
-- Name: objection_tracker objection_tracker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY objection_tracker_select ON public.objection_tracker FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: objection_tracker objection_tracker_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY objection_tracker_write_own ON public.objection_tracker USING ((user_id = auth.uid()));


--
-- Name: opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunities opportunities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opportunities_select ON public.opportunities FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: opportunities opportunities_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opportunities_write_own ON public.opportunities USING ((user_id = auth.uid()));


--
-- Name: user_performance_profiles performance_own_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY performance_own_data ON public.user_performance_profiles USING ((auth.uid() = user_id));


--
-- Name: practice_badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_badges ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_curriculum; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_curriculum ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_drills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_drills ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_sessions practice_own_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_own_data ON public.practice_sessions USING ((auth.uid() = user_id));


--
-- Name: practice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_insights prospect_insights_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_insights_select ON public.prospect_insights FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: prospect_insights prospect_insights_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospect_insights_write_own ON public.prospect_insights USING ((user_id = auth.uid()));


--
-- Name: prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects prospects_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_select ON public.prospects FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: prospects prospects_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospects_write_own ON public.prospects USING ((user_id = auth.uid()));


--
-- Name: push_notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_progression; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skill_progression ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_progression skill_progression_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skill_progression_select ON public.skill_progression FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: skill_progression skill_progression_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skill_progression_write_own ON public.skill_progression USING ((user_id = auth.uid()));


--
-- Name: file_uploads uploads_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uploads_own ON public.file_uploads USING ((auth.uid() = user_id));


--
-- Name: usage_tracking usage_own_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_own_data ON public.usage_tracking USING ((auth.uid() = user_id));


--
-- Name: usage_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: user_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

--
-- Name: user_events user_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_events_select ON public.user_events FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: user_events user_events_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_events_write_own ON public.user_events USING ((user_id = auth.uid()));


--
-- Name: user_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: user_goals user_goals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_goals_select ON public.user_goals FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: user_goals user_goals_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_goals_write_own ON public.user_goals USING ((user_id = auth.uid()));


--
-- Name: user_performance_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_performance_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_skill_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_skill_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete ON public.users FOR DELETE USING ((auth.uid() = id));


--
-- Name: users users_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select ON public.users FOR SELECT USING ((auth.uid() = id));


--
-- Name: users users_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update ON public.users FOR UPDATE USING ((auth.uid() = id));


--
-- Name: workspace_members wm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wm_select ON public.workspace_members FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: workspace_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_activity workspace_activity_insert_service; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_activity_insert_service ON public.workspace_activity TO service_role USING (true) WITH CHECK (true);


--
-- Name: workspace_activity workspace_activity_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_activity_select ON public.workspace_activity FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE ((wm.workspace_id = workspace_activity.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text)))));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_perplexity_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_perplexity_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_profiles wp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wp_select ON public.workspace_profiles FOR SELECT USING (public.is_workspace_member(workspace_id));


--
-- Name: workspace_profiles wp_write_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wp_write_own ON public.workspace_profiles USING ((user_id = auth.uid()));


--
-- Name: workspace_perplexity_usage wpu_service_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wpu_service_only ON public.workspace_perplexity_usage USING (false);


--
-- Name: workspaces ws_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_select ON public.workspaces FOR SELECT USING (public.is_workspace_member(id));


--
-- Name: workspaces ws_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_update_owner ON public.workspaces FOR UPDATE USING ((owner_user_id = auth.uid()));


--
-- Name: supabase_realtime chat_messages; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.chat_messages;


--
-- Name: supabase_realtime message_queue; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.message_queue;


--
-- Name: supabase_realtime opportunities; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.opportunities;

