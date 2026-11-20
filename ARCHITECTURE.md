# Architecture

**Scope:** the `src/` backend service — API, services, background workers, and the AI infrastructure underneath all of it. Frontend source isn't part of this document; where the frontend is mentioned, it's inferred from the API surface it must be calling, not from its own code.

---

## 1. Overview

FounderSales is a multi-tenant sales coaching and outreach platform. A single Node.js/Express service (ESM, `"type": "module"`) backed by Supabase Postgres and Redis, following a layered structure — routes → middleware → services → Supabase — with business logic living in `services/`, written to accept plain parameters rather than Express `req`/`res` objects specifically so the same functions are callable from an HTTP route or a background worker without duplication.

```mermaid
flowchart TB
    subgraph Client["Client"]
        FE["Frontend SPA"]
    end

    subgraph API["API Process"]
        EX["Express App"]
    end

    subgraph Workers["Background Processing"]
        W1["scheduledWorker.js\n(cron-driven, concurrency 1)"]
        W2["practiceWorker.js\n(event-driven, concurrency 10)"]
        W3["backgroundWorker.js\n(durable fire-and-forget, concurrency 5)"]
        SCHED["registerSchedules.js"]
    end

    subgraph Data["Data & Infra"]
        PG[("Postgres\nvia Supabase")]
        REDIS[("Redis")]
        CLOUD[("Cloudinary\nfile storage")]
    end

    subgraph AI["AI Layer"]
        GW["llm-gateway\nself-hosted, OpenAI-compatible"]
        GQ["Groq Whisper\nvoice-memo transcription"]
    end

    subgraph Ext["External Services"]
        EXA["Exa — web search"]
        FCM["Firebase Cloud Messaging"]
        RESEND["Resend / SMTP — email"]
        SENTRY["Sentry"]
    end

    FE -->|HTTPS / JSON| EX
    EX -->|supabase-js| PG
    EX -->|ioredis / redis| REDIS
    EX -->|uploads| CLOUD
    EX -->|enqueue| REDIS
    EX -->|search| EXA
    EX -->|chat completions| GW

    REDIS -->|BullMQ jobs| W1 & W2 & W3
    SCHED -->|repeatable jobs| REDIS

    W1 & W2 & W3 --> PG
    W1 & W2 & W3 -->|chat completions| GW
    W1 & W2 & W3 -->|transcription| GQ
    W2 & W3 --> FCM
    W1 --> RESEND
    EX & W1 & W2 & W3 -.->|error tracking| SENTRY
```

**Why this shape, not microservices:** the domain — a person's product context, outreach history, practice performance, calendar — is a small number of tightly related entities with cross-cutting AI concerns (a voice profile informs message generation, practice scoring, *and* calendar prep) that are cheaper to share as one process's library code than to split across service boundaries. The one place the system genuinely decomposes is synchronous request handling vs. asynchronous background work — a real scaling axis, covered in §11.

---

## 2. Architectural Principles

1. **Thin routes, fat services.** Route handlers parse the request, call one or more service functions, and shape the response. Business logic — Supabase queries, RPC calls, AI orchestration, notification dispatch — lives in `services/`.
2. **One shared implementation per concern.** Calendar prep generation used to exist in three separate places (inline in a route, re-implemented in the background worker, and a third helper nobody actually called) and now exists in exactly one function (`services/calendarPrep.js`) used by every trigger path. `utils/pagination.js`, `utils/parser.js`, and the shared logger factory (`utils/logger.js`) follow the same pattern.
3. **Workspace-scoped, not user-scoped, data.** Every AI-relevant table (`workspace_profiles`, `practice_sessions`, `conversation_analyses`, `skill_progression`, `communication_patterns`) is keyed by `(workspace_id, user_id)`, not `user_id` alone, because one person can belong to multiple workspaces with legitimately different voice profiles and practice history in each. This wasn't the original design — comments throughout the job files document a migration where `workspace_profiles!inner` joins started returning arrays from Supabase's client, and the fix in every case was finding the array element matching `active_workspace_id` rather than trusting index 0.
4. **AI cost is a design constraint, not an afterthought.** `services/calendarAiGate.js` exists solely to decide whether an AI call is worth making *before* making it, with every decision logged to `calendar_ai_events` so the impact is queryable. See §6.
5. **Structured error classification over string matching.** `utils/providerErrors.js` replaced substring-matching a formatted error message (`err.message.includes('429')`) with a typed `ProviderCallError` carrying the real HTTP status, network error code, and parsed response body — a substring match on "500" can't distinguish an actual HTTP 500 from a token count that happens to contain those digits.
6. **Redis state is shared across instances by design, with an explicit kill switch.** The AI gateway-key cooldown and rate-limit counters are Redis-backed so a horizontally-scaled deployment behaves correctly. Every one of these has a documented in-memory fallback and an environment-variable kill switch (`MULTIPROVIDER_REDIS_STATE_ENABLED`) to revert without a deploy.

---

## 3. Request Lifecycle

```mermaid
flowchart TB
    START([Incoming HTTP request]) --> COOKIE[cookieParser]
    COOKIE --> HELMET["helmet — security headers"]
    HELMET --> CORS["cors — explicit origin allowlist"]
    CORS --> MORGAN[morgan request logging]
    MORGAN --> BODY["express.json — 2mb limit"]
    BODY --> TRACE["traceId — attach X-Trace-Id"]
    TRACE --> ROUTE{Route match}

    ROUTE -->|"/api/auth/*"| AUTHLIM["authLimiter — IP-keyed"]
    ROUTE -->|"most other routes"| AUTHMW["authenticate —\nverify Supabase JWT,\nRedis-cached profile (30s)"]
    AUTHMW --> WSMW["resolveWorkspace —\nverify active membership,\nRedis-cached context (30s)"]
    WSMW --> ROUTELIM["Route-specific limiter\n(19 total, one per router-cost-profile)"]
    ROUTELIM --> HANDLER["Route handler:\nvalidate → call service(s) →\nshape response"]
    HANDLER --> SERVICE["Service layer:\nSupabase queries, RPC calls,\nAI orchestration"]
    SERVICE --> RESPOND[Response sent]

    HANDLER -.->|thrown error| ERRHANDLER[errorHandler middleware]
    SERVICE -.->|thrown error| ERRHANDLER
    AUTHMW -.->|401| ERRHANDLER
    WSMW -.->|403| ERRHANDLER
    ERRHANDLER --> RESPOND
```

### Authentication

`authenticate` (`middleware/auth.js`) verifies a Supabase JWT via `supabaseAdmin.auth.getUser(token)` and attaches `req.user` — identity and device fields only (name, email, tier, FCM token, notification preferences). Product/business context deliberately does not live on `req.user`; it's fetched separately by workspace resolution, because a user's voice profile is workspace-specific, not global. The profile fetch is Redis-cached 30s per user. The raw JWT is never attached to `req.user`, even post-verification — no legitimate downstream use for it, and keeping it off the request object closes off any risk of it leaking into a log line or error response by accident.

### Workspace resolution

`resolveWorkspace` (`middleware/workspace.js`) verifies the caller is an active member of `req.user.active_workspace_id`, fetching workspace, membership, and workspace-profile rows in parallel and caching the combined result 30s (`ws:ctx:{userId}:{workspaceId}`). Every route mounted behind the `...ws` spread in `app.js` gets this. The 30-second window is an explicit, bounded staleness trade-off against removing two-to-three Postgres round-trips from the single most frequently executed check in the API — a role change made through the app takes effect immediately for the device that made it, but can take up to 30 seconds to propagate to a different session (workspace switches and role changes explicitly invalidate the cache for the affected user, so this window only matters for *other* concurrent sessions).

### Rate limiting

Every limiter is defined once in `config/limiters.js` via a `buildLimiter()` factory that **requires** an explicit, unique Redis namespace — there is no default namespace available from that factory. This is a direct fix for a real bug: several limiters previously called `createRateLimitStore()` with no argument, silently defaulting to a shared `'default'` Redis key space and, in a few cases, genuinely merging counters across unrelated routes (an onboarding burst and a goals check-in decrementing the same Redis counter). Nineteen distinct limiters exist today, each sized to its own actual cost profile — a chat message (40/min, every message triggers an AI call) is a fundamentally different cost than a pipeline stage-drag (120/min, cheap DB writes, no AI at all).

---

## 4. Backend Structure

### Routes and services

Route files live in `routes/`, one per domain (`opportunities.js`, `practice.js`, `calendar.js`, etc.), mounted in `app.js` behind the `authenticate` + `resolveWorkspace` middleware pair (aliased `...ws`) except for auth routes themselves. Business logic lives in `services/` — AI orchestration (`groq-*.js` split by concern, `multiProvider.js` — the llm-gateway client, `exa.js`), calendar intelligence (`calendarPrep.js`, `calendarAiGate.js`, `calendarCommitmentsSignals.js`, `groqCalendarIntelligence.js`, `exaCalendar.js`), prospect dedup (`prospectDedup.js`), notifications (`notifications.js`), file storage (`storage.js`, `voiceMemoService.js`), and infra (`redis.js`, `providerCooldown.js`, `tokenTracker.js`).

### Validation

Zod schemas in `validators/` (or inline in the route file for smaller routers), applied via a `validate(schema, source)` middleware that returns structured field errors on failure.

### Middleware chain

`middleware/` holds `auth.js`, `workspace.js`, `errorHandler.js` (distinguishes DB errors, `AppError` instances with a `statusCode`, and unhandled errors — each gets a distinct response shape), and `traceId.js` (attaches an `X-Trace-Id` header, honoring an incoming header from an upstream load balancer if present, for correlating log lines across a single request).

---

## 5. Data Architecture

### Access pattern

The backend uses Supabase's Postgres exclusively through the `supabase-js` query builder via the **service-role client**, which bypasses Row-Level Security entirely. Authorization is enforced by the middleware chain (§3), not by RLS policies. This is a real, deliberate trade-off: correct as long as the service-role key stays server-side and the middleware chain is never bypassed, with **no independent database-layer backstop today**. See §13 for this listed explicitly as a known trade-off, not a hidden one.

### Core schema shape

```mermaid
erDiagram
    USERS ||--o{ WORKSPACE_MEMBERS : "belongs to"
    WORKSPACES ||--o{ WORKSPACE_MEMBERS : has
    WORKSPACES ||--o{ WORKSPACE_PROFILES : "one profile per member per workspace"
    WORKSPACES ||--o{ OPPORTUNITIES : contains
    WORKSPACES ||--o{ PROSPECTS : contains
    WORKSPACES ||--o{ PRACTICE_SESSIONS : contains
    WORKSPACES ||--o{ CHATS : contains
    OPPORTUNITIES ||--o{ FEEDBACK : "outcome logged as"
    FEEDBACK ||--o| CONVERSATION_ANALYSES : "triggers AI scoring"
    PROSPECTS ||--o{ USER_EVENTS : "meetings with"
    USER_EVENTS ||--o{ CONVERSATION_COMMITMENTS : yields
    USER_EVENTS ||--o{ CONVERSATION_SIGNALS : yields
    USER_EVENTS ||--o{ VOICE_MEMOS : "may have"
    PRACTICE_SESSIONS ||--o{ PRACTICE_BADGES : earns
    CHATS ||--o{ CHAT_MESSAGES : contains
    WORKSPACES ||--o{ SKILL_PROGRESSION : "weekly snapshots"
    WORKSPACES ||--o{ AI_USAGE_EVENTS : "append-only log"
    AI_USAGE_EVENTS }o--|| WORKSPACE_AI_USAGE_DAILY : "rolled up into"
```

### Atomicity via Postgres RPCs

Every genuine race-condition boundary is pushed into a Postgres stored procedure rather than emulated with sequential JS calls:

| RPC | Called from | Prevents |
|---|---|---|
| `create_workspace_for_user` | `workspaces.js`, `auth.js` registration | A workspace existing with no owning member row, or vice versa |
| `accept_workspace_invite` | `user.js` invite acceptance | Two simultaneous accept attempts both succeeding |
| `transfer_workspace_ownership` | `workspaces.js` | Ownership existing on two members simultaneously, or on neither, mid-transfer |
| `increment_chat_stats` | Every chat message insert path | Lost updates to `message_count`/`last_message_at` under concurrent writes |
| `increment_performance_stats` | `feedback.js` | Lost updates to send/positive/negative counters |
| `increment_goal_progress` | `goals.js` note submission | Lost updates to a goal's current value |
| `record_ai_usage` | `tokenTracker.js`, every AI-call site with workspace context | A usage event logged without its daily rollup updating in the same operation |
| `find_similar_prospects` | `prospectDedup.js` | N+1 client-side fuzzy matching — trigram similarity computed in the database |
| `upsert_objection_count` | `conversationAnalysisJob.js` | Lost updates to an objection's occurrence count under concurrent analysis jobs |

### Soft state, not soft deletes

Most entities use status/state fields (`opportunities.stage`, `practice_sessions.completed`, `voice_memos.transcription_status`) rather than deletion. `users.is_deleted` is a full soft-delete with PII scrubbing on account deletion; workspace-member removal is `status = 'removed'`. Financial/outcome history (`feedback`, `conversation_analyses`) is never deleted once created.

### Multi-tenancy

A single `users` row can hold membership in multiple `workspaces`, each a separate `workspace_members` row with its own role and its own `workspace_profiles` row — the same person can have a different product description, voice profile, and practice history per workspace. `users.active_workspace_id` determines which workspace's context is in scope for a request.

---

## 6. AI Provider Infrastructure

This is the layer every other AI feature sits on top of, and it's worth understanding on its own before looking at any individual feature.

### 6.1 One gateway, one key

Every AI chat call goes through one function, `callWithFallback(messages, tier)` in `services/multiProvider.js`, which sends a single OpenAI-compatible request to a self-hosted [llm-gateway](https://github.com/Devpaul-01/llm-gateway). The gateway is a separate service (its own repo) that fronts many upstream providers: it resolves model aliases, walks a per-request `fallback_models` chain, and rotates and cools its own upstream provider keys. FounderSales no longer does any of that itself.

This file used to *be* that failover engine: a fixed four-provider queue (Cerebras → Groq → Mistral → OpenRouter), a pool of keys per provider, and a Redis-cached model-discovery subsystem. That was infrastructure living inside the product's own hottest request path, so it was extracted. `multiProvider.js` went from about a thousand lines to under five hundred, and the exported contract (`callWithFallback`, `callWithFallbackGroq`, `streamWithFallback`, `getProviderStatus`) did not change, so none of the roughly two dozen call sites were touched.

```mermaid
flowchart TB
    Start["callWithFallback(messages, tier)"] --> Guard{"GATEWAY_API_KEY set?\nkey cooling in Redis?"}
    Guard -->|"missing / cooling"| FailFast["throw ALL_PROVIDERS_FAILED\nno request sent"]
    Guard -->|ok| Call["POST GATEWAY_BASE_URL/chat/completions\nmodel + fallback_models"]
    Call -->|success| Done["Return content + usage\n+ model_used (gateway-reported)"]
    Call -->|failure| Classify["classifyProviderError(err)"]
    Classify -->|"KEY_FAULT\n401/403, plain 429"| Cool["markKeyFailed()\ncool the gateway key 1h, Redis-shared"]
    Classify -->|"PROVIDER_TRANSIENT\n5xx, network errors,\n429 budget / concurrency code"| Skip["do NOT cool the key"]
    Classify -->|"BAD_MODEL"| Bad["no cache to evict from —\nmodel resolution is the gateway's job"]
    Classify -->|"NON_RETRYABLE\neverything else"| Abort["capture to Sentry with category"]
    Cool --> Fail["throw ALL_PROVIDERS_FAILED"]
    Skip --> Fail
    Bad --> Fail
    Abort --> Fail
```

There is deliberately no retry loop here any more. With one upstream and one key, "try the next key or provider" has nothing to try; that decision now lives inside the gateway, which has the full picture of every provider behind it.

Configuration is a single required key plus optional overrides (defaults are built in and mirror the gateway's own default priority list):

| Variable | Purpose | Default |
|---|---|---|
| `GATEWAY_API_KEY` | Project key for the gateway (**required**) | none |
| `GATEWAY_BASE_URL` | Gateway endpoint including `/v1`; set this to your own deployment | placeholder `https://llm-gateway.fly.dev/v1` |
| `GATEWAY_TEXT_MODEL` | Primary model for text requests | `openai/gpt-oss-120b` |
| `GATEWAY_TEXT_FALLBACK_MODELS` | Comma-separated `fallback_models` sent with text requests | `mistral-large-latest,meta-llama/llama-3.1-8b-instruct` |
| `GATEWAY_VISION_MODEL` | Primary model when images are attached | `meta-llama/llama-4-scout-17b-16e-instruct` |
| `GATEWAY_VISION_FALLBACK_MODELS` | `fallback_models` for image requests | `gemini-2.5-flash-lite` |

### 6.2 Why four classifications, not "retryable vs. not"

The classifier's real question is still **who is at fault**. The categories are unchanged; what they describe is now the gateway's error surface rather than each vendor's raw API:

- A `401`/`403`, or a plain `429` from the gateway, is the gateway key's fault right now — cool it, so repeated calls don't hammer a credential that is being rejected. This is the one failure the gateway cannot heal for itself.
- A `5xx` or a network error is the service's fault — cooling the key would be actively wrong, leaving it unavailable for an hour over an outage that has nothing to do with it.
- **A `429` is not always a bad key.** The gateway returns `429` for three different conditions, distinguished only by `error.code`: a genuine rate limit, `daily_token_budget_exceeded`, and `too_many_concurrent_requests`. The last two are capacity signals, not evidence the key is bad — one resets at UTC midnight, the other frees up in seconds. `classifyProviderError()` checks for those codes ahead of the blanket `429` rule and files them as `PROVIDER_TRANSIENT`, so a spent daily budget doesn't sideline a perfectly good key for an hour. A `429` with no body, or any other code, is still a `KEY_FAULT`.
- A `400` naming a model that doesn't exist classifies as `BAD_MODEL`. It used to evict the model from a Redis-cached discovery list; with discovery removed there is nothing to evict, and model resolution is the gateway's responsibility.
- Anything else is presumed to be an actual bug in how the request was built, and is captured to Sentry with its category. Failed calls surface to callers as `ALL_PROVIDERS_FAILED`, as before.

### 6.3 Cross-instance coordination

```mermaid
sequenceDiagram
    participant I1 as Instance 1
    participant R as Redis
    participant I2 as Instance 2

    I1->>I1: Gateway returns 401 (key rejected)
    I1->>R: HSET mp:cooldown:gateway:0<br/>{failCount, failedAt}, EX 3600
    Note over R: Shared cooldown state

    I2->>I2: callWithFallback() for a new request
    I2->>R: HGETALL mp:cooldown:gateway:0
    R-->>I2: {failCount: 1, failedAt: ...}
    I2->>I2: fail fast — no request sent,<br/>no wasted 401

    Note over I1,I2: Same pattern applies to Exa search keys<br/>via the same shared providerCooldown.js module
```

Without this, an instance that discovers a bad key has no way to tell any other instance — every other instance keeps sending traffic to a key already known to be failing until it independently rediscovers the same failure. The cooldown is now a single slot (`provider = gateway`, `keyIndex = 0`) instead of a pool of them, but the mechanism is unchanged. `services/providerCooldown.js` is generic over an arbitrary `provider` string, which is why Exa's key rotation shares the exact same module rather than maintaining a structurally identical, independently-drifting copy, and why it needed no changes. `MULTIPROVIDER_REDIS_STATE_ENABLED` still reverts the cooldown to in-memory state without a deploy.

The model-discovery cache and its distributed lock (a 6-hour Redis cache refreshed by whichever instance won a `withLock()` race) were removed along with the provider pool — the gateway resolves model names itself.

### 6.4 Vision routing

Text requests use `GATEWAY_TEXT_MODEL` with its fallback chain. `gpt-oss-120b` cannot read images, so a request with attachments needs a vision-capable model as the *primary* — a fallback list can't help if the first attempt can't see the image. When images are present, `buildRequestBody()` sends `GATEWAY_VISION_MODEL` as `model` with `GATEWAY_VISION_FALLBACK_MODELS` as `fallback_models`, and `buildMessagesForProvider()` attaches the images as `image_url` parts on the last user message only (history and system messages stay plain strings). Every model in the vision chain can read images, so a fallback never lands on a model that can't. Everything past that choice — which upstream provider actually serves the request — is the gateway's decision, and the model that really answered is reported back in the response's `gateway.model_used` field.

### 6.5 Usage tracking

Every AI call carrying `workspaceId` + `userId` is recorded via `record_ai_usage` (the model name stored is the upstream model the gateway reports having used, not the one requested), a Postgres RPC that writes an append-only row to `ai_usage_events` *and* atomically upserts a same-day rollup in `workspace_ai_usage_daily` in one write. This backs Exa's daily quota checks and the workspace usage-summary endpoint, deliberately workspace-and-user-scoped together — a prior single-`id`-parameter design had genuinely ambiguous semantics (sometimes "user," sometimes "workspace") that made cost reporting unreliable.

### 6.6 AI workflow inventory

Each of these is a distinct pipeline, not a generic "call the AI" pattern — see [PRODUCT_OVERVIEW.md §16](PRODUCT_OVERVIEW.md#16-ai-powered-experiences--summary) for the product-facing summary, and the relevant `groq-*.js` file for the actual prompt construction:

- **Onboarding** (`groq-onboarding.js`) — burst question generation, voice-profile synthesis, memory seeding, archetype detection, sample-message generation.
- **Opportunity discovery** (`groq-outreach.js`, `exa.js`) — search-worth-it routing, batch scoring, message generation with a self-correction pass against the user's avoid-phrase list.
- **Practice** (`groq-practice.js`) — buyer persona generation, the bundled per-turn reply call (`generatePracticeProspectReplyV3`), the ghost-scenario quality gate.
- **Calendar** (`groqCalendarIntelligence.js`, `calendarCommitmentsSignals.js`) — enriched prep generation, meeting debrief, merged commitment+signal extraction, follow-up variant generation, weekly pattern insights, prospect summaries.
- **Chat** (`chat.js`, `groq-coaching.js`) — system prompt assembly with memory-relevance splitting, streamed responses, rolling summarization.
- **Coaching/growth** (`groq-coaching.js`) — daily tips, check-in responses, weekly plans.
- **Session analysis** (`groq-session.js`) — multi-axis scoring, coaching annotations, adaptive curriculum, playbook generation, retry comparison.

### 6.7 Structured output handling

Two different reliability strategies exist for parsing AI JSON output, and they're not interchangeable by accident:

- **`utils/parser.js`** — a six-strategy cascade (direct parse, strip markdown fences, regex-extract an object, regex-extract an array, fix common mistakes like trailing commas and unquoted keys, bracket-balance extraction) used by most `groq-*.js` functions. Falls back to a hardcoded default object rather than throwing, so a malformed model response degrades a single feature instead of crashing a request.
- **`schemas/calendarAiSchemas.js`** — real Zod schema validation (`MeetingPrepSchema`, `MeetingDebriefSchema`, `FollowUpOptionsSchema`) with a `validateOrFallback()` helper that logs the raw model output on validation failure so prompt drift is observable. This is the one place structured AI output is validated against an actual schema rather than just parsed leniently — everywhere else relies on the parser cascade plus manual field-presence checks (`validateAndFill`).

---

## 7. Calendar Cost-Gating

Calendar AI is the feature most deliberately engineered around not spending AI calls reflexively.

```mermaid
flowchart TB
    subgraph Triggers
        T1["Event created\nwith attendee context"]
        T2["Daily prep sweep"]
        T3["Debrief submitted\nwith raw notes"]
        T4["Debrief completed"]
    end

    T1 & T2 --> G1{"shouldGeneratePrep()\n— has attendee context?\n— low-stakes type + no linked deal?"}
    G1 -->|skip| P1["buildTrivialEventPrep()\nno AI call, still flips\nprep_generated=true"]
    G1 -->|proceed, pick tier| P2["generateEnrichedEventPrep()\ntier: 'quality' if tied to a deal\nor event_type='demo', else 'fast'"]

    T1 --> G2{"shouldRunResearch()\n— already researched?\n— research done <14 days ago\nfor this SAME prospect,\nany event?\n— workspace quota available?"}
    G2 -->|reuse| P3["Reuse existing research —\nzero-cost, cross-event"]
    G2 -->|quota exceeded| P4["Skip entirely"]
    G2 -->|proceed| P5["Exa search + AI synthesis"]

    T3 --> G3{"shouldExtractCommitmentsSignals()\n— raw notes >= 20 chars?"}
    G3 -->|too short| P6[Skip]
    G3 -->|proceed| P7["ONE call extracts BOTH\ncommitments AND signals"]

    T4 --> G4{"shouldGenerateFollowUp()\n— outcome='dead' with no\nnext-step recommendation?"}
    G4 -->|skip| P8[Skip]
    G4 -->|proceed| P9["3 follow-up variants:\nbrief / substantive / re-engagement"]

    P1 & P2 & P3 & P4 & P5 & P6 & P7 & P8 & P9 --> LOG["Every decision logged to\ncalendar_ai_events\n(workspace, event, function,\ndecision, reason, tier)"]
```

This is what makes "AI cost was optimized here" a checkable claim: the actual proceed/skip ratio, and why each skip happened, is a real query against `calendar_ai_events`, not something inferred from logs.

---

## 8. Practice Simulation Engine

The most conversationally sophisticated AI feature, and the one running synchronously inside the request/response cycle rather than as a background job — the user is having a live conversation and needs the reply immediately.

```mermaid
sequenceDiagram
    participant U as User
    participant R as practice.js routes
    participant AI as multiProvider (llm-gateway client)
    participant Q as practice-jobs queue

    U->>R: POST /start {scenario_type, pressure_modifier?}
    R->>AI: generateBuyerProfile() — name, role, pain,<br/>hidden motivations, starting interest/trust scores
    R->>R: apply pressure_modifier stat adjustments
    R-->>U: session_id, buyer_profile, instruction

    loop Each message exchange
        U->>R: POST /:sessionId/message
        alt scenario_type === 'ghost'
            R->>AI: evaluateMessageQualityForGhost()
            alt quality_score >= 40
                R->>AI: generatePracticeProspectReplyV3<br/>(one-turn override as 'interested')
                R-->>U: reply + buyer_state (ghost broke silence)
            else
                R-->>U: ghosted: true, coaching hint (no reply)
            end
        else
            R->>AI: generatePracticeProspectReplyV3<br/>(single bundled call)
            Note over AI: Returns: reply text, internal_monologue,<br/>conversation_outcome, goal_achieved,<br/>state_delta, coaching_tip — one call
            R->>R: apply state_delta to buyer_state
            R-->>U: reply + updated buyer_state + outcome
        end
        R->>Q: enqueue PRACTICE_DELIVERED (500ms), PRACTICE_SEEN (1500ms)
    end

    U->>R: POST /:sessionId/complete
    R->>Q: enqueue SKILL_SCORES (2s), ANNOTATIONS (5s), PLAYBOOK (2h)
    R-->>U: 200
```

An earlier architecture (still present as V1/V2 functions in `groq-practice.js`, kept for reference rather than deleted) made the reply, monologue, outcome, and coaching tip as separate sequential calls. Bundling into one response cuts both latency and cost per conversational turn — the trade-off is a more constrained, carefully-engineered prompt and JSON schema that has to reliably produce all six fields in one shot, with `parseV3Reply()` providing field-by-field fallback defaults if the model's response is malformed rather than failing the whole turn.

---

## 9. Skill Scoring Model

```mermaid
flowchart LR
    subgraph Real["Real Outreach"]
        A["Message sent →\nfeedback logged"] --> B["conversation_analyses\nhook/clarity/value_prop/\npersonalization/cta/tone\n— each 0-10"]
    end

    subgraph Sim["Practice Simulation"]
        C["Session completed"] --> D["practice_sessions.skill_scores\nclarity/value/discovery/\nobjection_handling/brevity/\ncta_strength — each 0-100"]
    end

    B --> E["skillProgressionJob.js\nweekly blend"]
    D -->|"÷ 10 to normalize scale"| E
    E --> F["skill_progression\none row per\n(workspace, user, week)"]
    F --> G["adaptiveCurriculum\n3-session drill plan"]
    F --> H["insights.js endpoints\ntrend detection, drill recs"]
```

The two sources score genuinely different axes — real messages are scored on what's observable from static text (hook, tone, personalization); practice sessions additionally score `discovery` and `objection_handling`, which only exist as a signal across a multi-turn conversation. Where axes overlap, the weekly job blends both by simple averaging *after* normalizing practice's 0–100 scale down to conversation-analysis's 0–10 scale — a detail worth calling out because getting this normalization backwards (blending a 0–100 and a 0–10 number directly) was a real bug fixed during development, documented inline in `skillProgressionJob.js`.

---

## 10. Redis Usage

Redis is used for six genuinely different purposes here, not one "caching layer" — worth being precise about which is which:

| Purpose | Where | Mechanism |
|---|---|---|
| **Caching** | Auth profile (30s), workspace context (30s), insights/coaching-report results (4–24h) | `getCache`/`setCache`, plain key-value with TTL |
| **Queues** | All background job processing | BullMQ over a **separate `ioredis` connection**, deliberately isolated from the `redis`-package client used for everything else |
| **Rate limiting** | 19 namespaced limiters | `rate-limit-redis` wrapping the shared raw client, one Redis key-prefix per limiter |
| **Distributed locks** | Model-discovery refresh (15s TTL) | `SET NX PX` + a Lua script for compare-and-delete release, so a lock can only be released by the process that acquired it |
| **Cross-instance coordination** | AI gateway-key cooldown, Exa key cooldowns | Redis hash per `(provider, keyIndex)`, shared by `multiProvider.js` and `exa.js` via one module (`providerCooldown.js`) |
| **Distributed concurrency guard** | Onboarding AI-call staggering | A Redis sorted set (`stagger:groq_queue:active`) where each in-flight call is a member scored by its acquisition timestamp — self-healing via a staleness sweep rather than depending on a single shared TTL |

The queue Redis connection and the caching/coordination Redis connection are two separate client instances (`bullmq.js`'s `ioredis` vs `redis.js`'s `redis` package) that can share the same `REDIS_URL` but are configured, connected, and retried independently.

**Fail-open by design.** Every Redis helper returns a safe empty value (`null`/`false`/`[]`) on any error rather than throwing — a Redis outage degrades precision (rate limits become per-instance instead of global, caching becomes a no-op, coordination falls back to in-memory) but never takes down a request. `utils/reportDegradation.js` throttles the resulting alert to once per condition per 5 minutes, deliberately kept in-memory rather than Redis-coordinated — coordinating "Redis is down" alerts through Redis would be circular.

---

## 11. Scalability & Deployment Topology

The codebase can run as a single combined process (`app.js` — starts the Express server, then calls `startAllJobs()` to boot the scheduler and all three BullMQ workers in the same process) or as two independent processes:

- **`server.js`** — API only, no `startAllJobs()` call. Bull Board is still mounted here (read-only — it reads queue state from Redis, not from in-process workers), so it's safe to expose from the API process even with no local workers running.
- **`workers/index.js`** — scheduler + all three workers, no Express server at all. Has its own top-level `SIGTERM`/`SIGINT` handler with a bounded 10-second force-exit timer as a safety net on top of each worker's own graceful-shutdown handler.

Both files are fully implemented today. `app.js` remains what `package.json`'s `start`/`dev` scripts actually run — the split topology is available and correctly wired, not merely sketched out, but adopting it as the default deployment shape is an operational decision that hasn't been made yet. The AI layer's Redis-backed gateway-key cooldown (§6.3) is what makes horizontal *API* scaling safe regardless of which topology is running — any number of instances can run concurrently against the same Redis without duplicating rate-limit counters or key-cooldown state, because none of that state is held in process memory as the source of truth.

---

## 12. Security

- JWT verification via Supabase Auth, with a 30-second Redis-cached profile lookup and the raw token deliberately never attached to `req.user`.
- Workspace membership resolved and cached per-request with explicit invalidation on role changes and workspace switches, not left to expire silently.
- 19 independently-namespaced Redis-backed rate limiters (§3), each sized to its own cost profile.
- Invite tokens are 32-byte random values, SHA-256 hashed before storage — the plaintext token is never persisted, only compared by hash on acceptance.
- File uploads are MIME-validated both client-side (multer `fileFilter`) and against the actual bytes received; chat attachments are capped by an aggregate 16,000-character budget so a large attachment can't silently balloon what gets sent to the AI.
- Prospect deduplication never auto-merges a fuzzy match — only exact identifiers or normalized-name exact matches merge automatically; anything else is flagged for human review.
- The service-role Supabase client bypasses Row-Level Security; the middleware chain is the actual enforcement boundary, not RLS. Documented as a deliberate trade-off in §5 and §13, not glossed over.

---

## 13. Known Gaps & Engineering Trade-offs

Documented explicitly because a system with zero visible trade-offs is less credible, not more:

1. **`pattern_insights` has no registered handler.** A self-enqueued job from the weekly pattern-detection run fails every time — see [BACKGROUND_JOBS.md §4.3](BACKGROUND_JOBS.md#43-known-gap-pattern_insights) for the exact mechanics. Scoped and understood, pending a decision between two wiring options rather than a guess.
2. **Combined process is still the default deployment shape.** The split-process topology (§11) is fully built and available; it isn't what actually runs by default yet.
3. **Service-role Postgres access, not RLS, is the enforcement boundary** (§5, §12) — correct as long as the middleware chain is never bypassed, with no independent database-layer backstop.
4. **30-second membership/profile cache staleness** (§3) — an explicit, bounded trade-off against two extra Postgres round-trips on the hottest part of every authenticated request.
5. **Booking pages are schema-present but not wired.** `booking_pages` and `availability_windows` exist in the schema for a planned public booking-page feature — no route or service uses them yet.
6. **No billing system.** Tier values (`free`/`pro`/`enterprise`) gate a handful of things (Exa quota tiers, market-intel enrichment eligibility) but there's no payment provider integration or subscription lifecycle behind them.
7. **Dead job handlers kept, not removed.** `PRACTICE_REPLY` and `PRACTICE_GHOST` still have working handlers in `messageQueueWorker.js`, but nothing enqueues them since the practice reply path moved fully synchronous (§8). Kept as a defensive fallback rather than deleted mid-migration.
8. **Frontend architecture isn't documented here.** This document covers the backend; the frontend's own source wasn't part of this documentation pass.
9. **Two Groq paths remain outside the gateway.** Voice-memo transcription (`services/transcription.js`) still calls Groq Whisper directly with its own key pool, since the gateway has no audio endpoint. `services/groq-client.js`, a legacy direct-to-Groq chat client re-exported through the `groq.js` barrel, is no longer called by any route or job, but hasn't been removed. `streaming.js` still defaults to it when a caller omits `streamFn`; the only caller (`chat.js`) always passes `streamWithFallback` explicitly, so that default is dormant, not active.
10. **`tier` is accepted but ignored.** `callWithFallbackGroq` still takes `tier` (`fast`/`quality`) so no call site had to change, and still records it for usage tracking, but it no longer selects a different model. Cheaper-model routing for `fast` would be a second `GATEWAY_*_MODEL` pair keyed on `tier`.
11. **The gateway is now a single upstream dependency.** If it is down, every AI feature is down; previously four independent providers had to fail. The gateway key's Redis cooldown fails fast in that case, but there is no second path. Features with a non-AI fallback (e.g. the template-based practice examples) degrade as before.
