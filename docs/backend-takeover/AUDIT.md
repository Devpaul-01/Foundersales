# Backend Audit

Status: **in progress** — this is a living document, updated as work continues.
Last updated: 2026-10-29

## How to read this document

Findings are split into:
- **Confirmed** — reproduced or verified by reading the actual code path end to end (not inferred from naming or docs).
- **Suspected** — strong signal, not yet fully traced; needs more investigation before treating as fact.

Each confirmed finding has a severity, the evidence, and the fix status.

## 0. Context that shapes this audit

This is not a greenfield codebase and it is not an unmaintained one either. The source carries extensive inline
comments (`IMPL-*`, `FIX *`, `Phase 2 refactor`, `Phase 3`) documenting a real prior hardening pass: rate-limiter
namespace collisions, IDOR guards on opportunity endpoints, Redis-backed distributed concurrency control, dual-path
job idempotency races, workspace-membership re-verification on every request. That work is sound and is being
preserved, not redone. This audit is therefore focused on:
1. Gaps that survive careful review — subtle platform-level issues (e.g. module load order) that don't show up by
   reading a single file in isolation.
2. Genuinely unfinished/incomplete functionality.
3. Things that were never in scope for the prior pass (test coverage breadth, `.env.example`, RLS posture).

Explicit non-goals per the person's instructions: no frontend changes, no payment integration, and calendar,
metrics, insights, and onboarding are **protected** — flagged if problems are found, not restructured or removed.

## 1. Confirmed Findings

### 1.1 — CRITICAL — `validateEnv()` cannot catch its own required variables due to ESM import hoisting
**Location:** `backend/src/app.js` (import order), `backend/src/config/supabase.js`, `backend/src/config/validateEnv.js`

`app.js` calls `validateEnv()` early, with an explicit comment claiming it must run "before any other imports touch
process.env values." In practice this guarantee does not hold, because ES module `import` statements are hoisted:
every module in the import graph is resolved and its top-level code executed *before* any statement in the
importing file runs — regardless of where in the file the `import` appears. `supabase.js` calls `createClient()` at
module top-level, and is reachable via `middleware/auth.js`, which is itself imported by `app.js` after `validateEnv`
textually, but that doesn't matter: the whole graph resolves before `validateEnv()`'s function body ever executes.

**Reproduced:** running `node src/app.js` with zero environment variables set does **not** produce validateEnv's
intended clean, per-variable error message. It crashes instead with a raw Supabase SDK stack trace
(`Error: supabaseUrl is required.`) — proving the validator never got a chance to run first.

**Compounding issue, found twice:** `validateEnv.js` checked for `SUPABASE_SERVICE_KEY`, but `supabase.js` actually
reads `process.env.SUPABASE_SERVICE_ROLE_KEY` — a different variable name. Separately, it checked for
`FIREBASE_PROJECT_ID`, but `config/firebase.js` never reads that name at all — it reads `FIREBASE_SERVICE_ACCOUNT`
(a JSON credential blob). Both are the same bug class: the check exists, but checks the wrong name, so it can never
catch the variable actually being missing. Even setting aside the hoisting issue, these two checks were dead
weight — always "passing" or "warning" based on a name nothing else reads. The Firebase instance was caught directly
in this session's own boot verification: with placeholder env vars (no `FIREBASE_SERVICE_ACCOUNT` set), the app
logged `[Firebase] Init failed: "undefined" is not valid JSON` — not a crash (firebase.js already catches that
specific failure gracefully), but exactly the "cryptic runtime failure instead of a clear boot-time message" pattern
this file exists to prevent, confirming the gap wasn't theoretical.

**Impact:** operators cannot trust a clean startup as a signal that required config is present. A misconfigured
deploy can appear to boot fine and then fail unpredictably on first traffic (Supabase) or silently disable a feature
with no clear diagnostic (Firebase/push notifications).

**Related finding, same session:** verifying this fix surfaced a second, independent bug — `config/bullmq.js` threw
synchronously at module import time when `REDIS_URL` was unset, which (due to the same import-hoisting mechanism)
crashed the entire process before `app.listen()`, in all three entry points, even though `validateEnv.js` correctly
classifies `REDIS_URL` as optional. See 1.1b below.

**Fix status:** fixed. `validateEnv.js` now checks `SUPABASE_SERVICE_ROLE_KEY` and `FIREBASE_SERVICE_ACCOUNT`.
`src/index.js`, `src/index.server.js`, `src/index.workers.js` added as true entry points — each imports only
`dotenv` and `validateEnv.js`, calls `validateEnv()`, then dynamically `import()`s the real app/server/workers file,
so validation is structurally guaranteed to run first (a dynamic `import()` is not hoisted, unlike a static one).
`app.js`/`server.js`/`workers/index.js` no longer call `validateEnv()` themselves. `package.json`'s `start`/`dev`
point at `index.js`; `start:api`/`start:worker` scripts added for the split-process entry points.
**Verified:** booting all three entry points with an empty environment now produces validateEnv's clean,
per-variable message and exits — reproduced directly, see PROGRESS.md. Booting with placeholder credentials now
reaches `app.listen()` and the `/health` endpoint responds, confirmed via live `curl`. Regression tests added in
`src/config/__tests__/validateEnv.test.js`.

---

### 1.1b — HIGH — `config/bullmq.js` threw at import time on missing `REDIS_URL`, crashing all three entry points
**Location:** `backend/src/config/bullmq.js`

Found while verifying the 1.1 fix. `bullmq.js` threw synchronously at module top-level if `REDIS_URL` was unset.
Because this file is imported transitively by `jobs/index.js`, which all three entry points (`app.js`, `server.js`,
`workers/index.js`) import statically, the same ESM-hoisting mechanism from 1.1 meant this throw happened before
`app.listen()` — crashing the entire process, including `server.js` (the API-only process, which doesn't even call
`startAllJobs()` and is documented as independent of worker/Redis availability). This directly contradicted
`validateEnv.js`'s own classification of `REDIS_URL` as optional, and `app.js`'s documented design intent ("Start
listening FIRST so a Redis/BullMQ outage never takes down the whole API — only background jobs are affected").

**Reproduced:** booting with placeholder Supabase/Groq credentials and no `REDIS_URL` reached `app.listen()` (the
`🚀 Clutch AI Backend` banner printed) but the process then threw `Error: REDIS_URL env variable is not set` at
import time on a clean run — confirmed by direct `node` execution before the fix, in a background process with
explicit exit-code checking (not just a 5-second timeout, which was ambiguous between "still booting" and "silently
crashed").

**Fix:** `bullmq.js` no longer throws when `REDIS_URL` is absent. It constructs the `IORedis` connection against a
syntactically-valid loopback placeholder instead, which fails at the connection-attempt level — handled by the
file's own existing `retryStrategy`/`reconnectOnError` logic exactly as an unreachable *configured* Redis already
was, rather than crashing at import time. `bullmqConnectionState.status` is `'unconfigured'` in this case so
downstream code can distinguish "never configured" from "configured but down." Retries are skipped immediately
(rather than running the normal 10-attempt backoff) when no URL was ever configured, since retrying a known
placeholder serves no purpose.

**Second-order finding from verifying this fix:** fixing the import-time throw surfaced that `app.js` and
`server.js` had no process-level `unhandledRejection`/`uncaughtException` handler — `workers/index.js` already had
one, but the other two didn't. Once the import-time throw was removed, a later async rejection from BullMQ's
internal Redis-connection handling (occurring outside any call stack this codebase directly controls/awaits) was
still crashing the process a few seconds after it had already started accepting traffic. Added the same safety net
`workers/index.js` already used (log and continue — infrastructure hiccups degrade background jobs, not request
handling) to `app.js` and `server.js` as well, for consistency across all three entry points.

**Verified:** booting with placeholder credentials and no `REDIS_URL` now stays running, serves `/health`
successfully (confirmed via live `curl`), and logs the previously-fatal rejection as a non-fatal warning instead.

**Fix status:** fixed and verified. Regression test added in `src/config/__tests__/bullmq.test.js` (import does not
throw; `bullmqConnectionState.status` is `'unconfigured'`).

---

### 1.2 — MEDIUM — No `.env.example` for the backend
**Location:** repo root / `backend/`

`frontend/.env.example` exists; there is no backend equivalent. Combined with 1.1, a new environment is set up by
guesswork. `validateEnv.js`'s `REQUIRED`/`OPTIONAL_WITH_WARNINGS` lists are the de facto source of truth for what's
needed, but they're buried in code rather than discoverable at setup time.

**Fix status:** planned, bundled with 1.1 (same root cause, same milestone).

---

### 1.3 — INFO (not a defect) — Zero Row-Level Security policies across 48 tables
**Location:** `schema.sql`

No table has `ENABLE ROW LEVEL SECURITY`. This is **not inherently a bug**: the backend exclusively uses
`supabaseAdmin` (the service-role client, which bypasses RLS by design) for all queries — `config/supabase.js`
exports it as the default export and every route/job imports that. RLS would be redundant defense-in-depth here,
not a missing requirement, *as long as every single query path in the application correctly scopes by
workspace/user*. That means tenant isolation is 100% dependent on application code being correct everywhere, with
no database-level backstop if a future query is written carelessly.

Spot-checked so far: `middleware/workspace.js` (`resolveWorkspace`), `routes/opportunities.js` (`GET /:id`,
`PUT /:id/status`, `GET /:id/intel`), `routes/user.js` (`switch-workspace`), `routes/workspaces.js` (`switch`,
`GET /:id`), `routes/calendar.js` (`GET /team/:userId`). All correctly re-verify workspace membership server-side
and scope queries by the resolved `req.workspace.id`, not a client-supplied one. No IDOR found in this sample.

**Recommendation:** document this as a deliberate architectural choice (service-role-only, app-layer-enforced
isolation) in ARCHITECTURE.md, and continue widening the spot-check sample during the remaining milestones,
particularly around the routes not yet reviewed in depth (practice.js, chat.js, growth.js, feedback.js). Adding RLS
policies now, on an app that has never had them, is nontrivial schema work with real risk of breaking legitimate
`supabaseAdmin` queries if done carelessly — not something to do reactively without a specific finding driving it.

---

### 1.4 — LOW — Duplicate workspace-switch endpoints
**Location:** `backend/src/routes/user.js` (`POST /api/user/switch-workspace`) and
`backend/src/routes/workspaces.js` (`POST /api/workspaces/switch`)

Both endpoints do the same thing: validate `workspace_id` is provided, verify active membership, verify the
workspace isn't deleted, update `active_workspace_id`, invalidate both old and new workspace caches. Implementations
have drifted slightly (e.g. `workspaces.js`'s version also returns the role in the response in a specific shape;
`user.js`'s version logs differently) but are functionally redundant. This is the kind of duplicated-logic
complexity the mission asks to simplify — **not acted on yet** because removing one is a contract change that could
affect the frontend (out of scope to modify) if it's calling one specific path. Flagging for a decision rather than
silently picking one.

**Fix status:** deferred — see DECISIONS.md for the question this raises.

---

### 1.5 — LOW — Dependency: `multer` pinned at a vulnerable 1.x line
**Location:** `backend/package.json`

`multer@^1.4.5-lts.1` resolves to `1.4.5-lts.2` on install. The entire 1.x line has known, patched-in-2.x
vulnerabilities per npm's own deprecation warning at install time. Not actively exploited-in-the-wild evidence
found, but worth tracking. Upgrading to multer 2.x is an API-surface change (multer's 2.x has a different error
model) and touches `routes/upload.js` plus wherever upload middleware is used — treating as a tracked follow-up
rather than an immediate fix, since it's not a confirmed live vulnerability in this app's specific usage, just a
flagged dependency.

**Fix status:** tracked in IMPLEMENTATION_PLAN.md, not yet scheduled.

---

### 1.6 — INFO — Test coverage is narrow relative to codebase size
**Location:** `backend/src/**/__tests__`

5 test files, 16 tests total, covering: metrics route (4 tests), provider error classification (4), one job's
workspace-profile-matching fallback logic (3), JSON parser fallback behavior (3), pagination utility (2). No tests
exist for: auth middleware, workspace resolution/membership checks, any opportunities/calendar/practice/goals route,
background job handlers beyond the one above, or any database-integration-level behavior.

All 16 existing tests pass (`npx vitest run`, verified).

**Fix status:** will add targeted regression tests alongside each fix made during this engagement, per the mission's
guidance to test what's touched rather than pad test count. A dedicated "raise coverage on X" milestone is not
currently planned unless a specific fix calls for broader test scaffolding.

## 2. Suspected / Needs Further Investigation

Not yet confirmed — listed so they aren't lost, not yet acted on.

- **practice.js, chat.js, growth.js, feedback.js** route-level workspace/ownership scoping has not yet been
  reviewed as closely as opportunities.js/calendar.js/workspaces.js were. Given the pattern held everywhere checked
  so far, no specific reason to suspect a problem, but not yet verified directly.
- **Background job failure/retry semantics** beyond `backgroundWorker.js`'s calendar-prep consolidation (which was
  read and looks sound) — `messageQueueWorker.js`, `practiceWorker.js`, `scheduledWorker.js` not yet traced for
  idempotency under redelivery.
- **Migration consistency**: `migrations/` contains 15 numbered + 2 unnumbered-looking files
  (`20260719120000_drop_users_archetype.sql`, `add_event_id_to_commitments_signals.sql`) alongside a 4627-line
  `schema.sql`. Not yet verified whether `schema.sql` is kept in sync with the migrations directory, or which one is
  the actual source of truth for a fresh setup.

## 3. Explicitly Protected Areas (per project owner's instructions)

Calendar, metrics, insights, and onboarding functionality must not be removed or restructured as part of combining
this into a single product. Problems found in these areas will be documented here and in IMPLEMENTATION_PLAN.md,
not silently "simplified away."
