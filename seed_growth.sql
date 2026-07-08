-- =============================================================
--  GROWTH TABLES SEED SCRIPT
--  userId      = 190dc2fa-134e-4eab-9be1-661e4fe96cd9
--  workspaceId = d8151f09-56a4-41f6-908e-22b92f6820f9
--
--  Covers every table touched by growth.js endpoints:
--    GET  /feed           → growth_cards, opportunities, user_goals
--    POST /cards/:id/read → growth_cards
--    POST /cards/:id/dismiss → growth_cards
--    GET  /checkin/today  → daily_check_ins, chat_messages, user_goals
--    POST /checkin        → daily_check_ins, user_goals, opportunities,
--                           conversation_analyses
--    GET  /history        → growth_cards
--    POST /archetype/detect → workspace_profiles (existing record assumed)
--    GET  /plan           → growth_cards, user_goals,
--                           user_performance_profiles, daily_check_ins
-- =============================================================

-- ── Convenience variables (re-used throughout) ────────────────
DO $$
BEGIN
  RAISE NOTICE 'Seeding growth tables for userId=190dc2fa-134e-4eab-9be1-661e4fe96cd9 workspaceId=d8151f09-56a4-41f6-908e-22b92f6820f9';
END $$;

-- =============================================================
-- 1. user_goals  (active — fetched by /feed, /checkin, /plan)
-- =============================================================
INSERT INTO user_goals (id, user_id, workspace_id, goal_text, goal_type, target_value, target_unit, target_date, current_value, status)
VALUES
  (
    gen_random_uuid(),
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'Close 3 new deals this month',
    'revenue',
    3, 'deals', CURRENT_DATE + INTERVAL '20 days', 1,
    'active'
  ),
  (
    gen_random_uuid(),
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'Send 50 personalised outreach messages per week',
    'activity',
    50, 'messages/week', CURRENT_DATE + INTERVAL '7 days', 23,
    'active'
  ),
  (
    gen_random_uuid(),
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'Book 5 discovery calls this week',
    'meetings',
    5, 'calls', CURRENT_DATE + INTERVAL '5 days', 2,
    'active'
  );


-- =============================================================
-- 3. growth_cards  (mix of types / states for full feed coverage)
-- =============================================================

-- 3a. Active, unread, non-dismissed cards → shown in /feed
INSERT INTO growth_cards (id, user_id, workspace_id, card_type, title, body, action_label, action_type, priority, is_read, is_dismissed, generated_by, metadata, expires_at)
VALUES
  (
    'aaaaaaaa-0001-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'tip',
    'Lead with curiosity, not a pitch',
    'Opening with a question about their specific pain point increases reply rates by ~30%. Try "I noticed you recently hired 3 SDRs — are you finding onboarding ramp time a bottleneck?" instead of leading with your product.',
    'Chat with Clutch about this',
    'internal_chat',
    8, FALSE, FALSE, 'ai_daily',
    '{"focus_area": "outreach", "archetype": "seller"}'::jsonb,
    NOW() + INTERVAL '3 days'
  ),
  (
    'aaaaaaaa-0002-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'challenge',
    '5-minute LinkedIn audit',
    'Review the last 5 LinkedIn profiles you messaged. Did you reference something specific to them — a post, a job change, a company milestone? If not, rewrite one of those messages now and send a follow-up.',
    'Start challenge',
    'internal_chat',
    7, FALSE, FALSE, 'ai_daily',
    '{"focus_area": "personalization"}'::jsonb,
    NOW() + INTERVAL '2 days'
  ),
  (
    'aaaaaaaa-0003-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'insight',
    'Your reply rate dips on Fridays',
    'Based on your recent outreach data, messages sent Friday afternoon get 40% fewer replies than Tuesday–Thursday. Consider scheduling your highest-priority sends earlier in the week.',
    'Adjust my schedule',
    'internal_chat',
    9, FALSE, FALSE, 'ai_pattern_detection',
    '{"pattern": "day_of_week_reply_rate", "confidence": 0.82}'::jsonb,
    NOW() + INTERVAL '7 days'
  ),
  (
    'aaaaaaaa-0004-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'reflection',
    'What is your #1 objection right now?',
    'Sellers who regularly name and script their top 3 objections convert 22% more deals. What is the objection you hear most often? Let''s build a sharp response together.',
    'Work through it with Clutch',
    'internal_chat',
    6, FALSE, FALSE, 'ai_checkin',
    '{}'::jsonb,
    NOW() + INTERVAL '4 days'
  ),
  (
    'aaaaaaaa-0005-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'resource',
    'The 3-line cold email framework',
    'Line 1: Specific trigger (why you''re reaching out now). Line 2: One-sentence value prop tied to their world. Line 3: Soft CTA with a clear ask. Keep it under 60 words. This week''s challenge: rewrite your best-performing template using this structure.',
    'Try it now',
    'internal_chat',
    5, FALSE, FALSE, 'ai_daily',
    '{"resource_type": "framework"}'::jsonb,
    NOW() + INTERVAL '5 days'
  );

-- 3b. Already-read card (for testing /cards/:id/read toggle & history)
INSERT INTO growth_cards (id, user_id, workspace_id, card_type, title, body, action_label, action_type, priority, is_read, is_dismissed, generated_by, metadata)
VALUES
  (
    'aaaaaaaa-0006-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'tip',
    'Follow-up timing matters',
    'The optimal follow-up window after no reply is 3–5 business days — not 24 hours. Give them space to breathe.',
    'Learn more',
    'internal_chat',
    4, TRUE, FALSE, 'ai_daily',
    '{}'::jsonb
  );

-- 3c. Dismissed card (should NOT appear in /feed, but visible in /history)
INSERT INTO growth_cards (id, user_id, workspace_id, card_type, title, body, action_label, action_type, priority, is_read, is_dismissed, generated_by, metadata)
VALUES
  (
    'aaaaaaaa-0007-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'tip',
    'Dismissed: Use social proof early',
    'Mentioning a recognisable customer in the first two lines lifts open rates significantly.',
    NULL, NULL,
    3, TRUE, TRUE, 'ai_daily',
    '{}'::jsonb
  );

-- 3d. Weekly strategy card — used by GET /plan (card_type=strategy, generated_by=ai_weekly)
--     Created at start of the current week so getWeekStart() picks it up
INSERT INTO growth_cards (id, user_id, workspace_id, card_type, title, body, action_label, action_type, priority, is_read, is_dismissed, generated_by, metadata, expires_at, created_at)
VALUES
  (
    'aaaaaaaa-0008-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'strategy',
    'Your Weekly Growth Plan',
    'This week focus on deepening existing pipeline. Prioritise the 3 prospects who have replied but gone quiet — reach out with a value-add (case study or relevant insight) rather than a check-in. Reserve cold outreach to Tue/Wed mornings only.',
    'Explore this week''s plan with Clutch',
    'internal_chat',
    9, FALSE, FALSE, 'ai_weekly',
    '{
      "daily_actions": [
        "Monday: Review stalled pipeline and draft re-engagement messages",
        "Tuesday: Send 10 cold outreach messages before noon",
        "Wednesday: Follow up on any replies from Tuesday",
        "Thursday: Prep for 2 discovery calls",
        "Friday: Log outcomes and update goals"
      ],
      "focus_area": "pipeline_deepening"
    }'::jsonb,
    DATE_TRUNC('week', NOW()) + INTERVAL '7 days',
    DATE_TRUNC('week', NOW())  -- set to week start so the /plan cache check finds it
  );


-- =============================================================
-- 4. opportunities  (stage='new' → returned in /feed; others for /checkin context)
-- =============================================================
INSERT INTO opportunities (id, user_id, workspace_id, platform, source_url, target_name, target_context, prepared_message, fit_score, timing_score, intent_score, stage, status)
VALUES
  (
    'bbbbbbbb-0001-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'linkedin',
    'https://linkedin.com/in/sarah-chen-vp-sales',
    'Sarah Chen',
    'VP of Sales at Momentum CRM. Recently posted about struggling to hit Q2 pipeline targets. Company just raised Series B.',
    'Hi Sarah — saw your post about Q2 pipeline pressure. We help sales teams at Series B companies cut ramp time by 30%. Worth a quick 15-min chat?',
    85, 90, 80,
    'new', 'pending'
  ),
  (
    'bbbbbbbb-0002-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'reddit',
    'https://reddit.com/r/sales/comments/xyz123',
    'u/startup_founder_ama',
    'Reddit post asking for outreach tool recommendations. Mentions a team of 5 SDRs and frustration with manual CRM updates.',
    'Hey — I saw your thread on r/sales. We built exactly what you described. Happy to show you how 3 similar teams cut manual CRM work by 2h/day.',
    78, 95, 88,
    'new', 'pending'
  ),
  (
    'bbbbbbbb-0003-4eab-9be1-661e4fe96cd9',
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    'email',
    'https://acmecorp.com/team',
    'Marcus Webb',
    'Head of Revenue at Acme Corp. Replied to initial cold email, asked for more info, then went quiet for 8 days.',
    'Hi Marcus — following up with that case study I mentioned. Attaching it here — curious if this mirrors what you are seeing.',
    70, 60, 72,
    'contacted', 'pending'
  );

-- Mark one opp as sent (used by /checkin to fetch lastSentMessage context)
UPDATE opportunities
SET marked_sent_at = NOW() - INTERVAL '2 days'
WHERE id = 'bbbbbbbb-0003-4eab-9be1-661e4fe96cd9';


-- =============================================================
-- 5. conversation_analyses  (fetched by POST /checkin for lastAnalysis context)
-- =============================================================
INSERT INTO conversation_analyses (
  id, user_id, workspace_id, opportunity_id,
  message_text, outcome, platform,
  hook_score, clarity_score, value_prop_score,
  personalization_score, cta_score, tone_score, composite_score,
  word_count, failure_categories, success_signals, analysis_text
) VALUES (
  gen_random_uuid(),
  '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
  'd8151f09-56a4-41f6-908e-22b92f6820f9',
  'bbbbbbbb-0003-4eab-9be1-661e4fe96cd9',
  'Hi Marcus — following up with that case study I mentioned. Attaching it here — curious if this mirrors what you are seeing.',
  'no_reply',
  'email',
  6.5, 7.2, 6.8, 7.9, 5.5, 7.0, 6.82,
  22,
  ARRAY['weak_cta', 'no_urgency'],
  ARRAY['personalised_reference', 'value_asset_attached'],
  'Strong personalisation but the CTA is too soft — "curious if" lacks a clear next step. Consider proposing a specific time.'
);


-- =============================================================
-- 6. daily_check_ins
--    a) Past completed check-ins (for streak calculation & /plan context)
--    b) Today's unprocessed check-in (triggers is_new=false on /checkin/today)
-- =============================================================

-- Past completed check-ins (last 4 days for a streak of 4)
INSERT INTO daily_check_ins (user_id, workspace_id, date, questions, answers, mood_score, ai_response, chat_context, processed_at)
VALUES
  (
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    CURRENT_DATE - 3,
    '[{"id":"q1","text":"What is your #1 priority today?"},{"id":"q2","text":"Any blockers you anticipate?"}]'::jsonb,
    '{"q1":"Book a discovery call with Sarah Chen","q2":"She might be in board meetings this week"}'::jsonb,
    4,
    'Great focus! Starting with your best-fit lead is the right call. If Sarah is hard to reach, try a LinkedIn voice note — they stand out.',
    'User asked about outreach timing | Assistant suggested Tue/Wed mornings',
    NOW() - INTERVAL '3 days' + INTERVAL '9 hours'
  ),
  (
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    CURRENT_DATE - 2,
    '[{"id":"q1","text":"How did yesterday go?"},{"id":"q2","text":"What will move the needle most today?"}]'::jsonb,
    '{"q1":"Sent 8 messages, got 1 reply from Marcus","q2":"Need to prep for Thursday call"}'::jsonb,
    3,
    'Solid start with Marcus. Prep for Thursday by researching their Q2 goals — that context will make you stand out in the call.',
    'User discussed pipeline strategy | Assistant suggested discovery call prep framework',
    NOW() - INTERVAL '2 days' + INTERVAL '9 hours'
  ),
  (
    '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
    'd8151f09-56a4-41f6-908e-22b92f6820f9',
    CURRENT_DATE - 1,
    '[{"id":"q1","text":"What is your energy level today?"},{"id":"q2","text":"What is one thing you will execute no matter what?"}]'::jsonb,
    '{"q1":"7/10 — slept well","q2":"Send the follow-up to Marcus with the case study"}'::jsonb,
    4,
    'Love the commitment. Attaching a case study is a great move — it gives Marcus something tangible to share internally. Keep it short in the email body.',
    'User asked about follow-up best practices | Assistant recommended value-add approach',
    NOW() - INTERVAL '1 day' + INTERVAL '9 hours'
  );

-- Today's check-in: questions generated but NOT yet submitted
-- → GET /checkin/today will return this with is_new=false
-- → POST /checkin will be able to submit against it
INSERT INTO daily_check_ins (user_id, workspace_id, date, questions, answers, mood_score, chat_context, processed_at)
VALUES (
  '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
  'd8151f09-56a4-41f6-908e-22b92f6820f9',
  CURRENT_DATE,
  '[
    {"id":"q1","text":"What is the one deal you are most excited about today and why?"},
    {"id":"q2","text":"What is one outreach skill you want to sharpen this week?"},
    {"id":"q3","text":"How are you feeling about your pipeline momentum right now?"}
  ]'::jsonb,
  '{}'::jsonb,  -- empty = not yet submitted
  NULL,
  'User discussed weekly planning | Assistant suggested focusing on pipeline depth over breadth',
  NULL          -- NULL processed_at = not yet processed → POST /checkin can submit
);


-- =============================================================
-- 7. chat_messages  (context for /checkin/today AI question generation)
-- =============================================================
-- Insert into a stub chat first (required FK if enforced)
INSERT INTO chats (id, user_id, workspace_id, title, chat_type, message_count, last_message_at)
VALUES (
  'cccccccc-0001-4eab-9be1-661e4fe96cd9',
  '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
  'd8151f09-56a4-41f6-908e-22b92f6820f9',
  'Weekly planning chat',
  'general',
  6,
  NOW() - INTERVAL '1 hour'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (chat_id, user_id, workspace_id, role, content, created_at)
VALUES
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'user',      'I have 3 active deals but none are moving. What should I focus on?',                         NOW() - INTERVAL '5 hours'),
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'assistant', 'When deals stall, the issue is usually clarity of next step. Who owns the next action?',       NOW() - INTERVAL '5 hours'),
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'user',      'Marcus Webb has gone quiet after asking for a case study.',                                   NOW() - INTERVAL '4 hours'),
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'assistant', 'Try a pattern interrupt — short message with a new data point relevant to his company.',      NOW() - INTERVAL '4 hours'),
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'user',      'Should I also be focusing on new outreach or just warming existing pipeline?',               NOW() - INTERVAL '2 hours'),
  ('cccccccc-0001-4eab-9be1-661e4fe96cd9', '190dc2fa-134e-4eab-9be1-661e4fe96cd9', 'd8151f09-56a4-41f6-908e-22b92f6820f9', 'assistant', 'At your stage, depth beats breadth. Warm pipeline first, then allocate 30% bandwidth to new.', NOW() - INTERVAL '1 hour');


-- =============================================================
-- 8. user_performance_profiles  (used by GET /plan)
-- =============================================================
INSERT INTO user_performance_profiles (
  user_id, workspace_id,
  total_sent, total_positive, total_negative,
  positive_rate, best_platform, best_message_style, best_message_length,
  learned_patterns
) VALUES (
  '190dc2fa-134e-4eab-9be1-661e4fe96cd9',
  'd8151f09-56a4-41f6-908e-22b92f6820f9',
  42, 11, 18,
  0.2619,
  'linkedin',
  'question_led',
  'short',
  'Best results with messages under 60 words that open with a prospect-specific trigger. Friday sends consistently underperform. Follow-ups with value assets (case studies) outperform check-in messages 2:1.'
) ON CONFLICT (user_id) DO UPDATE SET
  total_sent         = EXCLUDED.total_sent,
  total_positive     = EXCLUDED.total_positive,
  total_negative     = EXCLUDED.total_negative,
  positive_rate      = EXCLUDED.positive_rate,
  best_platform      = EXCLUDED.best_platform,
  best_message_style = EXCLUDED.best_message_style,
  learned_patterns   = EXCLUDED.learned_patterns;


-- =============================================================
-- SUMMARY
-- =============================================================
DO $$
BEGIN
  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'Seed complete. Records inserted:';
  RAISE NOTICE '  user_goals         : 3 active';
  RAISE NOTICE '  growth_cards       : 8 (5 active feed, 1 read, 1 dismissed, 1 weekly strategy)';
  RAISE NOTICE '  opportunities      : 3 (2 new-stage for /feed, 1 contacted)';
  RAISE NOTICE '  conversation_analyses : 1';
  RAISE NOTICE '  daily_check_ins    : 3 completed (streak) + 1 open for today';
  RAISE NOTICE '  chats + messages   : 1 chat, 6 messages';
  RAISE NOTICE '  user_performance_profiles : 1 (upsert)';
  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'Key IDs for endpoint testing:';
  RAISE NOTICE '  Unread card (read/dismiss): aaaaaaaa-0001-4eab-9be1-661e4fe96cd9';
  RAISE NOTICE '  Already-read card        : aaaaaaaa-0006-4eab-9be1-661e4fe96cd9';
  RAISE NOTICE '  Dismissed card           : aaaaaaaa-0007-4eab-9be1-661e4fe96cd9';
  RAISE NOTICE '  Weekly strategy card     : aaaaaaaa-0008-4eab-9be1-661e4fe96cd9';
  RAISE NOTICE '  Opportunity (new)        : bbbbbbbb-0001-4eab-9be1-661e4fe96cd9';
  RAISE NOTICE '  Opportunity (sent)       : bbbbbbbb-0003-4eab-9be1-661e4fe96cd9';
END $$;
