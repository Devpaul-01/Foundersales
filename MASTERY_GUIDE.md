# 🧾 Backend Codebase Mastery Guide
### Clutch AI — Senior Engineer Mentorship Edition

---

> **How to use this document:**
> Read it once top to bottom before touching any code.
> Then keep it open as a reference while you read files.
> Every section is grounded in your *actual* codebase — not generic advice.

---

## 1. How to Approach This Codebase

### Mindset to adopt

You are not trying to memorise this codebase. You are trying to build a **mental map** of it — the same way you would learn a city. You don't memorise every street. You learn the landmarks, the districts, and the main roads that connect them. Everything else you look up when you need it.

The one trap that kills comprehension in a codebase this size is **reading files in isolation**. A file only makes sense once you know what calls it and what it calls. Always read with those two questions active.

### What to focus on

Focus on **data flow** above all else. Every feature in this system is ultimately a question of: where does data enter, what transforms it, and where does it end up? If you can answer that for each feature, you understand the system.

Do not get distracted by:
- Individual Groq prompts (they are implementation detail)
- Exact SQL column names (they are schema detail)
- Exact error message strings

Do get very comfortable with:
- The middleware chain (auth → resolveWorkspace → route handler)
- How `req.user`, `req.workspace`, `req.workspaceProfile`, and `req.membership` are built
- The three BullMQ queues and what each one is for
- How `discoverOpportunities` flows end-to-end

### How to avoid getting overwhelmed

This codebase has ~70+ files. If you try to read them all before forming any understanding, you will feel lost after file 10. Instead, use the **layered reading order** in Section 2. Read one layer at a time. After each layer, pause and write down what you now understand in plain English. That act of writing forces comprehension.

---

## 2. Recommended Reading Order

Read in this exact sequence. Do not skip ahead. Each layer gives you the vocabulary you need for the next.

### Stage 1 — The Skeleton (read these first, together)

```
src/config/constants.js
src/app.js
src/config/validateEnv.js   (new file — read after app.js)
```

**Why:** `constants.js` is the shared vocabulary of the entire system. Every other file imports from it. If you have not read it, you will constantly stop to ask "what is `BACKGROUND_JOB_TYPES`?" or "what is `PIPELINE_STAGES`?". Read it first like a glossary. Then `app.js` shows you the full map — every route prefix, every middleware chain, every rate limiter, every worker startup. Two files give you the entire skeleton.

### Stage 2 — The Request Pipeline (read these next)

```
src/middleware/auth.js
src/middleware/workspace.js
src/middleware/validate.js
src/middleware/errorHandler.js
src/middleware/traceId.js    (new file)
```

**Why:** Every single request goes through this chain in this order: `traceId → auth → resolveWorkspace → (optional validate) → route handler → errorHandler`. If you do not understand this chain, no route handler will make sense. You will keep asking "where does `req.user.id` come from?" and "what is `req.workspaceProfile`?".

### Stage 3 — The Services Layer (read these next)

```
src/services/groq-client.js
src/services/groq.js
src/services/perplexity.js
src/services/redis.js
src/services/multiProvider.js
src/services/notifications.js
```

**Why:** Routes call services. Services do the actual work — AI calls, database writes, cache reads. You need to know what each service exposes before you can understand what routes are doing when they call them. Read `groq-client.js` first (the raw HTTP client), then `groq.js` (the barrel re-exporter), then the others.

### Stage 4 — The Jobs System (read next)

```
src/jobs/index.js
src/jobs/backgroundWorker.js
src/jobs/practiceWorker.js
src/jobs/coreJobs.js
src/jobs/growthIntelligenceScheduler.js
src/config/bullmq.js
```

**Why:** A large fraction of this system's business logic does not live in routes — it lives in background jobs. Understanding the jobs system is not optional. If you skip it, you will not understand how opportunities get discovered, how growth tips get generated after check-ins, how pattern detection works, or how practice sessions progress.

### Stage 5 — The Routes (read last)

Read routes in this order — simplest to most complex:

```
src/routes/auth.js          (stateless, no workspace)
src/routes/workspaces.js    (workspace CRUD)
src/routes/onboarding.js    (sequential state machine)
src/routes/growth.js        (complex: check-ins, cards, plans, archetype)
src/routes/opportunities.js (complex: quota, AI, scoring, pipeline)
src/routes/insights.js      (complex: aggregation, AI reports)
src/routes/chat.js          (complex: streaming, history, context)
src/routes/practice.js      (most complex: multi-step simulated conversation)
```

**Why this order for routes:** `auth.js` is the only route with no workspace context — it is the simplest possible case. `workspaces.js` introduces the concept of workspaces. `onboarding.js` shows you how data gets populated into workspace_profiles. By the time you hit `growth.js` and `opportunities.js`, you know what all the data means and where it came from.

---

## 3. How to Read Each Layer

### config/constants.js

**What to look for:** Group the exports mentally into these families:
- **Role/permission constants**: `WORKSPACE_ROLES`, `WORKSPACE_MANAGER_ROLES`
- **Pipeline state**: `PIPELINE_STAGES`, `OPPORTUNITY_STATUS`, `DELIVERY_STATUS`
- **Job control**: `BACKGROUND_JOB_TYPES`, `QUEUE_JOB_TYPES`, `JOB_INTERVALS`
- **Quota limits**: `PERPLEXITY_LIMITS`, `WORKSPACE_PERPLEXITY_LIMITS`
- **Feature config**: `PRACTICE_SCENARIOS`, `ARCHETYPE_PLATFORM_DEFAULTS`

**Question to ask:** "If this constant changed, which features would behave differently?"

### Middleware files

**What to look for:** What does each middleware *add* to the `req` object? After reading all five middleware files, you should be able to fill in this table from memory:

| Set by | Property | Type | Contains |
|--------|----------|------|----------|
| `traceId` | `req.traceId` | string (UUID) | Unique request ID for log correlation |
| `authenticate` | `req.user` | object | userId, email, tier, fcm_token, onboarding_completed, active_workspace_id |
| `resolveWorkspace` | `req.workspace` | object | Full workspace row from DB |
| `resolveWorkspace` | `req.membership` | object | User's role in the workspace |
| `resolveWorkspace` | `req.workspaceProfile` | object | Product desc, target audience, voice profile, archetype |
| `buildUserContext(req)` | *(return value)* | object | Flattened combination of all three above |

**Key question to ask:** "Why does `req.user` NOT contain product_description?" Answer: because product context belongs to a *workspace*, not to a user. A user can be a member of multiple workspaces with different products.

### Services layer

**What to look for in groq-client.js:** The `callGroq` function returns `{ content, tokens_in, tokens_out, tokens_total, model_used }`. Every route that calls AI must handle this shape. The retry logic is here (3 attempts, 1.5s backoff).

**What to look for in groq.js:** This is a barrel file — it imports from 6 sub-modules and re-exports everything. There is no logic here. When you see `import groqService from '../services/groq.js'` in a route, know that `groqService.generateCheckInQuestions()` actually lives in `groq-coaching.js`.

**What to look for in perplexity.js:** Two completely separate quota systems exist. Per-user quota (for email digest) and per-workspace quota (for opportunity discovery). The smart router (`needsRealTimeSearch`) decides whether to spend a real Exa API call or fall back to Groq-generated examples.

**What to look for in redis.js:** This is a graceful-degradation pattern. Every function has a try/catch. If Redis is unavailable, they return null/no-op — the app keeps working, just without caching. Never assume Redis is up.

### Jobs layer

**What to look for:** Three queues, three workers, three concurrency levels — each for a different reason:

| Queue | Worker | Concurrency | Why |
|-------|--------|-------------|-----|
| `scheduledQueue` | `scheduledWorker` | 1 | Scheduled jobs (cron-like) must not overlap — running the same report twice would double-write |
| `practiceQueue` | `practiceWorker` | 10 | Practice events are user-facing real-time responses — high parallelism needed |
| `backgroundQueue` | `backgroundWorker` | 5 | Fire-and-forget but not critical path — moderate concurrency |

**What to look for in backgroundWorker.js:** The handler map pattern. Each `BACKGROUND_JOB_TYPES` key maps to an async function. When a job is added to the queue with `backgroundQueue.add('checkin_tip_generate', data)`, the worker picks it up and calls `handlers['checkin_tip_generate'](data)`. This is your dispatcher pattern.

### Routes layer

**What to look for in every route file:**
1. What middleware is applied (look at `router.get/post/put` first argument chain)
2. What Zod schema validates the input
3. What database tables are read/written
4. What external services are called (Groq, Exa, Redis)
5. What is returned in the JSON response

**Key question to ask in every route:** "What happens if the AI call fails?" A well-written route either catches the error gracefully or lets it bubble to `errorHandler`. A poorly-written route has a floating promise that silently dies.

---

## 4. Key Concepts to Extract

### Data flow across a typical request

```
Client → HTTP request
  → traceId middleware  (assigns req.traceId)
  → authenticate        (verifies JWT, loads req.user from DB + cache)
  → resolveWorkspace    (loads req.workspace + req.membership + req.workspaceProfile from DB + Redis)
  → validate middleware (Zod — validates req.body or req.query)
  → route handler       (calls service, writes to Supabase, calls AI)
  → JSON response
  → errorHandler        (catches any thrown error, formats it, logs it)
```

### The workspace isolation pattern

Every single Supabase query in every route must include `.eq('workspace_id', workspaceId)`. This is the multi-tenancy guarantee. If a query is missing this filter, a user could see another workspace's data. When reading routes, check every query for this.

The pattern in code always looks like:
```js
const userId = req.user.id;
const workspaceId = req.workspace.id;
// Every query from here must include both
supabaseAdmin.from('some_table').select('*')
  .eq('workspace_id', workspaceId)
  .eq('user_id', userId)
```

### The two-context model

**Identity context** (`req.user`): who you are — your user ID, email, notification token, tier. This is stable across all workspaces.

**Workspace context** (`req.workspace + req.workspaceProfile`): what you are working on in *this* workspace — your product, your target audience, your voice profile, your archetype. This changes per workspace.

`buildUserContext(req)` merges both into one flat object for services that need everything (AI calls, job scheduling).

### The quota architecture

Three quota layers, nested:

```
Global daily cap (500 Exa calls across ALL users)
  └── Workspace daily limit (5 / 50 / 200 depending on plan)
        └── Per-user daily limit (2 / 20 / 30 depending on tier)
              └── Smart cost router (Groq decides if call is worth making)
```

The system degrades gracefully at each layer: if any quota is hit, Groq generates synthetic examples. Users see a notice but never a crash.

### The background job durability pattern

Before the refactor, this pattern appeared in several routes:
```js
// ❌ Old pattern — floating promise, no retry, no monitoring
generateTipFromCheckIn(userId, ...).catch(err => console.error(err));
```

After the refactor, it is always:
```js
// ✅ New pattern — durable, retriable, monitorable
await backgroundQueue.add(BACKGROUND_JOB_TYPES.CHECKIN_TIP_GENERATE, {
  userId, workspaceId, ...
}).catch(err => logError('queue', err, { userId }));
```

The key difference: BullMQ persists the job in Redis. If the server crashes mid-execution, the job retries on restart. The old pattern lost the work forever.

### The error handling strategy

Three levels:
1. **Route-level**: `asyncHandler` wraps every route handler. Any thrown error is caught and forwarded to `errorHandler`. You never write `try/catch` in a route just to send a 500 — let the error propagate.
2. **Service-level**: Services like Redis and notifications have their own `try/catch` and degrade gracefully (return null, not throw).
3. **Global**: `errorHandler` middleware (mounted last in `app.js`) catches everything that reaches it, logs it, and returns a structured `{ error, message }` JSON.

### The caching strategy

Two cache layers with different TTLs and scopes:

| Cache | Location | TTL | What |
|-------|----------|-----|------|
| Profile cache | In-memory `Map` in `auth.js` | 30 seconds | User profile from `users` table |
| Workspace context | Redis | 30 seconds | workspace + membership + workspaceProfile |
| AI reports | Redis | 4 hours | `why-losing` report, pipeline insights |

Caches are cleared explicitly on profile update (`clearProfileCache`) and workspace changes (`clearWorkspaceCache`). This is the **cache invalidation on write** pattern.

---

## 5. How to Build Deep Understanding

### How to trace a request end-to-end

Pick one concrete flow and trace it manually. Here is a worked example:

**Flow: User submits a check-in**

```
POST /api/growth/checkin

1. app.js:
   - [...ws] = [authenticate, resolveWorkspace] both run
   - aiRateLimiter checks: < 30 req/min? ✓
   - growth.js router receives request

2. growth.js route handler:
   - validate(checkInSubmitSchema) — Zod validates { answers, mood_score, date }
   - requirePermission('member') — membership.role >= 'member' ✓

3. Handler body:
   - Query: daily_check_ins where user_id AND workspace_id AND date = today
   - If already processed → 409 ALREADY_SUBMITTED
   - Query: user_goals for context
   - Query: last sent opportunity + last conversation analysis
   - Call: groqService.generateCheckInResponse(userCtx, archetype, ...)
   - Update: daily_check_ins with answers, mood_score, ai_response, processed_at
   - Call: computeCheckInStreak(userId, workspaceId, today)
   - Update: users.check_in_streak + last_check_in_at

4. Background job enqueue:
   - backgroundQueue.add('checkin_tip_generate', { userId, workspaceId, ... })
   - Returns immediately — does NOT wait for job to complete

5. Response: 200 { success, ai_response, check_in_streak }

6. Later (async, in backgroundWorker.js):
   - Job is dequeued
   - Idempotency check: already generated today? Skip
   - Call: groqService.generateDailyTip(...)
   - Insert: growth_cards with generated_by = 'ai_checkin'
   - Update: users.last_tip_generated_at
```

Do this exercise for every major feature. Write it out like above — numbered, with DB table names and service calls explicit.

### How to simulate real user flows

You do not need a frontend. Open a REST client (Insomnia, Postman, or curl) and replay real flows:

1. `POST /api/auth/register` → get JWT
2. `POST /api/onboarding/complete` → create workspace_profile
3. `POST /api/growth/checkin/today` → generate today's questions
4. `POST /api/growth/checkin` → submit answers
5. `GET /api/growth/feed` → see the tip card that was generated

Each step, inspect the response. Then query Supabase directly to confirm what was written. This dual-verification habit — check the API response AND the DB — is what senior engineers do.

### How to connect modules mentally

Use this dependency chain as a mental model. Read it top-to-bottom as "calls":

```
app.js
  ├── routes/*.js
  │     ├── middleware/auth.js
  │     ├── middleware/workspace.js  (buildUserContext)
  │     ├── middleware/validate.js   (Zod schemas)
  │     ├── services/groq.js         (AI generation)
  │     │     └── groq-client.js     (raw Groq HTTP)
  │     ├── services/perplexity.js   (Exa search + quota)
  │     ├── services/multiProvider.js (Groq with Perplexity fallback)
  │     ├── services/redis.js        (cache get/set)
  │     ├── jobs/queues.js           (backgroundQueue.add)
  │     └── config/supabase.js       (supabaseAdmin queries)
  │
  └── jobs/index.js
        ├── backgroundWorker.js  → handlers call groq.js, supabaseAdmin
        ├── practiceWorker.js    → handles PRACTICE_* queue jobs
        ├── scheduledWorker.js   → runs coreJobs, growthIntelligenceScheduler
        └── coreJobs.js          → calls perplexity.js, groq.js, supabaseAdmin
```

---

## 6. What to Document While Learning

As you read, keep a running notes file. Write down:

### Important flows (one paragraph each)
For each feature, write: "When the user does X, the system does Y, Z, W and the end result is Q." If you cannot write that sentence, you do not yet understand the feature.

### Key design decisions (and why)
Examples to document:
- Why is `onboarding_completed` on the `users` table but `product_description` on `workspace_profiles`?
  - Answer: auth middleware runs on every request and needs to know onboarding status fast. Joining workspace_profiles on every auth check would be expensive. Product context is only needed inside workspace-scoped routes.
- Why does `resolveWorkspace` use Redis caching with only a 30-second TTL?
  - Answer: Workspace context (role, profile) can change if an admin updates it. A long TTL risks serving stale permissions. 30 seconds is a compromise between freshness and DB query reduction.
- Why does `discoverOpportunities` have a "smart cost router"?
  - Answer: Exa API calls cost real money. The router asks Groq (free) whether the profile is rich enough to make a real search worthwhile. Thin profiles (no product description, no target audience) would produce useless results — better to generate Groq examples.

### Edge cases you notice
Document any case where the system behaves differently than you would expect. For example: `POST /api/workspaces` bypasses `resolveWorkspace` — why? Because a user creating their *first* workspace has no `active_workspace_id` yet, so `resolveWorkspace` would return 400.

### Assumptions you can confirm or disprove
Write down things you think are true, then verify them by reading the code or querying the DB. This active verification habit is what separates someone who "read the code" from someone who "understands the code."

---

## 7. When to Ask Questions

### What confusion is "normal"

It is completely normal to be confused about:
- Why a specific Groq prompt is phrased a certain way — this is experimentation, not architecture
- Why a specific column name was chosen — this is history
- The exact order of fields in a Supabase response — just console.log it

### When to stop and investigate deeper

Stop and investigate when you are confused about:
- Why a middleware runs before or after another — this is intentional and consequential
- Why a job is in `backgroundQueue` vs `scheduledQueue` vs `practiceQueue` — each queue has a different contract
- Why a quota check exists in both the route AND the service — this is a deliberate defence-in-depth pattern, not an accident
- Why `workspace_id` appears on a table that already has `user_id` — multi-tenancy design decision
- Why some routes call `requirePermission('manager')` and others have no permission check — potential security gap

Any time you think "this seems wrong", write it down and trace it before moving on. It is either a bug worth fixing, or an architectural decision worth understanding. Either way it is valuable.

---

## 8. How to Prepare for Interviews

### How to explain your architecture (practice this paragraph out loud)

> "Clutch AI is a sales coaching platform built on Express with Supabase as the database. The architecture follows a layered pattern — every request passes through JWT authentication, then workspace resolution that loads the user's workspace context and role, and then reaches the route handler. We have two main concerns separated into different systems: the synchronous request path handles immediate user interactions, and a three-queue BullMQ system handles async work — scheduled jobs like nightly opportunity discovery, practice session simulations which need high concurrency, and background tasks like generating AI tip cards after a check-in. We use Groq as our primary AI provider with Exa for real-time web search, and Redis for caching both workspace context and expensive AI report results."

### How to explain the key features

**Opportunity Discovery:**
> "When a user requests new opportunities, we first check a workspace-level quota against our constants. If we're under limit, a smart router uses Groq to decide whether the user's profile is detailed enough to justify a real Exa API search — which costs money. If yes, Exa does a neural search across the user's preferred platforms. Results are parsed, scored, and inserted into the opportunities table. If we're over quota or the profile is too thin, Groq generates realistic synthetic examples as a graceful fallback."

**Practice Simulation:**
> "Practice sessions simulate a real sales conversation. When a user sends a message, it's enqueued into the practice queue — which runs at 10 concurrent workers because these are real-time user-facing events. The worker generates a buyer persona reply using Groq, evaluates whether the buyer's state has changed, and schedules follow-up jobs like ghost simulation if no reply arrives. At the end, multi-axis skill scores and coaching annotations are generated. All of this happens through BullMQ rather than synchronous HTTP calls because the delays are simulated to feel realistic."

**The Workspace Model:**
> "We use a multi-tenant workspace model. A user can be a member of multiple workspaces, each with a different product and context. The workspace_profiles table holds all the product-specific data — description, target audience, voice profile — separated from the users table which only holds identity and device data. This means a single user account can represent completely different selling contexts depending on which workspace is active."

### How to explain trade-offs

An interviewer will respect you for knowing the limitations, not just the strengths. Be ready to say:

- "We cache workspace context for 30 seconds in Redis for performance, which means there's a brief window where a role change doesn't take effect immediately. We accepted that trade-off because workspace roles change rarely."
- "We use an in-memory profile cache in the auth middleware with a process-level Map. In a multi-instance deployment this means each instance has its own cache — they don't share state. We mitigate this with a short 30-second TTL."
- "The Groq smart cost router is itself an AI call — it costs a small amount to decide whether to spend a larger amount. For users with very thin profiles this is pure overhead. We could optimise it by checking profile completeness synchronously first."

---

## 9. Simulated Interview Questions

These are the most likely questions in a technical interview for this system. Study the answer, then try to say it out loud in your own words.

---

**Q: Walk me through what happens when a user's JWT token expires mid-session.**

A: The client sends a request with the expired token. In `auth.js`, `supabaseAdmin.auth.getUser(token)` is called. Supabase validates the signature and expiry — if expired, it returns an error. The middleware returns `401 INVALID_TOKEN` with the message "Session expired. Please log in again." The profile cache is not consulted because cache lookup only happens after a successful JWT verification. The client should handle this 401 by redirecting to the login screen and using the refresh token to obtain a new JWT.

---

**Q: How does your system prevent one workspace from seeing another workspace's data?**

A: Every Supabase query in every route handler filters by `workspace_id`. The `workspace_id` always comes from `req.workspace.id` which is set by the `resolveWorkspace` middleware — the middleware fetches it from the database and verifies the user is an active member of that workspace. A user cannot inject a different `workspace_id` through the request body because routes always use `req.workspace.id`, never `req.body.workspace_id`. Additionally, Supabase Row Level Security can be configured as a second layer at the database level.

---

**Q: Why did you choose BullMQ over a simple `setTimeout` or an in-process job queue?**

A: Three reasons. Durability — BullMQ persists jobs in Redis. If the Node process crashes mid-job, the job is retried on restart. `setTimeout` and in-process queues lose their state on crash. Observability — Bull Board gives us a real-time dashboard of pending, active, completed, and failed jobs at `/admin/jobs`. This is impossible with `setTimeout`. Concurrency control — each queue has an explicit concurrency setting. The practice queue runs 10 concurrent jobs for responsiveness; the scheduled queue runs 1 to prevent overlap. This would require complex manual coordination with `setTimeout`.

---

**Q: What is the difference between `authenticate` and `resolveWorkspace` and why are they two separate middleware?**

A: `authenticate` only answers "who is this person?" — it verifies the JWT and loads the user's identity from the users table. `resolveWorkspace` answers "what workspace are they working in right now?" — it loads the workspace, their membership role, and their workspace-specific product profile. They are separate because some routes need authentication but not workspace context. For example, `POST /api/workspaces` creates a workspace — at that point, the user may have no workspace yet, so `resolveWorkspace` would fail. Keeping them separate allows the middleware chain to be composed per-route as needed.

---

**Q: A user complains that after an admin changed their role from 'member' to 'manager', they still can't access manager features for a few minutes. Why does this happen and how would you fix it?**

A: This is the Redis cache TTL window. `resolveWorkspace` caches the workspace context — including the membership role — in Redis for 30 seconds per user per workspace. If a role is changed in the database, the stale cached role is served for up to 30 seconds. The fix is cache invalidation on write: when a role update is performed in `workspaces.js`, call `clearWorkspaceCache(affectedUserId, workspaceId)` which deletes that user's Redis cache key. The next request from that user will re-fetch from the database and get the new role immediately. We already have `clearWorkspaceCache` implemented in `workspace.js` — it just needs to be called consistently after every role change operation.

---

**Q: How does your AI cost management work? What prevents a free user from making unlimited Groq calls?**

A: There are two layers. For Exa (paid search), we have a hard per-workspace daily quota tracked in the `workspace_perplexity_usage` table — free workspaces get 5 calls per day. Above that, requests fall back to Groq-generated synthetic examples. For Groq itself, we configured it as unlimited in `GROQ_LIMITS` because the cost is effectively zero at our scale — but we have an `aiRateLimiter` at the route level (30 requests per minute per user) to prevent any single user from hammering the endpoint. Token usage is recorded in a `token_usage` table via `recordTokenUsage` for monitoring and future billing purposes.

---

**Q: What is `buildUserContext` and why does it exist?**

A: `buildUserContext(req)` is a helper in `workspace.js` that merges `req.workspaceProfile`, `req.user`, and `req.workspace` into a single flat object. It exists because most AI service calls need context from all three sources — for example, `generateCheckInResponse` needs the user ID (from `req.user`), the product description (from `req.workspaceProfile`), and the workspace plan/tier (from `req.workspace`). Without this helper, every route would manually destructure all three objects. The helper also means if the shape of the merged context changes, there is one place to update it.

---

**Q: How does the practice simulation know when to trigger a "ghost" (no response)?**

A: When a practice scenario is created, it is assigned a scenario type (interested, ghost, polite_decline, etc.) with a weighted random distribution from `PRACTICE_SCENARIOS` in constants. If the scenario type is `ghost`, the `practiceWorker` schedules a `PRACTICE_GHOST` job with a delay equal to `GHOST_TIMEOUT_SECONDS` (600 seconds). When that job fires, it marks the session as ghosted. If the user messages before the ghost job fires, the user's message quality is evaluated (`evaluateMessageQualityForGhost`) and if it is strong enough, the ghost is cancelled and a real reply is generated instead. This simulates a real-world scenario where a good follow-up can re-engage a silent prospect.

---

## 10. Common Mistakes to Avoid

**Reading files without knowing their caller.** You will read half of `coreJobs.js` and have no idea why certain data is being fetched. Always check first: who calls this? In jobs, the answer is `scheduledWorker.js`. In services, the answer is routes. In routes, the answer is the client.

**Confusing `req.user.tier` with workspace plan.** `req.user.tier` is the user's personal subscription tier. `req.workspace.plan` is the workspace's plan. They can be different. `buildUserContext` uses `req.workspace?.plan || req.user.tier` — workspace plan takes precedence. Always use `buildUserContext(req).tier` in routes to get the right value.

**Assuming a service call is synchronous.** Every Supabase query and every AI call is async. If you forget an `await`, you get a Promise object instead of data. This is the most common source of subtle bugs in this codebase.

**Reading Groq prompt text for architecture understanding.** The prompts inside `groq-coaching.js`, `groq-outreach.js`, etc. are implementation detail — they change often. Focus on the *function signatures* (what goes in, what comes out) not the prompt text.

**Ignoring the `.catch()` pattern on background queue calls.** When routes call `backgroundQueue.add(...)`, they always add `.catch(err => logError(...))`. This means queue failures are logged but do not break the HTTP response. If you remove this pattern, a Redis outage will cause HTTP 500s for users even though the main operation succeeded.

**Thinking `is_fallback: true` in opportunity responses means something broke.** It means the system deliberately fell back to Groq examples — either quota was hit or the smart router decided a real search was not warranted. This is normal, expected behavior, not an error state.

---

## 11. Final Confidence Checklist

Before you call yourself fully confident in this codebase, you should be able to answer YES to every item below **without looking anything up**:

### Architecture
- [ ] I can draw the middleware chain (all 5 steps) from memory
- [ ] I can explain what `req.user`, `req.workspace`, `req.workspaceProfile`, and `req.membership` each contain and where each is set
- [ ] I can name the three BullMQ queues, their concurrency levels, and what types of jobs each processes
- [ ] I can explain the two-layer caching system (in-memory + Redis) and its TTLs

### Data & Security
- [ ] I can explain why every Supabase query must include `.eq('workspace_id', workspaceId)`
- [ ] I can explain the 4-layer quota system for AI calls (global cap → workspace limit → user limit → smart router)
- [ ] I can explain why `req.user` does NOT contain `product_description`
- [ ] I can trace what happens when a JWT is expired

### Business Logic
- [ ] I can trace the full flow of `POST /api/growth/checkin` end-to-end including the background job
- [ ] I can explain how `discoverOpportunities` decides between a real Exa search and Groq fallback
- [ ] I can explain what `buildUserContext` does and why it exists
- [ ] I can explain how the practice ghost simulation works

### Error Handling
- [ ] I can explain the three levels of error handling (service-level graceful degradation, asyncHandler propagation, global errorHandler)
- [ ] I can explain the difference between a floating promise and a properly queued background job
- [ ] I can explain why Redis failures do not cause HTTP errors for users

### Interviews
- [ ] I can explain the overall architecture in 60 seconds
- [ ] I can explain 3 specific trade-offs in the design and defend them
- [ ] I can answer the 9 simulated interview questions without reading this document

---

*When you can check every box above, you do not just know this codebase — you understand it at the level of someone who built it. That is the goal.*
