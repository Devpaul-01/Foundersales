# Product Overview

### FounderSales — what it does, how it's built, and where it's headed

> This document is a functional tour of the product as it exists today, illustrated with real screenshots from the running app. It's the longest document in this repo on purpose — the goal is to let someone unfamiliar with FounderSales actually see the breadth of it, not read a bullet list of feature names.

---

## 1. What This Is

FounderSales is a sales coaching and outreach platform built around one idea: a founder or early-stage seller who has never done cold outreach before shouldn't have to figure it out with a blank CRM and a chatbot bolted on. Instead, everything the product generates for them — the leads it surfaces, the messages it drafts, the buyer it simulates in practice mode, the meeting prep it writes — should draw from the *same* underlying understanding of who they are and what they're selling.

That understanding is a **voice profile**, built during onboarding and continuously informed by what actually happens afterward: which messages get replies, which practice sessions reveal a real weakness, which meetings go well.

## 2. Product Status

**This is an actively developed solo project**, not a finished commercial product. I'm building it with the intent of eventually growing it into a real company once it's further along — but right now it's a working platform with a genuinely deep feature set, some rough edges, and a few areas that are visibly still being wired up (a background job with no handler, a schema-only feature waiting on its routes, no billing system at all). Where something below is still being refined rather than fully finished, I've said so directly instead of glossing over it.

What follows is organized by product domain, in roughly the order a new user would encounter it.

---

## 3. Getting a New User Started: Onboarding & Workspaces

### 3.1 Workspaces

A workspace is the tenant boundary — a company, a personal sales practice, or a team. One account can belong to several (your own company, a company you're advising), each with its own voice profile, opportunities, and practice history. New users pick a workspace or create one before doing anything else.

<p align="center"><img src="assets/workspaces-picker.png" width="640" alt="Workspace picker showing four workspaces with role and plan badges"></p>

Creating a workspace is a two-field form (name + auto-generated URL slug) backed by `POST /api/workspaces`, which runs an atomic Postgres RPC (`create_workspace_for_user`) — workspace row, owning membership, and an empty profile all get created in one transaction, so there's no possible state where a workspace exists with no owner.

<p align="center"><img src="assets/workspaces-create-modal.png" width="500" alt="Create workspace modal with name and slug fields"></p>

Switching workspaces invalidates the cached membership context for both the old and new workspace immediately, rather than waiting out the 30-second cache window the rest of the app uses for workspace resolution.

### 3.2 Onboarding

Onboarding is a five-step wizard, and every step is backed by a real endpoint — this isn't a static form:

1. **Your Info** — a single rich step (name, business name, website, location, product description, target audience, primary goal, role, industry, experience level, business stage, where you find customers, a short bio) submitted to `POST /api/onboarding/basic`.
2. **Q&A — Round 1 of 3** — three AI-generated questions about the product itself (what customers love most, when people decide to buy, which channel has worked). If the product description from step 1 was too thin, the question generator detects that and swaps one question to ask directly what the person is building, instead of asking a redundant "what does your product do."
3. **Q&A — Round 2 of 3** — three questions about the customer: the real trigger moment, what makes them hesitate, what finally convinces them. Deliberately asks for concrete situations ("missed deadline," "Friday reporting scramble") rather than abstract psychology.
4. **Q&A — Round 3 of 3** — three questions about how the person actually sells: how they write to customers, what lands in a demo, what they do when someone goes quiet. Answering this round is what triggers voice-profile synthesis server-side.
5. **Preview** — a live-generated outreach message plus a compact summary of the synthesized voice profile, rendered from the exact `voice_profile` object the burst-3 answer call returned.

<p align="center"><img src="assets/onboarding-wizard-step1-your-info.png" width="500" alt="Onboarding step 1: personal info, product description, target audience"></p>
<p align="center"><img src="assets/onboarding-wizard-step2-qa.png" width="500" alt="Onboarding Q&A round: three AI-generated questions about approach"></p>

Each burst's questions are generated fresh by AI and **persisted** (`workspace_profiles.onboarding_questions`), so a user who leaves mid-onboarding and comes back sees the exact same questions rather than a newly regenerated set.

<p align="center"><img src="assets/onboarding-wizard-step5-preview.png" width="500" alt="Onboarding preview step showing generated voice profile tags and a sample outreach message"></p>

The preview step is deliberate — it's the first tangible proof to a new user that the system learned something specific about them, rather than asking them to trust an abstract profile they can't see in action yet.

Right after onboarding completes, three background jobs fire: memory seeding (extracting 8–10 standalone facts from the onboarding transcript into long-term AI memory), archetype detection (classifying the user as seller/builder/freelancer/creator/professional/learner, which shapes growth-card tone), and an immediate opportunity-discovery refresh, so a new user sees real discovered opportunities within moments rather than waiting for the next scheduled scan.

There's a second, lighter onboarding path too — a post-invite quickstart for users joining an existing team, asking only for a name, experience level, and primary goal (with suggested-goal chips) rather than the full wizard, since an invited member inherits the workspace owner's voice profile as a starting template.

<p align="center"><img src="assets/onboarding-post-signup-quickstart.png" width="500" alt="Lightweight post-signup quickstart for invited team members"></p>

---

## 4. The Home Dashboard

The landing screen after login. It's a status board, not a feature in its own right — momentum score with a breakdown by category (outreach/engagement/followups/consistency), 30-day sent/reply-rate/pipeline/win-rate cards, a 30-day activity chart, a growth feed of AI-generated insight/tip/milestone/challenge cards, active goal progress, and quick-start prompts into the AI chat.

<p align="center"><img src="assets/home-dashboard.png" width="700" alt="Home dashboard with momentum score, activity chart, and growth feed"></p>

The momentum score itself is computed deterministically (not by AI) from outreach streak, 30-day sent count, positive reply rate, pipeline stage progress, goal completion percentage, and recent practice activity — see [ARCHITECTURE.md](ARCHITECTURE.md) for the exact formula. The narrative text above it ("Nice work landing two replies...") is AI-generated and changes daily.

---

## 5. Opportunity Discovery

**The problem it answers:** cold outreach usually starts with "who do I even message?" This feature finds real people, in real conversations, expressing the exact problem the user's product solves — rather than making the user manually search.

### How a search decision gets made

Before spending an Exa search credit, `needsRealTimeSearch()` runs a cheap AI pass judging whether a live search right now has a good chance of finding anything — checking profile completeness and whether the ICP trigger and preferred platforms give it something specific to search for. If the router says no, or the workspace's daily Exa quota (tiered: 5/50/200 by plan) is exhausted, the system falls back to Groq-generated realistic practice examples instead — clearly labeled `is_example: true`, never presented as real leads.

```mermaid
flowchart TB
    A[Trigger: onboarding, manual refresh, or 6-hour scan] --> B{needsRealTimeSearch?}
    B -->|no / quota exceeded| C[Groq fallback: realistic practice examples]
    B -->|yes| D[Exa neural search per preferred platform]
    D --> E[scoreOpportunities — fit/timing/intent, one AI call for the batch]
    E --> F{composite score ≥ threshold?}
    F -->|no| G[Discarded]
    F -->|yes| H[generateOutreachMessage per qualifying opportunity]
    H --> I[Check against avoid_phrases — regenerate once if violated]
    I --> J[(opportunities table, upsert, dedup on source_url)]
```

Every scored opportunity gets its own drafted outreach message before the user sees it — the premise is "here's who to message and exactly what to say," not "here's a lead, go write something."

<p align="center"><img src="assets/opportunities-list.png" width="700" alt="Opportunities feed with fit/timing/intent scores across LinkedIn, Reddit, Product Hunt, Indie Hackers"></p>

### Opportunity detail and AI intel

Opening an opportunity shows the drafted message and a deeper "Clutch AI intel" panel — pain points, talking points, and risks synthesized from a live Exa search plus a second parallel Groq call that turns the same research into personalized outreach specifics (opening line, message suggestion, follow-up hook, tone). This intel result is cached on the opportunity row for 7 days so repeat views don't re-trigger both calls.

<p align="center"><img src="assets/opportunity-detail-ai-intel.png" width="700" alt="Opportunity detail with pain points, talking points, risks, and a generated outreach message"></p>

Opportunities can also be logged manually — useful for a lead found outside the automated discovery flow (a conference conversation, a warm intro) — with the same fit/timing/intent self-assessment sliders and an optional AI-suggested follow-up message.

<p align="center"><img src="assets/opportunity-add-manual.png" width="600" alt="Manual opportunity entry form with self-assessed fit, timing, and intent scores"></p>

---

## 6. Pipeline

Once an opportunity gets a reply, it stops being a discovery-feed item and becomes a deal to manage. Stages: `new → contacted → replied → call_demo → closed_won / closed_lost`. Stage advancement is partly automatic — logging positive feedback on a `new` opportunity auto-advances it to `contacted`; positive feedback on `contacted` advances it to `replied`. Every later transition is explicit, dragged or moved by the user.

<p align="center"><img src="assets/pipeline-kanban.png" width="700" alt="Pipeline kanban with Contacted, Replied, Call/Demo, and Closed Won columns"></p>

The first time a deal enters `contacted` or beyond, `marked_sent_at` is stamped and deliberately never overwritten afterward, even if the deal cycles through stages multiple times — it's meant to answer "when did outreach actually start," not "when did the most recent stage change happen."

---

## 7. Practice — AI Roleplay Simulation

**The problem it answers:** the best time to make a mistake with a difficult prospect is in a simulation, not on a real call.

### Starting a session

Six weighted scenario types exist — interested (25%), polite decline (25%), ghost (20%), skeptical (15%), price objection (10%), not-right-time (5%) — randomly selected by weight or explicitly chosen, with four optional pressure modifiers (time crunch, budget freeze, competitor pitch, gatekeeper) that shift the buyer's behavior and apply a one-time stat adjustment to their starting interest/trust. Difficulty auto-calibrates from the user's own session history.

<p align="center"><img src="assets/practice-session-setup.png" width="600" alt="New practice session setup with scenario, difficulty, session goal, and pressure modifier"></p>

### The conversation

A full buyer persona gets generated per session — name, role, specific pain, what they're skeptical about, current tools, and critically, **hidden motivations the user has to discover through questioning**, never read off the persona directly.

<p align="center"><img src="assets/practice-live-session.png" width="700" alt="Live practice session with interest/trust/confusion meters and buyer chat"></p>

Every reply the buyer sends is one bundled AI call (`generatePracticeProspectReplyV3`) returning: the in-character reply text, the buyer's real internal monologue (which can openly contradict the tone of the reply), a running interest/trust/confusion state delta, a conversation-outcome classification once the conversation reaches a natural endpoint, a goal-achieved check against whatever the user set as the session goal, and an inline coaching tip — six pieces of structured output from one model call rather than four separate sequential ones.

A "ghost" scenario means the buyer doesn't reply by default — but a genuinely strong message can revive it. Every message in a ghost scenario is scored 0–100 by a separate quality-gate call on specificity, value clarity, personalization, and ask quality; a score of 40+ breaks the silence for one reply, treating the buyer as temporarily "interested." Below 40, the buyer stays silent and the user gets a coaching hint explaining why.

### After the session

Completing a session triggers badge evaluation and three staggered background jobs: multi-axis skill scoring at 2 seconds, message-level coaching annotations at 5 seconds, and a full reusable playbook at 2 hours (delayed deliberately — a playbook the user might discard immediately isn't worth generating right away).

<p align="center"><img src="assets/practice-session-debrief.png" width="700" alt="Post-session debrief with strength score, what worked/what didn't, skill radar, and message-by-message coaching"></p>

Retrying a scenario starts a **genuinely new session against a newly-generated buyer persona** of the same scenario type — never a literal replay of one specific exchange.

### The internal monologue as a teaching tool

Post-session, internal monologues are surfaced separately from the transcript in a full session replay — every moment the buyer said one thing but privately thought something meaningfully different becomes a specific, reviewable teaching moment.

<p align="center"><img src="assets/practice-session-replay-monologue.png" width="700" alt="Session replay showing the buyer's hidden thoughts alongside each message"></p>
<p align="center"><img src="assets/practice-session-replay-monologue-2.png" width="700" alt="Session replay continued, showing the buyer's reasoning shift as trust builds"></p>

### The Practice dashboard

Total sessions, reply rate, streak, average score, a skill-axis radar chart (rapport, discovery, objection handling, closing, clarity, persuasion), earned achievements, and full session history.

<p align="center"><img src="assets/practice-dashboard.png" width="700" alt="Practice dashboard with skill radar, achievements, and session history list"></p>

---

## 8. AI Chat Coach

A general-purpose coaching chat, distinct from practice roleplay — this is for talking through a real situation with the same AI that knows the user's business context.

<p align="center"><img src="assets/chat-list.png" width="700" alt="Chat list with conversations tagged by mode: Prep, Meeting notes, Follow-up coach, general"></p>

Four modes exist under the hood (`general`, `prep`, `followup_coach`, `meeting_notes`), each layering different system-prompt instructions onto the same base coaching persona. Every turn re-injects fresh memory facts, active goals, latest check-in mood, and — if the chat was started from a growth card or an opportunity — that context too, rather than relying on a single copy planted at chat creation that would fall out of the model's context window after a few turns.

<p align="center"><img src="assets/chat-thread.png" width="700" alt="Chat thread showing a pipeline summary table generated from live deal data"></p>

Web search inside chat is an explicit toggle (`force_search`), not automatic — search cost stays predictable and the user controls when the AI reaches outside the conversation. Long chats get a rolling AI-written summary once they exceed the live history window, so context isn't silently truncated or resent in full every turn.

---

## 9. Calendar Intelligence

**The problem it answers:** a meeting walked into unprepared is a wasted opportunity; a meeting walked out of with no clear next step is nearly as wasted.

<p align="center"><img src="assets/calendar-list.png" width="700" alt="Calendar list with prep status, health scores, and overdue-commitment banners"></p>

Adding an event captures attendee context and can optionally resolve or create a matching prospect record (deduplicated — see §10).

<p align="center"><img src="assets/calendar-add-event.png" width="450" alt="Add event modal with attendee name, context, and type"></p>

### Before the meeting

Creating an event with attendee context triggers two background jobs, each gated by `calendarAiGate.js` before any model gets called: prospect research (an Exa search synthesized into a structured brief, reused across meetings with the same prospect within a 14-day window) and prep generation — an AI-written brief combining that research with the prospect's relationship history into an opening line, talking points, the single best question to ask, an anticipated objection with a ready response, and pre/post-meeting message templates.

<p align="center"><img src="assets/calendar-event-prep-tab.png" width="700" alt="Meeting prep tab with opening line, talking points, and a generated follow-up draft"></p>

### After the meeting

A debrief (raw notes plus an outcome rating) triggers, in parallel: a structured AI summary, a single merged AI call extracting both commitments and signals from the same notes text, a relationship-health recompute, and — immediately, not on a delay — three follow-up message variants, unless the outcome gate determines a follow-up isn't warranted.

<p align="center"><img src="assets/calendar-event-commitments-tab.png" width="700" alt="Commitments tab showing founder and prospect action items with due dates and status"></p>
<p align="center"><img src="assets/calendar-event-signals-tab.png" width="700" alt="Signals tab showing buying, budget, risk, and competitor-mention signals with confidence scores"></p>

Voice memos — recorded in-app or uploaded — flow through the exact same transcription → debrief → extraction pipeline as typed notes, distinguished only by a `source` field.

### Relationship health

Computed deterministically, not by AI: a base score of 50, adjusted by recency of last contact, the last meeting's outcome, recent buying/risk signals, and overdue founder commitments, clamped to 0–100. Using arithmetic here instead of an AI judgment call keeps the score consistent and explainable.

---

## 10. Prospects

A prospect is a real person the user has an ongoing relationship with — distinct from an opportunity, which is the discovery-feed item that may or may not become a tracked prospect.

<p align="center"><img src="assets/prospects-list.png" width="700" alt="Prospects list with status badges and source channel tags"></p>

Creating a prospect resolves through a three-layer dedup match: exact email/LinkedIn identifier, then normalized-name exact match (both auto-reuse silently), then trigram similarity on genuinely different-looking names (**never auto-merged** — flagged into a review queue instead, because auto-merging two different real people who happen to share a name is a real failure mode, not a hypothetical one).

<p align="center"><img src="assets/prospect-detail-overview.png" width="700" alt="Prospect detail with AI-generated relationship summary and talking points"></p>

The detail view includes an AI-generated narrative summary of the relationship, refreshed on a 7-day staleness cutoff, and a merged timeline combining every meeting, chat, and detected signal associated with them, sorted chronologically regardless of source type.

<p align="center"><img src="assets/prospect-detail-activity.png" width="700" alt="Prospect activity timeline: added, first outreach, intro call, demo, proposal, last contact"></p>

---

## 11. Goals

Free-text goals with an optional numeric target, tracked via atomic progress increments rather than read-modify-write from the client, so concurrent updates from multiple tabs can't silently clobber each other.

<p align="center"><img src="assets/goals.png" width="700" alt="Goals page with active, completed, and paused goals and progress bars"></p>

Logging a note against a goal gets an AI coaching response *and* an inferred progress delta in the same call — the user doesn't have to separately narrate progress and then manually update a number.

---

## 12. Follow-ups

A dedicated surface for every deal sitting in `contacted`/`replied`/`call_demo` past a per-stage staleness threshold, each with an AI-generated follow-up message ready to copy or mark sent.

<p align="center"><img src="assets/followups.png" width="700" alt="Follow-ups list with generated messages, days-overdue, and follow-up counts"></p>

Capped at 2 follow-ups per opportunity, and won't regenerate within 5 days of the last one — this is meant to nudge, not spam.

---

## 13. Insights & Metrics

This is the deepest analytical surface in the product — deliberately split into two related but distinct areas.

### 13.1 Insights — narrative, AI-synthesized

**Patterns** — plain-language, evidence-cited observations pulled from `communication_patterns` (detected weekly by the pattern-detection job), each with a concrete suggested action and a trend direction.

<p align="center"><img src="assets/insights-patterns.png" width="700" alt="Insights patterns tab with talk-to-listen ratio, deal-stall timing, and referral close-rate observations"></p>

**Why you're losing** — an AI-synthesized diagnosis comparing loss reasons, with a written analysis connecting the top loss driver to a secondary factor (e.g., "price too high" losses that also lacked a senior stakeholder).

<p align="center"><img src="assets/insights-why-losing.png" width="700" alt="Loss-reason bar chart with a written root-cause analysis below it"></p>

**Skill trend** — skill scores charted over time by axis, with 30-day deltas per axis.

<p align="center"><img src="assets/insights-skill-trend.png" width="700" alt="Skill trend line chart across discovery, objection handling, negotiation, closing, active listening"></p>

### 13.2 Metrics — structured numbers, mostly deterministic

A tabbed dashboard: Overview (momentum, sent/response/pipeline/win-rate, 30-day activity), Pipeline (funnel + stage distribution + at-risk/strongest-relationship lists), Skills (a 7-day radar plus a separate practice-specific skill-axis set), Practice (by-scenario breakdown, recommended drills, badges), Analyses (score dimensions, priority improvements, common failure patterns, an objection library with response/practice scores), Calendar (needs-prep/needs-debrief queues, meeting performance), and AI Insights (a handful of AI-generated action nudges).

<p align="center"><img src="assets/metrics-overview.png" width="700" alt="Metrics overview tab with momentum breakdown and pipeline/response stats"></p>
<p align="center"><img src="assets/metrics-pipeline.png" width="700" alt="Metrics pipeline tab with funnel chart, stage distribution, and at-risk deals"></p>
<p align="center"><img src="assets/metrics-skills.png" width="700" alt="Metrics skills tab with a 7-day radar and practice skill axes"></p>
<p align="center"><img src="assets/metrics-practice.png" width="700" alt="Metrics practice tab with by-scenario scores and recommended drills"></p>
<p align="center"><img src="assets/metrics-analyses.png" width="700" alt="Metrics analyses tab with score dimensions, priority improvements, and an objection library"></p>
<p align="center"><img src="assets/metrics-calendar.png" width="700" alt="Metrics calendar tab with needs-prep and needs-debrief queues"></p>
<p align="center"><img src="assets/metrics-ai-insights.png" width="700" alt="Metrics AI insights tab with send-timing and CTA-focused nudges"></p>

The distinction that matters: **Insights** is where AI does the synthesis work (pattern detection, loss diagnosis); most of **Metrics** is plain aggregation and arithmetic — correlation coefficients, funnel counts, stage distributions — computed in code, not asked of a model. A few specific analyses under Insights use real statistics rather than AI judgment too: mood-vs-performance uses an actual Pearson correlation (requiring 5+ active days before surfacing a result), practice ROI compares outcome rates across weeks-with-practice vs. weeks-without (requiring 3+ weeks in each bucket), and skill persistence classifies a recurring weakness as genuinely "persistent" only after 3+ consecutive weeks.

---

## 14. Team Features (Manager+)

For workspaces with more than one member, a manager-gated layer surfaces team-wide versions of the same data, plus coaching tools that don't exist at the individual level.

<p align="center"><img src="assets/team-metrics-overview.png" width="700" alt="Team metrics overview with team skill score, weak spot, and buying signals"></p>

**Leaderboard** — ranked by a weighted composite of outreach volume, reply quality, deals closed, and skill level.

<p align="center"><img src="assets/team-leaderboard.png" width="700" alt="Team leaderboard ranked by sent, response rate, and deals won"></p>

**Coaching queue** — flags reps hitting two or more risk signals (no outreach in 7 days, no practice in 7 days, declining skill score, low skill score, low average prospect health), each with a one-tap nudge action.

<p align="center"><img src="assets/team-coaching-queue.png" width="700" alt="Coaching queue with flagged reps and skill/pipeline-health detail"></p>
<p align="center"><img src="assets/team-coaching-nudge-queue.png" width="700" alt="Coaching queue nudge list for reps with no recent outreach or declining scores"></p>

**Velocity** — week-over-week team skill-score change, comparing the current week's average composite against the prior week's.

<p align="center"><img src="assets/team-velocity.png" width="700" alt="Team velocity showing week-over-week skill score change and active member counts"></p>

**Activity feed** — a chronological log of deals closed, practice sessions completed, check-ins submitted, and goals hit across the whole team.

<p align="center"><img src="assets/team-activity-feed.png" width="700" alt="Team activity feed with closed deals, completed practice sessions, and check-ins"></p>

**Team pipeline, opportunities, and analytics** — every deal and opportunity in the workspace regardless of owner, plus a per-member outreach/response breakdown.

<p align="center"><img src="assets/team-pipeline.png" width="700" alt="Team pipeline kanban showing every rep's deals by stage"></p>
<p align="center"><img src="assets/team-opportunities.png" width="700" alt="Team opportunities list with per-opportunity assignment"></p>
<p align="center"><img src="assets/team-analytics.png" width="700" alt="Team analytics with per-member sent, response rate, and demo counts"></p>

**Team insights ("Why losing")** — the same loss-diagnosis pattern as the individual Insights tab, aggregated across the whole workspace, plus a team-wide skill matrix.

<p align="center"><img src="assets/team-insights-why-losing.png" width="700" alt="Team-wide loss reasons with a written summary of the dominant pattern"></p>

---

## 15. Settings & Account

Profile and product-context editing, a dedicated Voice Profile page, AI Memory, Notification preferences, and Team member management all live under Settings.

<p align="center"><img src="assets/settings-profile.png" width="700" alt="Settings profile page with business info and links to voice profile, AI memory, notifications, and team members"></p>

### Voice Profile

A standalone page showing the full synthesized profile — unique value prop, target customer, ICP trigger, main objection and its reframe, best proof point, voice style, outreach persona, and phrases to avoid — with a note on when it was last rebuilt and from how many analyzed calls.

<p align="center"><img src="assets/voice-profile-detail.png" width="700" alt="Voice profile detail page with value prop, ICP trigger, objection reframe, and phrases to avoid"></p>

This isn't static after onboarding — it can be edited directly (deep-merged against the existing profile) or rebuilt from scratch against the original onboarding answers.

### Notifications

Granular per-type push preferences grouped by category (outreach, practice, calendar & meetings, growth & coaching), each independently toggleable.

<p align="center"><img src="assets/settings-notifications.png" width="700" alt="Notification preferences grouped by outreach, practice, calendar, and growth categories"></p>

### Team Members

Role management (owner/admin/manager/member) and pending-invite tracking with expiry and revoke actions.

<p align="center"><img src="assets/settings-team-members.png" width="700" alt="Team members list with roles and pending invites"></p>

---

## 16. AI-Powered Experiences — Summary

Pulling the AI usage across the product into one place, since it's easy to undercount when it's woven through every feature above:

| Feature | What the AI actually does |
|---|---|
| Onboarding | Generates 3 rounds of probing questions, synthesizes the full voice profile from the answers, seeds long-term memory, detects a user archetype |
| Opportunity discovery | Decides whether a live search is worth the cost, scores a batch of results on fit/timing/intent, drafts a personalized message per opportunity, self-corrects against a forbidden-phrase list |
| Opportunity intel | Runs a live web search plus two parallel synthesis calls (research brief + outreach specifics) |
| Practice | Generates a full buyer persona with hidden motivations, then one bundled call per turn for reply + private thoughts + state delta + outcome + coaching; a separate quality-gate call for ghost scenarios |
| Practice debrief | Multi-axis skill scoring, per-message coaching annotations, a reusable playbook, a curriculum targeting the weakest axes |
| Calendar prep | Combines relationship history, prior signals, outstanding commitments, and live research into one structured brief |
| Calendar debrief | Structured meeting summary; one merged call extracting both commitments and signals from the same notes |
| Calendar follow-up | Three follow-up message variants in one call, gated on whether a follow-up is even warranted for the outcome |
| Chat coach | Full conversational coaching with injected memory, goals, mood, and (if applicable) growth-card or opportunity context; optional live web search |
| Growth cards | Daily tips, weekly plans, check-in responses — mood-aware, referencing specific recent activity where available |
| Weekly pattern detection | Compares winning vs. losing message statistics to surface 2–4 named communication patterns |
| Message analysis | Scores every sent message on 6 dimensions once feedback is logged; regex (not AI) handles objection-type classification from feedback notes |

---

## 17. Future Direction

Where the product is headed, kept clearly separate from what exists today:

- **Split-process deployment as the default**, not just an available option — the API (`server.js`) and worker (`workers/index.js`) processes already exist and run independently; making that the recommended production topology (rather than the current combined-process default) is a deployment decision, not new code.
- **Billing and plan enforcement.** Tiers (`free`/`pro`/`enterprise`) already gate a few things (Exa quota, market-intel enrichment), but there's no payment integration or subscription lifecycle behind them yet.
- **Public booking pages** — the schema (`booking_pages`, `availability_windows`) already exists; routing and UI don't yet.
- **Resolving the `pattern_insights` gap** — deciding between direct cron registration and the current self-enqueue pattern, then wiring the handler that's already written (`patternInsightsJob.js`) into the scheduled worker.
- **Eventually, a real company.** The product is being built with that direction in mind, but there's no customer base, revenue, or production-scale deployment behind it today — it's a working platform I'm continuing to build toward that goal.
