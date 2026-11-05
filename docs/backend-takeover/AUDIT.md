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

Reviewed in full (not just spot-checked) as of milestone 2: `middleware/workspace.js` (`resolveWorkspace`),
`routes/opportunities.js` (`GET /:id`, `PUT /:id/status`, `GET /:id/intel`), `routes/user.js`
(`switch-workspace`), `routes/workspaces.js` (`switch`, `GET /:id`), `routes/calendar.js` (`GET /team/:userId`),
`routes/practice.js` (all 8 `:sessionId`-scoped routes, including the multi-step `DELETE` handler), `routes/chat.js`
(all `:chatId`/`:messageId`-scoped routes, including the message-edit handler that checks both identifiers plus a
role constraint), `routes/growth.js` (`:id`-scoped card routes), `routes/feedback.js` (`/history`, `/pending`).

Every identifier-scoped query checked verifies both `user_id`/ownership AND `workspace_id` (or, in
`practice.js`'s case, `user_id` alone, which is stricter) before returning or mutating data — not a client-supplied
workspace/user id, consistently `req.user.id` / the resolved `req.workspace.id`. No IDOR found across this review.
This is a genuine verification result, not an absence of looking: all route files with `:id`-shaped parameters in
the codebase have now been read end to end for this specific concern.

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

**Fix status:** fixed — see DECISIONS.md D3. Deduplicated the logic (one route now delegates to the other's
handler) while keeping both URLs registered, since an external API consumer outside this repo couldn't be ruled
out even though the frontend only uses `/api/workspaces/switch`.

---

### 1.5 — HIGH (upgraded from initial LOW rating) — Dependency: `multer` confirmed vulnerable to 4 real CVEs
**Location:** `backend/package.json`, `backend/src/routes/upload.js`, `backend/src/routes/calendar.js`

Originally flagged at LOW severity based only on npm's generic install-time deprecation warning, deliberately not
treated as urgent without confirming an actual exploit path (see DECISIONS.md D4) — avoided inventing a
vulnerability just because a dependency looked old. Followed up properly rather than leaving it as a permanent
"someday" item: `npm audit` on this project reports no multer entry at all (its data appears to lag GitHub's own
advisory feed for this package specifically). Checked GitHub Advisories/OSV/NVD directly and found the installed
`1.4.5-lts.2` is confirmed vulnerable to four real, high-severity CVEs — most notably CVE-2025-47944 (CVSS 7.5,
unhandled exception/DoS via a malformed multipart request) — all fixed in `2.0.x` or later. This is a dependency
that directly parses user-controlled file uploads in two live routes (`routes/upload.js`'s general file upload,
`routes/calendar.js`'s voice-memo upload), a directly attacker-reachable surface.

**Fix:** checked both call sites use only the stable API surface unchanged across the 1.x/2.x boundary (no
`diskStorage` with custom filenames, no `.fields()`, no `MulterError`-specific handling anywhere in the codebase —
errors flow through the generic handler as plain `Error`s), making this a low-risk upgrade. Upgraded to
`multer@2.5.0`. Verified functionally, not just by import/syntax check: a successful real multipart upload through
the app's exact configuration (correct filename/mimetype/size/Buffer), the `fileFilter` rejection path producing
the same error message as before, and a full app boot + `/health` check, all confirmed clean post-upgrade. The
existing test suite has zero coverage of the upload routes either before or after this change — noted as a gap,
not claimed as covered.

**Fix status:** fixed and functionally verified.

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

### 1.7 — MEDIUM — Two live job handlers re-ran expensive AI calls on BullMQ redelivery
**Location:** `backend/src/jobs/messageQueueWorker.js` — `handleSkillScores`, `handleCoachingAnnotations`

Both jobs are enqueued live (confirmed: `routes/practice.js` enqueues `PRACTICE_SKILL_SCORES` and
`PRACTICE_COACHING_ANNOTATIONS` with `attempts: 3` + exponential backoff, via `practiceWorker.js`). Neither had a
guard against redelivery: a transient failure after the Groq call but before/during the DB write, or a worker
crash/restart mid-job, causes BullMQ to retry the whole job, including the expensive AI generation call, from
scratch — even though the correct end state (an `update()` with fresh results) would be identical to not retrying
at all. `handlePlaybook` in the same file already had exactly this guard (`if (session.playbook_generated) return`)
— just not applied consistently to its two neighbors.

Not a correctness or data-duplication bug (these handlers only `update()`, never `insert()` or notify — unlike
`handleGhost`/`handleReply` below, which were a different, higher-looking-severity pattern that turned out to be
dead code). The real cost is wasted AI spend and latency on every retry.

**Fix:** added an early-skip guard to both handlers — `handleSkillScores` skips regenerating `skill_scores` if
already present on the session (and separately skips `retry_comparison` if already present, since that's an
independent AI call with its own redelivery risk), `handleCoachingAnnotations` returns early if
`coaching_annotations` is already a non-empty array. Matches the existing `handlePlaybook` pattern. The
`checkAndGenerateWeaknessCard` call after skill scoring was deliberately left reachable in both the first-run and
already-scored paths (not swallowed by an early return) because it has its own independent 14-day cooldown
idempotency guard in `practiceWeaknessDetector.js` — layering a second, cruder guard in front of an
already-self-protecting function would've been redundant and risked suppressing it in the crash-between-steps case.

**Related, downgraded finding:** `handleGhost` and `handleReply` in the same file have a more serious-looking
pattern (an `insert()` and a `notifyUser()` call with no redelivery guard at all — genuinely would create duplicate
chat messages and duplicate push notifications on retry). Investigated whether this is reachable: it is not.
Confirmed by grep that `QUEUE_JOB_TYPES.PRACTICE_GHOST` and `PRACTICE_REPLY` are never enqueued anywhere in the
live codebase — the file's own comments say so accurately ("kept for legacy completeness... never enqueued from
the message route") — and README.md independently, transparently discloses the same thing under "Dead code kept
intentionally, not cleaned up yet," confirming this investigation reached the same conclusion already on record.
That phrasing ("not cleaned up yet") reads as an acknowledged backlog item, not a deliberate preserve-at-all-costs
choice, so removed in a follow-up pass (see below) rather than left as a permanent cleanup candidate.

**Follow-up fix:** removed `handleReply` and `handleGhost` entirely, along with their `PRACTICE_REPLY`/
`PRACTICE_GHOST` dispatch cases and the now-unused `PRACTICE_SCENARIOS` import. Before removing, specifically
checked whether `DELIVERY_STATUS.GHOSTED` (the delivery-status value `handleGhost` used to set) was also safe to
touch — it was not: `routes/practice.js`'s live V3 path writes `'ghosted'` directly, and the frontend
(`PracticeSessionPage.tsx`, `api/types.ts`) actively reads and displays it. Left `DELIVERY_STATUS.GHOSTED`
untouched; only the dead handler functions and their dispatch wiring were removed. Also left
`QUEUE_JOB_TYPES.PRACTICE_REPLY`/`PRACTICE_GHOST` in `constants.js` alone — removing two unused string constants
was marginal benefit for a small added risk versus the actual complexity reduction, which was the dead logic
itself.

**Fix status:** fixed and verified (full test suite passing). No targeted regression test added for the guard
itself — exercising it meaningfully would require mocking Groq + Supabase + asserting the AI service was *not*
called on a second invocation, which is a heavier integration-test investment than this specific, moderate-severity
fix justifies on its own. Flagged in IMPLEMENTATION_PLAN.md as a candidate if job-handler test coverage becomes a
dedicated milestone.

---

### 1.8 — HIGH — `pattern_insights` job was enqueued but had no registered handler — always failed
**Location:** `backend/src/jobs/scheduledWorker.js`, `backend/src/jobs/patternDetectionJob.js`

`patternDetectionJob.js` enqueues a `'pattern_insights'` job onto `scheduledQueue` on completion of every
`pattern_detection` run (both its early-return and normal-completion code paths — confirmed these are mutually
exclusive, not a double-enqueue). `scheduledWorker.js` imports `runPatternInsightsJob` from
`patternInsightsJob.js` — a fully implemented job function — but never added it to the `HANDLERS` dispatch map.
Every enqueued `pattern_insights` job therefore hit the worker's `if (!handler) throw new Error(...)` branch,
failed, retried twice (`attempts: 2`), and was dead-lettered. `runPatternInsightsJob` could not run in production.

This wasn't an oversight born of carelessness — both `scheduledWorker.js` and `registerSchedules.js` carried
explicit comments showing a prior author correctly reasoned through the *adjacent* risk (don't add a second cron
entry for `pattern_insights`, since it's meant to be chained off `pattern_detection`'s completion, and registering
it both ways would double-execute it) and flagged it as unverified against the live system. The verification
never happened; the actually-needed fix (the missing `HANDLERS` entry) was never made either, even though the
investigation correctly identified where the real registration needed to happen.

**Verified:** confirmed via direct grep + read of `patternDetectionJob.js` that `pattern_insights` is genuinely
chained, not cron-driven — a second cron entry would be wrong, consistent with the original caution. Confirmed via
grep that `runPatternInsightsJob` had zero call sites anywhere in the codebase before this fix.

**Fix:** added `pattern_insights: runPatternInsightsJob` to `scheduledWorker.js`'s `HANDLERS` map. No new cron
entry added (would reintroduce the double-execution risk the original comment correctly avoided).
`registerSchedules.js`'s comment updated to record the verification as resolved rather than left open.

**Fix status:** fixed. `HANDLERS` and `SCHEDULES` were both un-exported internal consts; exported both (the only
change needed to make them testable, no behavior change) and added
`src/jobs/__tests__/scheduledWorker.test.js`, asserting every name in `SCHEDULES` plus `pattern_insights`
specifically has a registered handler. Verified the test has teeth, not just that it passes: temporarily reverted
the `HANDLERS` fix and confirmed the test fails with the exact "expected function, got undefined" assertion before
restoring the fix and re-confirming it passes.

### 1.9 — HIGH — `schema.sql` was missing one migration's changes; a fresh setup would break two live calendar query paths
**Location:** `schema.sql`, `migrations/add_event_id_to_commitments_signals.sql`

README.md explicitly documents `schema.sql` as the single artifact a fresh setup applies to a new Supabase
project ("The database schema is a single `schema.sql` file applied directly to the target Supabase project").
This was checked directly rather than assumed: every numbered migration (`002` through `014`) and the other
unnumbered migration (`20260719120000_drop_users_archetype.sql`) were traced against `schema.sql`'s current table
definitions and all are correctly reflected — `schema.sql` genuinely is kept current for those.

One migration was the exception: `migrations/add_event_id_to_commitments_signals.sql` (dated 2026-08-17) adds an
`event_id` column, a foreign key to `user_events(id)`, and an index to both `conversation_commitments` and
`conversation_signals`. None of this was present in `schema.sql`. Confirmed this isn't a theoretical gap: three
live query sites — `routes/calendar.js` (two call sites) and `jobs/backgroundWorker.js` — filter both tables with
`.eq('event_id', ...)`. A database provisioned from `schema.sql` alone, exactly as the README's setup
instructions describe, would be missing this column entirely, and these three query paths (part of the explicitly
protected calendar feature) would fail with a Postgres "column does not exist" error.

**Fix:** added the `event_id uuid` column, the two FK constraints (matching the exact formatting and `ON DELETE
SET NULL` semantics of four other `event_id` FK constraints already in the file, e.g. `chats_event_id_fkey`), and
the two indexes to `schema.sql`, placed alongside each table's existing constraints/indexes and commented with a
pointer back to the migration file and this audit entry, so a future reader can see why these particular entries
look newer/differently-dated than their neighbors.

**Verification limitation, stated plainly:** this sandbox has no `psql`/`pg_dump`/Postgres available to actually
execute the edited `schema.sql` against a real database and confirm it applies cleanly. The edit was made by
precise structural matching — the new column, constraint, and index blocks are byte-for-byte consistent in format
with multiple existing, presumably-already-verified blocks in the same file, and the column/table/constraint names
were cross-checked character-for-character against the original migration file. This is high confidence, not
proof. Recommend running this against a real (even local/throwaway) Postgres instance before relying on it for an
actual fresh deployment, and flagging that explicitly rather than claiming it's confirmed working.

**Secondary, minor finding from the same investigation, fixed separately (see 1.10):** `conversation_commitments`
had two exact-duplicate indexes on `prospect_id` — `idx_commitments_prospect` and `idx_commits_prospect`.

**Fix status:** fixed, with the verification limitation above stated honestly rather than glossed over.

### 1.10 — LOW — Duplicate index on `conversation_commitments.prospect_id`
**Location:** `schema.sql`, new `migrations/015_drop_duplicate_commitments_prospect_index.sql`

Found during the milestone 4 schema review: `idx_commitments_prospect` and `idx_commits_prospect` were exact
duplicates (same table, same column, same index type) — almost certainly from two separate migration passes that
each independently indexed the table without checking what the other had already added. The table's indexes
overall split into two naming "families" (`idx_commitments_*` and `idx_commits_*`), suggesting this happened more
than once in this table's history, though `prospect_id` was the only *exact* duplicate — the other
`idx_commits_status`/`idx_commits_workspace`/`idx_commits_ws_user` indexes cover different column combinations
than their `idx_commitments_*` counterparts, so they're not clear-cut duplicates in the same way, and weren't
touched. Deciding whether that broader set is individually justified is real query-pattern/performance-tuning work
this review can't do without a live database and real traffic data — scoped this fix narrowly to the one
confirmed, unambiguous duplicate.

Confirmed by repo-wide grep that neither index name is referenced by any application code or tooling, so removing
either is safe — kept `idx_commitments_prospect` (listed first in the file) as canonical.

**Fix:** removed the `CREATE INDEX idx_commits_prospect` statement from `schema.sql` (the fresh-install artifact —
a new database built from it now simply never creates the duplicate). For any database already built from the old
`schema.sql` (which `DECISIONS.md`/`AUDIT.md` can't know the state of from this codebase alone), added
`migrations/015_drop_duplicate_commitments_prospect_index.sql` — a forward-only, non-destructive `DROP INDEX IF
EXISTS`, safe to run at any time, drops only the redundant index structure, not any data or the identical index
that remains.

**Fix status:** fixed.

### 1.11 — CRITICAL — `schema.sql` could not actually be applied to a fresh database at all
**Location:** `schema.sql`, `README.md`

The person running this engagement offered to install Postgres and Redis locally, which made it possible to
actually execute `schema.sql` against a real, empty database for the first time, rather than relying on the
structural-match confidence stated in 1.9/1.10. This surfaced a genuine, critical bug that no amount of reading
the file would have caught with full confidence: **applying `schema.sql` to a fresh database failed partway
through**, with cascading `relation "X" does not exist` errors across `workspace_members`, `prospects`, `chats`,
`user_goals`, `objection_tracker`, and `workspace_activity`.

Root cause, confirmed precisely: `pg_dump` output sections functions before tables. Most function bodies in
Postgres are late-bound (not checked against the catalog until first call), so referencing a not-yet-created table
inside a function body is normally harmless at `CREATE FUNCTION` time. But two patterns in this file's functions
are NOT late-bound: PL/pgSQL `%ROWTYPE` variable declarations (e.g. `v_member workspace_members%ROWTYPE` in
`accept_workspace_invite`, which needs to know the table's structure immediately to compile) and `LANGUAGE sql`
function bodies (which Postgres parses/validates eagerly, unlike `plpgsql`). Every one of the ~24 functions in this
file was defined before any table, so every function using either of these two patterns failed at creation time.

**Fix:** moved the entire function-definition block (originally lines 22–645) to immediately after the last table
definition, with no change to any function's or table's actual SQL — purely a reordering. Verified precisely: the
extracted block's line count matched the original exactly before and after relocation (no content lost or
duplicated), and a diff-equivalent check (table/function/index counts) confirmed nothing else changed.

**Second, related finding from the same live test:** `schema.sql` has no `CREATE EXTENSION` statements at all
(expected — `pg_dump` doesn't include them; Supabase manages extensions separately, e.g. via its dashboard), and
the file turned out to depend on a specific, non-default extension layout for this particular project: `pg_trgm`
installed in the `public` schema (confirmed by its trigram indexes being schema-qualified to
`public.gin_trgm_ops`), while `uuid-ossp` is used via `extensions.uuid_generate_v4()` — a genuinely mixed setup,
not the "everything in `extensions`" pattern Supabase defaults to for new projects. README.md documented none of
this. A developer following its "schema.sql applied directly" instruction on a real fresh Supabase project would
hit `operator class "public.gin_trgm_ops" does not exist` with no guidance.

**Fix:** added a prerequisites note to README.md's Configuration section, documented precisely (which extension,
which schema, confirmed by the exact error message a developer would see without it) rather than vaguely. Also
fixed README.md's Configuration section separately citing the stale `SUPABASE_SERVICE_KEY`/`FIREBASE_PROJECT_ID`
names already fixed in code during milestone 1 but never updated in the README prose — found while editing the
same section for the extension note.

**Verified, genuinely, by execution — not just read:** this environment now has Postgres 16 and Redis installed
locally (`apt-get install postgresql redis-server`). Built a baseline matching the documented prerequisites exactly
(a minimal `auth.users`/`auth.uid()` stub, since this schema assumes a real Supabase `auth` schema that a plain
Postgres instance doesn't have — this stub is a test-only accommodation, not something `schema.sql` or the app
needs; `extensions` schema with `uuid-ossp`/`pgcrypto`; `pg_trgm` in `public`) and applied the actual, fixed
`schema.sql` file exactly as README instructs. Result: all 48 tables created, 55 functions (including Postgres's
own trigger-support functions), 241 indexes, and the `event_id` columns/constraints from 1.9 and the de-duplicated
index from 1.10 all present and correct. The only remaining message is `schema "public" already exists` at the
file's very first statement — confirmed via external sources (Prisma's own Postgres-migration docs state this
explicitly) to be expected, harmless, and reported by every tool restoring this kind of dump to any real target
(Supabase, Neon, Prisma Postgres, vanilla Postgres all pre-create `public`), not a defect in this file.

**What this changes about 1.9/1.10's earlier "no Postgres available, high confidence not proof" caveat:** that
caveat is resolved for the file as a whole — it now demonstrably applies successfully end to end, including both
of those earlier fixes, verified by actual execution in this same test.

**Fix status:** fixed and verified by real execution against Postgres 16.

### 1.12 — HIGH — `services/redis.js` hardcoded TLS, silently breaking non-TLS Redis for 7 files' worth of callers
**Location:** `backend/src/services/redis.js`

Found while running the live boot test for 1.11 (real Postgres/Redis, not placeholders) — this would not have
been caught by any amount of reading, since the bug only manifests when the app actually tries to use a working,
non-TLS `REDIS_URL`, a scenario the earlier milestones never exercised (prior tests used either no `REDIS_URL` at
all, or a deliberately-unreachable placeholder for the `config/bullmq.js` fix).

`getClient()` in this file unconditionally set `socket: { tls: true, servername: hostname }` regardless of whether
`REDIS_URL` actually used `rediss://` (TLS) or plain `redis://`. `config/bullmq.js`'s separate IORedis connection
already derives this correctly from the URL scheme (`isTLS = REDIS_URL.startsWith('rediss://')`) — this file did
the same hostname-parsing-for-SNI work but then ignored the scheme entirely.

**Confirmed live, not inferred:** booting against a real, local, plain `redis://127.0.0.1:6379` Redis instance
logged `[Redis] getRawClient() failed: tls socket option is set to true which is mismatch with protocol...`, and
every one of this client's 7 callers (`rateLimitStore.js`, `middleware/auth.js`, `middleware/workspace.js`,
`utils/concurrencyGuard.js` — the distributed-locking utility this review already trusted for race-condition
protection — `routes/insights.js`, `routes/metrics.js`, `routes/goals.js`) silently fell back to per-instance/
no-op behavior instead of actually using Redis. Note this is a *different* Redis client than `config/bullmq.js`'s
— BullMQ connected successfully in the same boot, confirming the bug was isolated to this file, not a general
Redis-reachability problem.

This is not a narrow edge case: a plain, non-TLS Redis is the common case for local development, self-hosted
Redis, and Docker Compose setups — anything that isn't a managed TLS-terminated provider like Upstash. Every one
of those legitimate setups would have silently lost rate limiting, workspace/auth caching, and distributed locking
with zero functional error — just a degraded-mode log line easy to miss.

**Fix:** derive `isTLS` from the URL scheme exactly as `config/bullmq.js` already does, and only set TLS socket
options when `isTLS` is true (omit entirely otherwise, matching the `node-redis` package's expected shape for a
non-TLS connection).

**Verified by actual execution, not just syntax check:** re-ran the same live boot test after the fix. Log now
shows `[Redis] Connected` and `[RateLimit] Redis-backed rate limit store initialized (namespace: "auth")` instead
of the failure/fallback messages. Confirmed via `redis-cli keys "*"` that the app actually wrote real state to the
real Redis instance during this boot (21 BullMQ schedules registered across three queues). Full test suite (23/23)
still passing.

**Fix status:** fixed and verified by real execution against a live, non-TLS Redis instance.

### 1.13 — MEDIUM — `backgroundWorker.js`: systematic idempotency trace, one real gap found and fixed
**Location:** `backend/src/jobs/backgroundWorker.js`

Milestone 1's initial read of this file looked sound but wasn't re-traced with the same systematic rigor
Milestone 3 gave `messageQueueWorker.js`/`scheduledWorker.js`. Closed that gap: read all 15 handlers plus the
services they delegate to, and confirmed `backgroundQueue` has `defaultJobOptions: { attempts: 3, ... }` applied
queue-wide (`jobs/queues.js`), meaning every handler here is genuinely subject to redelivery unless a specific
`.add()` call overrides it — not just the ones with visible `attempts:` at the call site.

Result: 13 of 15 handlers are correctly guarded, several explicitly and well-commented (`CALENDAR_PREP_GENERATE`'s
"Layer 1 idempotency" re-check, `CALENDAR_UPDATE_PROSPECT_HEALTH`'s explicit "no guard needed — recomputes from
source data" comment, `voiceMemoService.js`'s `transcribeMemo`/`enrichMemo` both explicitly marked
`// idempotency guard`). `CALENDAR_EXTRACT_COMMITMENTS_SIGNALS`, `CALENDAR_GENERATE_FOLLOWUP`, `CHAT_SUMMARIZE`,
`CHECKIN_TIP_GENERATE`, `FIRST_TIME_CARDS_GENERATE` all check prior-completion state before doing anything.
`PROSPECT_DEDUP_SCAN` is a read-and-flag scan, naturally safe to re-run.

**One confirmed gap:** `TIP_CARD_GENERATE` had no guard at all — a plain `insert()` after a Groq call, structurally
identical to its two well-guarded neighbors (`FIRST_TIME_CARDS_GENERATE`, `CHECKIN_TIP_GENERATE`) but missing their
"already generated today" check. A transient failure after the Groq call but before/during the insert, or a
worker crash/restart mid-job, would redeliver and insert a second, user-visible duplicate growth card — not just
wasted AI spend.

**Fix:** added the same "already generated today" date-window guard its siblings already use, scoped to
`generated_by = 'goal_note_ai'`. **Deliberate tradeoff, stated plainly:** a precise per-goal-note guard (filtering
on the `metadata.goal_id` this insert already sets) would be tighter, but this environment has no way to verify
that specific PostgREST JSONB-path filter shape against a real Supabase project (see the app↔real-Supabase gap
noted in PROGRESS.md), and an incorrectly-shaped guard that silently never matches is worse than no guard — false
confidence duplicates are prevented when they aren't. Used the proven-correct, coarser pattern instead. Real
consequence of the coarser guard: if a user logs two separate goal notes that each trigger `needs_tip_card` on the
same day, only the first produces a tip card — previously both would have (correctly, no bug there before this
fix). This is a minor, known, intentional narrowing in exchange for closing a real duplicate-card bug with a
verifiable fix rather than an unverifiable precise one. Noted as a candidate to tighten once the app↔Supabase
verification gap is closed (see PROGRESS.md).

**Second gap, investigated and flagged rather than fixed:** `SEED_MEMORY` (`groq-onboarding.js`'s
`seedMemoryFromOnboarding`) has a `MEMORY_CAP` that bounds unbounded growth but does not actually prevent
duplicate-ish facts from being inserted on a genuine redelivery of the same job (confirmed reachable: its two
real call sites in `routes/onboarding.js` use no `jobId`/`attempts` override, so they inherit the queue's
`attempts: 3`). Not fixed here: this sits inside the explicitly protected onboarding flow, and the right fix shape
is a genuine product judgment call this review isn't positioned to make unilaterally — e.g. should a retry
re-extract facts fresh (current behavior, bounded by the cap), or should it skip entirely if any onboarding-sourced
facts already exist for this user? Flagging for the person's decision rather than guessing.

**Fix status:** `TIP_CARD_GENERATE` fixed and verified (syntax check, full test suite 23/23). `SEED_MEMORY` flagged,
not fixed — see IMPLEMENTATION_PLAN.md.

### 1.14 — LOW/INFO — `routes/auth.js` full read (full audit, file 1 of 80)
**Location:** `backend/src/routes/auth.js`

Full read against the checklist in FULL_AUDIT_PLAN.md.

- **Rate limiting**: initially looked like `/set-password`/`/reset-password` (which take `access_token` and
  `new_password` directly in the body, no header) had zero rate limiting, since no limiter is visible anywhere in
  this file for them. Traced further before concluding anything: `app.js` mounts this entire router behind
  `LIMITERS.authLimiter` (10 requests / 15 min / IP, correctly keyed, `/refresh` explicitly exempted) at the mount
  point, not per-route inside this file. Confirmed this covers the whole router. Not a bug — just something that
  required tracing past this file's own contents before concluding anything.
- **`/logout`'s dead `refreshSession()` call — fixed.** Called `supabaseAdmin.auth.refreshSession({ refresh_token
  })` with a comment claiming it was "trying to revoke" the token, result discarded. Verified against Supabase's
  own documentation: `refreshSession()` has no revocation semantics at all — it mints a new access/refresh token
  pair. This did nothing toward logout; the `admin.signOut(token)` call just above it is what actually revokes the
  session. Removed as dead weight (an unnecessary extra Auth API call on every logout).
- **`/logout`'s sign-out scope — flagged, not changed.** `admin.signOut(token)` is called with no `scope` argument,
  which defaults to `"global"` per Supabase's docs — every logout revokes *all* of that user's sessions on every
  device, not just the current one. This might be the intended behavior, but it's a real product/security decision
  (`"global"` vs `"local"` vs `"others"`) this review isn't positioned to silently change. Flagging it as a
  characteristic worth confirming is intentional, not changing it.
- **Access tokens are never revoked on logout** — confirmed via Supabase's own docs this is expected, standard JWT
  behavior (access tokens remain valid until their encoded expiry regardless of sign-out; only the refresh token is
  revoked, preventing new ones from being minted), not a defect in this codebase. The actual mitigation for this
  (shorter JWT expiry) is a Supabase project *configuration* setting, not application code — out of scope to "fix"
  here, noted only for completeness.
- Removed one stray, orphaned comment block (a `// POST /api/auth/reset-password` header with no route beneath it
  — the real route is defined earlier in the file; this was leftover dead text, not a duplicate route).
- Everything else read clean: `/register`, `/login`, `/refresh`, `/me`, `/profile/ensure`, `/google/url`,
  `/google/callback`, `createUserWithWorkspaceRetry`, `deleteAuthUserWithRetry` all handle errors sensibly, use
  `req.user.id` correctly where authenticated, and the retry helpers have sensible backoff and duplicate-key
  handling.

**Fix status:** `/logout`'s dead call removed and verified (syntax check, full test suite). Sign-out scope flagged
for confirmation, not changed.

### 1.15 — LOW — `routes/commitments.js` full read (full audit, file 2 of 80)
**Location:** `backend/src/routes/commitments.js`

Full read against the checklist. `GET /`, `PUT /:id` both correctly scoped by `workspace_id`/`user_id`.
`updateCommitmentProspectHealth` already carries its own `FIX MED-04` comment from a prior pass fixing exactly
this class of issue (missing `workspace_id` on an update). `GET /` has no `requirePermission` call unlike the
write routes — checked this isn't a gap: `app.js` applies `authenticate`/`resolveWorkspace` to the whole router at
the mount point, so the route is still properly authenticated/workspace-scoped; it just doesn't add an extra
role-floor beyond "active member," which is the normal, correct pattern for a read endpoint.

**One real, low-severity finding, fixed:** `POST /:id/generate-message`'s final `update()` (saving the generated
follow-up message) filtered only by `.eq('id', commitment.id)` — missing the `workspace_id`/`user_id` scoping
every other query in this file applies, including the explicit prior fix for this exact category of bug a few
lines below it. Not actually exploitable as written: `commitment.id` only reaches this line via the `select()`
immediately above, which already verifies ownership — but inconsistent with the file's own established pattern,
and a future edit that reorders or reuses this code could silently lose that protection. Tightened to match.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.16 — LOW — `routes/followup.js` full read (full audit, file 3 of 80)
**Location:** `backend/src/routes/followup.js`

Full read against the checklist. `/unviewed-count`, `/:id/sent`, `/:id/dismiss` all correctly scoped by
`workspace_id` and (`user_id` OR `assigned_to`). Verified, not assumed: this file's `/sent`/`/dismiss` routes carry
a comment claiming `.or()` combined with `.select()` on an UPDATE produces an invalid-SQL error in PostgREST, and
deliberately avoid it by splitting into a scoped `fetch` then an `id`-only `update`. Confirmed via Supabase's own
troubleshooting documentation: this is a real, specifically-documented PostgREST bug (pre-14.4, `or()` on a
mutation combined with `select=`/`return=representation`) with exactly this workaround as one of the two
officially recommended fixes. Not a bug to correct — the existing workaround is the right one, already correctly
applied consistently across both routes.

**One real, low-severity finding, fixed:** `GET /`'s "mark opportunities as viewed" update filtered only by
`.in('id', ids)` — missing the `workspace_id` scoping `/sent`/`/dismiss` both correctly apply. Not actually
exploitable as written (`ids` only ever comes from the workspace-scoped `select()` immediately above), but
inconsistent with the rest of the file. Fixed by adding `.eq('workspace_id', workspaceId)` — a plain `.eq()`, not
`.or()`, so it doesn't reintroduce the PostgREST mutation bug just confirmed above.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.17 — MEDIUM — `routes/goals.js` full read (full audit, file 4 of 80)
**Location:** `backend/src/routes/goals.js`

Full read against the checklist. This is also the file enqueuing the `TIP_CARD_GENERATE` job fixed in milestone 7
(AUDIT.md 1.13) — the full file had never been read, only that one call site.

**Real finding, fixed:** `DELETE /:goalId/notes/:noteId` verified the goal belongs to the requesting user/workspace,
but the actual delete (`'goal_notes'.delete().eq('id', noteId).eq('user_id', userId)`) never verified `noteId`
actually belongs to `goalId` — only that both the goal and the note separately belong to this user. The URL's own
shape implies that relationship; the code didn't enforce it. Concretely: a request with a `goalId` the user owns,
paired with a `noteId` belonging to one of their *other* goals, would still delete it. Scoped to the same user only
(not a cross-user issue), but a real logic gap, not just a defense-in-depth tightening like the other findings in
this file. Fixed by adding `.eq('goal_id', goalId)` to the delete filter.

**Lower-severity, fixed for consistency:** `PUT /:id` and `DELETE /:id`'s actual mutations filtered only by
`.eq('id', id)` — ownership verified in a preceding `select()`, not re-applied on the mutation itself, same pattern
already fixed in `commitments.js` (1.15) and `followup.js` (1.16). Not exploitable as written; tightened to match.

**Flagged, not fixed — database-level design note:** `POST /:goalId/notes` calls
`rpc('increment_goal_progress', { p_goal_id, p_delta })`. Checked the RPC definition in `schema.sql`: it's a bare
`UPDATE user_goals SET current_value = ... WHERE id = p_goal_id`, with no workspace/user scoping parameter at
all — it relies entirely on the caller having already validated ownership. Confirmed this route does validate
ownership before calling it (via the `goal` fetch at line 77), and confirmed by repo-wide grep this is the RPC's
*only* call site in the entire codebase, so there's no current exploit path. But the RPC itself has no
defense-in-depth: any future caller that invokes it without first checking ownership would have a direct IDOR.
Not fixed here — rewriting a database RPC's signature/body is exactly the kind of schema change the mission asks
to be cautious about without first checking every consumer and migration implication, and there's no live defect
to justify it today. Noting it as a design characteristic worth knowing about for whoever adds the next caller.

**Fix status:** the two real logic gaps (notes delete, PUT/DELETE scoping) fixed and verified (syntax check, full
test suite). RPC design note flagged only.

### 1.18 — LOW — `routes/insights.js` full read (full audit, file 5 of 80)
**Location:** `backend/src/routes/insights.js`

Full read of all ~25 route handlers (1238 lines, the largest file reviewed so far) against the checklist.

Notably well-written: every self-scoped read/write correctly filters by `workspace_id`+`user_id`, every
workspace-wide aggregation route correctly requires `manager` or `owner` via `requirePermission`. The file's own
comments document two real bugs a prior pass already found and fixed in `/intelligence` (an undefined
`INTELLIGENCE_TTL_S` reference and a call to a `generateRuleBasedInsights` function that didn't exist anywhere —
together these meant the endpoint 500'd on every request regardless of AI success) — verified these are genuinely
fixed now (the constant is a real import, the function is a real implementation in `services/intelligenceReport.js`
not yet separately read in this pass), not just claimed fixed by a stale comment.

**One real, low-severity finding, fixed:** `DELETE /patterns/:id` verified ownership via a preceding `select()`,
but the dismiss `update()` itself filtered only by `.eq('id', req.params.id)` — the same "verified-then-unscoped
mutation" pattern now found and fixed in four consecutive files (`commitments.js` 1.15, `followup.js` 1.16,
`goals.js` 1.17). Not exploitable as written; tightened to match `/weekly/dismiss/:id` just below it in the same
file, which already does this correctly.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.19 — HIGH — `routes/metrics.js` full read (full audit, file 6 of 80)
**Location:** `backend/src/routes/metrics.js`

Full read of all ~30 route handlers (1549 lines, the largest file reviewed in this pass) against the checklist.
Like `insights.js`, this file's own comments document several real prior fixes (explicit "Fix 2," "Fix 3," "Fix:"
labels throughout, matching the pattern this review has found repeatedly), and its very first comment block
already explicitly states the exact bug class found twice below: *"a user can belong to more than one workspace —
without this filter, a multi-workspace user's stats bleed across workspaces."*

**Real, HIGH-severity finding, fixed — found twice:** `GET /achievements` and `GET /practice/summary`'s badge
count both queried `practice_badges` (and `/achievements` also `practice_drills`) filtered only by `.eq('user_id',
userId)` — with **no `workspace_id` filter at all**, unlike every other one of the ~28 other handlers in this
file. Confirmed both tables have a `NOT NULL workspace_id` column in `schema.sql`. This is not a
defense-in-depth gap like the "verified-then-unscoped mutation" pattern found in the four prior files (1.15–1.18)
— there was no scoping here to begin with. For any user who belongs to more than one workspace, both endpoints
would return badges/drills earned across *every* workspace they're a member of, combined — a real, live,
cross-workspace data leak, reachable by any authenticated user with multi-workspace membership, exactly the
scenario this file's own top-of-file comment already identified as the reason to scope by workspace elsewhere.

**Fix:** added `.eq('workspace_id', workspaceId)` to both `practice_badges` queries and the `practice_drills`
query in `/achievements`.

**Resolved a self-flagged open question:** the workspace leaderboard scoring formula (`/workspace/leaderboard`)
carried a comment explicitly saying `skill_score`'s 0–10 scale assumption was "worth double-checking against how
skill_progression is actually populated." Traced it: confirmed genuinely 0–10, by design — conversation-derived
axes come straight from already-0–10 fields, and practice-derived axes are explicitly divided by 10 before being
blended in, a deliberate, separately-documented normalization (`FIX HIGH-12`) specifically because the raw
practice axes are natively 0–100. The formula's `* 2` scaling is correct. Updated the comment to record this as
resolved rather than leave it open for the next reader to redo.

**Dead code removed:** a local `generateRuleBasedInsights(profile, pipeline, goals, objections, patterns,
stalledDeals)` function had zero call sites anywhere in this file. Its own comment described a fix to its call
signature from "the `/intelligence` catch block" — but there's no `/intelligence` route in this file; that route
now lives in `insights.js` (confirmed while auditing that file, 1.18) and imports a *different*,
differently-signatured `generateRuleBasedInsights(context, metrics)` from `services/intelligenceReport.js`.
Genuinely orphaned by whatever refactor moved `/intelligence` out of this file, never cleaned up. Removed —
verified zero references in the file or its test file before removing.

**Fix status:** fixed and verified (syntax check, full test suite including the file's own existing
`metrics.test.js`, which covers the three exported pure helpers unaffected by these changes).

### 1.20 — INFO — `routes/onboarding.js` full read (full audit, file 7 of 80)
**Location:** `backend/src/routes/onboarding.js`

Full read against the checklist. This file is explicitly protected per the project owner's instructions
(calendar, metrics, insights, onboarding — don't remove or restructure). Treated accordingly: only genuinely
risk-free cosmetic cleanups made, nothing touching actual onboarding logic or behavior.

Every query correctly scoped by `workspace_id`+`user_id`. The `ConcurrencyGuard` section documents a real, subtle,
already-fixed distributed-systems bug (a local-pending-array deadlock under multi-instance load) — read carefully,
confirmed the fix described matches the current implementation, not touched further.

**This is also the file containing both `SEED_MEMORY` call sites** flagged but not resolved in milestone 7
(AUDIT.md 1.13). Reading both in full context sharpens that flag:
- `POST /rebuild-voice-profile` enqueues with `isRebuild: true`. Re-checked `seedMemoryFromOnboarding`
  (`groq-onboarding.js`): the `isRebuild: true` path already clears stale onboarding-seeded memories before
  reseeding — genuinely redelivery-safe, a real retry just clears-and-reseeds again, no duplication. Not a gap.
- `POST /answers` (fresh onboarding completion) enqueues with `isRebuild: false` — this is the path with no
  redelivery protection, confirmed precisely now rather than inferred. Bounded, not unbounded: `MEMORY_CAP = 100`,
  and a single seeding run inserts "8-10 key facts" per its own prompt, so a worst-case single redelivery adds
  roughly 8-10 duplicate-ish facts out of a 100-fact cap, not uncontrolled growth. Milestone 7's framing of this
  as a bounded, product-judgment-call item (skip-if-already-seeded vs. the current re-extract-and-cap behavior)
  stands, now with this more precise severity bound. Still not fixed — still the person's call, inside protected
  functionality.

**Two trivial, zero-behavior-change cleanups made:** a comment (`// GET /api/onboarding/status`) was accidentally
duplicated on two consecutive lines above the route it describes; both `SEED_MEMORY` enqueue calls had a stray
`// ✅ ADD THIS` edit-marker comment and slightly inconsistent indentation left over from whatever edit added the
`workspaceId` field. Fixed purely as whitespace/comment hygiene — no logic, query, or behavior touched.

**Flagged, not acted on:** a comment header `// POST /api/onboarding/voice-profile/regenerate` has no route
beneath it. Unlike the clearly-dead leftover comment found and removed in `auth.js` (1.14) — where the real route
was confirmed to still exist elsewhere in that file — this reads more like a planned-but-never-built feature
marker than cruft from a completed refactor. Given the explicit protection on this file, left alone rather than
guessing which case it is.

**Fix status:** two trivial cosmetic fixes made and verified (syntax check, full test suite). `SEED_MEMORY`'s
flag sharpened with precise severity bound, not independently resolved — still awaiting the person's decision from
milestone 7.

### 1.21 — LOW — `routes/pipeline.js` full read (full audit, file 8 of 80)
**Location:** `backend/src/routes/pipeline.js`

Full read against the checklist. File's own comments document three real prior fixes ("FIX 1" route-ordering,
"FIX 2" workspace-wide manager assignment scope, "FIX 3" manager-vs-member deal visibility, "FIX 5" removing
member-level delete access) — same pattern of genuine prior care seen throughout this audit. `GET /:id`'s and
`PATCH /:id/deal-value`'s cross-table `feedback` queries (filtered only by `opportunity_id`, not re-stating
`workspace_id`) checked and confirmed safe: the `opportunity_id` used is only ever one already verified against
`workspace_id` in a preceding query on the same request, same reasoning already established for similar patterns
in `opportunities.js` (milestone 2).

**Two real, low-severity findings, fixed:** `PUT /:id/stage` and `PUT /:id/assign` both had their final
`update()` filtered only by `.eq('id', id)` — missing `workspace_id`, unlike `PATCH /:id/deal-value`'s update
flow and `DELETE /:id` elsewhere in the same file (both correctly re-apply workspace scoping on the mutation).
Same "verified-then-unscoped mutation" pattern now found in six files across this audit. Not exploitable as
written (`id` only reaches each mutation via an already workspace-verified `select()` immediately above); tightened
both to match the file's own established pattern.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.22 — INFO — `routes/prospects.js` full read (full audit, file 9 of 80) — clean
**Location:** `backend/src/routes/prospects.js`

Full read against the checklist. **No issue found** — the cleanest file reviewed in this pass so far. Every
mutation correctly re-applies `workspace_id`+`user_id` on the actual write statement, not just a preceding check
(the pattern six other files in this audit needed fixing). `DELETE /:id` doesn't even need a prior `select()` —
it deletes directly with full scoping, correctly fail-safe if the row doesn't match. `PUT /:id` uses a Zod
`.strict()` schema with an explicit comment explaining why: rejecting any key not explicitly listed is the actual
guard against a client smuggling `workspace_id`/`user_id` into the body to overwrite them. The merge-candidate
routes carry a correct comment about Express route-registration order (`/merge-candidates` must be registered
before `/:id`, or the param route would swallow it) — verified this ordering is indeed correct in the file as
written.

**Fix status:** no fix needed. Reviewed clean.

### 1.23 — LOW — `routes/suggestions.js` full read (full audit, file 10 of 80)
**Location:** `backend/src/routes/suggestions.js`

Full read against the checklist. Scoping correct throughout (`workspace_id`+`user_id` on both the cache read and
upsert). `userData` possibly being `null` from its `select()` is handled correctly (`userData || {}` at both
downstream call sites).

**One real, low-severity finding, fixed:** this file's AI-response JSON parsing did a manual markdown-fence strip
(`.replace(/\`\`\`json|\`\`\`/g, '')`) followed by a raw `JSON.parse()` — unlike every other AI-JSON-parsing call
site in this codebase, which uses `utils/parser.js`'s `parseJSON`/`parseJSONArray`/`parseJSONObject` (already
test-covered, handles the same fence-stripping plus additional recovery like unwrapping an array nested inside an
object, and never throws). Not a live crash as written: the raw `JSON.parse()`'s throw on malformed AI output was
already being caught by this function's own surrounding `try/catch`, correctly falling through to the
stale-cache-or-defaults path. Switched to `parseJSONArray` for consistency and because it's more robust than the
manual version, not because the manual version was actually broken.

**Noted, not acted on:** there are two separate JSON-parsing utilities in this codebase —
`utils/parser.js` (`parseJSON`/`parseJSONArray`/`parseJSONObject`, test-covered) and `utils/parseAIJson.js`
(`parseAIJson`, a differently-shaped single function). Worth knowing this duplication exists; not consolidating
them in this pass — that's a larger, cross-cutting refactor (would need to trace every call site of both to do
safely) better suited to a dedicated pass once `utils/parseAIJson.js` itself has been read as part of this audit
(not yet reached).

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.24 — INFO — `jobs/conversationAnalysisJob.js` full read (full audit, file 11 of 80) — clean
**Location:** `backend/src/jobs/conversationAnalysisJob.js`

Full read against the checklist. **No issue found.** Correct idempotency (an explicit "already analyzed this
feedback" check before doing any work). Correct trust model for a job: `workspaceId`/`userId` are trusted
parameters from the enqueuing caller rather than independently re-verified here, which is appropriate — confirmed
its only call site (`practiceWorker.js`) passes `job.data.*` values that were set when `routes/feedback.js`
enqueued the job, meaning the actual authorization happened at that enqueue point, not here. `feedback.js`'s own
comments confirm this was a deliberate refactor from an inline fire-and-forget call to a proper queued job.

The AI-response JSON parsing here (raw `JSON.parse()` in its own dedicated `try/catch` with a clean early return)
is actually a cleaner, more explicit pattern than the one just fixed in `suggestions.js` (1.23) — not flagged, no
change needed. `updateObjectionTracker`'s RPC-with-fallback pattern is correctly scoped on both paths.
`classifyObjection`'s regex-based heuristic classifier is substantial but not a correctness/security boundary —
not independently verified line-by-line, appropriately so for a heuristic.

**Fix status:** no fix needed. Reviewed clean.

### 1.25 — INFO — `jobs/coreJobs.js` full read (full audit, file 12 of 80) — clean
**Location:** `backend/src/jobs/coreJobs.js`

Full read of all 7 scheduled jobs against the checklist. **No issue found.** Only the `runOpportunitiesRefreshForUser`
call site had been seen before this pass; the full file (468 lines) had not.

Several genuinely strong patterns, verified against their own header comments rather than taken on faith:
- `runCalendarPrepJob`'s header claims it was refactored from a second, duplicate prep-generation implementation
  into a thin scan-and-enqueue using the same job type/implementation as every other prep trigger — confirmed in
  the actual code, not just the comment.
- `runCalendarReminderScan` uses an atomic `UPDATE user_events SET reminder_sent=true WHERE id=... AND
  reminder_sent=false ... RETURNING id` as its idempotency mechanism — a genuine database-level compare-and-swap,
  avoiding per-event BullMQ job scheduling entirely. `if (!claimed) continue` correctly handles the case where a
  concurrent scan tick already claimed the event. This is exactly the kind of "use database constraints and atomic
  operations" pattern the mission asks for, already correctly implemented.
- `runFeedbackPromptJob` cross-references candidate opportunities against `workspace_members.status = 'active'`
  before notifying, correctly excluding stale data for users who've since left the workspace.
- `runCalendarDebriefDigest`'s header explicitly clarifies it is NOT the Slack/email digest feature (which the
  comment says was deliberately excluded from that implementation pass) — worth noting for anyone looking for
  that feature and not finding it here.

All database queries across all 7 jobs correctly scoped by `workspace_id`+`user_id` where applicable.

**Fix status:** no fix needed. Reviewed clean.

### 1.26 — HIGH — `jobs/emailDigestJob.js`: unescaped AI/user content interpolated into raw email HTML (full audit, file 13 of 80)
**Location:** `backend/src/jobs/emailDigestJob.js`

Full read against the checklist. File's own header documents two real, previously-fatal bugs already fixed by a
prior pass: `CRIT-02` (a missing `import supabaseAdmin` meant this job crashed on every single run before writing
a row — the email digest feature likely never worked at all until this was fixed) and `HIGH-12` (a double
`.data` access bug that silently showed no skill-movement data in every digest). Both verified fixed in the
current code, not just claimed fixed by a stale comment.

**Real, HIGH-severity finding, fixed:** `digest.headline`, `digest.one_thing`, `digest.whats_working`,
`digest.skill_summary`, `digest.encouragement` (all LLM-generated JSON fields), `user.name`, and
`patterns[].pattern_label`/`pattern_detail` were all interpolated directly into this email's raw HTML template
string with **zero escaping anywhere in the pipeline** — confirmed by grep, no `escapeHtml`/`sanitize`/`DOMPurify`
call exists anywhere near this code path, and no such utility existed anywhere in the codebase to have been
skipped by mistake. Since the digest content is model-generated text whose prompt context includes
seller-entered profile data and detected pattern labels, any HTML/script-like content that makes it into that
chain becomes live markup in a weekly email every enabled user receives — a real content-injection risk, not
theoretical (email clients do have their own rendering sandboxes, but malicious links, tracking pixels, or
visually-deceptive markup are still a genuine concern in an HTML email body).

**Fix:** added a small, local `escapeHtml4` helper (standard `&`/`<`/`>`/`"`/`'` entity encoding, `null`/`undefined`
→ empty string) and applied it to every interpolation point in the HTML template. Manually verified against a
concrete `<script>` payload and a mixed-special-character string before relying on it.

**Second, lower-severity finding, fixed in the same pass:** the digest JSON response used a raw
`JSON.parse(content.replace(/\`\`\`json|\`\`\`/g, '').trim())` — the same unsafe pattern already found and fixed
in `routes/suggestions.js` (1.23). Here, unlike that route, a parse failure wasn't caught by a local `try/catch`
with a graceful fallback — it would throw, get caught by `runEmailDigestJob`'s `Promise.allSettled` (so not a
process crash), but silently give up on that one user's digest entirely for the week with only a generic error
log. Switched to the tested `parseJSONObject` utility (never throws) with an explicit check for a usable result
and a clear log message when the AI response genuinely can't be parsed.

**Fix status:** both fixed and verified (syntax check, full test suite, manual verification of the escaping
helper against adversarial input).

### 1.27 — LOW — `jobs/followupSequenceJob.js` full read (full audit, file 14 of 80)
**Location:** `backend/src/jobs/followupSequenceJob.js`

Full read against the checklist. This file has existing test coverage (`matchWorkspaceProfile`, the pure
array-disambiguation helper, 3 tests) but the actual job logic had never been read. File's own header documents
two real, previously-fatal bugs already fixed (`CRIT-03`: missing import crashed every run; `HIGH-03`:
`follow_up_count` was never actually incremented, so the "max 2 follow-ups" business rule silently never applied)
— both verified fixed in the current code.

This job is architecturally a deliberate cross-workspace sweep (processes all opportunities across all workspaces
meeting stage/timing criteria, correctly joining each opportunity's own `workspace_profiles` for context) — unlike
most other jobs reviewed, which iterate scoped-by-construction per-user/per-workspace pairs. Worth noting since it
changes what "correctly scoped" means here: there's no workspace-level pre-filter anywhere in the main query by
design, which is appropriate for a sweep, but means downstream mutations have less structural protection than in
other files.

**One real, low-severity finding, fixed:** the final `update()` in `generateFollowup` filtered only by
`.eq('id', opp.id)` — missing `workspace_id`. Given this job's lack of any workspace-level pre-filter (see above),
this `id` filter was the *only* thing preventing a cross-workspace write if `opp.id`/`opp.workspace_id` were ever
to disagree — not currently exploitable (`opp.id` comes from this job's own system query, not external input), but
worth tightening given the weaker surrounding protection than other files had. Added `.eq('workspace_id',
workspaceId)`.

**One stale, misleading comment, fixed:** the file's `MED-08` header entry claimed `FOLLOW_UP_THRESHOLDS` "does
not exist in constants.js" and was "defined inline" in this file. Checked both claims directly: neither was true.
`FOLLOW_UP_THRESHOLDS` is genuinely exported from `constants.js` (confirmed by that file's own `MED-01` entry,
which fixed exactly this — it used to be a non-exported `const`), and there's no inline definition anywhere in
this file. The comment predated that fix in the other file and was never updated. Removed the stale claim rather
than leave a future reader searching for a definition that was never actually here.

**Fix status:** both fixed and verified (syntax check, full test suite including the file's own existing tests).

### 1.28 — MEDIUM — `jobs/growthIntelligenceScheduler.js` full read (full audit, file 15 of 80)
**Location:** `backend/src/jobs/growthIntelligenceScheduler.js`

Full read of all 7 exported jobs (614 lines) against the checklist — only `detectAndSaveArchetype`'s call site had
been seen before this pass. This file's own header documents a substantial, genuinely well-explained prior fix
(`IMPL-ARCHETYPE-01`): `detectAndSaveArchetype` used to also write the detected archetype to the global `users`
table in addition to `workspace_profiles`, and that second write was the actual source of cross-workspace data
pollution for multi-workspace users — whichever workspace's detection ran most recently would silently overwrite
a single shared value. This independently confirms and explains the `archetype_detected_at` finding already
resolved in milestone 4 (AUDIT.md, the schema/migration consistency check) — two separate investigations arriving
at the same conclusion from different angles.

**Three real findings, same root pattern, fixed:**
1. `generateAndStoreTip`'s `daily_check_ins` and `practice_sessions` queries filtered only by `user_id`, missing
   `workspace_id` — confirmed both tables have a `NOT NULL workspace_id` column. Same bug class as `metrics.js`
   (1.19), but a different kind of consequence since this is job-internal data fetching, not a direct API
   response: the impact is AI context contamination, not a direct leak to a client. A multi-workspace user's
   growth tips in Workspace B could be generated using check-in answers or practice sessions from Workspace A.
2. `generateWeeklyPlanForUser`'s `daily_check_ins` query had the identical gap, sitting directly next to a
   `user_performance_profiles` query on the same line that *was* already correctly fixed for precisely this issue
   (comment: `"FIX: added workspace_id filter"`) — the fix was applied to one query but not its neighbor.
3. `runGoalNudgeJob`'s `user_goals` update (`last_goal_nudge_at`) filtered only by `.eq('id', goal.id)` — same
   "sweep job, no workspace pre-filter, so the id-only mutation filter is the only protection" pattern already
   found and fixed in `followupSequenceJob.js` (1.27). Not exploitable (`goal.id` is system-sourced), tightened
   for consistency with that reasoning.

All three fixed by adding `.eq('workspace_id', ...)` to the affected queries. Notably, two of the three correctly-
scoped sibling functions in this same file (`scheduleCheckIn`'s insert, `runCheckInScheduler`'s existence check)
already had this right, one with an explicit `FIX HIGH-06` comment for the exact same table — this bug kept
recurring in new call sites even after being fixed once elsewhere in the same file.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.29 — LOW — `jobs/growthPushNotificationJob.js` full read (full audit, file 16 of 80)
**Location:** `backend/src/jobs/growthPushNotificationJob.js`

Full read against the checklist. Every `growth_cards`/`opportunities`/`skill_progression` query in this file is
explicitly comment-labeled "workspace-scoped" and correctly is. Checked whether `push_notification_log`'s
user-only (no `workspace_id`) anti-spam queries were a gap: confirmed the table genuinely has no `workspace_id`
column at all in `schema.sql` — this is a deliberate design choice (a global, per-user daily push cap and cooldown
regardless of which workspace triggered it, which is sensible: a multi-workspace user shouldn't get double the
notifications just for being in two workspaces), not an oversight.

**One real, low-severity finding, fixed:** `buildEveningNotification2`'s `practice_sessions` existence check (used
to decide whether to suppress the "you haven't practiced your weakest skill" reminder) filtered only by
`user_id`, missing `workspace_id` — inconsistent with every other query in this file. Consequence: a
multi-workspace user who practiced in one workspace within the last 2 days would incorrectly suppress this
reminder for a different workspace too — a notification-logic leak (wrong UX), not a data exposure. Fixed by
adding `workspace_id`.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.30 — LOW — `jobs/memoryExtractionJob.js` full read (full audit, file 17 of 80)
**Location:** `backend/src/jobs/memoryExtractionJob.js`

Full read against the checklist. File's own header documents two real, previously-fixed issues
(`HIGH-05`: `user_memory` wasn't workspace-scoped on insert/reads, `MED-10`: token usage was being recorded at
user level instead of workspace level, undercounting workspace cost reporting) — both verified fixed in the
current code.

This job's main query is a deliberate cross-workspace sweep (all eligible chats system-wide, no workspace
pre-filter), same architecture as `followupSequenceJob.js` and `growthIntelligenceScheduler.js`'s sweep jobs.

**Five instances of the now-familiar "verified-then-unscoped mutation" pattern, fixed:** two `chats` updates
(`memory_last_extracted_at`) filtered only by `chat.id`, and three `user_memory` updates (reinforcement, replace,
eviction) filtered only by the target fact's `id` — all despite their source objects (`chat`, `target`, `toEvict`)
coming from already correctly-scoped queries earlier in the same function. Not exploitable as written in any
instance; tightened all five to match this codebase's own established pattern, consistent with roughly ten other
files in this audit.

**Two raw `JSON.parse()` calls switched to the tested utility:** both AI-response parses already had a local
`try/catch` with a safe fallback, so neither was a live crash — switched to `parseJSONArray` anyway for
consistency with the rest of the codebase and because it handles a couple of recovery cases (e.g. an array nested
inside an object) the manual versions didn't.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.31 — LOW — `jobs/patternDetectionJob.js` full read (full audit, file 18 of 80)
**Location:** `backend/src/jobs/patternDetectionJob.js`

Full read against the checklist. This file was previously only read for the `pattern_insights` enqueue-call
confirmation (milestone 3's finding about the missing handler registration), not the full detection/enrichment
logic. Confirmed again here that both `scheduledQueue.add('pattern_insights', ...)` call sites (the early-return
path and the end-of-function path) are genuinely mutually exclusive, not a double-enqueue — consistent with the
earlier finding.

**One real, low-severity finding, fixed:** `detectPatternsForUser`'s `user_skill_profile` query filtered only by
`user_id`, missing `workspace_id` — confirmed the table has a `NOT NULL workspace_id` column. Same AI-context-
contamination risk already found in `growthIntelligenceScheduler.js` (1.28): a multi-workspace user's practice
skill scores from one workspace could bleed into the pattern-detection prompt used to generate communication
insights for a different workspace. Fixed by adding the scope.

**One raw `JSON.parse()` switched to the tested utility:** already safely caught locally (a `return 0` on parse
failure), not a live crash — switched to `parseJSONArray` for consistency with the rest of the codebase.

Everything else correctly scoped: `conversation_analyses`, `workspace_profiles`, `communication_patterns` (upsert
with a correct `onConflict` composite key), `growth_cards` inserts, and `enrichWithMarketIntelligence`'s dedup
check all correctly carry both `workspace_id` and `user_id`.

**Fix status:** fixed and verified (syntax check, full test suite including `scheduledWorker.test.js`, which
specifically validates the `pattern_insights` handler registration this file's enqueue call depends on).

### 1.32 — LOW — `jobs/patternInsightsJob.js` full read (full audit, file 19 of 80)
**Location:** `backend/src/jobs/patternInsightsJob.js`

Full read against the checklist. This is `runPatternInsightsJob` — the function milestone 3 found had no
registered handler in `scheduledWorker.js` and had therefore likely never run in production, despite being fully
implemented. Only its first ~30 lines were sanity-checked at the time; the full logic had not been read. Good
validation that fixing the handler registration was worthwhile: the function is genuinely well-built and
correctly scoped, not accidentally wiring up something broken.

Verified, not just trusted, the file header's claim that `markOverdueCommitments` deliberately needs no workspace
filter: confirmed this is a correct, deliberate design — each row already carries its own `workspace_id`, and the
update only recalculates a derived status field from `due_date`, the same "recompute from source data" pattern
already independently verified correct for `CALENDAR_UPDATE_PROSPECT_HEALTH` in `backgroundWorker.js` (milestone
7). Added a comment recording this verification rather than leaving the claim as just asserted.

**One real, low-severity finding, fixed:** `refreshStaleProspectSummaries`'s final `prospects` update filtered
only by `.eq('id', prospect.id)` — missing `workspace_id`/`user_id`, even though `prospect` already carries both
(selected and used elsewhere in the same loop). Same "verified-then-unscoped mutation" pattern found across this
audit; not exploitable as written, tightened for consistency.

Everything else — `processUserInsights`'s five source queries, the `prospect_insights` dismiss-then-insert flow,
the push-notification gate — correctly scoped throughout.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.33 — MEDIUM — `jobs/practiceWeaknessDetector.js`: resolves workspace from current state, not the triggering session's actual workspace (full audit, file 20 of 80)
**Location:** `backend/src/jobs/practiceWeaknessDetector.js`, `backend/src/jobs/messageQueueWorker.js`

Full read against the checklist. File's own header documents a real prior fix — practice history used to be
treated as a cross-workspace personal asset, inconsistent with every other consumer of `practice_sessions`
(`metrics.js`, `skillProgressionJob.js`, `growthIntelligenceScheduler.js`), now correctly workspace-scoped
throughout this file.

**Real, cross-file finding, flagged rather than fixed:** `checkAndGenerateWeaknessCard` resolves `workspaceId` by
looking up the user's **current** `users.active_workspace_id`, not the workspace the triggering practice session
actually happened in. Traced its only call site (`handleSkillScores` in `messageQueueWorker.js`, confirmed during
an earlier milestone's idempotency trace): the `session` object it already has access to carries its own correct
`workspace_id` (`practice_sessions` is workspace-scoped), but the call only passes `{ user_id, session_id,
skillScores }` — not `workspace_id`. Since this runs as an asynchronous background job, there's a real, if
narrow, timing window: a user who switches their active workspace between finishing a practice session and this
job actually running would get their weakness card — and the `communication_patterns` upsert and
conversation-analyses cross-reference it's built on — generated under the *wrong*, currently-active workspace
rather than the one the practice session happened in.

Not fixed in this pass: the correct fix touches two files, including changing what `handleSkillScores` passes as
BullMQ job payload data, not just this function's own internal logic — a cross-cutting change that deserves to be
seen and decided on together rather than patched unilaterally in just one of the two files mid-audit.

**One raw `JSON.parse()` switched to the tested utility:** already safely caught locally with a sensible fallback
card, not a live crash — switched to `parseJSONObject` for consistency, restructured slightly so the fallback is
defined once and reused rather than duplicated inside the catch block.

**Fix status:** JSON parsing fixed and verified (syntax check, full test suite). Workspace-resolution timing gap
flagged with a clear comment at the exact point it matters, not fixed — see IMPLEMENTATION_PLAN.md.

## 2. Suspected / Needs Further Investigation

Not yet confirmed — listed so they aren't lost, not yet acted on.

- **`handleGhost`/`handleReply` dead code in `messageQueueWorker.js`** (see 1.7) — candidates for removal in a
  dedicated cleanup pass, since they're unreachable but still maintained/read as if live. Not removed yet because
  dead-code removal wasn't the active investigation and deserves its own deliberate pass rather than being folded
  into an idempotency fix's commit.
- **`backgroundWorker.js`'s idempotency** was read in milestone 1's initial recon and looked sound (deliberate
  dual-path-race consolidation, well-commented) but hasn't had the same systematic trace milestone 3 gave
  `messageQueueWorker.js`/`scheduledWorker.js`. Worth a closer pass if time allows.
- **Migration consistency**: `migrations/` contains 15 numbered + 2 unnumbered-looking files
  (`20260719120000_drop_users_archetype.sql`, `add_event_id_to_commitments_signals.sql`) alongside a 4627-line
  `schema.sql`. Not yet verified whether `schema.sql` is kept in sync with the migrations directory, or which one is
  the actual source of truth for a fresh setup.

## 3. Explicitly Protected Areas (per project owner's instructions)

Calendar, metrics, insights, and onboarding functionality must not be removed or restructured as part of combining
this into a single product. Problems found in these areas will be documented here and in IMPLEMENTATION_PLAN.md,
not silently "simplified away."
