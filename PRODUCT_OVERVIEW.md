# FounderSales — Product Overview

> **Document purpose:** this is not an architecture document or an API reference. It's the complete explanation of what FounderSales does, what problem it solves, and how someone actually experiences it — written so a hiring manager, product manager, or engineer evaluating the codebase can understand the whole product without reading the source.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Core Concepts & Domain Model](#3-core-concepts--domain-model)
4. [High-Level System Overview](#4-high-level-system-overview)
5. [Feature Inventory](#5-feature-inventory)
6. [Authentication & Workspaces](#6-authentication--workspaces)
7. [Onboarding — Building a Voice Profile](#7-onboarding--building-a-voice-profile)
8. [Opportunity Discovery](#8-opportunity-discovery)
9. [Pipeline & Deal Tracking](#9-pipeline--deal-tracking)
10. [Feedback & Conversation Analysis](#10-feedback--conversation-analysis)
11. [Practice Mode — AI Roleplay](#11-practice-mode--ai-roleplay)
12. [Calendar & Meeting Intelligence](#12-calendar--meeting-intelligence)
13. [Voice Memos](#13-voice-memos)
14. [Prospects & Relationship Health](#14-prospects--relationship-health)
15. [Chat — the AI Coach](#15-chat--the-ai-coach)
16. [Growth — Daily & Weekly Coaching](#16-growth--daily--weekly-coaching)
17. [Insights & Metrics](#17-insights--metrics)
18. [Skill Progression](#18-skill-progression)
19. [Goals & Commitments](#19-goals--commitments)
20. [Team Features](#20-team-features)
21. [Notifications](#21-notifications)
22. [AI Provider Reliability](#22-ai-provider-reliability)
23. [Background Automation](#23-background-automation)
24. [Business Rules Reference](#24-business-rules-reference)
25. [Complete End-to-End User Flows](#25-complete-end-to-end-user-flows)
26. [Feature Relationships — How It All Connects](#26-feature-relationships--how-it-all-connects)
27. [System Lifecycle — A Day in the Life of the Backend](#27-system-lifecycle--a-day-in-the-life-of-the-backend)
28. [Product Strengths](#28-product-strengths)
29. [Known Limitations & Roadmap](#29-known-limitations--roadmap)
30. [Appendix — Glossary & Terminology](#30-appendix--glossary--terminology)

---

## 1. Executive Summary

**FounderSales is a sales enablement platform for people selling without a sales team.** Solo founders doing their own customer acquisition, freelancers pitching for work, and small teams without a dedicated sales-ops function all run into the same gap: they improve at selling almost entirely by trial and error on real prospects, with no feedback loop telling them what's actually going wrong, and no safe place to fix it before it costs them a real conversation.

The product exists to close that gap by treating four things — outbound lead discovery, a pipeline, AI roleplay practice, and meeting intelligence — as one connected system instead of four separate tools. A message goes out, its outcome gets logged, the message gets scored on the same rubric a practice session is scored on, and the weakest pattern in that scoring feeds directly into what the founder practices next. The AI buyer in a roleplay session, the coaching prompts, the growth cards, and the outreach message drafts are all generated from one "voice profile" built during onboarding — not from a shared template library.

At the center of the system are three ideas:

- A **workspace** is the founder's (or team's) space — members, a shared product context, a shared pipeline.
- An **opportunity** is a discovered or logged prospect moving through a pipeline (new → contacted → replied → call/demo → closed).
- The **feedback loop** is what makes the system adaptive: outcomes from real outreach and scores from practice sessions are measured on identical axes, so the system can say, concretely, "this is what's not working" rather than offering generic advice.

FounderSales is built as a multi-tenant backend service — API-first, with a client application consuming it — split cleanly between synchronous request handling and an asynchronous job system for anything AI-heavy or scheduled.

---

## 2. Product Vision

Sales skill is usually built one of two ways: expensively (a sales manager reviewing your calls, a coach watching your pitch) or slowly (send enough messages, eventually notice a pattern yourself). Founders and freelancers selling on their own rarely have access to the first option, and the second one is costly — a weak cold message to a specific person is often a shot you don't get to retake.

FounderSales is built around a small number of durable beliefs:

- **Feedback should come from your own data, not a template library.** A growth card that says "your CTA is weak" is less useful than one that says "your CTA is present but vague in messages under 40 words, and that pattern shows up in 6 of your last 9 negative outcomes."
- **Practice should be measured the same way reality is.** If practice and real outreach are scored on different rubrics, improving at one doesn't tell you anything reliable about the other. This product deliberately scores both on the same six-plus axes.
- **A roleplay buyer that's too easy teaches nothing.** The AI buyer in practice mode starts skeptical, has to be drawn out through discovery questions, and can genuinely ghost a weak message — because real buyers do exactly that.
- **AI cost should be spent where it earns its keep.** Not every event needs research, not every meeting needs full AI prep, and not every question is worth a live search. The system gates AI spend behind cheap upfront checks rather than generating everything by default.
- **A founder shouldn't have to re-explain their business every session.** The product remembers specific facts (a specific win, a specific competitor, a specific price point) and references them later instead of starting from zero each time.

---

## 3. Core Concepts & Domain Model

| Concept | What it is | Real-world analogy |
|---|---|---|
| **Workspace** | A founder's or team's space in FounderSales — has a plan, members, and a shared voice profile. | The "company" in a business SaaS product — the top-level tenant. |
| **Workspace Member** | A person's membership within one workspace, with a role (owner/admin/manager/member). One person can belong to multiple workspaces (e.g., their own solo space and a client's team). | An employee's record at a specific company. |
| **Workspace Profile** | The product/audience/voice context for a specific person *within* a specific workspace — not on the user's global account. | The "brand voice" or "positioning doc" for that specific business. |
| **Opportunity** | A discovered or manually logged prospect, moving through a pipeline stage, with a prepared outreach message. | A lead card in a CRM. |
| **Feedback** | The logged outcome (positive/negative) of sending an opportunity's message — the event that triggers scoring. | A closed/won or closed/lost note on a deal. |
| **Conversation Analysis** | The AI's six-axis score of one specific outreach message, tied to its feedback outcome. | A sales call scorecard, but for a written message. |
| **Practice Session** | A roleplay conversation against an AI buyer persona, scored on the same axes as real outreach. | A mock sales call with a coach playing the prospect. |
| **Prospect** | A person the founder has an ongoing relationship with — distinct from a one-off opportunity, tracked across meetings, chats, and signals over time. | A contact record in a CRM. |
| **Growth Card** | A generated, dismissible coaching nudge — a tip, a challenge, a reflection prompt, or a detected pattern. | A personalized coaching notification. |

**Nesting, visually:**

```
Workspace ("Alex's Workspace")
│
├── Workspace Members (Alex [owner])
│
├── Workspace Profile
│     └── Voice Profile (value prop, ICP trigger, objection reframe,
│           opening hooks, avoid-phrases, story vault)
│
├── Opportunities (pipeline: new → contacted → replied → call_demo → closed_won/lost)
│     └── Feedback (outcome + note)
│           └── Conversation Analysis (6-axis score)
│                 └── Objection Tracker entry (if negative)
│
├── Practice Sessions
│     ├── Buyer Profile (persona, hidden motivations)
│     ├── Buyer State History (interest/trust/confusion per exchange)
│     ├── Skill Scores (same 6 axes + discovery, objection handling, monologue alignment)
│     └── Playbook (generated after a strong session)
│
├── Prospects
│     ├── Timeline (events, chats, signals)
│     ├── Relationship Health Score
│     └── Commitments (who owes what, by when)
│
├── Calendar (user_events)
│     ├── Prep Content (AI-generated pre-meeting brief)
│     ├── Debrief Content (post-meeting summary + signals)
│     └── Voice Memos (transcribed, feeding the same debrief pipeline)
│
├── Growth Cards (daily tips, weekly plan, detected patterns)
├── Goals & Commitments
└── Skill Progression (weekly snapshot, real-world + practice blended)
```

**Two cross-cutting ideas** shape almost every feature below:

- **Workspace-scoped product context, not user-scoped.** A person's product description, target audience, and voice profile live on `workspace_profiles`, keyed by `(workspace_id, user_id)` — not on their global user account. This is what makes it correct for the same person to belong to a solo workspace and a team workspace with entirely different products and voices.
- **Real outreach and practice share one scoring rubric.** Six axes — hook, clarity, value proposition, personalization, CTA, tone — are used for both `conversation_analyses` (real messages) and `practice_sessions.skill_scores` (roleplay). Practice adds discovery, objection handling, brevity, and monologue alignment. This shared rubric is the mechanism, not a coincidence — it's what lets a weekly job blend the two into one skill trend.

---

## 4. High-Level System Overview

FounderSales runs as a Node.js/Express API backed by:

- **Supabase (Postgres)** as the system of record for every entity.
- **Supabase Auth** for identity — JWT-based sessions, Google OAuth supported.
- **Redis** for three distinct jobs: BullMQ's queue backing store, namespaced rate-limit counters, and short-lived auth/workspace caches.
- **BullMQ** across three dedicated workers (scheduled, background, practice), covering everything from nightly pattern detection to per-message scoring.
- **Four AI chat providers** (Cerebras, Groq, Mistral, OpenRouter) behind one fallback layer, plus **Exa** for prospect search and **Groq Whisper** for voice memo transcription.
- **Cloudinary** for file and voice-memo storage.
- **Firebase Cloud Messaging** for push notifications, **Resend/Nodemailer** for email.
- **Sentry** for error tracking, fully optional.

A request flows through: security headers → CORS → JSON parsing → trace ID attachment → structured logging → route-specific auth (JWT verification via Supabase) → workspace membership resolution (Redis-cached, 30s) → namespaced per-route rate limiting → role check where relevant → controller → service (business logic, DB, AI calls) → response. Anything that doesn't need to finish before the response is enqueued to one of three BullMQ queues instead of run inline.

---

## 5. Feature Inventory

**Identity & Workspace**
- Email/password and Google OAuth sign-in via Supabase Auth
- Multi-workspace membership with roles (owner/admin/manager/member)
- Token-based workspace invites (hashed, expiring, atomic acceptance)
- Ownership transfer, member removal, role changes

**Onboarding**
- Three-burst conversational onboarding (product → customer behavior → communication style)
- AI-synthesized voice profile (value prop, ICP trigger, objection + reframe, opening hooks, avoid-phrases, story vault, follow-up sequence)
- Voice profile editing and full regeneration
- Archetype detection (seller/builder/freelancer/creator/professional/learner)

**Opportunity Discovery & Pipeline**
- Cost-gated real-time search across Reddit, LinkedIn, X, IndieHackers, Hacker News (via Exa)
- AI scoring (fit/timing/intent) and message drafting per opportunity
- Graceful fallback to labeled practice examples when search isn't warranted or quota is spent
- Full pipeline (new → contacted → replied → call/demo → closed won/lost) with stage-change tracking
- Manual opportunity creation and editing
- Team assignment and per-rep/team pipeline views

**Feedback & Analysis**
- Outcome logging (positive/negative) with deal value and scheduled-call tracking
- Six-axis AI scoring of every analyzed message (hook, clarity, value prop, personalization, CTA, tone)
- Automatic objection classification and frequency tracking on negative outcomes
- Weekly pattern detection comparing winning vs. losing messages
- Market-intelligence enrichment for recurring loss patterns (pro/enterprise)

**Practice Mode**
- Six weighted scenario types (interested, polite decline, ghost, skeptical, price objection, bad timing)
- Generated buyer personas with hidden motivations and a live interest/trust/confusion state
- Pressure modifiers (decision-maker watching, aggressive buyer, competitor mentioned, compliance concern)
- Message-quality-gated ghost revival — a strong enough message can break a ghost's silence
- Post-session debrief, coaching annotations, internal-monologue reveal, retry comparison
- Adaptive difficulty based on session history and reply rate
- Badges, streaks, adaptive weekly curriculum

**Calendar & Meetings**
- Event creation with AI cost-gated prep generation
- Live "meeting notes" chat mode with real-time flagging of signals
- Post-meeting debrief from typed notes or voice memo
- Commitment and buying/risk/timing/engagement signal extraction (shared pipeline across all input types)
- Three-variant follow-up generation (brief, substantive, re-engagement)
- Voice memo recording/upload, transcription, and enrichment
- Prospect pre-meeting research with a 14-day reuse cooldown
- Reschedule handling, cursor-paginated event search, team calendar views

**Prospects**
- Auto-creation from calendar events (heuristic-gated) and manual creation
- Three-layer fuzzy deduplication (exact identifier, normalized name, trigram similarity with human review)
- Relationship health scoring from recent outcomes, signals, and overdue commitments
- AI-generated relationship summary from full interaction timeline
- Merge-candidate review queue

**Chat**
- General coaching, meeting prep, follow-up coaching, and live meeting-notes modes
- Rolling conversation summarization to bound token cost on long chats
- Growth-card and opportunity context injection, refreshed every turn
- Web search integration (Exa) with citation persistence
- Vision support for image attachments (model-dependent)
- Streaming (SSE) and non-streaming generation
- Markdown export

**Growth & Coaching**
- Daily growth cards personalized to product, goals, and recent activity
- Mood-adaptive daily check-ins
- Weekly plan generation with daily action items
- Durable memory extraction (specific facts referenced in later conversations)
- Morning/evening push notification nudges with anti-spam pacing

**Insights & Metrics**
- Dashboard: momentum score, streaks, channel breakdown, relationship health summary
- "Why you're losing" diagnostic reports (individual and team-wide)
- Skill trend analysis with biggest-gain/biggest-drop callouts
- Practice buyer-state trajectory (peak interest, drop-off point across sessions)
- Practice-vs-outcome ROI correlation
- Meeting prep effectiveness (prepped vs. unprepped positive-outcome rate)
- Mood-vs-performance correlation
- Pipeline lost-reason breakdown by frequency and dollar impact
- Silent-risk detection (deals that look active but show negative signals underneath)

**Team Features**
- Manager+ team pipeline, calendar, and analytics views
- Leaderboard blending outreach volume, reply quality, deals closed, skill, and goal progress
- Coaching queue flagging reps by inactivity, declining skill, or cold relationships
- Team-wide objection divergence (shared problem vs. one rep's gap)
- Executive report generation (owner/admin only)
- Nudges and workspace activity feed

**Goals & Commitments**
- Goal creation with target value/unit/date and AI-coached progress notes
- Commitment tracking (who owes what, from meetings or chat), overdue detection

**Notifications**
- In-app inbox, push (FCM), and email, with per-type preference toggles
- Deduplication and an outbox-style retry for stuck deliveries

---

## 6. Authentication & Workspaces

### Why it exists
Every feature depends on knowing who's asking and which business context they're acting in. Authentication is delegated to Supabase rather than built from scratch; workspace resolution on top of that is what makes multi-tenant, multi-workspace membership actually work.

### Sign-in
Email/password and Google OAuth both terminate in a Supabase-issued JWT. The backend never stores or checks a password itself — `authenticate` middleware calls `supabase.auth.getUser(token)` on every request and caches the resulting profile row in Redis for 30 seconds, explicitly invalidated on writes.

### Workspace resolution
`resolveWorkspace` runs immediately after authentication on every workspace-scoped route. It reads the user's `active_workspace_id`, loads the workspace, the caller's membership row, and their `workspace_profile` in parallel, and caches the combined result for 30 seconds. A user with no active workspace, or with a membership that isn't `active`, is rejected before any route handler runs.

### Roles
`owner` / `admin` / `manager` / `member`, checked via `requirePermission(role)`. Ownership transfer, workspace deletion, and settings changes are owner-only; member management and invites are admin+; team views and coaching queues are manager+.

### Invites
A random token is hashed before storage; acceptance runs through a Postgres function (`accept_workspace_invite`) that atomically activates the membership row and seeds a new `workspace_profile` from the inviting owner's own profile defaults — so a newly-accepted teammate starts with sensible product context rather than a blank slate.

### Permissions summary

| Action | Member | Manager | Admin | Owner |
|---|:---:|:---:|:---:|:---:|
| View own pipeline, practice, chat | ✅ | ✅ | ✅ | ✅ |
| View team pipeline / leaderboard / coaching queue | ❌ | ✅ | ✅ | ✅ |
| Invite a member | ❌ | ❌ | ✅ | ✅ |
| Change a member's role | ❌ | ❌ | ✅ | ✅ |
| Assign a deal to a rep | ❌ | ✅ | ✅ | ✅ |
| Delete the workspace | ❌ | ❌ | ❌ | ✅ |
| Transfer ownership | ❌ | ❌ | ❌ | ✅ |

---

## 7. Onboarding — Building a Voice Profile

### Why it exists
Every AI-generated artifact downstream — outreach messages, buyer personas, coaching cards — needs a real, specific product context to draw from. A settings form produces shallow answers ("we help businesses grow"). A short conversational interview, where each question is generated from the previous answer, produces the specific, quotable material the rest of the product depends on.

### The three-burst flow
**Burst 1** asks about the product, target customer, and — if the product description is too thin to work with — explicitly asks what the founder is actually building. **Burst 2**, generated from burst 1's answers, asks about real customer behavior: the exact trigger moment someone starts looking for a solution, what makes them hesitate, and what actually convinces them to buy. **Burst 3** asks how the founder actually communicates today — what gets a reply, what lands in a demo, what they do when someone goes quiet.

### Voice profile synthesis
The three bursts of answers are synthesized into a structured profile: a unique value proposition (kept to a specific outcome or number if one was given), an ICP trigger anchored to a real, situational moment rather than an abstraction, the main objection in the founder's own words, a non-salesy reframe for it, a best proof point formatted with real numbers/names/quotes, three opening-line hooks, a channel-by-channel tone map, a CTA style, a voice style, an outreach persona, a list of phrases to avoid, a small story vault, and a three-step follow-up sequence. The prompt explicitly instructs the model to keep any number, name, quote, or timeframe the founder actually gave rather than generalizing it away.

### Editing and rebuilding
The voice profile can be edited field-by-field (deep-merged, arrays replaced rather than merged) or fully rebuilt from the original onboarding answers — useful after a pivot, without re-running the whole interview.

---

## 8. Opportunity Discovery

### Why it exists
Manually finding people expressing the exact problem a product solves is slow and doesn't scale with a founder's own time. Discovery automates the search, but is deliberately built to not waste external search calls on a profile that isn't developed enough to search on yet.

### The cost-aware router
Before spending a real search call, a cheap AI pass looks at the founder's product description length, target-audience specificity, and ICP trigger, and decides whether a live search is actually likely to find something real. If the profile is too thin, or the workspace's daily search quota is exhausted, the system generates realistic AI practice examples instead — explicitly flagged `is_example: true` and never mixed into real opportunity counts.

### Search and scoring
When a search runs, queries are built per preferred platform (Reddit, LinkedIn, X/Twitter, IndieHackers, Hacker News), each scoped to that platform's domain. Results are scored on fit, timing, and intent (1–10 each), and a message is drafted per qualifying opportunity — informed by the founder's own performance history (best platform, message style, and length, computed from real past outcomes), not a generic template.

### Manual creation and the pipeline
Opportunities can also be logged manually, with an optional initial stage. Every opportunity carries a generated `composite_score` (a Postgres computed column, the average of fit/timing/intent) so sorting the discovery feed never requires recalculating scores in application code.

---

## 9. Pipeline & Deal Tracking

### Why it exists
A discovered opportunity that turns into a real conversation needs a place to live that isn't a spreadsheet — stage, deal value, scheduled calls, and follow-up state, visible individually and, for teams, in aggregate.

### Stages and transitions
`new → contacted → replied → call_demo → closed_won → closed_lost`. Marking an opportunity's outcome as positive automatically advances its stage the first time (new → contacted, or contacted → replied); every stage change stamps `last_stage_changed_at`, which is what follow-up sequencing and staleness detection key off.

### Follow-ups
A follow-up message is generated with context on the stage, platform, and prior outreach, capped at two follow-ups per opportunity, spaced by a minimum resend interval. A dedicated unviewed-count endpoint and view-stamping keeps a lightweight "you have follow-ups to review" signal separate from the full follow-up list fetch.

### Deal value and assignment
Deal value is tracked via the `feedback` table's `deal_value_usd`, upserted independently of the outcome itself (a deal's dollar value can be logged before an outcome is known). On a team, managers can assign a deal to a specific rep, which triggers both a push notification and an email to the assignee.

---

## 10. Feedback & Conversation Analysis

### Why it exists
This is where a logged outcome becomes structured skill data instead of just a pipeline status change — the mechanism that makes the whole product adaptive rather than static.

### Scoring
Once a founder logs a final outcome, a background job scores the associated message across six axes (hook, clarity, value proposition, personalization, CTA, tone), each 0–10, with a rewritten example and 2–3 sentence diagnosis. The prompt explicitly asks the model to quote phrases from the actual message when explaining a score, rather than issuing a generic verdict.

### Objection classification
A negative outcome's note is run through a rule-based classifier (ghost, price, timing, trust, competition, fit — pattern-matched with both positive and negative signal phrases per category) and upserted into a per-founder objection tracker with an occurrence count. Once an objection recurs often enough, it becomes a candidate for a saved "best response," and — for paying tiers — for live market-intelligence enrichment on how to handle it.

### Weekly pattern detection
Once a founder has at least five analyzed messages in the last 60 days, a weekly job compares the stats of winning and losing messages (hook score, personalization score, word count, social-proof presence) and asks the model for 2–4 specific, confidence-scored patterns — each becomes both a stored `communication_pattern` row and a growth card, so the same insight is queryable later and also surfaces proactively.

---

## 11. Practice Mode — AI Roleplay

### Why it exists
Real prospects are not a safe place to fail. Practice mode exists to let a founder fail specifically and repeatedly, against something that behaves like a real, skeptical person rather than a scripted quiz.

### Starting a session
A scenario is either explicitly chosen or picked by a weighted random draw across six types (interested 25%, polite decline 25%, ghost 20%, skeptical 15%, price objection 10%, bad timing 5%). Difficulty is derived from the founder's own session history and reply rate (beginner → standard → advanced → expert), not user-selected. A generated buyer persona includes a name, role, current tools, a specific pain point, a specific skepticism, hidden motivations the founder has to draw out through discovery questions, and starting interest/trust scores intentionally kept low (20–45 / 10–30) — a buyer who hasn't heard a pitch yet doesn't start out excited. Optional pressure modifiers (a decision-maker watching, an aggressive buyer, a mentioned competitor, a compliance concern) further shift the starting state.

### Live conversation state
Every founder message shifts the buyer's interest, trust, and confusion scores, with a `state_delta` reasoning string explaining *why*. The full state history is retained per exchange, not just the current value, which is what later powers cross-session trajectory analysis (§17).

### The ghost scenario, done properly
A naive ghost scenario is just silence with no signal. Here, a message sent into a ghost scenario is evaluated by a live quality gate (specificity, value clarity, personalization, ask quality) that decides whether *this specific message* is strong enough to earn a reply from someone who had no intention of responding. If it clears the bar, the ghost breaks silence for one turn; if not, the founder gets a coaching tip explaining exactly why it didn't land, without the ghost ever replying.

### Debrief and analysis
A completed session produces a strength, an improvement, one coachable moment, a rewritten weakest message, and — when internal monologues were captured — a set of monologue insights tying a specific buyer thought to a specific founder line, with a coaching takeaway. Multi-axis scoring covers the same six real-outreach axes plus discovery, objection handling, brevity, CTA strength, and (when monologue data exists) monologue alignment. A retry of a prior session generates a structured diff: specific improvements, what's still weak, the single strongest new phrase, and an honest verdict on whether the retry was meaningfully better.

### Curriculum and progression
A weekly adaptive curriculum targets the founder's current weakest axis directly in session one, blends the two weakest axes in session two, and runs a full scenario in session three — each with a specific target score. Badges (first session, first rejection, ghostbuster, session-count milestones, price-objection handled, advanced-mode reached) track engagement without gamifying the coaching content itself.

---

## 12. Calendar & Meeting Intelligence

### Why it exists
A founder's real pipeline moves in meetings, not just messages — but AI prep and debrief generation aren't free, and not every meeting deserves the same depth. This feature is built around spending AI effort where a meeting's context actually justifies it.

### The cost gate
Before generating prep, a rule engine checks whether there's any attendee context at all (no attendee name or notes → skip, with a trivial non-AI placeholder so the UI never shows infinite loading), and whether the event type is low-stakes with no linked opportunity (skip). Research reuses any research already generated for the same prospect within the last 14 days rather than re-searching. Every gate decision is logged with a reason, so which meetings got full AI treatment — and why — is auditable later, not just asserted.

### Prep
When the gate proceeds, prep pulls together the prospect's recent interaction history, previously detected signals, any commitments the founder still owes them, live research (when fresh enough), and — if the meeting is tied to an opportunity — that opportunity's stage and deal value, into an opening line, 3–4 talking points, one key question to ask, an anticipated objection with a specific response, a short intelligence brief, a commitment reminder if one exists, a pre-meeting outreach message, and a follow-up template.

### Live meeting notes
A dedicated chat mode accepts fragmented notes typed during or right after a meeting and responds in one or two sentences — confirming capture, asking one smart follow-up question, or flagging something worth noting (a number, a competitor mention, a buying signal) — without ever lecturing. Saying "done" or "end" triggers a one-sentence outcome summary and closes the session.

### Debrief and extraction
Whether the input is typed notes, a live meeting-notes chat, or a transcribed voice memo, all three converge on the same extraction call: a structured debrief (summary, what worked, what to improve, one coachable moment, a next-step recommendation) plus commitments and signals pulled from the same text in a single AI call — a deliberate merge of what used to be two separate calls on the same input, since debrief submission is the single highest-frequency AI trigger in this feature.

### Follow-ups
Three variants are generated from the debrief, prior commitments, and detected signals: brief (a short check-in), substantive (delivers on a specific promise, references the conversation's strongest moment), and re-engagement (for a prospect who's gone quiet). All three are real drafts the founder picks from, not a single message they have to edit from scratch.

---

## 13. Voice Memos

### Why it exists
Typing notes immediately after a meeting is friction a founder often skips entirely. A voice memo removes that friction without creating a second, parallel AI pipeline.

### The pipeline
A memo (recorded in-app or uploaded as an existing file) is uploaded to Cloudinary, transcribed via a Groq Whisper-compatible endpoint, and the resulting transcript is fed into the exact same commitment/signal extraction and debrief generation used by typed notes. If the event doesn't already have a debrief, the voice-memo debrief becomes the event's debrief directly. Transcription and enrichment are two separate, individually retryable background jobs — a failed transcription doesn't lose an already-successful enrichment, and vice versa.

---

## 14. Prospects & Relationship Health

### Why it exists
An opportunity is a one-off outreach attempt; a prospect is an ongoing relationship that spans multiple meetings, chats, and signals over time. Treating them as the same entity would either lose the outreach-attempt-level detail or lose the relationship-level continuity — this product keeps both.

### Deduplication
Three layers, only two of which auto-merge (see `ARCHITECTURE.md` §7 for the mechanism): an exact email or LinkedIn URL match, or a normalized-name exact match, merge automatically. A trigram-similarity match on genuinely different-looking names is never auto-merged — it's written to a `prospect_merge_candidates` queue for an admin to confirm or dismiss, specifically because auto-merging on fuzzy name similarity risks combining two different real people who happen to share a name.

### Relationship health
A 0–100 score computed from the recency and outcome of the last interaction, the count of recent buying vs. risk signals, and the count of overdue commitments owed *to* the prospect by the founder. This isn't a static field — it's recomputed from source data every time it's requested, so it's never stale in a way that requires a separate cache-invalidation step.

### The AI summary
A short, honest narrative (not a report) synthesized from the prospect's full timeline — where the relationship actually stands, any notable pattern, and the founder's most important next move — regenerated on request or by a weekly job for prospects whose summary has gone stale.

---

## 15. Chat — the AI Coach

### Why it exists
Not every coaching interaction fits a structured feature. Chat is the general-purpose surface, with four specialized modes layered on top of one shared conversational engine.

### Modes
**General** — open-ended coaching. **Prep** — focused meeting preparation. **Follow-up coach** — refining a specific follow-up draft, explicitly instructed never to open with "just checking in." **Meeting notes** — the live capture mode described in §12.

### Context injection, refreshed every turn
Growth-card and opportunity context (when a chat is tied to either) is fetched fresh and prepended to the system prompt on every single turn, rather than injected once at chat creation and left to fall out of context after a few exchanges — a deliberate fix for a real failure mode where long-running context silently disappeared from what the model could see.

### Bounded token growth
The most recent 20 non-system messages replay raw. Once a chat crosses a message threshold since its last summarization, a background job folds everything older into a running `summary` field, prepended ahead of the live window on every subsequent turn — so a six-month-long coaching relationship doesn't cost six months of tokens on every message.

### Search and memory
An explicit "search the web" toggle runs an Exa search scoped by the workspace's daily quota, with citations persisted on the resulting message. A lightweight memory system separately extracts durable, specific facts about the founder from conversation history (a number, a name, a specific outcome) and surfaces the most relevant ones back into the system prompt on future turns.

---

## 16. Growth — Daily & Weekly Coaching

### Why it exists
A founder shouldn't have to go looking for coaching — it should show up, and it should be specific enough that it's obviously about *their* business, not a rotating tip library.

### Daily cards
Three distinct card types generated together each day — a quick actionable tip, a 24-hour challenge (skipped in favor of a second tip on a low-mood day), and a reflection prompt — each required to reference something concrete from the founder's actual situation: a real score, a real recent activity, a real goal.

### Mood-adaptive check-ins
A daily check-in asks up to three questions, generated from recent chat context and active goals rather than a fixed list. The response explicitly adapts to a reported mood: a low-mood day gets acknowledgment first and exactly one small, low-pressure action — never a task list; a high-mood day gets pushed toward a bolder move. A streak is computed from consecutive days with a completed check-in.

### Weekly plan
One sharp focus area for the week, not a generic checklist — reasoned from real performance data, active goals, and recent check-in signals, with five specific daily actions.

### Memory
Facts extracted from onboarding and later conversations are deduplicated against existing memory (skip, replace, or insert) rather than accumulating duplicates, capped per founder, with the lowest-priority fact evicted (by a blend of reinforcement count, recency, and source diversity) when the cap is hit.

---

## 17. Insights & Metrics

### Why it exists
Raw activity counts don't tell a founder what to do differently. This layer exists specifically for correlation and diagnosis — comparing two things against each other — rather than just listing numbers.

### Selected diagnostics
- **Why you're losing** — compares winning vs. losing message scores, top failure categories, and top objections into one prioritized diagnosis, cached for four hours (individual and, separately, team-wide for managers).
- **Skill trends** — week-over-week deltas per axis, with the biggest gain and biggest drop named explicitly.
- **Buyer-state trajectory** — aggregates interest/trust across up to 20 recent practice sessions by exchange index, computing the exchange where interest peaks and the exchange where it meaningfully drops off (a >15% decline from peak).
- **Practice ROI correlation** — compares real-world positive-outcome rate on weeks with at least one practice session against weeks with none, requiring at least three weeks in each bucket before claiming a lift percentage.
- **Meeting prep effectiveness** — prepped vs. unprepped meetings' positive-outcome rate, gated on at least three meetings in each group.
- **Mood-vs-performance correlation** — a real Pearson correlation between daily mood score and same-day positive reply rate, not just an eyeballed comparison.
- **Silent-risk detection** — opportunities that look healthy by "last stage change" alone but carry two or more negative signals (recent negative conversation signals, overdue founder commitments, a low relationship health score) underneath.

Every diagnostic explicitly declines to render (`has_data: false`) rather than guessing from too little data — the minimum-sample thresholds are stated in the response, not hidden.

---

## 18. Skill Progression

### Why it exists
"You're weak at discovery" needs to mean the same thing whether it showed up in a real message or a practice session — otherwise the two coaching surfaces contradict each other.

### The weekly blend
Real-outreach axis averages (hook, clarity, value prop, personalization, CTA, tone) and practice axis averages (clarity, value, discovery, objection handling, brevity, CTA, normalized from a 0–100 to a 0–10 scale) are blended per axis, and every available axis — not just the two that were blended in an earlier version of this logic — contributes to one composite score and one named weakest/strongest axis. A week's snapshot is a new row, never an update to last week's, so a delta computation is a two-row comparison rather than a reconstructed value.

---

## 19. Goals & Commitments

### Goals
A goal has free text, an optional target value/unit/date, and a running current value. Logging a note against a goal runs it through an AI coach that returns a short response, a progress delta, and — when the note suggests the founder is stuck — a flag to generate a supporting tip card. Hitting the target value marks the goal complete and writes a workspace activity event.

### Commitments
Distinct from a goal — a commitment is a specific, dated promise, either the founder's own (extracted from a meeting or chat) or one owed *to* the founder by a prospect. Overdue commitments the founder owes are what specifically lowers a prospect's relationship health score (§14) and drives the daily debrief digest notification.

---

## 20. Team Features

### Why it exists
A workspace with more than one seller needs the same visibility a sales manager gets from a real team — without requiring a manager to manually review every rep.

### Leaderboard
A single score blending outreach volume (15%), reply quality (30%), deals closed (20%), current skill level (20%), and active-goal completion (15%) — sourced from real pipeline, performance-profile, and skill-progression data, not a vanity metric.

### Coaching queue
Flags a rep automatically on any combination of: no outreach sent in 7 days, no practice in 7 days, a skill-score decline of more than 0.5 points week-over-week, a skill score under 5/10, or an average prospect relationship health under 40 — surfaced with the specific flags, not just a "needs attention" label.

### Objection divergence
Distinguishes a **team-wide** objection (70%+ of reps hitting the same objection type — likely a positioning problem, not a skill gap) from an **individual** one (exactly one rep hitting it repeatedly — worth a 1:1), computed from the same objection-tracker data every individual rep sees for themselves.

---

## 21. Notifications

In-app, push (Firebase), and email, gated per-user by a notification-preferences object covering roughly a dozen distinct notification types (new opportunities, feedback reminders, practice replies, calendar prep, daily tips, check-in prompts, debrief reminders, commitment reminders, weekly insights, pattern insights, skill progression, morning/evening growth nudges). Morning and evening push nudges are explicitly rate-limited (max 2/day, minimum 6-hour gap) and pick from a priority list — a detected pattern, a waiting tip, pending feedback, a streak, or a generic nudge — rather than sending everything that's technically eligible.

---

## 22. AI Provider Reliability

Every AI call in the product goes through one fallback layer spanning four chat providers (Cerebras, Groq, Mistral, OpenRouter), each with its own key pool, classified by real HTTP status rather than string-matched error text, so a provider-wide outage doesn't penalize a key that wasn't actually at fault. Full mechanism in `ARCHITECTURE.md` §8 — the product-level point worth making here is that this reliability layer is what makes every AI feature in this document behave consistently rather than randomly failing when one provider has a bad day.

---

## 23. Background Automation

A day of scheduled jobs, independent of any user action: memory extraction (every 30 min), opportunity discovery sweeps (every 6h), calendar reminder scans (every 5 min), daily performance summaries, metrics aggregation, tip generation, calendar prep sweeps, morning/evening growth nudges, goal nudges, follow-up generation, check-in scheduling, and — weekly — plan generation, email digests, pattern detection, skill progression snapshots, skill-profile aggregation, adaptive curriculum generation, and a prospect dedup scan. None of it requires a founder to open the app for the system to keep working on their behalf.

---

## 24. Business Rules Reference

**Ownership & data integrity**
- Prospect deduplication never auto-merges on fuzzy name similarity — only exact identifier or normalized-name matches merge automatically.
- A workspace's product/voice context lives on `workspace_profiles`, never on the global `users` row.
- An opportunity's composite score is a Postgres-generated column — never independently recalculated in application code.

**Practice rules**
- A ghost scenario only breaks silence if a live quality gate scores the message above threshold.
- Difficulty is derived from session history, never directly user-selected.
- A retry session is linked to its original via `retry_of_session_id`, enabling the structured diff.

**Calendar / AI cost rules**
- Prep is not generated for an event with no attendee context — a trivial placeholder is used instead.
- Research is reused, not regenerated, if the same prospect was researched within 14 days.
- Commitment/signal extraction is skipped on notes under 20 characters.

**Follow-up rules**
- Maximum two automated follow-ups per opportunity, spaced by a minimum resend interval.
- A follow-up's unviewed count and the full list are tracked independently.

**Notification rules**
- Morning/evening growth nudges: max 2 per day, minimum 6-hour gap between any two.
- Proxy/team notifications are gated per-recipient by their own notification preferences, not the sender's.

---

## 25. Complete End-to-End User Flows

### Flow: A founder joins and gets their first outreach

1. Sign up (email/password or Google) → a workspace and first `workspace_profile` row are created atomically.
2. Onboarding burst 1 → 2 → 3, each generated from the prior answers.
3. Voice profile synthesized and saved; archetype detection and memory seeding run in the background.
4. Opportunity discovery runs automatically post-onboarding; if the profile is thin, practice examples are shown instead, clearly labeled.
5. Founder reviews an opportunity, copies or sends the drafted message, marks it sent.

### Flow: Real outreach becomes a coaching signal

1. 48 hours after a message is marked sent, a reminder prompts the founder to log the outcome.
2. Outcome logged (positive/negative + note) → opportunity stage may auto-advance → performance stats increment.
3. A conversation-analysis job scores the message on six axes.
4. If negative, the note is classified into an objection type and the objection tracker's occurrence count increments.
5. Once enough analyzed messages exist, the weekly pattern job compares winners vs. losers and writes a growth card naming a specific, evidenced pattern.
6. That pattern's weakest axis feeds the next adaptive practice curriculum.

### Flow: A practice session, start to debrief

1. Scenario selected (or weighted-random), difficulty derived from history, buyer persona and pressure modifier generated.
2. Founder sends messages; each shifts the buyer's live interest/trust/confusion state, with the buyer's tone following that state.
3. Session completes (goal achieved, AI-determined natural end, or founder ends it manually).
4. Skill scores computed across six-plus axes; coaching annotations and a debrief generated in the background.
5. If the score was strong, a reusable playbook (opening message, discovery questions, objection responses) is generated a couple of hours later.
6. The weekly skill snapshot blends this session's scores with the founder's real-outreach scores into one trend.

### Flow: A meeting, prep to follow-up

1. Event created with attendee context → the AI cost gate decides whether prep is worth generating.
2. If it proceeds, prep pulls prospect history, signals, commitments, and research into one brief.
3. During or after the meeting, notes are captured live (chat mode) or recorded as a voice memo.
4. Voice memo path: uploaded → transcribed → the same extraction pipeline typed notes use runs on the transcript.
5. A structured debrief, commitments, and signals are extracted and persisted; the prospect's relationship health is recomputed.
6. Three follow-up variants are generated; the founder sends one.

### Flow: A team lead reviewing their team

1. Manager opens the team pipeline view — every rep's deals in one board, not just their own.
2. Leaderboard shows a blended score per rep; coaching queue flags reps by specific triggers (inactivity, declining skill, cold relationships).
3. Objection divergence report distinguishes a shared team problem from one rep's individual gap.
4. Manager nudges a specific rep directly, or reassigns a deal — both logged to the workspace activity feed.

---

## 26. Feature Relationships — How It All Connects

**Onboarding → Voice Profile → everything AI-generated downstream.** No other feature generates outreach, buyer personas, or coaching content from a generic template — all of it traces back to the same synthesized profile.

**Feedback → Conversation Analysis → Objection Tracking → Pattern Detection → Growth Cards → Practice Curriculum.** This is the core loop described in the executive summary, made concrete: one logged outcome eventually shapes what a founder practices weeks later.

**Practice Scoring ↔ Real-Outreach Scoring → Skill Progression.** The two scoring systems are independent inputs to one blended weekly trend specifically because they share a rubric — without the shared rubric, blending them would be meaningless.

**Calendar Debrief (any input) → Commitments & Signals → Relationship Health → Team Coaching Queue.** An overdue commitment doesn't just sit on a list — it lowers a prospect's health score, which can surface a rep in a manager's coaching queue if enough of their relationships show the same pattern.

**AI Cost Gates (calendar, discovery) → Growth Cards / Market Intelligence.** Nothing in the AI-heavy surfaces of this product runs unconditionally — every one of them is preceded by a cheap check that can redirect to a cached result, a cheaper fallback, or a skip.

**Provider Fallback Layer → every AI feature in this document.** Every single AI call named above — scoring, buyer replies, prep, debriefs, growth cards — routes through the same fallback chain, which is why a single provider outage degrades none of them.

---

## 27. System Lifecycle — A Day in the Life of the Backend

- **Every 30 min** — memory extraction scans chats that have grown enough to be worth extracting new founder facts from.
- **Every 6h** — opportunity discovery runs for eligible workspaces, cost-gated per workspace.
- **Every 5 min** — calendar reminder scan flags meetings starting soon.
- **07:00** — daily tip generation and calendar prep sweep.
- **08:00** — calendar debrief/commitment digest push.
- **09:00** — morning growth push (rate-limited, priority-ordered).
- **09:05** — goal nudges for stale or approaching-deadline goals.
- **10:00** — follow-up sequence check.
- **14:00** — check-in scheduling.
- **18:00** — evening growth push.
- **Sunday 18:00–23:00** — weekly plan generation, email digests, pattern detection, skill progression, skill-profile aggregation, adaptive curriculum generation, in sequence.
- **Monday 03:00** — workspace-wide prospect dedup scan.
- **Continuously, queue-driven** — message scoring, coaching annotations, playbook generation, voice memo transcription/enrichment, all triggered by user actions rather than a schedule.

None of it requires a founder to be actively using the app for the system to keep working on their behalf.

---

## 28. Product Strengths

- **The shared-rubric design is a genuinely structural decision, not a coincidence.** Scoring real outreach and practice sessions on the same axes is what makes the whole "practice feeds real improvement" claim actually mechanically true, rather than a marketing line over two unrelated features.
- **AI spend is gated, not assumed.** Discovery, calendar prep, and research all check whether generation is worth it before spending a call — a design choice that shows up as better unit economics, not just a nice-to-have.
- **The ghost scenario is a real design decision, not a shortcut.** Gating ghost-breaking on live message quality, rather than a fixed reply probability, is what makes practicing against silence actually teach something.
- **Fuzzy matching stops exactly where it should.** Auto-merging two prospects who happen to share a name is a real failure mode most systems don't bother guarding against; this one deliberately routes that specific case to a human.
- **Diagnostics state their own confidence thresholds.** Every correlation/trend endpoint declines to answer with too little data rather than presenting a low-sample coincidence as a real pattern.

---

## 29. Known Limitations & Roadmap

- **No automated test suite yet.** The system hasn't been through a production deployment cycle; the data model and job architecture are stable, but test coverage is a known next investment rather than an oversight.
- **Search coverage is fixed to five platforms** (Reddit, LinkedIn, X, IndieHackers, Hacker News) — extending discovery to additional platforms is a natural, additive change given the existing per-platform query builder.
- **Team features assume a Postgres-computed leaderboard score weighting** that isn't currently configurable per workspace — a natural next step for teams with different sales motions.
- **Market-intelligence enrichment is tier-gated** (pro/enterprise) rather than universally available, reflecting real external search-API cost, not a technical limitation.

---

## 30. Appendix — Glossary & Terminology

| Term | Meaning |
|---|---|
| **Workspace** | A founder's or team's tenant space; the top-level organizational unit. |
| **Workspace Profile** | Product/audience/voice context for one person within one specific workspace. |
| **Voice Profile** | The synthesized output of onboarding — value prop, ICP trigger, objection reframe, hooks, avoid-phrases, story vault. |
| **Opportunity** | A discovered or logged prospect moving through the pipeline. |
| **Feedback** | The logged outcome of sending an opportunity's message. |
| **Conversation Analysis** | The six-axis AI score of one specific outreach message. |
| **Practice Session** | A roleplay conversation against a generated AI buyer, scored on the shared rubric. |
| **Buyer State** | The live interest/trust/confusion tracking during a practice session. |
| **Ghost (scenario)** | A practice scenario where the buyer stays silent unless a live quality gate is cleared. |
| **Growth Card** | A generated, dismissible coaching nudge — tip, challenge, reflection, or detected pattern. |
| **Objection Tracker** | Per-founder counts and best-response tracking for classified objection types. |
| **Prospect** | An ongoing relationship, distinct from a one-off opportunity, with its own timeline and health score. |
| **Relationship Health Score** | A 0–100 score recomputed from recent outcomes, signals, and overdue commitments. |
| **Commitment** | A specific, dated promise — the founder's own, or one owed to them — extracted from a meeting, chat, or voice memo. |
| **Signal** | A detected buying, risk, timing, or engagement indicator from a conversation or meeting. |
| **Skill Progression** | The weekly blend of real-outreach and practice scores into one composite trend. |
| **Playbook** | A reusable opening message, discovery questions, and objection responses generated after a strong practice session. |
| **AI Cost Gate** | A rule engine deciding whether a given AI generation is worth the spend before running it. |

---

*End of PRODUCT_OVERVIEW.md*
