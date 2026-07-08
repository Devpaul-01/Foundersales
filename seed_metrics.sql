-- ============================================================
-- METRICS ENDPOINT SEED DATA — COMPREHENSIVE VERSION
-- userId      = 190dc2fa-134e-4eab-9be1-661e4fe96cd9
-- workspaceId = d8151f09-56a4-41f6-908e-22b92f6820f9
--
-- Covers EVERY endpoint in src/routes/metrics.js:
--   GET /api/metrics/dashboard
--   GET /api/metrics/skill-breakdown
--   GET /api/metrics/intelligence
--   GET /api/metrics/conversation-analyses
--   GET /api/metrics/workspace/leaderboard       (manager+)
--   GET /api/metrics/workspace/coaching-queue    (manager+)
--   GET /api/metrics/workspace/team-velocity     (manager+)
--   GET /api/metrics/alerts
--   GET /api/metrics/practice-recommendations
--   GET /api/metrics/objection-trends
--   GET /api/metrics/workspace/team-overview     (manager+)
--   GET /api/metrics/prospects-health
--   GET /api/metrics/calendar-prep
--   GET /api/metrics/practice-skill-profile
--   GET /api/metrics/achievements
--   GET /api/metrics/workspace/activity-feed     (manager+)
--   conversationAnalysisJob (feedback → analyses pipeline)
--
-- NOTE ON ASSUMPTIONS: columns for the tables that were previously unused
-- in this file (conversation_signals, communication_patterns,
-- conversation_commitments, growth_cards, prospects, user_events,
-- user_skill_profile, practice_badges, practice_drills, workspace_activity)
-- are inferred strictly from the .select(...) calls in metrics.js. `id` is
-- omitted on inserts where nothing else references it, same as the
-- original script did for conversation_analyses/daily_metrics/etc., so it
-- relies on a DB default (gen_random_uuid() or serial). If any of these
-- tables have additional NOT NULL columns with no default, add them before
-- running.
--
-- This script CLEARS all existing data for this user+workspace in every
-- table it touches before inserting, so it's safe to re-run.
-- ============================================================

DO $$
DECLARE
  v_user_id      UUID := '190dc2fa-134e-4eab-9be1-661e4fe96cd9';
  v_workspace_id UUID := 'd8151f09-56a4-41f6-908e-22b92f6820f9';

  -- Opportunity IDs (referenced by feedback → pipeline_metrics view)
  opp1  UUID := gen_random_uuid();
  opp2  UUID := gen_random_uuid();
  opp3  UUID := gen_random_uuid();
  opp4  UUID := gen_random_uuid();
  opp5  UUID := gen_random_uuid();
  opp6  UUID := gen_random_uuid();
  opp7  UUID := gen_random_uuid();
  opp8  UUID := gen_random_uuid();
  opp9  UUID := gen_random_uuid();

  -- Feedback IDs (used in conversation_analyses)
  fb1   UUID := gen_random_uuid();
  fb2   UUID := gen_random_uuid();
  fb3   UUID := gen_random_uuid();
  fb4   UUID := gen_random_uuid();
  fb5   UUID := gen_random_uuid();

  -- Practice session IDs
  ps1   UUID := gen_random_uuid();
  ps2   UUID := gen_random_uuid();
  ps3   UUID := gen_random_uuid();

  -- Goal IDs
  goal1 UUID := gen_random_uuid();
  goal2 UUID := gen_random_uuid();

BEGIN

-- ══════════════════════════════════════════════════════════════
-- 0. CLEAR EXISTING DATA FOR THIS USER + WORKSPACE
-- Children before parents to respect FKs.
-- ══════════════════════════════════════════════════════════════
DELETE FROM conversation_analyses     WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM feedback                  WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM opportunities             WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM daily_metrics             WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM skill_progression         WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM practice_sessions         WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM user_goals                WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM daily_check_ins           WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM objection_tracker         WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM conversation_signals      WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM communication_patterns    WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM conversation_commitments  WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM growth_cards              WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM prospects                 WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM user_events               WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM user_skill_profile        WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM workspace_activity        WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
DELETE FROM user_performance_profiles WHERE user_id = v_user_id AND workspace_id = v_workspace_id;
-- achievements endpoint queries these two by user_id only (no workspace_id filter)
DELETE FROM practice_badges           WHERE user_id = v_user_id;
DELETE FROM practice_drills           WHERE user_id = v_user_id;


-- ══════════════════════════════════════════════════════════════
-- 1. USER PERFORMANCE PROFILE
-- Read by: dashboard, intelligence, workspace/leaderboard
-- ══════════════════════════════════════════════════════════════
INSERT INTO user_performance_profiles (
  user_id, workspace_id,
  total_sent, total_positive, total_negative,
  positive_rate, best_platform, best_message_style,
  best_message_length, learned_patterns,
  messages_at_last_summary, last_summarized_at
)
VALUES (
  v_user_id,
  v_workspace_id,
  42,
  14,
  28,
  0.333,
  'reddit',
  'empathetic',
  'medium',
  'Short empathetic openers on Reddit perform best. Messages under 100 words that lead with a specific pain point get 2× the reply rate of longer messages.',
  42,
  NOW() - INTERVAL '2 days'
);


-- ══════════════════════════════════════════════════════════════
-- 2. OPPORTUNITIES
-- Needed by: pipeline_metrics view, chart data, alerts (stalled deals)
-- Stages: new / contacted / replied / call_demo / closed_won / closed_lost
-- ══════════════════════════════════════════════════════════════
INSERT INTO opportunities (
  id, user_id, workspace_id,
  platform, source_url, target_context, target_name,
  prepared_message, fit_score, timing_score, intent_score,
  status, stage,
  viewed_at, link_clicked_at, message_copied_at, marked_sent_at,
  created_at
) VALUES
  -- closed_won × 2 (contribute to total_revenue via feedback.deal_value_usd)
  (opp1, v_user_id, v_workspace_id, 'reddit',
   'https://reddit.com/r/startups/comments/abc1',
   'Struggling to get first 10 customers for my B2B SaaS',
   'u/founder_struggles',
   'Saw your post about the customer acquisition wall — we built something specifically for this phase. Mind if I share what worked for our users?',
   8, 9, 8, 'sent', 'closed_won',
   NOW()-INTERVAL '20 days', NOW()-INTERVAL '20 days',
   NOW()-INTERVAL '20 days', NOW()-INTERVAL '20 days',
   NOW()-INTERVAL '22 days'),

  (opp2, v_user_id, v_workspace_id, 'linkedin',
   'https://linkedin.com/posts/def2',
   'Just hired my first AE but they are not ramping fast enough',
   'Sarah Chen',
   'The ramp problem is real — most AE playbooks are built for established GTM, not founder-led orgs. Happy to share what we have seen work.',
   9, 8, 9, 'sent', 'closed_won',
   NOW()-INTERVAL '15 days', NOW()-INTERVAL '15 days',
   NOW()-INTERVAL '15 days', NOW()-INTERVAL '15 days',
   NOW()-INTERVAL '17 days'),

  -- call_demo × 2 (also qualify as "stalled" for /intelligence, sent >7d ago)
  (opp3, v_user_id, v_workspace_id, 'reddit',
   'https://reddit.com/r/entrepreneur/comments/ghi3',
   'Cold outreach is getting 0 replies, been at it 3 weeks',
   'u/cold_outreach_pain',
   'Three weeks with no replies usually points to one of two things: targeting or the hook. Quick question — are you leading with your product or their problem?',
   7, 9, 9, 'sent', 'call_demo',
   NOW()-INTERVAL '10 days', NOW()-INTERVAL '10 days',
   NOW()-INTERVAL '10 days', NOW()-INTERVAL '10 days',
   NOW()-INTERVAL '12 days'),

  (opp4, v_user_id, v_workspace_id, 'linkedin',
   'https://linkedin.com/posts/jkl4',
   'Looking for tools to help my sales team improve reply rates',
   'Marcus Obi',
   'Saw your post — we specifically work on reply rate improvement for teams doing founder-style outreach. Worth a 20-min look?',
   8, 7, 8, 'sent', 'call_demo',
   NOW()-INTERVAL '8 days', NOW()-INTERVAL '8 days',
   NOW()-INTERVAL '8 days', NOW()-INTERVAL '8 days',
   NOW()-INTERVAL '10 days'),

  -- replied × 2
  (opp5, v_user_id, v_workspace_id, 'reddit',
   'https://reddit.com/r/sales/comments/mno5',
   'Does anyone actually use AI for outreach or is it all hype',
   'u/ai_skeptic_sales',
   'Fair skepticism. Most AI outreach tools automate the wrong thing — volume instead of quality. The ones that work help you sound more human, not less.',
   6, 7, 7, 'sent', 'replied',
   NOW()-INTERVAL '6 days', NOW()-INTERVAL '6 days',
   NOW()-INTERVAL '6 days', NOW()-INTERVAL '6 days',
   NOW()-INTERVAL '7 days'),

  (opp6, v_user_id, v_workspace_id, 'linkedin',
   'https://linkedin.com/posts/pqr6',
   'Just started founder-led sales, feeling lost on where to begin',
   'Priya Nair',
   'The lost feeling at the start is universal — most founders try to pitch instead of discover. Happy to share a simple framework that changed things for us.',
   7, 8, 8, 'sent', 'replied',
   NOW()-INTERVAL '4 days', NOW()-INTERVAL '4 days',
   NOW()-INTERVAL '4 days', NOW()-INTERVAL '4 days',
   NOW()-INTERVAL '5 days'),

  -- contacted × 1 (recent — not stalled)
  (opp7, v_user_id, v_workspace_id, 'reddit',
   'https://reddit.com/r/startups/comments/stu7',
   'What CRM do you use for early-stage sales tracking',
   'u/early_crm_question',
   'For pre-10-customer stage, a CRM is often overkill — a Notion table or even a spreadsheet beats the overhead. Happy to share what we recommend.',
   5, 6, 6, 'sent', 'contacted',
   NOW()-INTERVAL '2 days', NOW()-INTERVAL '2 days',
   NOW()-INTERVAL '2 days', NOW()-INTERVAL '2 days',
   NOW()-INTERVAL '3 days'),

  -- new / pending (no feedback yet — tests chart discovery data)
  (opp8, v_user_id, v_workspace_id, 'reddit',
   'https://reddit.com/r/entrepreneur/comments/vwx8',
   'Trying to figure out ICP for a new B2B product',
   'u/icp_question',
   'ICP definition is the highest-leverage thing you can do right now — worth spending a week on it before more outreach. Happy to share a quick framework.',
   6, 5, 7, 'pending', 'new',
   NULL, NULL, NULL, NULL,
   NOW()-INTERVAL '1 day'),

  -- contacted, sent 9 days ago, no feedback_prompted_at → triggers the
  -- "stalled deal" alert in GET /api/metrics/alerts specifically
  -- (alerts only looks at stage IN contacted/replied + marked_sent_at older
  -- than 7d + feedback_prompted_at IS NULL — opp3/opp4 above are call_demo
  -- stage so they don't satisfy *that* particular query, even though they
  -- do satisfy the broader "stalled" check used in /intelligence)
  (opp9, v_user_id, v_workspace_id, 'linkedin',
   'https://linkedin.com/posts/stalled9',
   'Looking into outbound tooling for our small team',
   'David Okonkwo',
   'Saw you''re evaluating outbound tooling — happy to share how teams your size usually structure this without overbuilding.',
   6, 6, 6, 'sent', 'contacted',
   NOW()-INTERVAL '9 days', NOW()-INTERVAL '9 days',
   NOW()-INTERVAL '9 days', NOW()-INTERVAL '9 days',
   NOW()-INTERVAL '11 days');


-- ══════════════════════════════════════════════════════════════
-- 3. FEEDBACK
-- Drives pipeline_metrics view (stage counts, deal values)
-- Also triggers conversationAnalysisJob
-- ══════════════════════════════════════════════════════════════
INSERT INTO feedback (
  id, user_id, workspace_id, opportunity_id,
  outcome, outcome_note,
  deal_value_usd, scheduled_call, is_final,
  created_at
) VALUES
  (fb1, v_user_id, v_workspace_id, opp1,
   'positive', 'Signed contract, onboarding next week',
   4800, true, true,
   NOW()-INTERVAL '18 days'),

  (fb2, v_user_id, v_workspace_id, opp2,
   'positive', 'Closed after second call, great fit',
   6000, true, true,
   NOW()-INTERVAL '13 days'),

  (fb3, v_user_id, v_workspace_id, opp3,
   'positive', 'Demo booked for next Thursday',
   NULL, true, false,
   NOW()-INTERVAL '8 days'),

  (fb4, v_user_id, v_workspace_id, opp5,
   'negative', 'Replied but said not the right timing, too busy right now',
   NULL, false, true,
   NOW()-INTERVAL '5 days'),

  (fb5, v_user_id, v_workspace_id, opp6,
   'negative', 'No response after initial reply, ghosted',
   NULL, false, true,
   NOW()-INTERVAL '3 days');


-- ══════════════════════════════════════════════════════════════
-- 4. CONVERSATION ANALYSES
-- Read by: metrics/skill-breakdown, metrics/conversation-analyses
-- ══════════════════════════════════════════════════════════════
INSERT INTO conversation_analyses (
  user_id, workspace_id, opportunity_id, feedback_id,
  message_text, outcome, outcome_note, platform,
  hook_score, clarity_score, value_prop_score,
  personalization_score, cta_score, tone_score, composite_score,
  word_count, self_referential_ratio,
  has_social_proof, has_specific_ask,
  failure_categories, success_signals,
  analysis_text, analysis_model,
  improvement_suggestions, rewritten_message, line_annotations,
  created_at
) VALUES
  -- Analysis 1: positive outcome, strong message
  (v_user_id, v_workspace_id, opp1, fb1,
   'Saw your post about the customer acquisition wall — we built something specifically for this phase. Mind if I share what worked for our users?',
   'positive', 'Signed contract, onboarding next week', 'reddit',
   8.5, 7.5, 8.0, 8.5, 7.0, 8.0, 7.92,
   26, 0.0,
   true, true,
   ARRAY[]::text[],
   ARRAY['specific_pain_reference', 'soft_cta', 'social_proof_implied'],
   'Strong hook that mirrors the prospect''s exact language. Value prop is implicit but clear. CTA is low-friction and curiosity-driven.',
   'groq_pro',
   '[{"priority":1,"dimension":"cta","suggestion":"Make the social proof more explicit — name a result, not just a reference","example":"We helped two founders in this exact position go from 0 to 10 customers in 6 weeks."}]'::jsonb,
   'Noticed you''re hitting the customer acquisition wall — that moment is exactly what we built for. We helped two founders in your situation reach their first 10 customers in under 8 weeks. Worth a quick look?',
   '[]'::jsonb,
   NOW()-INTERVAL '17 days'),

  -- Analysis 2: positive outcome, excellent message
  (v_user_id, v_workspace_id, opp2, fb2,
   'The ramp problem is real — most AE playbooks are built for established GTM, not founder-led orgs. Happy to share what we have seen work.',
   'positive', 'Closed after second call, great fit', 'linkedin',
   9.0, 8.5, 8.0, 7.5, 7.5, 9.0, 8.25,
   31, 0.0,
   false, true,
   ARRAY[]::text[],
   ARRAY['pain_reframe', 'credibility_signal', 'peer_tone'],
   'Excellent reframe — immediately positions as an expert who understands the nuance. Tone is perfectly peer-to-peer for LinkedIn.',
   'groq_pro',
   '[{"priority":1,"dimension":"personalization","suggestion":"Reference their specific industry or company size to increase relevance","example":"For a team of your size, the playbooks written for 50-person orgs tend to backfire in specific ways."}]'::jsonb,
   'The ramp problem hits differently when you''re transitioning from founder-led to a hired AE — standard playbooks assume infrastructure you don''t have yet. Happy to share a framework that works at your stage.',
   '[]'::jsonb,
   NOW()-INTERVAL '14 days'),

  -- Analysis 3: positive, good but could improve CTA
  (v_user_id, v_workspace_id, opp3, fb3,
   'Three weeks with no replies usually points to one of two things: targeting or the hook. Quick question — are you leading with your product or their problem?',
   'positive', 'Demo booked for next Thursday', 'reddit',
   8.0, 9.0, 7.0, 7.0, 8.5, 8.5, 8.0,
   33, 0.0,
   false, true,
   ARRAY[]::text[],
   ARRAY['diagnostic_question', 'expertise_signal', 'conversational_hook'],
   'The diagnostic question is the strongest element — it invites engagement and positions as a consultant, not a vendor. Value prop is implied through expertise.',
   'groq_pro',
   '[{"priority":1,"dimension":"value_prop","suggestion":"Add a one-line tease of what you offer before the question","example":"We help founders fix exactly this — quick question to diagnose where the gap is: are you leading with your product or their problem?"}]'::jsonb,
   'Three weeks of silence usually comes down to one of two root causes: who you''re targeting or the first line. We help founders diagnose and fix both — quick question: are you opening with your product or their problem?',
   '[]'::jsonb,
   NOW()-INTERVAL '9 days'),

  -- Analysis 4: negative, timing objection, weaker message
  (v_user_id, v_workspace_id, opp5, fb4,
   'Fair skepticism. Most AI outreach tools automate the wrong thing — volume instead of quality. The ones that work help you sound more human, not less.',
   'negative', 'Replied but said not the right timing, too busy right now', 'reddit',
   6.5, 7.0, 6.0, 5.5, 4.5, 7.5, 6.17,
   28, 0.1,
   false, false,
   ARRAY['no_specific_ask', 'weak_cta', 'generic_positioning'],
   ARRAY['good_reframe', 'addresses_skepticism'],
   'The reframe is smart but the message ends without any next step. No CTA means the prospect has no reason to respond beyond conversation.',
   'groq_pro',
   '[{"priority":1,"dimension":"cta","suggestion":"End with a lightweight specific ask rather than a statement","example":"Would it be useful if I shared how one founder used this to go from 0% to 28% reply rate in three weeks?"},{"priority":2,"dimension":"personalization","suggestion":"Reference something specific from their post to increase relevance","example":"You mentioned the skepticism — totally fair. Most AI tools earn that reputation."}]'::jsonb,
   'That skepticism is earned — most AI tools optimise for volume and make outreach feel less human. The ones that actually work do the opposite. One founder on Reddit last month went from 0 to 28% reply rate after a single session. Worth hearing how?',
   '[]'::jsonb,
   NOW()-INTERVAL '4 days'),

  -- Analysis 5: negative, ghost, self-referential, needs work
  (v_user_id, v_workspace_id, opp6, fb5,
   'The lost feeling at the start is universal — most founders try to pitch instead of discover. Happy to share a simple framework that changed things for us.',
   'negative', 'No response after initial reply, ghosted', 'linkedin',
   5.5, 6.5, 5.0, 5.0, 4.0, 6.5, 5.42,
   27, 0.15,
   false, false,
   ARRAY['weak_hook', 'no_specific_ask', 'vague_value_prop'],
   ARRAY['empathetic_opener'],
   'Opening is empathetic but generic — could describe any coaching product. Value prop is buried and the CTA is missing entirely. Ends on "happy to share" with no ask.',
   'groq_pro',
   '[{"priority":1,"dimension":"cta","suggestion":"Replace the passive offer with a direct low-friction question","example":"What does your current outreach process look like — are you doing volume or targeted?"},{"priority":2,"dimension":"value_prop","suggestion":"Name a specific outcome instead of a vague framework","example":"One thing that helped three founders I know: spending the first two weeks only on ICP definition before any outreach."},{"priority":3,"dimension":"hook","suggestion":"Open with something specific to their situation, not a universal statement","example":"Transitioning from building to selling is a specific skill gap — and it shows up in very predictable ways."}]'::jsonb,
   'The switch from builder to seller is a specific skill gap — and it shows up in predictable ways. One thing that unlocked things for three founders I know: spending the first week purely on ICP definition before touching outreach. Does that resonate with where you are right now?',
   '[]'::jsonb,
   NOW()-INTERVAL '2 days');


-- ══════════════════════════════════════════════════════════════
-- 5. DAILY METRICS (28 days)
-- Read by: metrics/dashboard chart_data
-- ══════════════════════════════════════════════════════════════
INSERT INTO daily_metrics (
  user_id, workspace_id, date,
  opportunities_shown, opportunities_viewed,
  links_clicked, messages_copied, messages_sent,
  positive_outcomes, negative_outcomes,
  execution_rate, positive_rate
)
SELECT
  v_user_id,
  v_workspace_id,
  (NOW() - (s || ' days')::INTERVAL)::date,
  CASE WHEN s % 3 = 0 THEN 4 ELSE 3 END,
  CASE WHEN s % 3 = 0 THEN 3 ELSE 2 END,
  CASE WHEN s % 4 = 0 THEN 2 ELSE 1 END,
  CASE WHEN s % 3 = 0 THEN 2 ELSE 1 END,
  CASE WHEN s % 5 = 0 THEN 0 WHEN s % 2 = 0 THEN 2 ELSE 1 END,
  CASE WHEN s % 7 = 0 THEN 1 ELSE 0 END,
  CASE WHEN s % 4 = 0 THEN 1 ELSE 0 END,
  CASE WHEN s % 5 = 0 THEN 0 WHEN s % 2 = 0 THEN 0.5 ELSE 0.33 END,
  CASE WHEN s % 7 = 0 THEN 0.5 WHEN s % 3 = 0 THEN 0.33 ELSE 0.0 END
FROM generate_series(1, 28) AS s;


-- ══════════════════════════════════════════════════════════════
-- 6. SKILL PROGRESSION (4 weeks)
-- Read by: workspace/team-velocity, workspace/coaching-queue,
--          workspace/team-overview, workspace/leaderboard, intelligence
-- ══════════════════════════════════════════════════════════════
INSERT INTO skill_progression (
  id, user_id, workspace_id, week_start,
  hook_score_avg, clarity_score_avg, value_prop_score_avg,
  personalization_score_avg, cta_score_avg, tone_score_avg,
  composite_score_avg, composite_delta,
  positive_outcome_rate, messages_analyzed, practice_sessions,
  top_weakness, top_strength, created_at
)
VALUES
  (gen_random_uuid(), v_user_id, v_workspace_id,
   date_trunc('week', NOW() - INTERVAL '21 days')::date,
   5.5, 6.0, 5.0, 4.5, 4.0, 6.0, 5.17, NULL,
   0.20, 8, 2, 'cta', 'tone',
   NOW() - INTERVAL '21 days'),

  (gen_random_uuid(), v_user_id, v_workspace_id,
   date_trunc('week', NOW() - INTERVAL '14 days')::date,
   6.5, 7.0, 6.0, 5.5, 5.0, 7.0, 6.17, 1.00,
   0.28, 10, 3, 'personalization', 'clarity',
   NOW() - INTERVAL '14 days'),

  (gen_random_uuid(), v_user_id, v_workspace_id,
   date_trunc('week', NOW() - INTERVAL '7 days')::date,
   7.5, 7.5, 6.5, 6.0, 5.5, 7.5, 6.75, 0.58,
   0.33, 12, 4, 'cta', 'hook',
   NOW() - INTERVAL '7 days'),

  (gen_random_uuid(), v_user_id, v_workspace_id,
   date_trunc('week', NOW())::date,
   8.0, 8.0, 7.0, 6.5, 6.0, 8.0, 7.25, 0.50,
   0.38, 5, 2, 'value_prop', 'tone',
   NOW());


-- ══════════════════════════════════════════════════════════════
-- 7. PRACTICE SESSIONS (last 6 days, all completed)
-- Read by: dashboard practice count, workspace/team-overview,
--          workspace/coaching-queue, intelligence
-- ══════════════════════════════════════════════════════════════
INSERT INTO practice_sessions (
  id, user_id, workspace_id,
  scenario_type, completed, difficulty_level,
  message_strength_score, rating, rating_note,
  final_interest_score, final_trust_score,
  exchanges_count, messages_exchanged,
  skill_scores, outcome,
  created_at, completed_at
) VALUES
  (ps1, v_user_id, v_workspace_id,
   'cold_outreach', true, 'standard',
   72, 4, 'Good drill, felt realistic',
   7, 6, 5, 5,
   '{"hook":7.5,"clarity":8.0,"value_prop":7.0,"personalization":6.5,"cta":6.0,"tone":8.0}'::jsonb,
   'follow_up_agreed',
   NOW()-INTERVAL '6 days', NOW()-INTERVAL '6 days'),

  (ps2, v_user_id, v_workspace_id,
   'objection_handling', true, 'hard',
   58, 3, 'Struggled with the pricing objection',
   5, 7, 7, 7,
   '{"hook":6.0,"clarity":7.0,"value_prop":5.5,"personalization":5.0,"cta":5.0,"tone":7.5}'::jsonb,
   'objection_unresolved',
   NOW()-INTERVAL '4 days', NOW()-INTERVAL '4 days'),

  (ps3, v_user_id, v_workspace_id,
   'discovery', true, 'standard',
   81, 5, 'Best session yet — landed the meeting',
   9, 8, 6, 6,
   '{"hook":8.5,"clarity":8.5,"value_prop":8.0,"personalization":7.5,"cta":7.0,"tone":8.5}'::jsonb,
   'meeting_booked',
   NOW()-INTERVAL '2 days', NOW()-INTERVAL '2 days');


-- ══════════════════════════════════════════════════════════════
-- 8. USER GOALS
-- Read by: metrics/dashboard momentum score, metrics/intelligence
-- ══════════════════════════════════════════════════════════════
INSERT INTO user_goals (
  id, user_id, workspace_id,
  goal_text, goal_type,
  target_value, target_unit, target_date,
  current_value, status
) VALUES
  (goal1, v_user_id, v_workspace_id,
   'Send 50 outreach messages this month',
   'outreach_volume',
   50, 'messages', (NOW() + INTERVAL '10 days')::date,
   42, 'active'),

  (goal2, v_user_id, v_workspace_id,
   'Book 3 demos from cold outreach',
   'pipeline',
   3, 'demos', (NOW() + INTERVAL '20 days')::date,
   2, 'active');


-- ══════════════════════════════════════════════════════════════
-- 9. DAILY CHECK-INS (last 7 days)
-- Read by: dashboard average_mood, metrics/intelligence
-- ══════════════════════════════════════════════════════════════
INSERT INTO daily_check_ins (
  user_id, workspace_id, date,
  mood_score, ai_response,
  questions, answers,
  created_at
) VALUES
  (v_user_id, v_workspace_id, CURRENT_DATE - 6,
   4, 'Solid effort today — consistency is the compound interest of outreach.',
   '[{"q":"How are you feeling about your pipeline?"}]'::jsonb,
   '{"0":"Cautiously optimistic"}'::jsonb,
   NOW()-INTERVAL '6 days'),

  (v_user_id, v_workspace_id, CURRENT_DATE - 5,
   3, 'A rough day is data, not failure. What would you do differently tomorrow?',
   '[{"q":"What blocked you today?"}]'::jsonb,
   '{"0":"Spent too long on one prospect"}'::jsonb,
   NOW()-INTERVAL '5 days'),

  (v_user_id, v_workspace_id, CURRENT_DATE - 4,
   5, 'Great energy today — that demo booking is momentum. Ride it.',
   '[{"q":"What went well today?"}]'::jsonb,
   '{"0":"Booked a demo, felt like a real conversation"}'::jsonb,
   NOW()-INTERVAL '4 days'),

  (v_user_id, v_workspace_id, CURRENT_DATE - 3,
   4, 'You are in a good rhythm. Stay focused on quality over volume.',
   '[{"q":"How many messages did you send?"}]'::jsonb,
   '{"0":"3 messages, 1 reply"}'::jsonb,
   NOW()-INTERVAL '3 days'),

  (v_user_id, v_workspace_id, CURRENT_DATE - 2,
   4, 'Two positive signals today — your hook is landing better than before.',
   '[{"q":"Any wins today?"}]'::jsonb,
   '{"0":"Got two replies, one interested"}'::jsonb,
   NOW()-INTERVAL '2 days'),

  (v_user_id, v_workspace_id, CURRENT_DATE - 1,
   5, 'Strong day. The discovery session you did yesterday is showing up in your messages.',
   '[{"q":"How did today feel?"}]'::jsonb,
   '{"0":"Best outreach day this week"}'::jsonb,
   NOW()-INTERVAL '1 day');


-- ══════════════════════════════════════════════════════════════
-- 10. OBJECTION TRACKER
-- Written by: conversationAnalysisJob.updateObjectionTracker
-- Seeded here so the table is non-empty for any reads.
-- "timing" has a best_response (tests the populated branch); "ghost" and
-- "competition" don't (tests needs_best_response / alerts coaching branch).
-- ══════════════════════════════════════════════════════════════
INSERT INTO objection_tracker (
  user_id, workspace_id,
  objection_type, objection_phrase,
  occurrence_count, last_seen_at, best_response
) VALUES
  (v_user_id, v_workspace_id,
   'timing', 'Not the right timing, too busy right now',
   3, NOW()-INTERVAL '3 days',
   'Acknowledge the timing concern, ask what would need to be true in 30 days for it to make sense, and offer a no-pressure check-in date.'),

  (v_user_id, v_workspace_id,
   'ghost', 'No response after initial reply',
   5, NOW()-INTERVAL '2 days', NULL),

  (v_user_id, v_workspace_id,
   'competition', 'Already using a competitor tool, happy with it',
   2, NOW()-INTERVAL '7 days', NULL);


-- ══════════════════════════════════════════════════════════════
-- 11. CONVERSATION SIGNALS
-- Read by: dashboard recent_signals, intelligence, alerts (buying signals)
-- 4 of the 5 are buying_signal/strong_interest within 7 days, which is
-- >3 and trips the "buying signals this week" alert.
-- ══════════════════════════════════════════════════════════════
INSERT INTO conversation_signals (
  user_id, workspace_id,
  source_type, signal_type, signal_text, confidence,
  is_active, detected_at
) VALUES
  (v_user_id, v_workspace_id, 'conversation_analysis', 'buying_signal',  'Asked about pricing tiers and annual discounts', 0.82, true, NOW()-INTERVAL '2 days'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'strong_interest', 'Requested a follow-up call next week',           0.90, true, NOW()-INTERVAL '1 day'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'buying_signal',  'Asked who else on the team is already using it', 0.75, true, NOW()-INTERVAL '3 days'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'strong_interest', 'Said this is exactly the gap they have right now', 0.95, true, NOW()-INTERVAL '4 days'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'hesitation',      'Mentioned needing to check the budget first',     0.60, true, NOW()-INTERVAL '5 days');


-- ══════════════════════════════════════════════════════════════
-- 12. COMMUNICATION PATTERNS
-- Read by: dashboard top_pattern, intelligence, practice-recommendations
-- ══════════════════════════════════════════════════════════════
INSERT INTO communication_patterns (
  user_id, workspace_id,
  pattern_type, pattern_label, affected_outcome, confidence_score, is_active
) VALUES
  (v_user_id, v_workspace_id, 'monologue',       'Long opening monologues before any question',   'negative', 0.78, true),
  (v_user_id, v_workspace_id, 'question_density', 'High question density during discovery calls', 'positive', 0.71, true),
  (v_user_id, v_workspace_id, 'self_reference',  'Excessive self-referential language in openers', 'negative', 0.65, true);


-- ══════════════════════════════════════════════════════════════
-- 13. CONVERSATION COMMITMENTS
-- Read by: dashboard pending_commitments, intelligence, alerts (overdue)
-- ══════════════════════════════════════════════════════════════
INSERT INTO conversation_commitments (
  user_id, workspace_id,
  source_type, commitment_text, owner, due_date, status
) VALUES
  (v_user_id, v_workspace_id, 'conversation_analysis', 'Send case study by Friday',         'user',     CURRENT_DATE + 3, 'pending'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'Follow up after the demo call',     'user',     CURRENT_DATE - 2, 'pending'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'Loop in their VP of Sales',         'prospect', CURRENT_DATE - 5, 'overdue'),
  (v_user_id, v_workspace_id, 'conversation_analysis', 'Share the pricing one-pager',       'user',     CURRENT_DATE + 7, 'pending');


-- ══════════════════════════════════════════════════════════════
-- 14. GROWTH CARDS
-- Read by: dashboard unread_tips, intelligence
-- Allowed card_type values: tip, strategy, resource, reflection,
--   challenge, community, insight
-- 3 unread+undismissed, 1 read, 1 dismissed — exercises both exclusions.
-- ══════════════════════════════════════════════════════════════
INSERT INTO growth_cards (
  user_id, workspace_id,
  card_type, title, body, priority, is_read, is_dismissed, created_at
) VALUES
  (v_user_id, v_workspace_id, 'tip',        'Try a stronger CTA',           'Messages with a specific, concrete ask see higher reply rates — give your next outreach one clear next step.', 3, false, false, NOW()-INTERVAL '1 day'),
  (v_user_id, v_workspace_id, 'insight',    'LinkedIn is outperforming',     'Messages sent on LinkedIn have a noticeably higher positive reply rate than your other platforms this month.', 5, false, false, NOW()-INTERVAL '2 days'),
  (v_user_id, v_workspace_id, 'reflection', 'Review your recent tone',       'Your positive reply rate is down compared to last week. Worth reviewing your last few messages for tone or clarity.', 4, false, false, NOW()-INTERVAL '3 days'),
  (v_user_id, v_workspace_id, 'strategy',   'Personalize your opener',       'Referencing something specific about the prospect in your first line tends to outperform generic openers.', 2, true,  false, NOW()-INTERVAL '5 days'),
  (v_user_id, v_workspace_id, 'challenge',  'Consistency streak challenge',  'You have kept up consistent outreach for several days in a row — keep the momentum going and aim for 7 days straight.', 1, false, true,  NOW()-INTERVAL '4 days');


-- ══════════════════════════════════════════════════════════════
-- 15. PROSPECTS
-- Read by: dashboard relationship_health, prospects-health, alerts,
--          workspace/coaching-queue
-- 2 at-risk (<40), 2 healthy (>=80), 2 stale (last_contact >14d ago)
-- ══════════════════════════════════════════════════════════════
INSERT INTO prospects (
  user_id, workspace_id,
  name, company, stage,
  relationship_health_score, last_contact_at, total_interactions
) VALUES
  (v_user_id, v_workspace_id, 'Tunde Bakare',  'Lagos Fintech Co',   'negotiating', 82, NOW()-INTERVAL '3 days',  12),
  (v_user_id, v_workspace_id, 'Aisha Bello',   'GreenAgro Ltd',      'qualified',   88, NOW()-INTERVAL '1 day',   9),
  (v_user_id, v_workspace_id, 'Femi Adeyemi',  'EduTech NG',         'contacted',   55, NOW()-INTERVAL '5 days',  5),
  (v_user_id, v_workspace_id, 'Chidi Okafor',  'BuildRight Construction', 'cold',   22, NOW()-INTERVAL '20 days', 2),
  (v_user_id, v_workspace_id, 'Ngozi Eze',     'RetailPlus',         'stalled',     18, NOW()-INTERVAL '25 days', 3);


-- ══════════════════════════════════════════════════════════════
-- 16. USER EVENTS
-- Read by: dashboard upcoming_events, calendar-prep
-- 1 past needing debrief, 1 past with debrief done, 1 upcoming needing
-- prep, 1 upcoming already prepped.
-- ══════════════════════════════════════════════════════════════
INSERT INTO user_events (
  user_id, workspace_id,
  title, event_date, event_type,
  prep_generated, debrief_completed_at, outcome, energy_score, attendee_name
) VALUES
  (v_user_id, v_workspace_id, 'Demo call — Marcus Obi',      (CURRENT_DATE - 3), 'demo_call',     true,  NULL,                       'positive', 8, 'Marcus Obi'),
  (v_user_id, v_workspace_id, 'Discovery call — Priya Nair', (CURRENT_DATE - 6), 'discovery_call', true,  NOW()-INTERVAL '5 days',    'neutral',  6, 'Priya Nair'),
  (v_user_id, v_workspace_id, 'Demo call — Priya Nair',      (CURRENT_DATE + 2), 'demo_call',     false, NULL,                       NULL,       NULL, 'Priya Nair'),
  (v_user_id, v_workspace_id, 'Intro call — Sarah Chen',     (CURRENT_DATE + 5), 'intro_call',    true,  NULL,                       NULL,       NULL, 'Sarah Chen');


-- ══════════════════════════════════════════════════════════════
-- 17. USER SKILL PROFILE (2 periods, for delta)
-- Read by: metrics/practice-skill-profile
-- ══════════════════════════════════════════════════════════════
INSERT INTO user_skill_profile (
  user_id, workspace_id,
  period_start, period_end,
  clarity_avg, value_avg, discovery_avg, objection_avg, brevity_avg, cta_avg,
  overall_avg, weakest_axis, strongest_axis,
  sessions_count, weekly_monologue_score,
  outcome_distribution, pressure_scores
) VALUES
  (v_user_id, v_workspace_id,
   CURRENT_DATE - 13, CURRENT_DATE,
   7.8, 7.2, 6.8, 6.0, 7.0, 6.2,
   6.83, 'objection', 'clarity',
   5, 42.5,
   '{"meeting_booked":1,"follow_up_agreed":1,"objection_unresolved":1}'::jsonb,
   '{"low":7.5,"medium":6.8,"high":5.9}'::jsonb),

  (v_user_id, v_workspace_id,
   CURRENT_DATE - 27, CURRENT_DATE - 14,
   6.8, 6.4, 6.0, 5.2, 6.5, 5.0,
   6.10, 'cta', 'discovery',
   4, 38.0,
   '{"meeting_booked":0,"follow_up_agreed":2,"objection_unresolved":2}'::jsonb,
   '{"low":6.6,"medium":6.0,"high":5.2}'::jsonb);


-- ══════════════════════════════════════════════════════════════
-- 18. PRACTICE BADGES
-- Read by: metrics/achievements (now scoped by workspace_id + user_id
-- after the practice_badges/practice_drills workspace_id migration)
-- ══════════════════════════════════════════════════════════════
INSERT INTO practice_badges (
  user_id, workspace_id,
  badge_type, badge_label, badge_description, earned_at
) VALUES
  (v_user_id, v_workspace_id, 'streak_5',  '5-Day Streak',     'Sent outreach 5 days in a row',       NOW()-INTERVAL '10 days'),
  (v_user_id, v_workspace_id, 'first_demo', 'First Demo Booked', 'Booked your first demo call',       NOW()-INTERVAL '8 days'),
  (v_user_id, v_workspace_id, 'closer',    'Deal Closer',      'Closed your first deal',              NOW()-INTERVAL '17 days');


-- ══════════════════════════════════════════════════════════════
-- 19. PRACTICE DRILLS
-- Read by: metrics/achievements (drill_improvements aggregation)
-- ══════════════════════════════════════════════════════════════
INSERT INTO practice_drills (
  user_id, workspace_id,
  drill_type, target_axis, score_before, score_after, completed_at
) VALUES
  (v_user_id, v_workspace_id, 'cta_drill',       'cta',       4.5, 6.2, NOW()-INTERVAL '5 days'),
  (v_user_id, v_workspace_id, 'hook_drill',      'hook',      5.0, 7.0, NOW()-INTERVAL '3 days'),
  (v_user_id, v_workspace_id, 'objection_drill', 'objection', 5.5, 5.8, NOW()-INTERVAL '1 day');


-- ══════════════════════════════════════════════════════════════
-- 20. WORKSPACE ACTIVITY
-- Read by: GET /api/metrics/workspace/activity-feed (manager+)
-- ══════════════════════════════════════════════════════════════
INSERT INTO workspace_activity (
  user_id, workspace_id,
  event_type, metadata, created_at
) VALUES
  (v_user_id, v_workspace_id, 'opportunity_sent',   '{"platform":"linkedin","target_name":"David Okonkwo"}'::jsonb, NOW()-INTERVAL '9 days'),
  (v_user_id, v_workspace_id, 'deal_closed',        '{"deal_value_usd":6000}'::jsonb,                                NOW()-INTERVAL '13 days'),
  (v_user_id, v_workspace_id, 'practice_completed',  '{"scenario_type":"discovery","outcome":"meeting_booked"}'::jsonb, NOW()-INTERVAL '2 days'),
  (v_user_id, v_workspace_id, 'goal_progress',       '{"goal_type":"outreach_volume","current_value":42,"target_value":50}'::jsonb, NOW()-INTERVAL '1 day'),
  (v_user_id, v_workspace_id, 'check_in_completed',  '{"mood_score":5}'::jsonb,                                      NOW()-INTERVAL '1 day');


-- ══════════════════════════════════════════════════════════════
-- 21. WORKSPACE MEMBERSHIP
-- Needed for: workspace/leaderboard, workspace/coaching-queue,
--             workspace/team-overview, workspace/team-velocity,
--             workspace/activity-feed (requirePermission('manager'))
-- Not deleted in section 0 — this only ensures the row exists, since
-- removing it could lock the test account out of manager-gated routes.
-- Assumes role 'manager' satisfies requirePermission('manager'); adjust
-- if your role hierarchy uses a different value (e.g. 'owner', 'admin').
-- ══════════════════════════════════════════════════════════════
INSERT INTO workspace_members (user_id, workspace_id, role, status)
SELECT v_user_id, v_workspace_id, 'manager', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE user_id = v_user_id AND workspace_id = v_workspace_id
);


END $$;
