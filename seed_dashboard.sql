-- ================================================================
--  DASHBOARD SEED SCRIPT
--  Targets: daily_metrics, opportunities, feedback, user_goals,
--           growth_cards, daily_check_ins,
--           user_performance_profiles, workspace_profiles
--
--  Automatically picks up the first (and only) user + workspace.
--  Safe to re-run: uses DELETE + INSERT per section.
-- ================================================================

DO $$
DECLARE
  v_user_id      UUID;
  v_workspace_id UUID;
  v_today        DATE := CURRENT_DATE;

  -- Opportunity IDs we'll reference in feedback
  opp_won_1  UUID := gen_random_uuid();
  opp_won_2  UUID := gen_random_uuid();
  opp_lost_1 UUID := gen_random_uuid();
  opp_demo_1 UUID := gen_random_uuid();
  opp_demo_2 UUID := gen_random_uuid();
  opp_reply_1 UUID := gen_random_uuid();

BEGIN

  -- ── 0. Resolve user & workspace ───────────────────────────────
  SELECT id INTO v_user_id FROM public.users
  WHERE is_deleted = false ORDER BY created_at ASC LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found. Make sure you have signed up first.';
  END IF;

  SELECT id INTO v_workspace_id FROM public.workspaces
  WHERE owner_user_id = v_user_id AND is_deleted = false
  ORDER BY created_at ASC LIMIT 1;

  IF v_workspace_id IS NULL THEN
    SELECT active_workspace_id INTO v_workspace_id
    FROM public.users WHERE id = v_user_id;
  END IF;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'No workspace found for user %.', v_user_id;
  END IF;

  RAISE NOTICE '→ Seeding for user_id=% workspace_id=%', v_user_id, v_workspace_id;


  -- ── 1. workspace_profiles — set archetype so header shows it ──
  UPDATE public.workspace_profiles
  SET
    archetype              = 'hunter',
    archetype_detected_at  = NOW(),
    onboarding_completed   = true,
    onboarding_step        = 5,
    business_name          = 'Acme SaaS',
    product_description    = 'B2B sales coaching platform for founders',
    target_audience        = 'Early-stage SaaS founders doing their own sales',
    industry               = 'SaaS / Software',
    role                   = 'Founder',
    experience_level       = 'intermediate',
    preferred_platforms    = ARRAY['linkedin','email']
  WHERE workspace_id = v_workspace_id AND user_id = v_user_id;

  -- Also make sure user has a streak for the header badge
  UPDATE public.users
  SET check_in_streak = 5, last_check_in_at = NOW()
  WHERE id = v_user_id;


  -- ── 2. user_performance_profiles ─────────────────────────────
  DELETE FROM public.user_performance_profiles
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id;

  INSERT INTO public.user_performance_profiles
    (user_id, workspace_id, total_sent, total_positive, total_negative, positive_rate,
     best_platform, best_message_style, best_message_length)
  VALUES
    (v_user_id, v_workspace_id, 47, 14, 33, 0.2979,
     'linkedin', 'value-led', 'medium');


  -- ── 3. opportunities (30 days, various stages) ────────────────
  -- We delete only the seeded ones by a marker in score_reason
  DELETE FROM public.opportunities
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
    AND score_reason = '__seed__';

  -- closed_won opportunities (will power pipeline value & win rate)
  INSERT INTO public.opportunities
    (id, user_id, workspace_id, platform, source_url, target_name, target_context,
     prepared_message, fit_score, timing_score, intent_score,
     status, stage, marked_sent_at, created_at, score_reason)
  VALUES
    (opp_won_1, v_user_id, v_workspace_id, 'linkedin',
     'https://linkedin.com/in/sarah-johnson', 'Sarah Johnson',
     'VP Sales at Growthly — posted about scaling their SDR team',
     'Hi Sarah, saw your post about building out your SDR team. We help sales leaders at Series A companies cut ramp time by 40% — worth a quick call?',
     85, 80, 90, 'sent', 'closed_won',
     v_today - INTERVAL '22 days', v_today - INTERVAL '25 days', '__seed__'),

    (opp_won_2, v_user_id, v_workspace_id, 'email',
     'https://crunchbase.com/org/nexttier', 'Marcus Reid',
     'CTO at NextTier — just raised seed round, building sales process from scratch',
     'Hey Marcus, congrats on the raise. Founders at your stage often struggle with the first 50 outbound sequences. Happy to share what''s working — 15 mins?',
     88, 92, 85, 'sent', 'closed_won',
     v_today - INTERVAL '15 days', v_today - INTERVAL '18 days', '__seed__'),

    -- closed_lost
    (opp_lost_1, v_user_id, v_workspace_id, 'linkedin',
     'https://linkedin.com/in/priya-patel', 'Priya Patel',
     'Head of Growth at Launchpad — was hiring BDRs',
     'Hi Priya, noticed you''re building out your growth team. We work with similar companies to improve outbound conversion. Worth exploring?',
     70, 65, 72, 'sent', 'closed_lost',
     v_today - INTERVAL '10 days', v_today - INTERVAL '12 days', '__seed__'),

    -- call_demo (active pipeline)
    (opp_demo_1, v_user_id, v_workspace_id, 'reddit',
     'https://reddit.com/r/startups/comments/abc123', 'Tom Chen',
     'Founder at Buildfast asking about cold outreach tools',
     'Hey Tom, saw your post on r/startups. We specifically help founders who are doing their own sales — no SDR needed. Happy to walk you through it?',
     82, 78, 88, 'sent', 'call_demo',
     v_today - INTERVAL '7 days', v_today - INTERVAL '8 days', '__seed__'),

    (opp_demo_2, v_user_id, v_workspace_id, 'linkedin',
     'https://linkedin.com/in/alex-wu', 'Alex Wu',
     'CEO at Loopify — posted about outbound struggles',
     'Alex, your post resonated — outbound is brutal without a repeatable playbook. We''ve helped 40+ founders fix this. Got 20 mins this week?',
     79, 83, 80, 'sent', 'call_demo',
     v_today - INTERVAL '5 days', v_today - INTERVAL '6 days', '__seed__'),

    -- replied (active pipeline)
    (opp_reply_1, v_user_id, v_workspace_id, 'email',
     'https://producthunt.com/products/framelink', 'Jamie Torres',
     'Co-founder at Framelink — replied positively to last outreach',
     'Hey Jamie, noticed Framelink just launched. Founders doing their own outreach at this stage often hit a wall around month 3 — we help break through that.',
     75, 70, 77, 'sent', 'replied',
     v_today - INTERVAL '3 days', v_today - INTERVAL '4 days', '__seed__');

  -- Add some recent "new" stage opps so the feed has content
  INSERT INTO public.opportunities
    (user_id, workspace_id, platform, source_url, target_name, target_context,
     prepared_message, fit_score, timing_score, intent_score,
     status, stage, created_at, score_reason)
  SELECT
    v_user_id, v_workspace_id,
    platform, source_url, target_name, target_context,
    prepared_message, fit_score, timing_score, intent_score,
    'pending', 'new', created_at, '__seed__'
  FROM (VALUES
    ('linkedin', 'https://linkedin.com/in/dana-white-ceo', 'Dana White',
     'CEO at Pivotal — hiring sales team after product-market fit',
     'Dana, building your first sales motion after PMF is one of the most critical moments. We''ve helped founders at this exact stage 3x their pipeline in 60 days.',
     88, 85, 91, v_today - INTERVAL '1 day'),
    ('reddit', 'https://reddit.com/r/entrepreneur/comments/xyz789', 'Chris Park',
     'Bootstrapped founder asking about B2B outreach on r/entrepreneur',
     'Hey Chris, bootstrapped founders doing B2B outreach need a different playbook than funded startups. Happy to share what''s working without the burn.',
     80, 76, 83, v_today - INTERVAL '2 days')
  ) AS t(platform, source_url, target_name, target_context, prepared_message,
         fit_score, timing_score, intent_score, created_at);


  -- ── 4. feedback (powers pipeline_metrics view) ────────────────
  DELETE FROM public.feedback
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
    AND opportunity_id IN (opp_won_1, opp_won_2, opp_lost_1, opp_demo_1, opp_demo_2, opp_reply_1);

  INSERT INTO public.feedback
    (user_id, workspace_id, opportunity_id, outcome, deal_value_usd, scheduled_call, is_final)
  VALUES
    (v_user_id, v_workspace_id, opp_won_1,  'positive', 4800,  true,  true),
    (v_user_id, v_workspace_id, opp_won_2,  'positive', 7200,  true,  true),
    (v_user_id, v_workspace_id, opp_lost_1, 'negative', NULL,  false, true),
    (v_user_id, v_workspace_id, opp_demo_1, 'positive', NULL,  true,  false),
    (v_user_id, v_workspace_id, opp_demo_2, 'positive', NULL,  true,  false),
    (v_user_id, v_workspace_id, opp_reply_1,'positive', NULL,  false, false);


  -- ── 5. daily_metrics (30 days for chart) ─────────────────────
  DELETE FROM public.daily_metrics
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
    AND date >= v_today - INTERVAL '30 days';

  INSERT INTO public.daily_metrics
    (user_id, workspace_id, date, messages_sent, positive_outcomes,
     negative_outcomes, positive_rate, opportunities_shown)
  SELECT
    v_user_id,
    v_workspace_id,
    v_today - (INTERVAL '1 day' * gs),
    -- Realistic-ish daily numbers: 0–4 sent, weekends quieter
    CASE
      WHEN EXTRACT(DOW FROM (v_today - (INTERVAL '1 day' * gs))) IN (0,6) THEN FLOOR(RANDOM()*2)::INT
      ELSE FLOOR(RANDOM()*3+1)::INT
    END,
    CASE WHEN RANDOM() > 0.65 THEN 1 ELSE 0 END,
    CASE WHEN RANDOM() > 0.40 THEN 1 ELSE 0 END,
    ROUND((RANDOM() * 0.25 + 0.10)::NUMERIC, 4),
    FLOOR(RANDOM()*8+2)::INT
  FROM generate_series(0, 29) AS gs
  -- Skip days that already have data
  WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_metrics dm
    WHERE dm.user_id = v_user_id
      AND dm.workspace_id = v_workspace_id
      AND dm.date = v_today - (INTERVAL '1 day' * gs)
  );


  -- ── 6. user_goals (shows in dashboard goals section) ──────────
  DELETE FROM public.user_goals
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id;

  INSERT INTO public.user_goals
    (user_id, workspace_id, goal_text, goal_type, target_value, target_unit,
     target_date, current_value, status)
  VALUES
    (v_user_id, v_workspace_id,
     'Send 50 personalised outreach messages',
     'outreach', 50, 'messages',
     v_today + INTERVAL '14 days', 31, 'active'),

    (v_user_id, v_workspace_id,
     'Book 5 discovery calls this month',
     'pipeline', 5, 'calls',
     v_today + INTERVAL '21 days', 2, 'active'),

    (v_user_id, v_workspace_id,
     'Close $10k in new MRR',
     'revenue', 10000, 'USD',
     v_today + INTERVAL '45 days', 4800, 'active');


  -- ── 7. growth_cards (growth feed) ────────────────────────────
  DELETE FROM public.growth_cards
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
    AND generated_by IN ('ai_daily', 'ai_checkin', 'ai_weekly', 'system');

  INSERT INTO public.growth_cards
    (user_id, workspace_id, card_type, title, body,
     action_label, action_type, priority, is_read, generated_by, created_at)
  VALUES
    (v_user_id, v_workspace_id, 'tip',
     'Lead with curiosity, not your pitch',
     'Your best-performing messages this week opened with a question rather than a feature list. Buyers respond to feeling understood, not sold to. Try leading with "I noticed..." followed by a specific observation about their situation before mentioning what you do.',
     'Practice this opener', 'internal_chat', 9, false, 'ai_daily',
     NOW() - INTERVAL '2 hours'),

    (v_user_id, v_workspace_id, 'insight',
     'Your LinkedIn reply rate is 2× your email rate',
     'Based on your last 30 messages, LinkedIn is significantly outperforming email for you — 34% vs 17%. Consider shifting more of your volume there while you test what''s making email underperform.',
     'Explore your stats', 'internal_nav', 8, false, 'ai_daily',
     NOW() - INTERVAL '5 hours'),

    (v_user_id, v_workspace_id, 'challenge',
     '5-day follow-up sprint',
     'You have 3 contacts who replied but never got a follow-up. This week''s challenge: send one thoughtful follow-up per day to your warm pipeline. A simple "still relevant?" with a new insight closes 22% of stalled deals.',
     'Start the challenge', 'internal_chat', 8, false, 'ai_daily',
     NOW() - INTERVAL '1 day'),

    (v_user_id, v_workspace_id, 'strategy',
     'Weekly plan: convert your warm pipeline',
     'You''ve got 3 contacts at call/demo stage. This week''s focus: don''t open new doors — close the ones already ajar. Block 30 mins each morning for follow-ups before doing any new outreach. Use the Monday slot to prepare personalised value summaries for each open deal.',
     'Discuss with Clutch AI', 'internal_chat', 9, true, 'ai_weekly',
     NOW() - INTERVAL '2 days'),

    (v_user_id, v_workspace_id, 'reflection',
     'What made your best message work?',
     'Your top-performing message this month (Sarah Johnson, closed_won) used a specific data point from her own public post. Take 5 minutes to identify the pattern: was it the personalisation, the hook, the CTA, or the timing? Replicating that deliberately is how you build a repeatable playbook.',
     'Reflect with Clutch AI', 'internal_chat', 7, false, 'ai_checkin',
     NOW() - INTERVAL '3 days'),

    (v_user_id, v_workspace_id, 'resource',
     'The 3-sentence cold message framework',
     'Line 1: Show you know them (specific observation). Line 2: Connect it to a pain you solve (not a feature). Line 3: Low-friction CTA ("worth a 15-min chat?" not "book a demo"). Messages under 60 words consistently outperform longer ones in B2B outreach.',
     'Try it now', 'internal_chat', 6, true, 'ai_daily',
     NOW() - INTERVAL '4 days');


  -- ── 8. daily_check_ins (today completed + recent history) ─────
  DELETE FROM public.daily_check_ins
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
    AND date >= v_today - INTERVAL '7 days';

  -- Today's check-in — already completed so dashboard shows coaching card
  INSERT INTO public.daily_check_ins
    (user_id, workspace_id, date, mood_score, ai_response,
     answers, processed_at, questions)
  VALUES
    (v_user_id, v_workspace_id, v_today, 4,
     'Strong day ahead. You''re 3 calls away from your monthly goal — that''s within reach this week. Your follow-up timing has been improving; keep the momentum by reaching back out to Tom and Alex before Friday. One message a day to warm leads beats five cold ones.',
     '{"q1": "Feeling focused, had a good call yesterday", "q2": "Want to close at least one demo this week", "q3": "Struggled a bit with objection handling on the pricing question"}'::jsonb,
     NOW() - INTERVAL '2 hours',
     '[{"id": "q1", "text": "How are you feeling going into today?"}, {"id": "q2", "text": "What''s your #1 focus today?"}, {"id": "q3", "text": "Anything blocking you right now?"}]'::jsonb),

    -- Recent history for mood average
    (v_user_id, v_workspace_id, v_today - INTERVAL '1 day', 3,
     'Consistency over intensity. Even on slower days, one quality outreach message keeps your streak alive.',
     '{"q1": "Bit tired, had a late night", "q2": "Catch up on emails", "q3": "Not much, just energy"}'::jsonb,
     (v_today - INTERVAL '1 day')::TIMESTAMP + INTERVAL '9 hours',
     '[{"id": "q1", "text": "How are you feeling today?"}]'::jsonb),

    (v_user_id, v_workspace_id, v_today - INTERVAL '2 days', 5,
     'Great energy — this is exactly when to push. You booked a demo this week. Use that momentum to follow up fast while you''re top of mind.',
     '{"q1": "Great, just booked a demo!", "q2": "Reach out to 3 new prospects"}'::jsonb,
     (v_today - INTERVAL '2 days')::TIMESTAMP + INTERVAL '8 hours',
     '[{"id": "q1", "text": "How are you feeling today?"}]'::jsonb);


  -- ── Done ─────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '✅ Seed complete for user % / workspace %', v_user_id, v_workspace_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Dashboard will show:';
  RAISE NOTICE '  → Momentum score   ~65–75 (activity + conversion + pipeline)';
  RAISE NOTICE '  → Sent (30d)       ~31 opportunities marked sent';
  RAISE NOTICE '  → Reply rate       ~29%%';
  RAISE NOTICE '  → Pipeline value   $12,000 (call_demo stage)';
  RAISE NOTICE '  → Win rate         66.7%% (2 won / 1 lost)';
  RAISE NOTICE '  → Active goals     3 (with realistic progress)';
  RAISE NOTICE '  → Growth feed      6 cards (tip, insight, challenge, strategy, reflection, resource)';
  RAISE NOTICE '  → Check-in         Today completed → shows coaching message';
  RAISE NOTICE '  → Streak badge     5-day streak 🔥';

END $$;
