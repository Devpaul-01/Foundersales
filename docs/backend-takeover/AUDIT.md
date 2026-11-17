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

### 1.34 — INFO — `jobs/skillProgressionJob.js` full read (full audit, file 21 of 80) — clean
**Location:** `backend/src/jobs/skillProgressionJob.js`

Full read against the checklist. **No issue found.** This is the authoritative source of `composite_score_avg` —
the exact field whose 0–10 scale was traced here and confirmed during an earlier milestone (resolving a
self-flagged open question in `metrics.js`'s leaderboard formula). Reading the full file now directly confirms
what that earlier trace found: the `/10` normalization of practice-derived axes (lines 125–130) is real,
deliberate, and correctly applied — consistent, not just plausible.

File's own header documents two real prior fixes: `HIGH-12` (discovery/objection/brevity axes were previously
omitted from the composite score and weakness detection entirely) and a workspace-scoping fix on the
`user_skill_profile` query (previously could merge the wrong workspace's practice data into a snapshot) — both
verified fixed in the current code.

Considered whether `practiceUserIds`'s workspace resolution via `users.active_workspace_id` (lines 36-43) is the
same "current state vs. triggering-event state" issue flagged in `practiceWeaknessDetector.js` (1.33) — concluded
it is not: this job runs as a periodic weekly aggregate over the last 7 days of activity, with no single
triggering event to be inconsistent with, so resolving against current workspace state is a reasonable design for
a periodic snapshot rather than a timing-window correctness gap like the per-event, immediately-triggered weakness
card generation in the other file.

**Fix status:** no fix needed. Reviewed clean.

### 1.35 — INFO — `services/calendarAiGate.js` full read (full audit, file 22 of 80) — clean
**Location:** `backend/src/services/calendarAiGate.js`

Full read against the checklist. **No issue found.** A dedicated, well-designed cost-control rule engine
("is this AI call worth making") with centralized audit logging to `calendar_ai_events` for every gate decision.
`shouldRunResearch`'s cross-event prospect-reuse lookup correctly scopes by both `prospect_id` and `workspace_id`.
`shouldExtractCommitmentsSignals`'s own comment documents consolidating a length-threshold check that previously
existed ad hoc in two separate places — consistent with this audit's broader observation that this codebase has
had real, deliberate consolidation passes, not just accumulation of duplicated logic.

**Fix status:** no fix needed. Reviewed clean.

### 1.36 — INFO — `services/calendarCommitmentsSignals.js` full read (full audit, file 23 of 80)
**Location:** `backend/src/services/calendarCommitmentsSignals.js`

Full read against the checklist. Genuinely clean implementation: already uses `parseJSONObject` (the tested
utility, no raw `JSON.parse` to fix here), wrapped in its own `try/catch` with a safe empty-arrays fallback,
correctly gated via `calendarAiGate.js`. Header comment's claim of consolidating two previously-separate Groq
calls into one (the single highest-value AI cost optimization identified for the Calendar feature, per the
comment) is a real, legitimate, well-reasoned optimization.

**One finding, flagged for follow-up rather than fixed here:** the header comment claims
`extractCommitmentsFromText`/`generateSignalAnalysis` (in `groqCalendarIntelligence.js`, not yet read as part of
this audit) are "left in place... still used by `synthesizeMeetingNotes` and any other call sites outside
Calendar's debrief flow." Repo-wide grep found **zero call sites of either function anywhere** — not in
`synthesizeMeetingNotes`, not anywhere else. If this holds once `groqCalendarIntelligence.js` is read directly,
both functions are genuinely dead code, and this comment's claim is stale. Not removing anything in that other
file based on a cross-reference alone — flagged here, to be confirmed and acted on when that file is reached
directly in this audit.

**Fix status:** no functional fix needed in this file. Updated this file's own comment to flag the
cross-reference finding rather than let it stand unverified. The actual dead-code question will be resolved when
`groqCalendarIntelligence.js` is read.

### 1.37 — INFO — `services/calendarPrep.js` full read (full audit, file 24 of 80) — clean
**Location:** `backend/src/services/calendarPrep.js`

Full read against the checklist. **No issue found.** Header comment documents a substantial, genuinely real
consolidation: prep-generation logic used to exist independently in three places, one of which (`calendar.js`'s
`generateAndSaveEnrichedPrep` helper) is explicitly called out as having been dead code the whole time, "never
actually called by the worker despite the comment claiming it was." This cross-references and is consistent with
`jobs/backgroundWorker.js`'s own `CALENDAR_PREP_GENERATE` consolidation already verified correct back in an
earlier milestone.

Every query in `buildPrepContext` correctly carries `workspace_id`+`user_id` (and `prospect_id` where relevant),
including the slightly unusual `opportunities.feedback(deal_value_usd)` embedded-relation select, which correctly
handles both possible PostgREST return shapes (array vs. single object) when extracting `deal_value_usd`.
`generateAndPersistPrep`'s AI-cost-gate integration and schema-validated-with-fallback persistence are both
correctly scoped on their final `update()` calls.

**Fix status:** no fix needed. Reviewed clean.

### 1.38 — HIGH — `services/email.js`: unescaped user-controlled content in two HTML email templates (full audit, file 25 of 80)
**Location:** `backend/src/services/email.js`

Full read against the checklist. This is the shared email-sending service (console/Resend/SMTP providers,
selected by `EMAIL_PROVIDER`).

**Real, HIGH-severity finding, fixed — found twice, more directly exploitable than 1.26:** both
`sendWorkspaceInviteEmail` and `sendDealAssignedEmail` interpolated genuinely user-controlled values directly into
raw HTML templates with zero escaping. Traced every value to its actual source, not assumed:
- `sendWorkspaceInviteEmail`'s `workspaceName`/`inviterName`: confirmed via `routes/workspaces.js`'s only call
  site to be `req.workspace.name` and `req.user.name` — a workspace name and display name any signed-up user can
  set themselves.
- `sendDealAssignedEmail`'s `assigneeName`/`assignerName`/`dealName`: confirmed via both call sites
  (`routes/pipeline.js`, `routes/opportunities.js`) to be real user display names and
  `opp.target_name || extractName(opp.target_context)` — prospect-derived text, not a fixed system string.

This is more directly exploitable than the AI-content version of the same issue already fixed in
`jobs/emailDigestJob.js` (1.26): it needs no model cooperation at all. Any authenticated user could set their
display name or a workspace name to malicious markup, then send an invite to anyone — including someone with no
account on the platform — and that markup renders in the recipient's real email client.

**Fix:** added the same `escapeHtml5` helper (identical approach to `emailDigestJob.js`'s `escapeHtml4`, kept
file-local rather than extracted into a shared utility for now — see note below) and applied it to every
HTML-body interpolation point in both templates. Left the two email subject-line interpolations alone, correctly
— subject lines aren't HTML-rendered, so escaping them isn't needed and would just show literal `&amp;` etc. to
the recipient. Manually verified against a realistic `onerror` payload and a normal ampersand-containing string
before relying on it.

**Noted, not acted on:** this is now the second near-identical HTML-escaping helper added in this audit
(`emailDigestJob.js`'s `escapeHtml4`, this file's `escapeHtml5`). Worth extracting into a real shared
`utils/escapeHtml.js` at some point — not done in this pass, since consolidating them is a separate, lower-urgency
cleanup from fixing the actual vulnerability, and doing so now would mean touching a third file mid-fix rather
than focusing this commit on the security issue itself.

**Fix status:** fixed and verified (syntax check, full test suite, manual verification of the escaping helper
against adversarial input).

### 1.39 — INFO — `services/exa.js` full read (full audit, file 26 of 80)
**Location:** `backend/src/services/exa.js`

Full read against the checklist. Header comment (`IMPL-EXA-01`) documents a substantial, genuinely well-reasoned
prior refactor: this file used to implement its own independent, in-memory-only key-cooldown mechanism (a
duplicate of `multiProvider.js`'s, with the exact same cross-instance correctness gap — one instance's "key N
failed" knowledge never reached any other instance) and now delegates to the shared `providerCooldown.js` module
instead. The comment is also explicit about a deliberate scope boundary *not* taken — Exa's error classification
stayed as message-substring matching rather than being migrated to `utils/providerErrors.js`'s structured
taxonomy, with a clearly stated reason (the SDK doesn't reliably expose a raw status code) rather than silence.
This kind of explicit "here's what we chose not to do and why" is useful, and rare enough to be worth noting when
seen.

Usage-gating sequence in `discoverOpportunities` (workspace quota check → AI cost-router decision → Exa search →
Groq fallback on any failure at any stage) is correctly ordered and every fallback path is reachable and sensible.
Not a route/job with direct DB scoping concerns — this file's "scoping" is workspace-aware usage tracking, which
is correctly threaded through every exported function (`discoverOpportunities`, `searchForChat` both require and
pass `workspaceId`/`userId` to `recordExaUsage`).

**One real, low-severity finding, fixed:** `needsRealTimeSearch`'s AI-router-decision parse used a raw
`JSON.parse()` despite `parseJSONArray` already being imported and used elsewhere in this same file — already
safely caught by its own `try/catch`, not a live crash. Switched to `parseJSONObject` (added to the existing
import) for consistency.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.40 — INFO — `services/groq-client.js` full read (full audit, file 27 of 80) — clean
**Location:** `backend/src/services/groq-client.js`

Full read against the checklist. **No issue found.** The low-level Groq HTTP client (non-streaming `callGroq`,
streaming `streamGroq`) — small, correct, well-scoped to its job. Retry logic is correctly selective: 3 attempts
with linear backoff, but auth (`401`/`403`) and bad-request (`400`) errors are deliberately not retried (retrying
those can't succeed). Reasonable timeouts (30s non-streaming, 60s streaming).

The one `JSON.parse()` in this file (parsing individual SSE chunks from the streaming response) is correctly
*not* a candidate for the codebase's `parseJSONArray`/`parseJSONObject` utilities — those are built for recovering
an LLM's free-form, possibly-fenced-or-malformed JSON *output*, a different problem than parsing individual
protocol-level chunks of a well-formed streaming API's wire format. Already correctly wrapped in a per-chunk
`try/catch` with a sensible "skip malformed chunks" fallback — exactly right for this context.

**Fix status:** no fix needed. Reviewed clean.

### 1.41 — LOW — `services/groq-coaching.js` full read (full audit, file 28 of 80)
**Location:** `backend/src/services/groq-coaching.js`

Full read of all 7 exported functions (656 lines) against the checklist. Pure prompt-construction/business logic —
no DB queries, no workspace/user scoping concerns in this file. Notably consistent prompt-engineering discipline
throughout: explicit mood-sensitivity branching (`generateDailyTips`, `generateCheckInResponse` both deliberately
soften tone and reduce ask-size for a low mood score), concrete, situation-matched fallback content for every
single AI call rather than generic placeholders, and an explicit "no generic advice" instruction baked into
several prompts.

**Five raw `JSON.parse()` calls, all switched to the tested utilities:** `generateCoachingTip`,
`generateDailyTips`, `generateCheckInQuestions`, `generateCheckInResponse`, `generateWeeklyPlan` each had a manual
markdown-fence-strip + raw `JSON.parse()`. All five were already safely caught by their own local `try/catch` with
a sensible, situation-appropriate fallback — none was a live crash. Switched to `parseJSONObject`/`parseJSONArray`
for consistency with the rest of the codebase, same low-risk mechanical change applied in roughly ten other files
across this audit.

**Noted for follow-up when reached directly:** `generateCoachingTip`'s inline message-quality heuristic
(word count, metric detection, personalization detection) carries a comment saying it "mirrors
`analyzeMessageQuality` in `groq-practice.js`" — flagging this cross-reference for verification once that file is
read, same as the `calendarCommitmentsSignals.js`/`groqCalendarIntelligence.js` cross-reference flagged earlier
(1.36), to check whether this is genuine, maintained duplication or something that should be consolidated.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.42 — LOW — `services/groq-onboarding.js` full read (full audit, file 29 of 80)
**Location:** `backend/src/services/groq-onboarding.js`

Full read of all 6 exported functions (745 lines) against the checklist. This file backs the explicitly protected
onboarding flow — treated with the same care as `routes/onboarding.js` (1.20): only mechanical, zero-behavior-
change fixes made, nothing touching prompt content, business logic, or the memory-seeding redelivery question
already flagged and left for the person's decision.

Genuinely sophisticated, concrete prompt engineering throughout (`buildVoiceProfile`'s "keep the exact number/
name/quote, don't genericize it" instructions with paired bad/good examples is a particularly good pattern). This
is also the file whose `detectUserArchetype` is the function `growthIntelligenceScheduler.js`'s `IMPL-ARCHETYPE-01`
fix (verified correct in an earlier pass of this audit) actually calls — confirms that fix was pointed at the
right, real implementation.

Re-confirmed `seedMemoryFromOnboarding`'s `isRebuild`/`MEMORY_CAP` logic matches exactly what was read and relied
on when resolving the `SEED_MEMORY` flag in two earlier entries — no new information here, consistent with the
prior read.

**Two raw `JSON.parse()` calls, switched to the tested utility:** `generateNextBurst` and `detectUserArchetype`
both had a manual fence-strip + raw `JSON.parse()`, despite `parseJSONObject` already being imported and used by
several other functions in this same file — the same "already uses the utility elsewhere, missed a couple of
spots" pattern found in `exa.js` (1.39). Both already safely caught by local `try/catch` with sensible fallbacks,
neither a live crash. Switched for consistency.

**Fix status:** fixed and verified (syntax check, full test suite). Purely mechanical — no prompt content,
business logic, or protected onboarding behavior changed.

### 1.43 — LOW — `services/groq-outreach.js` full read (full audit, file 30 of 80)
**Location:** `backend/src/services/groq-outreach.js`

Full read of all 6 exported functions against the checklist. No DB queries — pure prompt-construction and
non-AI business logic. `generateOutreachMessage`'s avoid-phrases validate-then-regenerate pattern (check the
output against the user's own "don't sound like this" list, and if violated, retry once with an explicit
correction instruction) is a genuinely good quality-control mechanism, not just generate-and-hope.
`summarizePerformancePatterns`'s pure-JS stats derivation (platform/style/length win-rate bucketing) has a
sensible minimum-sample-size guard (`sent >= 2`) before a bucket is allowed to be called "best."

**Two raw `JSON.parse()` calls, switched to the tested utilities:** `scoreOpportunities` and
`evaluateMessageStrength` both had a manual fence-strip + raw `JSON.parse()`, despite `parseJSONObject` already
being imported and used elsewhere in this same file (`generateEventPrep`) — same "already uses the utility
elsewhere, missed a couple of spots" pattern now found in three files in a row (`exa.js` 1.39,
`groq-onboarding.js` 1.42, this file). Both already safely caught locally with sensible fallbacks, neither a live
crash. Switched for consistency.

**Fix status:** fixed and verified (syntax check, full test suite).

### 1.44 — LOW — `services/groq-practice.js` full read, consolidates a real duplication (full audit, file 31 of 80)
**Location:** `backend/src/services/groq-practice.js`, `backend/src/services/groq-coaching.js`

Full read of all 9 exported functions (822 lines, the largest file read in this audit) against the checklist.
Header comment's claim of a "Bug D" fix (an unused `patience` variable extracted but never referenced in the V3
prompt) verified genuinely accurate — confirmed its absence in the current `generatePracticeProspectReplyV3`.
Several functions show real, deliberate coaching-mechanics design (threshold-based buyer behavior at interest
milestones, drill-type overrides for discovery/CTA practice, pressure-modifier blocks) rather than generic
prompt templates.

**Real finding, fixed — confirms and resolves the cross-reference flagged in `groq-coaching.js` (1.41):**
`analyzeMessageQuality` here and `groq-coaching.js`'s inline "quality analysis" were confirmed to be a genuine,
byte-for-byte duplication — same five regexes, same scoring formula — not just conceptually similar, with
`groq-coaching.js`'s own comment honestly acknowledging the duplication rather than hiding it. Consolidated:
exported `analyzeMessageQuality` from this file (was a local, unexported `const` with exactly one internal call
site, confirmed safe to export), and `groq-coaching.js`'s `generateCoachingTip` now imports and calls it instead
of maintaining its own copy. Verified the returned object shape matches every downstream field `groq-coaching.js`
reads from it before making the switch. Checked for a circular-import risk between the two files before adding the
new import — none exists.

**Five raw `JSON.parse()` calls, switched to the tested utility:** unlike the last several files, this one had
never adopted `parseJSONObject`/`parseJSONArray` at all (no partial adoption to extend, a first-time import).
`parseV3Reply`, `generateBuyerProfile`, `evaluateBuyerStateChange`, `evaluateMessageQualityForGhost`,
`generatePracticeProspectReplyV2` each had a manual fence-strip + raw `JSON.parse()`. All five were already safely
caught by surrounding `try/catch` blocks with sensible fallbacks — `parseV3Reply`'s catch block had the most
distinct behavior (falling back to any plain text found before the JSON starts), preserved exactly when switching
it to a null-fallback-then-explicit-check pattern, since `parseJSONObject` never throws.

**Fix status:** both the duplication consolidation and all five JSON-parsing switches fixed and verified (syntax
check on both edited files, full test suite). Response shapes preserved exactly in every case — no change to what
either function returns on success or on a parse failure.

### 1.45 — LOW — `services/groq-prompts.js` full read (full audit, file 32 of 80)
**Location:** `backend/src/services/groq-prompts.js`

Full read against the checklist. Pure constants/prompt-string builders — no DB queries, no AI-response JSON
parsing to check (this file produces prompt text, it doesn't parse AI output). `buildChatSystemPrompt`'s
mood-sensitivity and per-mode instruction blocks are well-built, consistent with the prompt-engineering quality
seen in several other `groq-*` files this audit has read.

**One real, low-severity finding, flagged rather than fixed:** `getGrowthStrategistPrompt`'s `archetypeOpenings`
lookup map has 11 keys (`hunter`, `farmer`, `consultant`, `founder`, `freelancer`, `creator`, `closers`,
`marketer`, `connector`, `operator`, `seller`), but the only function anywhere in this codebase that ever assigns
`user.archetype` — `detectUserArchetype` in `groq-onboarding.js`, read earlier in this audit — can only ever
produce one of 6 values (confirmed by that function's own `validArchetypes` allow-list: `seller`, `builder`,
`freelancer`, `creator`, `professional`, `learner`). This means 6 of the 11 keys here (`hunter`, `farmer`,
`consultant`, `closers`, `connector`, `operator`) — plus `founder` and `marketer`, which also aren't in the real
set — can never actually be selected; they'd always silently fall through to the `seller` default. Confirmed
`getGrowthStrategistPrompt` itself is genuinely live (called from four places in `groq-coaching.js`), so this
isn't dead code overall — just unreachable branches inside a live function. Not changed: could represent a
planned future archetype-set expansion rather than leftover cruft, and distinguishing those two possibilities is
a product decision, not something to guess at. Flagged with a clear comment at the exact spot.

**Fix status:** no functional change. Added a comment documenting the finding rather than leaving it silently
unreachable for the next person to puzzle over independently.

### 1.46 — MEDIUM — `services/groq-session.js`: three functions could store malformed AI output as valid data (full audit, file 33 of 80)
**Location:** `backend/src/services/groq-session.js`, `backend/src/jobs/messageQueueWorker.js`,
`backend/src/jobs/growthIntelligenceScheduler.js`

Full read of all 8 exported functions (688 lines) against the checklist. This file is the real implementation
behind several functions already relied on elsewhere in this audit — `generateCoachingAnnotations` (the function
`messageQueueWorker.js`'s `handleCoachingAnnotations` calls, idempotency-fixed in an earlier milestone) and
`generateMultiAxisScores` (the one `handleSkillScores` calls, also idempotency-fixed earlier) — both read here in
full for the first time and confirmed to match what those earlier reads assumed about them.

**Real, MEDIUM-severity finding, found three times, fixed:** `generateAdaptiveCurriculum`, `generatePlaybook`,
and `generateRetryComparison` all returned a raw `JSON.parse()` result directly with **no shape validation at
all** — unlike every sibling function in this file (`generateSessionDebrief`, `generateSessionDebriefV3`,
`generateMultiAxisScores`, `generateMultiAxisScoresV3` all check for required fields before accepting a parsed
result). Traced every one of the three callers to confirm this was a real, not theoretical, gap:
- `generateAdaptiveCurriculum` → `growthIntelligenceScheduler.js`'s weekly curriculum job only checks
  `if (!curriculum) continue` (a falsy check) before `upsert`ing the result into `practice_curriculum`.
- `generatePlaybook` → `messageQueueWorker.js`'s `handlePlaybook` only checks `if (playbook)` before storing it
  into `practice_sessions.playbook` and notifying the user their playbook is ready.
- `generateRetryComparison` → the same file's retry-comparison flow only checks `if (comparison)` before storing
  it into `practice_sessions.retry_comparison`.

In all three cases, a syntactically-valid but structurally-wrong AI response (e.g. `{}`, or an object missing the
fields the frontend actually expects to render) would pass straight through these truthy-only checks and get
persisted as if it were valid, user-facing content — a real data-quality gap, not a crash risk (the original code
never threw), but a path to storing and displaying broken AI output.

**Fix:** added the same required-field validation pattern already used by this file's own correctly-validated
siblings to all three functions, so a malformed response now correctly falls back to `null` (matching what each
caller's existing `if (x)`/`if (!x) continue` check already expected the failure case to look like — no caller
logic needed to change).

**Seven raw `JSON.parse()` calls total switched to the tested utility** across this file (the three above plus
four already-validated siblings that just hadn't adopted the parser utility yet) — same mechanical consistency
fix applied throughout this audit, this file having never adopted it before this pass (same situation as
`groq-practice.js`, 1.44).

**Fix status:** all fixed and verified (syntax check, full test suite). The three real validation gaps are the
significant part of this finding — the other four are the now-familiar mechanical cleanup.

### 1.47 — INFO — `services/groq.js` full read (full audit, file 34 of 80) — clean, verified against real source exports
**Location:** `backend/src/services/groq.js`

Full read against the checklist. This is a pure barrel/re-export file aggregating all 6 `groq-*` modules (all
now read in full earlier in this audit) into one surface, both as named exports and as a default `groqService`
object. Header comment documents a real, previously-fixed bug: the default-export object used to completely omit
the entire outreach module (`generateOutreachMessage`, `scoreOpportunities`, etc.), meaning any caller using
`groqService.generateOutreachMessage(...)` style (rather than a named import) would have silently gotten
`undefined` and crashed at call time — comment marks it `(ALL - was completely missing)`, confirming this was a
deliberate, verified fix, not a guess.

**Cross-checked every one of this file's 42 re-exported names against the real `export const` in its actual
source module** (not spot-checked — every single one, across all 6 `groq-*` files already read in this audit),
since a typo or stale export name here would be a genuine, if easily-reproduced, runtime bug. All 42 confirmed
correct.

**Fix status:** no fix needed. Reviewed clean, with a systematic cross-check rather than a surface read.

### 1.48 — INFO — `services/groqCalendarIntelligence.js` full read; corrects a mistake from an earlier audit entry (full audit, file 35 of 80)
**Location:** `backend/src/services/groqCalendarIntelligence.js`, `backend/src/services/calendarCommitmentsSignals.js`

Full read of all 10 exported functions (660 lines) against the checklist. Already correctly uses
`parseJSONObject`/`parseJSONArray` throughout — no raw `JSON.parse()` to fix in this file.

**This corrects a mistake made earlier in this audit (1.36), stated plainly rather than quietly fixed:** that
entry flagged `calendarCommitmentsSignals.js`'s comment — which claims `extractCommitmentsFromText` and
`generateSignalAnalysis` (both in this file) are "still used by `synthesizeMeetingNotes`" — as inaccurate, based
on a repo-wide grep that found no call sites. That grep was flawed: it excluded this function's own file from the
search (`grep -v "groqCalendarIntelligence.js:\|..."`, meant to filter out comment-only mentions, but it filtered
out the real call site too, since `synthesizeMeetingNotes` is defined in that same file). Having now read the file
directly: `synthesizeMeetingNotes` (line 472) genuinely does call both functions, exactly as the original comment
claimed. The original comment was correct; last pass's flag of it was wrong, caused by a search methodology
mistake, not a reasoning mistake about what the grep result meant.

**What is genuinely true, and the real (much narrower) finding:** `synthesizeMeetingNotes` itself has zero callers
anywhere in the codebase — confirmed by a corrected, properly-scoped grep this time. So the two leaf functions are
reachable in principle but the one thing that calls them is itself unreachable. Not treating this as dead code to
remove: `synthesizeMeetingNotes` reads as a deliberately-built, complete feature (AI debrief + commitment/signal
extraction from a live meeting-notes session, paired with `generateMeetingNotesResponse`'s live, in-session partner)
that simply has no route wired to trigger it yet — not obviously-abandoned cruft the way the confirmed-dead
`handleReply`/`handleGhost` in `messageQueueWorker.js` were. Corrected both this file's comment and the earlier
audit entry rather than leaving the wrong conclusion on record.

Everything else in this file reads well: `generatePostMeetingFollowUp`'s three-variant (brief/substantive/
re-engagement) follow-up generation incorporates actual commitment and signal data into the prompt rather than
generating generically, `generateWeeklyPatternInsights` has a sensible "not enough data" early return, and
`generateMeetingNotesResponse`'s end-of-meeting detection and live-partner behavior is a genuinely interesting,
well-built interaction pattern.

**Fix status:** no functional code changed in this file. Corrected the stale/incorrect comment in
`calendarCommitmentsSignals.js` and this audit's own earlier (wrong) entry about it.

### 1.49 — LOW — `services/multiProvider.js` full read; stale comment fixed, three design concerns flagged (full audit, file 36/80)
**Location:** `backend/src/services/multiProvider.js`

Full read of all 929 lines against the checklist. This is the single highest-traffic file in the codebase (every AI
call routes through it). No scoping concerns (no DB access except via `tokenTracker`). Confirmed rather than
assumed: every name imported from `redis.js` and `providerCooldown.js` exists as a real export; `recordGroqUsage`
(awaited after every successful call in `callWithFallbackGroq`) cannot break a successful AI call, because
`tokenTracker.js`'s `writeUsageEvent` catches its own errors and returns `null`; the `callWithFallback` /
`streamWithFallback` loops correctly dedupe key cooldown per call and never cool a key for provider-wide
(`PROVIDER_TRANSIENT`) or bad-model failures; Sentry capture is correctly limited to the two choke points the header
describes and is itself wrapped so it cannot break the call path.

Traced a suspected duplicate-token bug in `streamWithFallback` and **ruled it out**: a stream that fails *mid-read*
throws a plain error (not a `ProviderCallError`), which `classifyProviderError` maps to `NON_RETRYABLE`, so the loop
calls `onError` and stops instead of restarting on the next provider and re-emitting tokens the client already has.
(Side effect worth knowing: such mid-stream drops are reported to Sentry as if they were application bugs.)

**One real finding, fixed:** the header (IMPL-H8-01) claimed the old `isRetryableError`/`shouldCoolKey` functions
and signal-list constants were "kept below ... for one release cycle as a safety net." Neither exists in this file —
grep found no `isRetryableError` anywhere, and the only `shouldCoolKey` in the codebase is `exa.js`'s own separate
function. Only the in-memory cooldown/discovery kill-switch fallback was retained. Comment corrected. (My first
draft of the correction also said no `shouldCoolKey` exists anywhere in the codebase; the verification grep showed
that was wrong because of `exa.js`, and I fixed the wording before committing.)

**Flagged, not fixed (behavior changes in the highest-traffic file, none verifiable without real providers):**
1. *No provider-level short-circuit on transient failure.* The queue is every model x every healthy key, per
   provider. A `PROVIDER_TRANSIENT` failure (503, ECONNREFUSED) does not skip the rest of that provider's entries, so
   a provider that is down is retried once per model/key before the next provider is tried.
2. *Unbounded dynamic model discovery.* For cerebras/groq/openrouter, every discovered chat-capable model not in
   `MODEL_PRIORITY` is appended alphabetically. For OpenRouter that is potentially its whole catalog, including
   paid models, if the key has credit. Combined with (1), a total outage could mean a very long sequential chain
   before the caller gets an error. May be intended ("dynamic discovery" is in the header) — a product/cost call.
3. *No explicit timeout on the provider `fetch` calls* (unlike `groq-client.js`, 30s/60s). Not verified here what the
   runtime's default is (Node v22.23.4 in this sandbox; I believe undici defaults to several minutes, unconfirmed).
   Also, a 200 response whose body fails to read/parse (`res.json()` throws) is `NON_RETRYABLE` and aborts the whole
   fallback chain instead of trying the next provider — arguably should be transient. Needs a decision on the values.
4. *Observation only:* a 429 cools the entire key for 1 hour. I believe Groq rate limits apply per model, in which
   case a single model's 429 sidelines the key for all models. Unverified; noting it for whoever tunes this.

**Fix status:** stale comment fixed and verified (syntax check, full suite 23/23). Items 1-4 flagged only.

### 1.50 — MEDIUM — `services/providerCooldown.js`: the "fall back to in-memory" path could never trigger, so key cooldown silently did nothing without Redis (full audit, file 37/80)
**Location:** `backend/src/services/providerCooldown.js` (also affects `multiProvider.js`, `exa.js`)

Full read (116 lines). Shared Redis-backed (in-memory fallback) key-cooldown used by `multiProvider.js` and `exa.js`.

**Real finding, fixed:** the public dispatchers (`markKeyFailed`, `isKeyCooling`) wrap the Redis path in `try/catch`
and fall back to the in-memory implementation + `reportDegradedMode(...)` on a thrown error. But the Redis helpers
they call (`hashIncrementField`, `hashSet`, `hashGetAll` in `redis.js`) catch their own errors and return `null`, and
`getClient()` returns `null` when `REDIS_URL` is unset — none of them ever throw. So the fallback was unreachable for
every real "Redis unavailable" case. Concretely, with `REDIS_URL` unset (a supported config: `validateEnv` classifies
it optional) and the kill switch at its default (ON): `markKeyFailed` logged "cooling down (Redis, cross-instance)"
while recording nothing anywhere, `isKeyCooling` always returned `false`, and `reportDegradedMode` never fired. A
known-bad or rate-limited key was therefore retried on every request, on every model — worse than the kill-switch
(in-memory) path the file claims to degrade to.

**Reproduced, not inferred:** `REDIS_URL` unset, default env -> `isKeyCooling` is `false` right after
`markKeyFailed`; the same script with `MULTIPROVIDER_REDIS_STATE_ENABLED=false` -> `true`.

**Fix:** `markKeyFailedRedis` and `isKeyCoolingRedis` now call `getRawClient()` first and throw if it is `null`, and
`markKeyFailedRedis` also throws if either write returns a failure value, so the existing dispatcher `catch` (in-memory
fallback + degraded-mode report) now actually runs. No change to the Redis-available path.

**Verified:** new `src/services/__tests__/providerCooldown.test.js` (3 tests). Confirmed it has teeth: with the
original file restored it fails (`expected false to be true`); with the fix it passes. Also ran the working-Redis path
against a real local Redis (`redis-server` 6399): key cooled, other key not, hash holds `failCount`/`failedAt`, TTL 3600.
Full suite 26/26.

**Related, discovered while checking the above — see AUDIT.md 1.51:** with `REDIS_URL` set but Redis *unreachable*,
`redis.js`'s `getClient()` never returns (every Redis call hangs). That is outside this file and is recorded separately.

**Minor, not changed:** `multiProvider.getProviderStatus` (no callers anywhere) reads cooldown state from Redis when
enabled, so with Redis down it would report in-memory-cooled keys as "healthy". Moot while it has no callers.

**Fix status:** fixed and verified (syntax check, regression test, live Redis check, full suite).

### 1.51 — HIGH — `services/redis.js`: every Redis call hung forever when Redis was down; reopens a file earlier marked clean (found while auditing files 36-37)
**Location:** `backend/src/services/redis.js` (`getClient`), `backend/src/config/limiters.js` (`buildLimiter`)

This reopens `redis.js`, previously recorded as fully fixed and live-verified (1.12). That verification exercised the
*working* Redis and the *unconfigured* (`REDIS_URL` unset) cases, never "configured but unreachable" or "Redis dies
after connecting" — and the whole codebase is written to fail open on those. They did not.

**Reproduced live (local `redis-server`, node-redis 5.12.1), two distinct hangs:**
1. *Unreachable at startup* (`REDIS_URL=redis://127.0.0.1:1`): `getClient()` awaited `client.connect()` with no timeout.
   node-redis' default reconnect strategy retries forever, so `connect()` never rejects; `getCache()` was still pending
   after 12s, on two consecutive calls. Nothing was cached on failure, so each call also created a new client that
   kept retrying in the background (a leak).
2. *Redis dies after connecting:* with the default offline queue, commands issued while node-redis reconnects wait
   until Redis returns; `getCache()` was still pending after 10s.

**Impact:** every caller's `try/catch`-and-fail-open design was unreachable in a real outage; the request simply stalled.
That includes `multiProvider.isKeyCooling` (called per key on every AI call), the auth/workspace caches, distributed
locking in `concurrencyGuard`, and rate limiting. A Redis outage would have stalled the API rather than degrading it.

**Fix (`redis.js`):** bound the initial connect (3s) and destroy the never-connected client; remember a failed attempt
for 30s so requests don't each pay the timeout; coalesce concurrent callers onto one connect attempt; create the client
with `disableOfflineQueue: true` so commands issued while reconnecting fail fast (reconnection still happens in the
background). All existing helpers already catch and return null/false, so no caller changed.

**Verified live, four scenarios:** unreachable -> `null` after 3.0s, then 0ms on later calls (was: hang); healthy -> 20
concurrent first callers all round-trip with a single "Connected"; Redis killed mid-life -> `null` in 1ms (was: hang);
Redis restarted -> auto-recovered without a process restart. New `src/services/__tests__/redis.test.js`: with the
original file it times out (hangs); with the fix it passes. Full suite 27/27.

**Second-order effect I introduced and had to handle (`limiters.js`):** making Redis fail fast turned the mid-life hang
into an error for rate-limited routes. Tested with the real store: with the existing `buildLimiter` config, a Redis
outage returned `500 {"err":"The client is offline"}`; with `passOnStoreError: true` it returned 200. Nearly every
route (including `/login`) sits behind one of these limiters, so I added `passOnStoreError: true` to `buildLimiter`,
consistent with `redis.js`'s own stated philosophy. **This is a deliberate tradeoff, flagged for the owner:** during a
mid-life Redis outage requests are not rate limited at all (the boot-time fallback is per-instance in-memory limiting;
this case has none). If you would rather fail closed on e.g. the auth limiter, remove that line (comment says how).
Only `buildLimiter` was touched; `limiters.js` still gets its own full read.

**Not changed / limits of verification:** the in-flight-command case (a connection that stalls without closing) is not
covered by a command timeout; `config/bullmq.js` uses a separate IORedis client and was not touched.

**Fix status:** fixed and verified live (see above).

### 1.52 — INFO — `utils/reportDegradation.js` full read (clean); `utils/providerErrors.js` re-read, one observation flagged (full audit, file 38/80)
**Location:** `backend/src/utils/reportDegradation.js`, `backend/src/utils/providerErrors.js`

**`reportDegradation.js` (61 lines) — no issue found.** A per-process, 5-minute-throttled "degraded mode" reporter. Its
header's reasoning for being in-memory rather than Redis-backed (a Redis-outage alert cannot depend on Redis) is correct.
Falls back to `console.warn` without `SENTRY_DSN`, and Sentry failure is caught so it cannot break a caller. Worth
knowing: before 1.50 it was effectively never triggered for Redis outages from `providerCooldown.js`/`multiProvider.js`
(their fallbacks were unreachable); after that fix it can be.

**`providerErrors.js` (130 lines)** was previously ✅ on the strength of its tests alone; read in full now. Logic matches
its header and tests. **One observation, flagged not changed:** `BAD_MODEL` is only detected when `err.status === 400`.
If a provider answers an unknown or removed model with HTTP 404 (I believe some OpenAI-compatible endpoints do, e.g.
OpenRouter for withdrawn `:free` models — **not verified here**), it classifies as `NON_RETRYABLE` and aborts the whole
fallback chain instead of skipping that model. A body-gated widening (`400 || 404`, still requiring the model-not-found
text) looks low-risk but depends on real provider behavior I cannot check from this sandbox.

**Fix status:** no code change. Observation recorded in IMPLEMENTATION_PLAN.md.

### 1.53 — LOW — `services/tokenTracker.js` full read; no code change, four observations (full audit, file 39/80)
**Location:** `backend/src/services/tokenTracker.js` (173 lines), cross-checked against `record_ai_usage()` and `workspace_ai_usage_daily` in `schema.sql`

Verified against the real schema rather than assumed: the `record_ai_usage` function writes the event row and upserts the
daily rollup in one atomic statement pair (`ON CONFLICT (workspace_id, date, provider) DO UPDATE`), so concurrent writes do
not lose counts; column names/types used by the readers (`call_count`, `total_tokens`, `total_credits`,
`estimated_cost_cents`) all exist; `writeUsageEvent` correctly never throws, so a tracking failure can never break a
completed AI call (also confirmed from the `callWithFallbackGroq` side in 1.49). The JS side computes "today" with
`toISOString()` (UTC) and the SQL uses `CURRENT_DATE` (database session timezone) — these agree only while the database
timezone is UTC (the Supabase default); worth knowing if that is ever changed.

**Observations, not changed (all low impact, none verifiable as real problems at current scale):**
1. *Quota checks fail open on a DB error.* `checkWorkspaceExaUsage` destructures only `data`, never `error`; a failed
   query yields `used = 0` and `allowed: true`. Plausibly intentional (a DB blip should not block a feature), but it
   means Exa spend is unmetered during one.
2. *Check-then-record is not atomic* (callers check, make the Exa call, record afterwards), so concurrent requests can
   overshoot a daily limit slightly. Standard for this design; bounded by concurrency.
3. *Global Exa cap reads one row per workspace* via a plain select; PostgREST returns at most 1000 rows by default
   (I believe — Supabase project setting, not verified here), so with >1000 workspaces using Exa on the same day the
   global total would be undercounted. Not reachable at small scale.
4. *All multi-provider AI usage is recorded under `provider: 'groq'`* even when Cerebras/Mistral/OpenRouter served the
   call (the real provider survives only in the `model` string, `cerebras:gpt-oss-120b`). Cost is always 0, so no wrong
   money figures, but per-provider analytics by the `provider` column would be misleading.
Also: `getWorkspaceUsageSummary` has **no callers anywhere** in the codebase — another complete-but-unwired feature, like
`synthesizeMeetingNotes` (1.48). Left in place; same question for the owner.

**Fix status:** no code change.

### 1.54 — HIGH — Supabase query builders have no `.catch()`: 7 call sites threw a TypeError and never ran their query (full audit, file 40/80: services/notifications.js; also touches jobs/growthPushNotificationJob.js and routes/practice.js)
**Location:** `services/notifications.js:35`, `jobs/growthPushNotificationJob.js:24, 196`, `routes/practice.js:51, 130, 891, 892`

Found reading `notifications.js`, where `sendPushNotification` does `await supabaseAdmin.from('users').update(..).eq(..).catch(() => {})`
inside its own `catch` block. Supabase query builders (postgrest-js 2.115.0 here) are thenables with **no `.catch` method**.

**Verified with the real client, not inferred:** `typeof builder.then === 'function'`, `typeof builder.catch === 'undefined'`.
Against a local HTTP server standing in for Supabase: the old pattern throws `TypeError: ...catch is not a function` and
**sends 0 requests** (a builder only executes when `.then` is called); `.then(undefined, handler)` sends the request
(`POST /rest/v1/...` -> 201) and, against an unreachable host, returns an error object instead of throwing.

**Impact, per site (all previously broken):**
- `notifications.js` — the "silently handles expired FCM tokens" cleanup never ran, and `sendPushNotification` **rejected**
  instead of returning `{ sent: false }` for exactly the expired-token case it is meant to absorb. Dead tokens were never cleared.
- `growthPushNotificationJob.js:196` (`logPushSent2`) — **the push log was never written.** That table is what
  `getDailyPushCount2` / `getHoursSinceLastPush2` read to enforce the daily cap and minimum gap between pushes, so those
  throttles could never trigger (count always 0, last-push always "never"). The throw also aborted the per-user step.
- `growthPushNotificationJob.js:24` (`logJob3`) — job-run logging threw on every call.
- `practice.js:130` — **practice badges were never awarded** (the insert never ran; the TypeError surfaced on the first earned badge).
- `practice.js:891-892` — **deleting a practice session with an attached chat failed**: the cleanup lines threw before the
  session row was deleted.
- `practice.js:51` — the dead-letter logger crashed inside the failure path it exists to record, and skipped the alert webhook after it.

**Fix:** all seven now use `.then(undefined, handler)` (same intent: best-effort, swallow errors). Behavior that was
being masked is therefore **now live** — see "Behavior changes" below. Note Supabase normally returns `{ error }` rather
than rejecting, so a failed write is still silently ignored, as the original code intended.

**Regression guard:** new `src/__tests__/noSupabaseBuilderCatch.test.js` (1) asserts the premise on a real builder and
(2) scans all backend source for `.catch(` chained on a `.from()`/`.rpc()` statement (excluding `storage.from`/`auth`).
Confirmed it fails on the original code listing all 7 sites and passes on the fixed code. Suite 29/29.

**Behavior changes the owner should expect (these are corrections, but visible):**
1. Growth pushes will start being throttled for real (the cap/gap now see their own log), so users may receive **fewer** pushes than before.
2. `push_notification_log` and `job_logs` will begin accumulating rows; I did not check whether either has a retention/cleanup job.
   **CORRECTION (see 1.59):** I overstated this for `job_logs`. The growth push job's *'completed'* rows pass `{ sent, ... }` and `job_logs` has
   no `sent` column, so those inserts would still have been rejected by PostgREST (silently) after the `.catch` fix. 'started' and 'failed' rows
   were fine. Fixed in 1.59 by routing that job through the shared `logJob`.
3. Practice badges will begin being awarded (eligibility is computed from current totals, so earned badges appear on the next qualifying session).
4. Deleting a practice session with a chat now succeeds and removes its messages.

**`notifications.js` otherwise:** read in full (161 lines); no other defect. `notifyUser` takes the target `userId`/token from its
caller, so scoping depends on call sites (the ones in the files already audited were reviewed in earlier passes). Cleanup
of an invalid token clears it for every user row holding that token, which is correct for a dead token.

**Scope note:** only these 7 lines were changed in `practice.js` and `growthPushNotificationJob.js`; neither file was re-read in full
here. The scan covers `.from('literal')` and `.rpc(` chains; a `.from(variable)` builder with `.catch` would not be matched
(a separate grep for non-literal `.from(` found only `prospectDedup.js`, which does not use `.catch`).

**Fix status:** fixed and verified (real-client checks, regression guard with teeth, full suite).

### 1.55 — MEDIUM — `services/storage.js`: client-controlled file extension, orphaned uploads, silent failed delete (full audit, file 41/80)
**Location:** `backend/src/services/storage.js` (210 lines), traced through `routes/upload.js` and `config/constants.js`

Full read, cross-checked against its two callers (`routes/upload.js`, `services/voiceMemoService.js`) and `UPLOAD_LIMITS`.
Allowed types are jpeg/png/gif/webp, pdf, text/plain and text/csv; images go up as Cloudinary `image` resources
(Cloudinary itself rejects non-images), while pdf/txt/csv go up as `raw`, which Cloudinary does not content-check.

**Three real defects, all fixed:**
1. **Client-controlled extension on raw uploads.** `ext` was taken from the filename (`originalFilename.split('.').pop()`) and
   passed as Cloudinary's `format`, while the only validation is the *declared* mime type (a client-supplied header).
   A file sent as `application/pdf` with the name `x.html` (or `.exe`, `.svg`) was stored and served with that extension.
   It is served from Cloudinary's domain, not the app's origin, so this is not an app-origin XSS, but it let the app be
   used to host arbitrary-extension content. Now derived from the validated mime type (`pdf`/`txt`/`csv`, else `bin`).
2. **Orphaned uploads on metadata failure.** The object is uploaded to Cloudinary first, then the `file_uploads` row is
   inserted. If the insert failed (for example an invalid `chat_id`, which `routes/upload.js` passes through from the request body
   without checking), the exception was thrown but the Cloudinary object stayed forever, unreferenced. Now removed
   best-effort (cleanup failure is logged and never masks the real error).
3. **`deleteFile` reported success on a failed row delete.** The final `delete()` result was ignored, so a DB failure after the
   Cloudinary object was already destroyed returned success and left a dangling row. Now surfaced as an error, and the delete
   is also scoped `.eq('user_id', userId)` (ownership was already checked above; this is defense in depth).

**Verified:** new `src/services/__tests__/storage.test.js` (7 tests, Cloudinary and Supabase mocked). Run against the original
file, the four tests covering changed behavior fail; with the fix all pass. Full suite 36/36. Not verified against a live
Cloudinary account (no credentials in this environment); the mime-to-extension map was checked only against the allowed-types list.

**Checked and found fine:** `deleteFile` ownership check (row's `user_id` must equal the caller; mismatch rejects before
Cloudinary is touched); `GET /upload` is scoped by `user_id`, so the unvalidated `chat_id` is not a cross-user exposure
(`file_uploads` is read nowhere else); `uploadFile` enforces type and size even though `multer` also does.

**Observations, not changed:**
- `buildAttachmentContext` has **no callers** anywhere, and the `audio` branch in `uploadFile`/`getFileType` is unreachable because
  `UPLOAD_LIMITS.ALLOWED_TYPES` has no audio types (voice memos use `uploadAudioBuffer`). Dead code, left in place.
- `uploadAudioBuffer` does no type or size validation itself; it relies entirely on `voiceMemoService.js` (not yet audited, still pending).
- Uploads are public by URL (default Cloudinary `upload` delivery type, unguessable UUID path). Reasonable for this design, but access
  control is obscurity, not authorization; worth a conscious decision if any uploads are sensitive.

**Fix status:** fixed and verified (mocked tests with teeth, full suite).

### 1.56 — LOW — `services/streaming.js`: persistence failures were silent; main chat path now has tests (full audit, file 42/80)
**Location:** `backend/src/services/streaming.js` (249 lines), traced through `multiProvider.streamWithFallback` and both `streamAndSave` call sites in `routes/chat.js`

Full read. This is the main chat reply path (SSE streaming + persistence) and had no tests.

**Defect, fixed (low severity):** the `UPDATE` that saves the finished reply (`delivery_status: 'delivered'`) and the `UPDATE` that marks a
failed generation never checked their result. If the save failed, the client was still sent `complete`/`done` while the
`chat_messages` row stayed empty (`content: ''`, status `sent`), so the reply vanished on reload and **nothing was logged**. Both now log
the failure with the message and chat ids. Behavior otherwise unchanged (it does not retry; the user still sees the streamed text live).

**Traced and ruled out (checked rather than assumed):**
- *Crash from the fire-and-forget `onComplete`.* `streamProvider` calls `onComplete?.(...)` without awaiting it and `onComplete` is async, so a
  rejection would be unhandled. `app.js` and `server.js` install `unhandledRejection` handlers that log and continue, so it cannot crash the process.
- *`streamAndSave` throwing before any event.* Both `routes/chat.js` call sites wrap it in `try/catch`, send an SSE `error` and end the stream.
- *`...metadata` spread overriding `role`/`user_id`/`chat_id` in the placeholder insert.* Neither caller passes `metadata`, so it is theoretical today
  (it would become real if a caller ever passed request-derived data; spread order puts `metadata` last).
- SSE framing: events carry fixed names and `JSON.stringify`d data, so newline injection is not possible via the current callers.

**Verified:** new `src/services/__tests__/streaming.test.js` (6 tests, Supabase and response mocked): happy path event order and DB state, empty-output
placeholder, error path, client-disconnect (no SSE but reply still saved), and the two new logging cases. The two logging tests fail on the
original file; the other four pass on both (they characterize existing behavior). Full suite 42/42.

**Observations, not changed:**
- `await streamAndSave(...)` resolves **before** the message is persisted and before `done` is sent, because `streamWithFallback` returns as soon as the
  provider stream ends and `onComplete`'s database work is not awaited. Nothing relies on the opposite today (`onSaved` is designed to fire later),
  but any future code that assumes "the message is saved once `streamAndSave` returns" would be wrong.
- If `streamAndSave` throws *after* inserting the placeholder, the row is left `content: ''` / `sent` (the route only closes the SSE stream).
- An empty model response is saved as a bracketed apology string with status `delivered`, so it is later replayed to the model as a real assistant turn.

**Fix status:** logging fix applied and verified; observations recorded only.

### 1.57 — LOW — `services/transcription.js`: bad audio re-uploaded to every key; header claimed a cooldown that does not exist (full audit, file 43/80)
**Location:** `backend/src/services/transcription.js` (85 lines), traced through its only caller `services/voiceMemoService.js`

Full read. A small Groq Whisper client that loops over `GROQ_API_KEY_1..10` and returns `{ text }`.

**Defect, fixed:** every failure, whatever its cause, moved on to the next key. Audio the provider rejects outright (400 bad/empty
format, 413 too large, 415 unsupported type, 422) was therefore re-uploaded once per configured key (up to 10 times, each a full
audio upload) and could never succeed. It now reuses the already-audited `classifyProviderError`: only key faults
(401/403/429) and provider-wide transient failures (5xx, network) go on to the next key; anything else stops after one request.
The error message keeps its `TRANSCRIPTION_FAILED: ...` form (the caller only stores `err.message` and rethrows).

**Stale comment, fixed:** the header said this module has "same cooldown-on-failure behavior" as `multiProvider.js`; the body (and the
header's own next sentence) says there is no cooldown. Corrected. I did **not** add a cooldown: it would be a feature, and Groq's
Whisper limits are probably separate from its chat limits, so sharing the chat key cooldown would be wrong.

**Verified:** new `src/services/__tests__/transcription.test.js` (10 cases, `fetch` stubbed): success, fallback on 401/429, on 503, on a
network reset, stop-after-one on 400/413/415/422, last-error reporting after all keys fail, and the no-key error. The four
input-rejection cases fail on the original (it made 3 requests instead of 1); the rest pass on both. Full suite 52/52.
Not verified against the real Groq API (no key here).

**Behavior change to know about:** a `200` response with an unparseable body now stops after one attempt (it is not a `ProviderCallError`,
so it classifies as non-retryable) where it previously tried the next key. Judged acceptable and rare.

**Observations, not changed:**
- No request timeout on the upload (same as `multiProvider.js`, 1.49), so a stalled connection waits on the runtime default.
- *Lead for `voiceMemoService.js` (still pending):* it downloads the stored audio with `fetch(audioUrl).then(r => r.arrayBuffer())` and never
  checks `r.ok`; a 404/403 from Cloudinary would hand an HTML error page to the transcriber as if it were audio.
- The key-pool parsing is a third copy of `multiProvider.buildKeyPool`; a small duplication, not worth a shared helper on its own.

**Fix status:** fixed and verified (tests with teeth, full suite).

### 1.58 — MEDIUM — `config/cloudinary.js`: setting only `CLOUDINARY_URL` (as documented) wiped the config, so every upload failed (full audit, file 44/80)
**Location:** `backend/src/config/cloudinary.js` (18 lines)

The header says the SDK auto-reads a single `CLOUDINARY_URL`. But the file then called `cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
api_key: ..., api_secret: ..., secure: true })` unconditionally. With only `CLOUDINARY_URL` set, those three are `undefined`, and the SDK treats explicit
`undefined` values as overrides of the URL-derived config.

**Reproduced:** with `CLOUDINARY_URL=cloudinary://KEY123:SECRET456@mycloud` and no discrete vars, `cloudinary.config()` returned no `cloud_name`, no `api_key`
and no secret (`{"has_secret":false}`); with the three discrete vars it worked. So the advertised single-variable form silently produced an unconfigured
client, and every `uploadFile` / `uploadAudioBuffer` call (document uploads and voice memos) would fail at runtime with a Cloudinary "must supply" error.

**Fix:** only pass the discrete variables that are actually set (`secure: true` is always passed). Both forms now work.

**Verified:** new `src/config/__tests__/cloudinary.test.js` runs each configuration in a child process (the SDK keeps global state that a module reset cannot
clear): URL-only gives `mycloud` / `KEY123` / secret present / `secure: true`; discrete vars give the expected values. The URL-only test fails on the original
file; both pass with the fix. Full suite 54/54. Not tested against Cloudinary's servers (no account here).

**Observation, not changed:** `config/validateEnv.js` does not mention any `CLOUDINARY_*` variable, so a deployment with Cloudinary unconfigured boots cleanly
and only fails when someone first uploads a file. Whether Cloudinary should count as required or optional is a deployment decision.

**Fix status:** fixed and verified.

### 1.59 — MEDIUM — `utils/jobHelpers.js`, `utils/logger.js` (+ `jobs/growthPushNotificationJob.js`): job-log failures were invisible, 'completed' rows could not insert, logger could throw (full audit, files 45-46/80)
**Location:** `backend/src/utils/jobHelpers.js`, `backend/src/utils/logger.js`, `backend/src/jobs/growthPushNotificationJob.js` (3 lines)

**1. `logJob`'s error handling could never fire (the "L4" fix did not actually work).** `logJob` wraps
`await supabaseAdmin.from('job_logs').insert(row)` in `try/catch` and reports a failure to Sentry. But Supabase reports failures as a *returned* `{ error }`,
not a thrown exception (shown against a real client in 1.54: an unreachable host returns an error object and does not throw). So for exactly the scenario the
comments describe (an unwritable `job_logs`: migration, RLS, bad column) nothing was warned and nothing reached Sentry. It now reads `{ error }` and throws
into the existing handling, so the warning and the Sentry report happen. It still never throws out to its caller.

**2. The growth push job's private `logJob3` inserted `...data` straight into `job_logs`.** Its callers pass `{ sent, duration_ms }`, and `job_logs`
(checked in `schema.sql`) has only `users_processed`, `opportunities_found`, `error_message`, `duration_ms`, `metadata`. `sent` is not a column, so every
**'completed'** insert was rejected by PostgREST (and silently ignored). 'started' and 'failed' rows were fine. This is what `utils/jobHelpers.js`
(the LOW-09 "shared helper") already handles by moving unknown keys into the `metadata` jsonb column; `logJob3` is now just an alias of it. The two other direct
`job_logs` writers were checked: `practice.js:51` uses only real columns.

**3. `logger.js` could throw.** `fmt` called `JSON.stringify` on object values; it throws on circular structures (e.g. an HTTP-client error object) and on BigInt.
Loggers are usually called from `catch` blocks, where a throw would replace the real error with a `TypeError`. Unserializable values now print as `[unserializable]`.
Output for normal values is unchanged. Not changed (still a real, separate issue): string values are interpolated raw, so a value containing newlines can forge log lines.

**Verified:** new `utils/__tests__/jobHelpers.test.js` (3) and `utils/__tests__/logger.test.js` (4). Against the original files, four fail (returned-error not reported;
three logger cases); the other three pass on both, as characterizations (including that `{ sent, duration_ms }` becomes `{ duration_ms, metadata: { sent } }`). The growth job module
was also imported to confirm the new import binds. Full suite 61/61. Not exercised against a live Supabase `job_logs` table.

**Fix status:** fixed and verified (tests with teeth, module load, full suite).

### 1.60 — INFO — observation-only reviews: `config/sentry.js`, `utils/parseAIJson.js`, `middleware/traceId.js`, `middleware/validate.js` (full audit, files 47-50/80)
No code changes. Each was read in full.

- **`config/sentry.js` (81 lines).** Fail-open and no-op without `SENTRY_DSN`; `sendDefaultPii: false` is explicit. *Likely issue, unverified:* `initSentry()` is called in `app.js`
  *after* the file's `import` statements. ES module imports are hoisted, so `express`, `http` and every route module are already loaded when `Sentry.init` runs. With
  `@sentry/node` 10.x on ESM, automatic tracing/instrumentation generally requires Sentry to be initialized before those modules load (a preloaded `--import` file).
  Explicit `captureException`/`captureMessage` calls (what this codebase relies on) work regardless; the configured `tracesSampleRate: 0.1` probably produces no auto-traces.
  Could not be confirmed without a DSN and a Sentry project.
- **`utils/parseAIJson.js` (25 lines).** Correct for fenced or bare JSON. Known limitation: it removes every triple-backtick *anywhere*, including inside JSON string
  values, so a field containing a markdown code block would corrupt otherwise valid JSON. Unlikely in outreach content; a safe fix would be a superset (try raw parse first,
  strip edge fences next, keep the current behavior last). Not applied: low value.
- **`middleware/traceId.js` (25 lines).** Accepts a client-supplied `X-Trace-Id` verbatim (no length or character check) and echoes it in the response header. **`req.traceId` is read
  nowhere else in the codebase** (only mounted in `app.js` and `server.js`), so it is not in any log line and there is no log-forging path today; it would become one the moment
  something logs it. Worth validating at that point.
- **`middleware/validate.js` (16 lines).** Correct under Express 4.22.2 / zod 3.25.76 (used on 19 routes, 3 with `'query'`). Latent: it assigns `req[source] = result.data`, and in
  **Express 5 `req.query` is a read-only getter**, so the three `'query'` routes would throw on an Express upgrade. Also returns only `fieldErrors`, so a root-level type failure
  (body not an object) yields an empty `details`.

### 1.61 — LOW — `routes/workspace-activity.js`: negative limit/offset caused a 500 (full audit, file 51/80)
**Location:** `backend/src/routes/workspace-activity.js` (34 lines)

Full read. Scoping is correct: manager-gated via `requirePermission('manager')`, filtered by `req.workspace.id`, mounted behind auth + workspace middleware in both `app.js` and `server.js`. Returning member name/email and activity metadata to managers is by design (see its header).

**Defect, fixed:** `limit`/`offset` were only capped above (`Math.min(.., 100)`), so `?limit=-5` or `?offset=-10` reached `.range()` unchanged, which PostgREST rejects, and the manager got a 500. Now `limit` is clamped to 1..100 and `offset` to >= 0 (non-numeric still falls back to 20 / 0).

**Verified:** new `routes/__tests__/workspaceActivity.test.js` (6 tests, handler invoked directly with Supabase mocked): workspace scoping, defaults, cap at 100, negative clamp, non-numeric, DB error propagation. The negative-clamp test fails on the original. Suite 67/67. (My first version of that test asserted the wrong clamp value; the code was right and I corrected the test.)

**Fix status:** fixed and verified.

### 1.62 — HIGH — `config/rateLimitStore.js`: only 1 of 20 limiters actually used Redis, even with a healthy Redis (full audit, files 52-53/80; also reviews `schemas/calendarAiSchemas.js`)
**Location:** `backend/src/config/rateLimitStore.js` (150 lines); consumer `backend/src/config/limiters.js`

**Defect, fixed.** `getSharedClient()` set a boolean `_clientAttempted = true` *before* the Redis connection finished, and any caller arriving afterwards got `null`
("already tried and failed"). `limiters.js` starts all 20 limiters concurrently at import time (each `buildLimiter(...)` is an un-awaited promise gathered later),
so only the first caller ('auth') ever received the client. The other 19 silently fell back to per-instance in-memory counters, with no warning (the fallback
log/degraded-mode report fired only on the first caller's path).

**Reproduced with a real Redis:** booting `limiters.js` printed exactly **one** "Redis-backed rate limit store initialized" line (namespace `auth`) out of 20 limiters.
Effect: every limiter except `auth` enforced its limit per server instance, so with N instances the real limit was roughly N x the configured one. That is precisely the
problem this module's header (C2 / IMPL-RATELIMIT-02) says it exists to solve, and the earlier "namespace per limiter" work was irrelevant for 19 of them.

**Fix:** all callers now await one shared in-flight promise. Also re-checks the per-namespace cache after the `await`, because two concurrent calls for the *same* namespace
each built a store (found by my own test; harmless for counting, but the docs promise one instance). After the fix: **20 of 20** limiters report a Redis-backed store
with a live Redis; with Redis unreachable or `REDIS_URL` unset, all fall back with a single warning.

**Verified:** new `config/__tests__/rateLimitStore.test.js` (3 tests, delayed fake Redis client): 20 concurrent namespaces all get distinct stores from one client lookup;
unavailable Redis falls back for all with one warning; same namespace returns the same instance. Two of the three fail on the original. Suite 70/70. Live check above used
a local `redis-server`, not a production Redis.

**Behavior change to expect:** rate limits will now actually be shared across instances, i.e. effectively *stricter* than before for any multi-instance deployment (a user could
previously get ~N x the limit). Worth knowing before it surprises a heavy user or an integration test that hammers an endpoint.

**Still true, not changed (design limits):** the fallback is sticky for the whole process lifetime. If Redis is unreachable when the app boots (e.g. it starts a few seconds after the API), every
limiter stays in-memory until restart even after Redis recovers. (Before the 1.51 fix this case hung forever instead.) Relatedly, see 1.51: a mid-life outage fails open via `passOnStoreError`.

**`schemas/calendarAiSchemas.js` (79 lines) — read in full, no defect.** Plain zod schemas plus `validateOrFallback`. Minor: on validation failure it logs up to 500 characters of the raw
model output, which for meeting prep/debrief content can include names and details from a user's calendar, so those land in application logs. Noted only.

**Fix status:** rateLimitStore fixed and verified; calendarAiSchemas clean.

### 1.63 — HIGH — `utils/attachmentProcessor.js`: SSRF with response reflection through chat attachment URLs (full audit, file 54/80)
**Location:** `backend/src/utils/attachmentProcessor.js` (301 lines), fed by `routes/chat.js` (schema at ~line 496, call sites ~1047 and ~1586)

**Defect, fixed.** `POST` chat-message bodies accept `attachments: [{ name, type, url }]` and `chat.js` validates `url` only with `z.string().url()`, which accepts any
URL. `preprocessAttachmentsForGrok` then fetched that URL **server-side** with `axios` (text/PDF/image) and put the result into the model prompt (documents: first 8000 chars of the
body; images: base64 sent to a vision model). An authenticated user could therefore make the server request an internal address — e.g. a cloud metadata endpoint such as
`http://169.254.169.254/...`, `localhost`, or an internal service — and read the response by asking the model to repeat the attached "document". Classic SSRF, with the response
reflected back to the attacker.

**Fix:** `preprocessAttachmentsForGrok` now refuses to fetch any URL that is not one of our own uploads. The new exported `isAllowedAttachmentUrl` requires `https:`, host exactly
`res.cloudinary.com`, no userinfo, no non-default port, and, when `CLOUDINARY_CLOUD_NAME` is known, a path under `/<our cloud>/` (so another tenant's assets are refused too). Those
are the only URLs `services/storage.js` ever produces. A refused attachment becomes the same kind of placeholder as a missing URL ("... is not an uploaded file — it was not read"); the
request itself still succeeds. Also added the missing `maxContentLength` (10 MB) to the PDF download, which was the only one of the three fetches without a size bound.

**Checked for other sinks:** every other server-side `fetch`/`axios` call was reviewed: `multiProvider.js` (fixed provider base URLs), `voiceMemoService.js:114` (URL built server-side by
`cloudinary.url(memo.storage_path)`), `practice.js:57` (env-configured webhook). `attachmentProcessor.js` was the only one taking a client-supplied URL.

**Verified:** new `utils/__tests__/attachmentProcessor.test.js` (21 cases, `axios` mocked): allows our Cloudinary URLs; rejects cloud-metadata IP, localhost, loopback https, internal hostname,
plain http, another cloud's path, lookalike host (`res.cloudinary.com.evil.example`), userinfo trick (`res.cloudinary.com@evil.example`), credentials, odd port, `file:`, `data:`, garbage and
empty; confirms a disallowed URL results in **zero** `axios.get` calls and a placeholder; an allowed text file is still fetched and read; the no-URL placeholder is unchanged. Against the
original file all 19 new-behavior cases fail (the helper does not exist and the fetch happens). Full suite 91/91. Not exercised against a real Cloudinary account or a real vision model.

**Behavior change / risks to know:**
- Any attachment whose URL is **not** `https://res.cloudinary.com/<cloud>/...` is now silently not read (the user message still goes through). If the frontend ever sends another origin (a custom
  Cloudinary CNAME domain, a different CDN, a pasted link), it will stop working; the allowlist would need that host added.
- I did not change `chat.js`'s schema, so the bad URL is still *accepted* and persisted on the stored message (`attachments` is saved as sent). It is simply never fetched. Rejecting it at the
  edge with a 400 would be a reasonable follow-up.
- Redirects are still followed by `axios` by default; with the host pinned to our own Cloudinary path this does not reopen the hole in practice, but `maxRedirects: 0` would be stricter.

**Other observations:** the file keeps its legacy "Grok" names (the header explains why); `buildGrokAttachmentPrompt` interpolates the client-supplied filename into the prompt (normal prompt-injection surface,
not a new one).

**Fix status:** fixed and verified.

### 1.64 — LOW — `services/intelligenceReport.js` (+ `routes/insights.js`): unvalidated AI output was cached and returned; flat trend labeled "Declining" (full audit, file 55/80)
**Location:** `backend/src/services/intelligenceReport.js` (324 lines); consumer `backend/src/routes/insights.js` (`GET /intelligence`)

Full read. **Scoping is correct:** all 12 gather queries filter by both `workspace_id` and `user_id`. Callers checked: `routes/insights.js` is the only consumer, with correct argument order
(`gatherIntelligenceContext(userId, workspaceId)`). The `.catch(() => {})` on `setCache` there is fine (`setCache` is a real async function, not a Supabase builder; see 1.54).

**Defects, fixed:**
1. **AI output was cached and returned unchecked.** The route did `const insights = parseAIJson(content)` then cached it and returned it. If the model answered with an object (`{ "insights": [...] }`), a
   string, or items missing `title`/`body`, that went straight to the client and stayed cached for the full TTL. New `normalizeInsights` (exported) requires an array, keeps only items with a non-empty string
   `title` and `body`, fills `type`/`icon` defaults, nulls a non-string `action`, caps at 5 (the prompt asks for 3-5), and returns `null` when nothing usable remains; the route then throws into its
   existing catch and serves the rule-based fallback instead.
2. **A flat skill trend was described to the model as "Declining".** The prompt used `isImproving ? 'Improving' : 'Declining'`, so `composite_delta` of `0` read as "Declining (0.00)". Now three-state:
   Improving / Declining / Flat.

**Verified:** new `services/__tests__/intelligenceReport.test.js` (10 tests): trend wording for +/-/0 and absent, `normalizeInsights` on good input, wrong shapes, partial items, defaults and the cap, and that the
rule-based fallback always yields an insight. Six fail on the original (the helper and the Flat label do not exist); full suite 101/101. The route change itself is a three-line wiring change and was not
exercised end to end (that needs the whole app, auth and a model).

**Observations, not changed:**
- Every query ignores its `error`, so a failed query silently becomes "No active goals" / "No signals detected" in the prompt and the model is asked for insights on partial data without any indication.
- Check-in mood average counts a null `mood_score` as 5 (`c.mood_score || 5`), which biases the average toward neutral; a real 0 would also become 5.
- "Stalled deals" is counted only within the 10 most recent contacted/replied/call_demo opportunities, and includes deals that are progressing (replied/call_demo) if no feedback was ever prompted.
- User-supplied text (goals, objection phrases, product description) is interpolated into the prompt: normal, unavoidable prompt-injection surface for this feature.

**Fix status:** fixed and verified.

### 1.65 — LOW — `services/voiceMemoService.js`: audio download never checked the HTTP status or size (follow-up to 1.57; file re-opened)
**Location:** `backend/src/services/voiceMemoService.js:114` (transcription step); new `backend/src/utils/downloadAudio.js`

Re-opens a file previously marked clean (a prior pass read it for idempotency). Lead from 1.57, confirmed: the transcription step did
`await fetch(audioUrl).then(r => r.arrayBuffer())`, with no `r.ok` check. A 403/404/5xx from the storage CDN (for example if the Cloudinary object was deleted or never finished uploading) had its
error page passed to the transcriber as if it were audio. With the 1.57 change that now fails fast with an opaque "HTTP 400" from Groq stored in `transcription_error`, rather than a message saying
the download failed. There was also no size bound on the download.

**Fix:** new `downloadAudioBuffer(url, { maxBytes })` throws a clear error on a non-OK status, on an oversized declared `Content-Length` (before reading the body), on an oversized body, and on an empty body.
`voiceMemoService` uses it with the existing `VOICE_MEMO_LIMITS.MAX_SIZE_BYTES` (25 MB, the same ceiling as the upload path). The surrounding `try/catch` is unchanged, so a failure still marks the memo
`failed` with the (now accurate) message and rethrows for the queue's retry.

**Verified:** new `utils/__tests__/downloadAudio.test.js` (7 cases, `fetch` stubbed): success, 403/404/500, oversized by header (body not read), oversized by body, empty. Suite 108/108.
The `voiceMemoService` wiring is a one-line substitution plus an import (syntax-checked, and the constant was already imported there); the full service was not re-read or run end to end.

**Fix status:** fixed and verified at the helper level.

### 1.66 — POSSIBLY CRITICAL (needs a 1-minute owner check) — zero RLS + the browser uses the public anon key to subscribe to table changes; this weakens the premise of 1.3 / D2 (full audit, schema.sql)
**Location:** `schema.sql` (0 of 48 tables have `ENABLE ROW LEVEL SECURITY`), `frontend/src/lib/supabase.ts`, `frontend/src/hooks/useRealtime.ts`

**What 1.3 / D2 concluded:** no RLS is "not inherently a bug" because the *backend* only uses the service-role client, which bypasses RLS. That is true of the backend. It does not cover the other client of the same
database: **the browser.** Facts established from the repo:
- The frontend builds a Supabase client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`lib/supabase.ts`). A `VITE_` variable is compiled into the public JavaScript bundle, so the anon key is, by design, public.
- `hooks/useRealtime.ts` uses that client to open `postgres_changes` subscriptions on **`chat_messages`** (practice-session delivery, `PracticeSessionPage.tsx`) and **`user_events`** (calendar prep, `CalendarPage.tsx`,
  `CalendarEventDetailPage.tsx`). No user session or access token is attached to the client anywhere I could find (`setSession` / `setAuth` / `access_token` are absent), so these subscriptions run as the **anon role**.
- The `filter` (e.g. by `chat_id`) is chosen by the client code. Anyone holding the anon key can open the same subscription **without** a filter.

**Why that matters:** with RLS disabled, Supabase Realtime does not restrict which rows an anon subscriber receives, and PostgREST (`/rest/v1/<table>`) is open to the anon role on any table it has been granted (Supabase's default
grants include `anon` on `public` tables). If both hold on the live project, anyone who opens the site's JS can read, and possibly write, **every tenant's data**: chat message content, prospects, voice-memo transcripts, calendar
events. The whole multi-tenant isolation work audited elsewhere (workspace scoping in every route) would be bypassed because it is enforced in the Express layer, which this path never touches.

**What I could NOT verify (so this is a flagged risk, not a confirmed breach):** the live project's grants and RLS state, and which tables are in the `supabase_realtime` publication (no publication/grant statements exist in `schema.sql` or
`migrations/`, so they are configured outside the repo). The app working as designed (realtime delivering rows to an anon client) is itself consistent with the exposure being real.

**Check it (anon key is the same one the frontend ships; replace the placeholders):**
```
curl -s "https://<project>.supabase.co/rest/v1/users?select=id&limit=1" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
curl -s "https://<project>.supabase.co/rest/v1/chat_messages?select=id,content&limit=1" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
```
A JSON array with rows = exposed. `[]` is **inconclusive** (the table may just be empty); `permission denied` / 401/403 = safe for REST. Also check Dashboard -> Database -> Replication for which tables are published.

**Why I did not "just enable RLS":** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with *no* policies is safe for the backend (service role bypasses RLS) and would close both holes, **but it will also stop the three realtime
subscriptions from delivering anything**, because they run as anon. So the practice-session "message delivered" updates and calendar "prep generated" updates would silently stop. D2's worry about breaking things was about backend queries;
this is the browser-side dependency it did not account for. The real fix is a design decision:
1. Authenticate the realtime client with the user's session token and add *narrow* RLS SELECT policies for just the subscribed tables (workspace/user scoped), enabling RLS on all the others with no policies; or
2. Move delivery notifications off Supabase Realtime (the backend already streams SSE for chat; polling or SSE for these two events), then enable RLS everywhere with no policies; or
3. Revoke `anon` table grants and rely on Realtime Broadcast instead.
Interim mitigation that breaks nothing: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` closes **REST** exposure for anon but will also cut the realtime subscriptions; so it is the same trade-off. I changed no code or SQL for this.

**Also revisit D2:** its stated reason ("isn't justified by a specific confirmed gap") should be re-read in light of this. Recommend the owner run the check above before anything else in this audit.

**Fix status:** NOT fixed — needs the owner's check and a design decision; documented only.

### 1.67 — LOW/MEDIUM — `schema.sql` structural review (script-based, not run against a live DB) (full audit, `schema.sql` constraints row)
**Method:** parsed `schema.sql` (48 tables, 100 foreign keys, 4702 lines) with a script, then spot-checked the surprising results against the file. Not executed against Postgres in this pass.

**Sound:** all 48 tables have a primary key. 57 FKs cascade, 22 `SET NULL`, 12 have no `ON DELETE` clause.

**Findings (none changed; all are decisions or low-risk hardening):**
1. **26 ownership/reference columns have no foreign key**, so there is no referential integrity and no cascade: `ai_usage_events.{workspace_id,user_id}`, `availability_windows.{workspace_id,user_id}`, `booking_pages.{workspace_id,user_id}`,
   `calendar_ai_events.{workspace_id,user_id,event_id}`, `conversation_commitments.{user_id,source_id}`, `conversation_signals.{user_id,source_id}`, `event_attendees.workspace_id`, `practice_curriculum.user_id`, `practice_drills.user_id`,
   `practice_sessions.{coaching_chat_id,workspace_id}`, `prospect_insights.user_id`, `prospect_merge_candidates.workspace_id`, `prospects.user_id`, `user_notifications.user_id`, `user_skill_profile.user_id`, `voice_memos.{workspace_id,user_id}`,
   `workspace_ai_usage_daily.workspace_id`. Some may be intentional (e.g. `source_id` polymorphic), but `workspace_id`/`user_id` on user content tables (`prospects`, `voice_memos`) are not.
2. **12 FKs have no `ON DELETE` behavior** (default NO ACTION, so deleting the parent is *blocked*): chats.growth_card_id -> growth_cards; daily_check_ins.workspace_id -> workspaces; opportunities.assigned_to -> users; practice_badges.workspace_id -> workspaces; practice_drills.session_id -> practice_sessions; practice_drills.workspace_id -> workspaces; practice_interruptions.chat_id -> chats; practice_sessions.triggered_by_feedback_id -> feedback; user_memory.workspace_id -> workspaces; user_performance_profiles.workspace_id -> workspaces; workspace_members.invited_by -> users; workspaces.owner_user_id -> users. Notably `workspaces.owner_user_id -> users` and `opportunities.assigned_to -> users` block a hard delete of a user.
3. **26 FK columns have no index starting with that column** (heuristic: composite indexes that lead with another column are not counted), e.g. `chats.user_id`, `chat_messages.user_id`, `user_events.user_id`, `practice_badges.user_id`, `chats.practice_session_id`,
   `file_uploads.chat_id`, `workspace_members.invited_by`. Mostly a scale/performance and cascade-speed concern; confirm against real query plans before adding indexes.
4. **Nullable ownership columns:** `calendar_ai_events.user_id`, `chat_topic_tags.user_id`, `feature_usage_events.user_id`, `goal_notes.user_id`, `practice_curriculum.user_id`, `practice_drills.user_id`, `user_memory.user_id`, `user_skill_profile.user_id`,
   `workspace_members.user_id` (the last is plausibly intentional for pending invites). A NULL-owner row is invisible to every user-scoped query.
5. **Account deletion never removes user content.** `deleteAccount` (checked in `routes/user.js`) is a soft delete: it scrubs `name`/`email`, marks owned workspaces deleted and removes the auth user; no job in `jobs/`/`workers/` hard-deletes afterwards. So chats, prospects,
   voice-memo transcripts, calendar data and so on persist indefinitely, and the missing FKs in (1) mean even a manual hard delete would leave rows behind. That is a retention/privacy decision (e.g. GDPR erasure expectations) for the owner, not a code bug.

**Fix status:** documented only; schema changes need an owner decision and a migration plan.

### 1.68 — RESOLUTION — `services/multiProvider.js` + `utils/providerErrors.js`: the design concerns flagged in 1.49 and 1.52, decided and fixed
**Decision (owner asked me to decide):** fix all of them, conservatively, because each failure mode (a hung provider, an aborted chain, a long outage) hurts every AI feature at once.

1. **Provider-level short-circuit.** After 2 provider-wide transient failures (5xx, network, timeout) from one provider within a single call, the loop skips that provider's remaining model x key entries and moves on. Key faults and bad-model
   errors do not count toward this. (Test: groq returning 503 now costs 2 requests, not one per static model, then mistral serves the call.)
2. **Timeouts.** Non-streaming calls get a 90 s total limit. Streaming calls get a 30 s limit to *start* responding (cleared once headers arrive, so long replies are not cut off) and a 45 s stall guard between chunks.
   A timeout is mapped to a transient `ETIMEDOUT` so it falls through to the next entry (an unmapped abort would have been `NON_RETRYABLE` and ended the whole chain). A mid-stream stall ends via `onError` and does **not** restart on another
   provider, preserving the no-duplicate-tokens guarantee established in 1.49 (verified with a stalling stream under fake timers: one token delivered, one `onError`, no second provider request).
3. **Unreadable 200 body** (connection cut mid-body, parse failure) is now a transient failure that moves to the next entry, instead of aborting the chain.
4. **Discovery cap.** The alphabetical tail of dynamically discovered models is limited to 8 per provider, so OpenRouter's catalog (including paid models) is no longer walked in full.
5. **`providerErrors.js`:** a `404` now counts as `BAD_MODEL` when (and only when) the body names a missing model, same gate as the existing `400` rule; a 404 without that body stays `NON_RETRYABLE` so a wrong-URL bug is not hidden.

**Verified:** new `services/__tests__/multiProvider.test.js` (7 tests, `fetch` stubbed, real fallback loop) plus a new 404 case in `providerErrors.test.js`. Seven of these fail on the original code. Full suite 116/116.
**Not verified:** against live providers (no keys here). The numbers (90/30/45 s, threshold 2, cap 8) are my judgment, not measured; they are named constants at the top of that section of `multiProvider.js` if they need tuning. One thing I did **not** change: a 429 still cools the
whole key for 1 h (1.49 item 4), because whether the provider limits per model or per key is unverified and I would rather not guess.

**Fix status:** fixed and verified in tests.

### 1.69 — RESOLUTION — chat attachment URLs are now rejected at the edge (follow-up to 1.63)
**Decision:** reject, don't just ignore. Checked the frontend first: attachment URLs come from the upload response (`res.file.url` in `ChatPage.tsx`, i.e. the Cloudinary `secure_url` from `routes/upload.js`), so a strict check matches real usage.
`routes/chat.js` now validates `attachments[].url` with the new exported `attachmentUrlSchema` (the same allowlist `isAllowedAttachmentUrl` uses for fetching), so a disallowed URL gets a **400** (`Attachment url must be a file you uploaded`) instead of being accepted, stored and merely never fetched. The fetch-time check from 1.63 stays as defense in depth.
**Verified:** schema test added to `attachmentProcessor.test.js` (accepts our URL, rejects metadata IP and garbage with the message, optional still optional). **Not verified:** the full chat request path end to end. **Risk:** a client sending an attachment URL from any other origin now gets a 400.

### 1.70 — RESOLUTION — small hardening decided and applied (deferred observations from 1.58, 1.59, 1.60)
Each was an observation earlier; I decided to fix all of them because every one is cheap and low risk:
1. **`middleware/validate.js`** assigns the parsed value with `Object.defineProperty` instead of `req[source] = ...`, so the three `'query'` routes keep working on Express 5, where `req.query` is a read-only getter (tested with a getter-only `req.query`).
2. **`middleware/traceId.js`** trusts an incoming `X-Trace-Id` only if it is 1-128 characters from `[A-Za-z0-9._:-]`; anything else (spaces, control characters, overlong, non-ASCII) is replaced with a fresh UUID.
3. **`utils/parseAIJson.js`** now tries the text as-is, then with only leading/trailing fences removed, then the original strip-everything behavior as the last resort. It is a strict superset: all 7 shapes the old version could parse still parse (tested), and JSON whose string values contain triple backticks, previously corrupted, now parses.
4. **`utils/logger.js`** escapes CR/LF in string values so user text or model output cannot forge extra log lines.
5. **`config/validateEnv.js`** prints an optional-variable warning at boot when Cloudinary is unconfigured (neither `CLOUDINARY_URL` nor all three discrete vars), instead of failing only at the first upload.
**Verified:** 21 tests (`parseAIJson`, `traceIdValidate`, logger escaping, `validateEnvCloudinary`); 10 of the new-behavior cases fail on the original files. Suite 144/144.
**Behavior to know:** log values containing newlines now print as a literal `\n`; a non-conforming client trace id is silently replaced.

### 1.71 — RESOLUTION — retention job for `job_logs` and `push_notification_log` (follow-up to 1.54 / 1.59)
**Decision:** add one, 90 days. Those two tables only ever grew, and the 1.54 and 1.59 fixes made their inserts actually work, so growth would have started. New `jobs/dataRetentionJob.js`, scheduled daily at 04:30 UTC (`data_retention` in `registerSchedules.js`, handler in `scheduledWorker.js`,
documented in `BACKGROUND_JOBS.md`). It deletes `job_logs` rows by `created_at` and `push_notification_log` rows by `sent_at` older than 90 days (the push throttle only reads the last 24 hours). One table failing does not stop the other, and a delete error is reported in the job's own log row rather than thrown, since the job is safe to simply rerun the next day.
**Verified:** `dataRetentionJob.test.js` (2 tests, Supabase mocked): correct tables, columns and ~90-day cutoffs, `count: 'exact'`, partial-failure behavior; the existing scheduled-worker completeness test confirms the handler is registered. Suite 146/146. **Not verified:** against a real database. Note `job_logs` has no index on `created_at`, so the daily delete is a sequential scan; fine at this table's size, worth an index if it ever grows large.
**Not done (still your call):** retention of user-authored content after account deletion (1.67 item 5) is a policy decision and untouched.

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
