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

**Compounding issue:** `validateEnv.js` checks for `SUPABASE_SERVICE_KEY`, but `supabase.js` actually reads
`process.env.SUPABASE_SERVICE_ROLE_KEY` — a different variable name. Even if the hoisting issue didn't exist, this
check would never catch a missing service key, because it's checking the wrong name. If `SUPABASE_URL` happens to be
set but `SUPABASE_SERVICE_ROLE_KEY` is not, the admin Supabase client is constructed successfully with an `undefined`
key, and the failure only surfaces later, opaquely, on the first real database call — exactly the "cryptic runtime
crash deep inside a service call" failure mode this file's own header comment says it exists to prevent.

**Impact:** operators cannot trust a clean startup as a signal that required config is present. A misconfigured
deploy can appear to boot fine and then fail unpredictably on first traffic.

**Fix status:** planned, milestone 1.

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
