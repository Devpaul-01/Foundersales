# FounderSales

[![Backend Unit Tests](https://github.com/Devpaul-01/Foundersales/actions/workflows/tests.yml/badge.svg)](https://github.com/Devpaul-01/Foundersales/actions/workflows/tests.yml)

An AI sales coaching and outreach platform for founders, freelancers, and early-stage sellers — people who have something worth selling but haven't necessarily done outbound sales before.

This is a monorepo with two apps:

- **`backend/`** — Node.js/Express API and background job system (Supabase, Redis, BullMQ, AI calls routed through a self-hosted multi-provider LLM gateway)
- **`frontend/`** — the client the screenshots in this repo come from. Its source isn't part of this documentation pass; everything here about the frontend is inferred from the backend API surface and the app's own UI.

**Status: actively under development.** This is a solo project I'm building toward a real product, not a finished SaaS. Large parts of the backend are genuinely solid — the AI gateway client, the background job system, the calendar cost-gating — and some parts are still rough edges or half-wired (see [Known Gaps](#known-gaps--in-progress-work) below). I'd rather show you both than pretend otherwise.

**This is planned as a startup, not just a portfolio project.** I'm actively open to collaborating with other developers, and I'm open to a cofounder if the fit is right. If you're interested in either, reach out.

## Why I Built This

Most sales tools assume you already know how to sell and just need somewhere to log activity. That doesn't hold for a founder doing cold outreach for the first time — they don't know what a good message sounds like, and they have no one to rehearse a hard conversation against before having it for real.

The premise here: everything the platform generates for a user should come from the *same* understanding of who they are and what they're selling, and that understanding should get sharper the longer they use it. A voice profile built during onboarding feeds opportunity scoring, outreach drafting, the personality of the simulated buyer in practice mode, and calendar meeting prep — not four separate AI features that happen to share a login.

I used this project to go deep on the parts of shipping an AI product that don't show up in a "call an LLM API" tutorial: AI calls routed through a self-built, self-hosted multi-provider gateway ([llm-gateway](https://github.com/Devpaul-01/llm-gateway)) with structured error classification and a Redis-coordinated cooldown on the gateway key, a cost-gating layer that decides whether an AI call is worth making *before* making it, a single-request buyer simulation that bundles reply generation, a private internal monologue, and outcome detection into one model call instead of four, and a background-job system with real idempotency guarantees. It's also where I've tried to document real trade-offs and known gaps honestly rather than pretend the system has none — see [ARCHITECTURE.md §13](ARCHITECTURE.md#13-known-gaps--engineering-trade-offs).

## What It Does

**Onboarding that builds a real voice profile.** A guided wizard — basic info, then three AI-generated question bursts, then a live preview of the outreach message the resulting profile produces — synthesizes a structured voice profile (differentiator, ICP trigger, objection handling, opening hooks, a personalized avoid-phrase list) that every other AI feature reads from.

**Opportunity discovery with drafted outreach attached.** Finds real conversations online matching a user's product (Exa neural search, gated by an AI router that decides whether a search is worth the cost first), scores them, and drafts a message for every qualifying result — checked against the user's own avoid-phrase list, with a one-shot regeneration if a violation slips through.

**Practice mode with a buyer who has a private opinion.** A simulated buyer persona with hidden motivations the user has to discover through questioning, scored across skill axes, with a state that shifts turn-by-turn. Every reply is one bundled AI call returning the reply text, the buyer's real internal monologue (which can contradict what they actually said), a conversation-outcome classification, and inline coaching — not four sequential calls.

**Calendar intelligence that gates its own AI spend.** Meeting prep, prospect research (reused across meetings with the same prospect within a 14-day window), live meeting-notes capture, voice-memo transcription, and post-meeting debriefs that extract commitments and signals from one AI call instead of two. Every trigger point passes through a cost gate that logs its own proceed/skip decisions to an audit table.

**Coaching driven by blended real + simulated data.** A weekly job reconciles skill scores from real sent-message analysis (0–10 scale) with practice-session scores (0–100 scale, normalized down) onto one comparable trend line, feeding weakness detection, an adaptive drill curriculum, and a fairly deep analytics surface — correlation and trend detection, pipeline-risk flagging, team-level coaching queues.

**A manager/team layer** — leaderboard, a coaching queue that flags reps hitting risk signals, team pipeline and opportunity views, team-wide loss-reason analysis, and a week-over-week team skill-velocity number.

See [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md) for a full feature-by-feature tour with screenshots.

## Engineering Highlights

**AI calls go through one self-hosted gateway, not a hand-rolled failover engine inside the product.** Every AI chat call is a single OpenAI-compatible request to [llm-gateway](https://github.com/Devpaul-01/llm-gateway), my own Go service that fronts many providers. FounderSales sends a primary model plus a `fallback_models` chain and one gateway key; provider selection, upstream key rotation and model failover happen inside the gateway. This used to live in this repo as a four-provider chain (Cerebras → Groq → Mistral → OpenRouter) with per-provider key pools and a model-discovery cache — infrastructure that doesn't belong in a product's request path, so it moved out. What stayed is the part only the caller can know: failures from the gateway are still classified by *structured status code and parsed error body*, not string-matched — a plain 429 or 401/403 cools the gateway key; a 429 whose `error.code` is `daily_token_budget_exceeded` or `too_many_concurrent_requests` is a capacity signal, not a bad key, so it does **not** cool it; a 5xx or network error is transient; anything else is presumed to be a request-construction bug and is reported to Sentry.

**Cross-instance coordination via Redis, with a documented rollback switch.** Gateway-key cooldown state and rate-limit counters are Redis-shared so a horizontally-scaled deployment behaves correctly — one instance discovering a bad key means every instance knows immediately. Every one of these systems has a working in-memory fallback and a single environment-variable kill switch to revert to it without a deploy.

**A cost gate that runs before the AI call, not after.** `calendarAiGate.js` decides — cooldown reuse, low-stakes skip, quota-aware degradation — whether a calendar AI call is worth making, and logs every decision to an audit table (`calendar_ai_events`). That makes "cost was optimized here" a checkable query, not a claim.

**Real background-job idempotency, matched per job to its own write shape.** Stable BullMQ job IDs for most durable work; an atomic conditional `UPDATE ... WHERE flag = false` for the calendar reminder scan; upserts on composite conflict keys for weekly aggregates; a database re-check before spending an AI call on calendar prep, specifically because BullMQ's job-ID dedup only protects against duplicate *enqueues*, not two different job IDs racing to do the same work.

**Deterministic scoring where it belongs, AI where it doesn't.** Relationship health is plain arithmetic (recency, outcome, signal counts, clamped 0–100) so it stays explainable. Objection classification on short feedback notes uses regex pattern matching, not a second model call, because a full AI call for a two-sentence note isn't worth the cost or the latency.

**A documented, real known gap.** A self-enqueued weekly job (`pattern_insights`) currently has no registered handler and fails every run — left as a deliberately scoped, honestly documented issue rather than silently patched over. See [Known Gaps](#known-gaps--in-progress-work).

## Architecture

The API follows a layered **routes → middleware → services → Supabase** structure. Route handlers are thin — parse the request, call a service, shape the response. Business logic, AI orchestration, and database access live in `services/`, written to accept plain parameters rather than Express `req`/`res`, so the same functions are callable from an HTTP route or a background worker.

```mermaid
flowchart LR
    Client[Frontend SPA] -->|HTTPS| API[Express API]

    subgraph API_Process [API Process]
        MW[Middleware<br/>auth · rate limit · workspace] --> R[Routes]
        R --> SVC[Services]
    end

    SVC --> PG[(Supabase Postgres)]
    SVC --> REDIS[(Redis)]
    SVC -->|enqueue| BULLMQ[BullMQ Queues]
    SVC -->|OpenAI-compatible API| AI[llm-gateway<br/>self-hosted · multi-provider]
    SVC --> EXA[Exa Search]

    subgraph Workers [Background Workers]
        BULLMQ --> W1[Scheduled Worker<br/>21 cron jobs]
        BULLMQ --> W2[Practice Worker<br/>event-driven]
        BULLMQ --> W3[Background Worker<br/>durable fire-and-forget]
    end

    W1 & W2 & W3 -->|OpenAI-compatible API| AI
    W1 --> RESEND[Resend / SMTP]
    W2 & W3 --> FCM[Firebase Cloud Messaging]
```

The backend can run as a single combined process (`src/app.js` — starts the HTTP server and all three background workers in-process, the default in `package.json`'s `start`/`dev` scripts) or as **two independent processes** — `src/server.js` (API only) and `src/workers/index.js` (scheduler + all three workers, no HTTP server) — decoupling request-handling capacity from background-job throughput. Both entry points exist and are fully wired; the combined process remains the default way the app actually gets started.

Full request-lifecycle diagrams, the AI provider architecture, the data model, and every documented trade-off are in [ARCHITECTURE.md](ARCHITECTURE.md). Every queue, job, retry policy, and idempotency mechanism is in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).

### Domain Model

```
Workspace (a tenant — a company, or a personal sales practice)
 ├─ Workspace Profile (AI-synthesized voice/product/audience — one per user per workspace)
 ├─ Opportunities (discovered, scored, drafted outreach attached)
 │   └─ Pipeline (stage progression → feedback → conversation analysis)
 ├─ Practice Sessions (buyer persona, scored, feeds skill progression)
 ├─ Prospects (deduplicated real people)
 │   └─ Calendar Events (prep, debriefs, voice memos, commitments, signals)
 ├─ Growth Cards (tips, plans, detected patterns, weakness alerts)
 └─ Chats (AI coach, meeting-notes mode, growth-card discussion)
```

## Background Jobs

Three BullMQ queues, each shaped for a different kind of "not right now" work:

| Queue | Concurrency | Handles |
|---|---|---|
| `scheduled-jobs` | 1 | 21 cron-driven jobs — daily tips, weekly pattern detection, nightly metrics, calendar sweeps |
| `practice-jobs` | 10 | Post-session scoring, coaching annotations, playbook generation, real conversation analysis |
| `background` | 5 | Calendar prep/research/extraction, voice memo transcription, chat summarization, prospect dedup |

Full detail — trigger, idempotency mechanism, retry policy, and the one job currently failing every run — in [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).

## Backend Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, Express 4, ESM (`"type": "module"`) |
| Database | Supabase (managed Postgres), via `@supabase/supabase-js` |
| Auth | Supabase Auth (email/password + Google OAuth), JWT bearer tokens |
| Cache / coordination | Redis (`ioredis` for BullMQ, `redis` for caching/locks/coordination) |
| Background jobs | BullMQ (3 queues, 3 workers), `rate-limit-redis` |
| AI | Self-hosted [llm-gateway](https://github.com/Devpaul-01/llm-gateway) (OpenAI-compatible, multi-provider, own repo) for all chat/generation calls; Groq Whisper, called directly, for voice-memo transcription |
| Web search | Exa (neural search), with an AI router deciding when it's worth the cost, quota-aware AI-generated fallback |
| File storage | Cloudinary (images, PDFs, audio) |
| Validation | Zod |
| Push notifications | Firebase Admin SDK (FCM) |
| Transactional email | Resend, with SMTP (nodemailer) and console-log fallback |
| Security middleware | Helmet, CORS, `express-rate-limit` |
| Error tracking (optional) | Sentry (`@sentry/node`) |
| Queue monitoring (optional) | Bull Board, gated behind a shared-secret header + rate limiter |
| Testing | Vitest — unit tests on the pure/extractable logic (pagination, error classification, momentum scoring, workspace-profile array resolution) |

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A Supabase project (Postgres + Auth)
- A Redis instance
- A running [llm-gateway](https://github.com/Devpaul-01/llm-gateway) instance and a project key for it (every AI chat feature depends on it)
- A Groq API key (still called directly for voice-memo transcription)

### Installation

```bash
git clone https://github.com/Devpaul-01/Foundersales.git
cd Foundersales/backend
npm install
cp .env.example .env   # if present — otherwise see Configuration below
```

### Running

```bash
npm run dev      # combined process, nodemon
npm start        # combined process, node

# or as two independent processes:
node src/server.js          # API only
node src/workers/index.js   # scheduler + all 3 workers only
```

`GET /health` reports basic process status and is suitable for a load-balancer health check.

### Configuration

Required at startup (the process exits immediately with a clear per-variable message if any are missing): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GATEWAY_API_KEY` (AI chat, via llm-gateway), `GROQ_API_KEY` (voice-memo transcription only), `ADMIN_SECRET`. See `backend/.env.example` for every variable the app reads, required and optional.

Optional, feature-gating (the app boots without these, with a startup warning, and the corresponding feature degrades): `REDIS_URL` (workspace/profile caching and all background job processing are skipped without it), `EXA_API_KEY` (opportunity discovery falls back to an AI-generated practice-example mode), `FIREBASE_SERVICE_ACCOUNT`, `FRONTEND_URL`, gateway overrides (`GATEWAY_BASE_URL`, `GATEWAY_TEXT_MODEL`, `GATEWAY_TEXT_FALLBACK_MODELS`, `GATEWAY_VISION_MODEL`, `GATEWAY_VISION_FALLBACK_MODELS` — defaults are built in, but set `GATEWAY_BASE_URL` to your own deployment), `SENTRY_DSN`, `RESEND_API_KEY`/SMTP variables.

The database schema is a single `schema.sql` file applied directly to the target Supabase project — it also defines every atomic Postgres RPC the app relies on. See [ARCHITECTURE.md §5](ARCHITECTURE.md#5-data-architecture) for the RPC list and what each one prevents.

**Prerequisite not covered by `schema.sql` itself:** `pg_dump` (what produced this file) doesn't include `CREATE EXTENSION` statements — extension management is handled separately, e.g. via the Supabase dashboard. This project's trigram-search indexes are schema-qualified to `public.gin_trgm_ops`, meaning `pg_trgm` needs to be enabled in the `public` schema specifically (not Supabase's more common `extensions` schema default) before applying `schema.sql` — either via the dashboard's Database → Extensions page, or `CREATE EXTENSION pg_trgm WITH SCHEMA public;` run first. Confirmed by actually applying this file against a real, empty Postgres database: it fails with `operator class "public.gin_trgm_ops" does not exist for access method "gin"` without this.

## Known Gaps & In-Progress Work

This is a solo project, still moving. Some things worth being upfront about:

- **`pattern_insights`, a self-enqueued weekly job, currently has no registered handler** and fails every run. Scoped and understood — see [BACKGROUND_JOBS.md §4.3](BACKGROUND_JOBS.md#43-known-gap-pattern_insights) — just not fixed yet, because the fix requires deciding between two wiring approaches rather than guessing.
- **Service-role Postgres access, not Row-Level Security, is the actual authorization boundary.** Correct as long as the middleware chain (auth → workspace membership → rate limit) is never bypassed, with no independent database-layer backstop today.
- **Public booking pages exist at the schema level** (`booking_pages`, `availability_windows`) **but aren't wired to any route.** Planned, not shipped.
- **No billing or subscription system.** No payment provider integration, no plan/tier enforcement beyond a few hardcoded tier checks, no subscription state in the schema. This is a solo project, not a business yet.
- **Frontend source isn't part of this documentation pass.** The screenshots throughout this repo's docs reflect a real, working client; its internal architecture isn't traced here.
- **Two Groq paths remain outside the gateway.** Voice-memo transcription (`services/transcription.js`) still calls Groq Whisper directly with its own key pool, because the gateway doesn't expose an audio endpoint. Separately, `services/groq-client.js` (a legacy direct-to-Groq chat client re-exported through the `groq.js` barrel) is no longer called by any route or job — every live chat path goes through `multiProvider.js` and the gateway — but it hasn't been deleted yet.
- **Dead code kept intentionally, not cleaned up yet:** two practice-reply job handlers (`PRACTICE_REPLY`, `PRACTICE_GHOST`) remain registered in the worker even though nothing enqueues them anymore — the synchronous V3 reply path replaced them and the old handlers were kept as a fallback rather than deleted.

I'd rather list these than have someone find them first.

## License

[MIT](LICENSE)
