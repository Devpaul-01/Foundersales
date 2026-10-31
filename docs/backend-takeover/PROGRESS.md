# Progress

## 2026-10-29 — Session 1: Discovery, audit, Milestone 1 in progress

### Done
- Cloned repo, surveyed branch state (see DECISIONS.md D1), confirmed `main` is the correct, current base.
- Installed backend deps (`npm install`), ran existing test suite: **16/16 tests passing** (5 test files — see
  AUDIT.md 1.6 for coverage gap notes).
- Read and traced: `app.js` boot sequence, `middleware/auth.js`, `middleware/workspace.js`,
  `config/supabase.js`, `config/validateEnv.js`, `routes/opportunities.js` (ownership checks on `:id` routes),
  `routes/calendar.js` (`:userId` manager route), `routes/user.js` + `routes/workspaces.js` (workspace switching),
  `jobs/backgroundWorker.js` (calendar-prep idempotency), `utils/concurrencyGuard.js`.
- Confirmed by reproduction: `validateEnv()` does not actually gate startup due to ESM import hoisting
  (`node src/app.js` with empty env crashes with a raw Supabase SDK error, not validateEnv's intended message).
  See AUDIT.md 1.1.
- Confirmed by code inspection: `SUPABASE_SERVICE_KEY` (checked by validateEnv) vs
  `SUPABASE_SERVICE_ROLE_KEY` (actually read by supabase.js) name mismatch. See AUDIT.md 1.1.
- Spot-checked workspace/tenant isolation across 6 route handlers in 3 files — no IDOR found in this sample. See
  AUDIT.md 1.3.
- Wrote AUDIT.md, IMPLEMENTATION_PLAN.md, DECISIONS.md (this directory).

### Done (continued, same session)
- **Milestone 1 complete.** Fixed the validateEnv/ESM-hoisting bug (added `src/index.js`, `src/index.server.js`,
  `src/index.workers.js` as true entry points), the two wrong-variable-name bugs in validateEnv.js
  (`SUPABASE_SERVICE_KEY`→`SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_PROJECT_ID`→`FIREBASE_SERVICE_ACCOUNT`), a related
  bug found while verifying the fix (`config/bullmq.js` throwing at import time on missing `REDIS_URL`, crashing
  all three entry points), and a second-order gap found while verifying that fix (missing process-level
  `unhandledRejection`/`uncaughtException` handlers in `app.js`/`server.js`). Added `.env.example`. Added 5
  regression tests (21/21 total passing). Committed as 6 separate, reviewable commits on `backend-takeover`.
- **Milestone 2 complete.** Widened the workspace/ownership scoping review to `practice.js`, `chat.js`,
  `growth.js`, `feedback.js` — every identifier-scoped route in the codebase has now been checked. No IDOR found.
  This is a genuine verification result (recorded in AUDIT.md 1.3), not a sign nothing was done.

- **Milestone 3 complete.** Traced redelivery/retry behavior in `messageQueueWorker.js` and `scheduledWorker.js`.
  Found and fixed: missing idempotency guards on two live AI-generation job handlers (wasted spend on retry, not a
  correctness bug). Found and fixed a more serious issue while investigating: `pattern_insights` was enqueued live
  with zero registered handler, so `runPatternInsightsJob` never actually ran in production despite being fully
  implemented — added the missing registration, verified with a test proven to fail without the fix (reverted and
  re-tested to confirm). Investigated `handleGhost`/`handleReply`, which looked like a worse version of the same
  gap; confirmed dead code, not fixed, flagged for cleanup instead. Committed as 3 separate, reviewable commits.

- **Milestone 4 complete.** Traced every migration file in `migrations/` against `schema.sql`'s current table
  definitions to check README.md's documented claim that `schema.sql` alone is the fresh-setup artifact. Confirmed
  true for all but one migration (`add_event_id_to_commitments_signals.sql`, 2026-08-17), which was never folded
  back in — a real, live gap, since three query sites in the protected calendar feature depend on the column it
  adds. Fixed by adding the column/constraints/indexes to `schema.sql` directly, matching the file's existing
  format precisely. Also resolved an open question a prior migration had explicitly flagged for future
  verification. Honest limitation recorded: no Postgres available in this sandbox to actually execute and confirm
  the schema.sql edit applies cleanly — high structural confidence, not proof. Committed as 2 reviewable commits.

### Done (continued, same session) — deferred items cleared
- **Workspace-switch deduplication.** Confirmed via the frontend (`WorkspaceContext.tsx`) that
  `/api/workspaces/switch` is the only one the real UI uses; `/api/user/switch-workspace`'s frontend wrapper has
  zero callers. Kept both backend routes (an external API consumer outside this repo can't be ruled out) but made
  one delegate to the other instead of maintaining two independently-drifting copies of the same logic. Verified
  both still respond correctly via a live boot + curl check.
- **Test flake fix.** Noticed (unrelated to the above) `scheduledWorker.test.js` occasionally exceeding its
  default timeout under full-suite load, despite finishing in ~1.5s standalone. Raised the timeout; confirmed 5/5
  clean full-suite runs after.
- **Duplicate database index removed.** `idx_commitments_prospect`/`idx_commits_prospect` were exact duplicates on
  `conversation_commitments.prospect_id`. Confirmed neither name is referenced anywhere before removing the
  redundant one from `schema.sql`, and added a forward-only `DROP INDEX IF EXISTS` migration for any database
  already built from the old schema.
- **Dead code removed.** `handleReply`/`handleGhost` in `messageQueueWorker.js` — confirmed unreachable in
  milestone 3, and README.md's own "kept intentionally, not cleaned up yet" note confirmed this was an
  acknowledged backlog item, not a deliberate preserve choice. Removed both handlers, their dispatch cases, and the
  now-unused `PRACTICE_SCENARIOS` import. Specifically checked and confirmed `DELIVERY_STATUS.GHOSTED` is NOT dead
  (actively written by the live V3 path, read by the frontend) before touching anything adjacent — left untouched.
- **multer upgraded, 1.4.5-lts.2 → 2.5.0.** Initially deferred without a confirmed exploit; followed up and found
  4 real high-severity CVEs via GitHub Advisories/OSV directly (npm audit doesn't currently flag this package at
  all for this project — worth knowing on its own). Verified both call sites use only the stable, version-safe API
  surface before upgrading, then verified functionally with real multipart requests (success and fileFilter
  rejection paths), not just a syntax check — the existing test suite has no upload-route coverage either way.

All deferred items from the original milestones 1-4 pass are now resolved. 7 additional commits this session (18
total on `backend-takeover`).

### Done (continued, same session) — Milestone 6: real-infrastructure verification
- The person offered to install Postgres and Redis locally rather than continuing to rely on the "no Postgres
  available" caveat. Installed both (`apt-get install postgresql redis-server`), started both services.
- Applied `schema.sql` to a genuinely fresh, empty database and found it **actually failed** — a real, critical,
  previously-undetected bug (functions dumped before tables, two patterns validated eagerly rather than deferred).
  Fixed by relocating the function-definition block, verified lossless, then re-verified by full successful
  application end to end (48 tables, 55 functions, 241 indexes, including milestone 4/5's fixes all present).
- Found and documented a related undocumented prerequisite (`pg_trgm` needed in `public` specifically for this
  project) and fixed two stale variable names in README.md's prose left over from milestone 1's code fixes.
- The same real-Redis boot test surfaced a second, independent, genuine bug: `services/redis.js` hardcoded TLS
  unconditionally, silently breaking rate limiting, workspace/auth caching, and distributed locking for any
  non-TLS Redis (the common case for local dev / self-hosted setups) — 7 files' worth of callers affected. Fixed
  to derive TLS from the URL scheme, matching the correct pattern already used in `config/bullmq.js`. Verified by
  re-running the boot test: Redis-backed rate limiting now initializes correctly.
- 2 commits this session for milestone 6 (20 total on `backend-takeover`).

### Not yet started
- No scoped work remains from the original engagement plan or the deferred items. Any further work would be a
  fresh audit pass over areas not yet covered this session (e.g. a closer idempotency trace of
  `backgroundWorker.js`, noted but not deeply re-verified since milestone 1's initial read) or the project owner's
  next priority.
- The `schema.sql` → real Supabase project gap that remains: this session's local Postgres cannot fully replicate
  Supabase's PostgREST API layer, so the actual backend app (which talks to Supabase via `supabaseAdmin`, not raw
  SQL) could not be boot-tested against this local database for its data operations — only `schema.sql` itself was
  verified by direct SQL execution. Recommend a final check against an actual Supabase project (or Supabase's own
  local CLI/Docker stack, which does include PostgREST) before relying on this for a real deployment, though the
  SQL-level verification here is substantially stronger evidence than the structural-read confidence milestone 4
  originally shipped with.

### Verified facts, stated plainly
- Existing test suite: 16/16 passing, confirmed by running `npx vitest run` directly.
- App does NOT currently boot cleanly without real Supabase/Groq/Redis credentials — expected, not itself a bug,
  but the *failure mode* when it can't boot is the bug (AUDIT.md 1.1).
- No tests were weakened, deleted, or had assertions changed to produce this passing result — the 16/16 was the
  suite's state as found, unmodified.

### Known limitations of this session so far
- Could not test against a real Supabase/Redis/Groq-backed environment — no live credentials available in this
  sandbox. All verification so far is: static code reading, dependency installation, unit test execution, and
  local process boot-failure-mode reproduction. Anything requiring an actual database connection (migration
  correctness, RLS behavior, live query results) is reviewed by reading code only, not executed, and is marked
  accordingly.
