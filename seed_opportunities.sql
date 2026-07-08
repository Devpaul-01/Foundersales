-- ================================================================
--  OPPORTUNITIES SEED SCRIPT  (plain SQL — no DO block)
--  Avoids PL/pgSQL parsing string literals as variable names.
--
--  fit / timing / intent scores are 0–10 integers.
--  composite_score is a GENERATED column — never inserted directly.
--  composite = (fit + timing + intent) / 3.0
--    >= 7.0 → green circle  |  >= 4.0 → yellow  |  < 4.0 → red
-- ================================================================

-- ── Step 1: resolve user + workspace into a temp table ──────────
DROP TABLE IF EXISTS _seed_ctx;

CREATE TEMP TABLE _seed_ctx AS
SELECT
  u.id                                                          AS user_id,
  COALESCE(
    u.active_workspace_id,
    (SELECT id FROM workspaces
     WHERE owner_user_id = u.id AND is_deleted = false
     ORDER BY created_at ASC LIMIT 1)
  )                                                             AS workspace_id
FROM users u
WHERE u.is_deleted = false
ORDER BY u.created_at ASC
LIMIT 1;

-- Abort early if nothing found
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _seed_ctx WHERE workspace_id IS NOT NULL) THEN
    RAISE EXCEPTION 'No user/workspace found. Sign up and complete onboarding first.';
  END IF;
  RAISE NOTICE 'Seeding for user=% workspace=%',
    (SELECT user_id FROM _seed_ctx),
    (SELECT workspace_id FROM _seed_ctx);
END $$;

-- ── Step 2: clean previous seed ─────────────────────────────────
DELETE FROM public.opportunities
WHERE score_reason = '__seed__'
  AND user_id      = (SELECT user_id      FROM _seed_ctx)
  AND workspace_id = (SELECT workspace_id FROM _seed_ctx);


-- ================================================================
--  TAB: PENDING  (status=pending, stage=new)
-- ================================================================

-- HIGH — reddit, has target_name + prepared_message
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'reddit',
  'https://reddit.com/r/devops/comments/1abc123/tired_of_manual_slack_alert_routing',
  'u/infra_headaches',
  'Posted in r/devops: "We have 6 different monitoring tools all dumping alerts into the same Slack channel. Nobody knows which alerts are theirs anymore, on-call rotations are a mess, and half the team has muted the channel entirely. Tried Zapier but the routing logic is too rigid. Anyone built something smarter for this?"',
  'Hey, alert routing chaos is one of the most common complaints I hear from engineering teams at your scale. Our tool does smart routing based on alert content and ownership rules — no rigid Zapier logic. Happy to walk you through it.',
  9, 8, 9,
  'pending', 'new',
  NOW() - INTERVAL '3 hours',
  '__seed__'
FROM _seed_ctx ctx;

-- HIGH — hackernews, no target_name (hides Analyse button)
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'hackernews',
  'https://news.ycombinator.com/item?id=38921045',
  NULL,
  'HN thread "Ask HN: How do you handle cross-team Slack notification fatigue?" — top comment with 180 upvotes: "We literally have an internal tool to snooze channels by project. Built it ourselves because nothing on the market handles our routing rules well enough. The problem is it has now become a full-time maintenance burden."',
  'Saw your comment on the HN thread about notification fatigue — the internal tool becoming a maintenance burden problem is exactly what we built against. Our product handles the routing rules without the upkeep. Worth a 20-minute look?',
  8, 9, 8,
  'pending', 'new',
  NOW() - INTERVAL '7 hours',
  '__seed__'
FROM _seed_ctx ctx;

-- MEDIUM — linkedin, has target_name
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'linkedin',
  'https://linkedin.com/posts/priya-nair-engmgr-slack-workflows-activity-7180123456789',
  'Priya Nair',
  'Engineering Manager at Loopstack posted: "Spent two weeks trying to build a Slack workflow that auto-routes support tickets to the right squad. Got halfway there with Workflow Builder but hit a wall — no conditional logic based on ticket content. Anyone solved this without going full custom bot?"',
  'Hi Priya, conditional routing based on content is exactly the gap we close. Our tool lets you define rules in plain English (e.g. if ticket mentions billing, route to finance-support) without writing a bot. Happy to show you how it would work for your setup.',
  7, 6, 7,
  'pending', 'new',
  NOW() - INTERVAL '1 day',
  '__seed__'
FROM _seed_ctx ctx;

-- LOW — indiehackers, no prepared_message
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'indiehackers',
  'https://indiehackers.com/post/how-we-run-our-async-company-on-slack-abc12345',
  'Marco Vitale',
  'IH post: "We are a 12-person fully async company. Slack is our office. The problem: no good way to route messages so the right person sees them without tagging everyone. Tried bots, tried naming conventions, nothing sticks."',
  NULL,
  4, 5, 4,
  'pending', 'new',
  NOW() - INTERVAL '2 days',
  '__seed__'
FROM _seed_ctx ctx;


-- ================================================================
--  TAB: VIEWED  (status=viewed, stage=new)
-- ================================================================

INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'reddit',
  'https://reddit.com/r/Slack/comments/1xyz789/slack_bots_for_intelligent_triage',
  'u/startup_ops_lead',
  'Posted in r/Slack: "We are a 40-person startup and our Slack has become completely ungovernable. Every tool dumps notifications, nobody knows what needs action vs what is FYI. Looking for something that can intelligently triage messages — either mute low-priority stuff or surface what actually needs a response."',
  'Hey, the ungovernable Slack problem is exactly what we built our tool around. We classify messages by urgency and ownership, so what needs action gets surfaced and the rest stays out of the way. Worth a 15-min demo?',
  8, 7, 8,
  'viewed', 'new',
  NOW() - INTERVAL '18 hours',
  NOW() - INTERVAL '2 days',
  '__seed__'
FROM _seed_ctx ctx;

INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'producthunt',
  'https://producthunt.com/discussions/how-do-you-manage-slack-for-distributed-teams',
  'Tomas Eriksson',
  'ProductHunt discussion: "We launched 6 months ago and onboarded 30 enterprise customers. Our Slack support channel is now impossible to manage. We are manually triaging 200+ messages a day. We need something that can auto-tag by customer tier, route to the right CSM, and escalate unresolved threads — everything we have tried is too rigid or too complex."',
  'Hi Tomas, manual triage at 200 messages a day is exactly when teams hit a wall. Our routing engine handles tier-based routing, CSM assignment, and escalation rules out of the box — setup takes under an hour. Happy to walk through it.',
  9, 8, 9,
  'viewed', 'new',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '3 days',
  '__seed__'
FROM _seed_ctx ctx;


-- ================================================================
--  TAB: ACTED  (status=acted, stage=new)
-- ================================================================

INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'twitter',
  'https://x.com/devrel_maya/status/1234567890123456789',
  'Maya Chen',
  'Tweet from @devrel_maya: "Hot take: Slack has become the productivity killer it was supposed to replace. 47 unread channels, 200 DMs, and somehow I still miss the thing my boss sent 3 minutes ago — devlife buildinpublic"',
  'Maya, the irony of Slack creating the problem it was meant to solve is very real — we built a routing layer that actually surfaces what needs your attention. Not another bot, just smarter signal vs noise. Happy to show you if curious.',
  5, 6, 5,
  'acted', 'new',
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '4 days',
  '__seed__'
FROM _seed_ctx ctx;


-- ================================================================
--  TAB: SENT  (status=sent, various pipeline stages)
--  These have marked_sent_at set. Log Feedback button shows.
-- ================================================================

-- contacted stage
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, marked_sent_at, last_stage_changed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'linkedin',
  'https://linkedin.com/in/james-okafor-cto',
  'James Okafor',
  'CTO at Buildwise — posted about their engineering team struggling with alert overload after migrating to microservices. Three monitoring tools, all piping data into a single alerts Slack channel, on-call team burned out.',
  'Hi James, saw your post about the alert overload after the microservices migration — that is one of the hardest scaling pains for infra teams. We route alerts by service ownership and severity so on-call engineers only see what is actually theirs. Would a quick walkthrough be useful?',
  8, 8, 7,
  'sent', 'contacted',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '5 days',
  '__seed__'
FROM _seed_ctx ctx;

-- replied stage
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, marked_sent_at, last_stage_changed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'hackernews',
  'https://news.ycombinator.com/item?id=38800012',
  'Zara Kim',
  'HN comment: "We have almost the same problem but at a larger scale — around 200 engineers. The routing logic we hacked together in Zapier is starting to break at the seams. We would genuinely pay for something that handles our use case properly — the challenge is always enterprise SSO and audit logging."',
  'Hi Zara, enterprise SSO and audit logging are table stakes for us — built specifically for engineering teams at your scale. The routing logic that breaks in Zapier is exactly what our rules engine handles natively. Happy to show you a live walkthrough.',
  9, 9, 9,
  'sent', 'replied',
  NOW() - INTERVAL '6 days',
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '8 days',
  '__seed__'
FROM _seed_ctx ctx;

-- call_demo stage
INSERT INTO public.opportunities
  (user_id, workspace_id, platform, source_url, target_name, target_context,
   prepared_message, fit_score, timing_score, intent_score,
   status, stage, viewed_at, marked_sent_at, last_stage_changed_at, created_at, score_reason)
SELECT
  ctx.user_id, ctx.workspace_id,
  'reddit',
  'https://reddit.com/r/sysadmin/comments/1mnp456/our_slack_is_out_of_control_at_300_people',
  'u/platform_eng_chris',
  'r/sysadmin thread with 240 upvotes: "We just hit 300 people and our Slack governance fell apart overnight. Twelve different teams routing CI/CD failures, security alerts, and customer pings into random channels. On-call is getting paged for things that have nothing to do with them."',
  'Hey, multi-team routing complexity at 300+ engineers is exactly the problem we designed for. We handle CI/CD, security alerts, and customer pings with separate rule sets per team, all in one place. Happy to do a live demo with your actual alert types.',
  9, 8, 9,
  'sent', 'call_demo',
  NOW() - INTERVAL '10 days',
  NOW() - INTERVAL '9 days',
  NOW() - INTERVAL '6 days',
  NOW() - INTERVAL '12 days',
  '__seed__'
FROM _seed_ctx ctx;


-- ── Done ────────────────────────────────────────────────────────
SELECT
  'Seed complete' AS status,
  (SELECT user_id      FROM _seed_ctx) AS user_id,
  (SELECT workspace_id FROM _seed_ctx) AS workspace_id,
  COUNT(*)                             AS opportunities_inserted
FROM public.opportunities
WHERE score_reason = '__seed__'
  AND user_id      = (SELECT user_id      FROM _seed_ctx)
  AND workspace_id = (SELECT workspace_id FROM _seed_ctx);

DROP TABLE IF EXISTS _seed_ctx;
