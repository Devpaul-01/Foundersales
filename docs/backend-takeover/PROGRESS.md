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

### Not yet started / deferred
- Items tracked in IMPLEMENTATION_PLAN.md's "Deferred" section: duplicate workspace-switch endpoints
  (user.js/workspaces.js), multer dependency upgrade, handleGhost/handleReply dead-code removal, duplicate
  prospect_id index on conversation_commitments, validating the schema.sql fix against a real Postgres instance.
- The originally-scoped milestones 1-4 are now all complete. Remaining work, if continued, would be a fresh pass
  to decide what's next (the deferred items above, or a new audit pass over areas not yet covered this session —
  e.g. a closer idempotency trace of backgroundWorker.js, or review of files/routers not touched in milestones 1-4).

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
