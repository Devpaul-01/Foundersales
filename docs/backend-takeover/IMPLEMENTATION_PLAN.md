# Implementation Plan

Status: **in progress**. Updated as milestones complete.

## Guiding principles for this engagement

- No frontend changes. No payment integration.
- Calendar, metrics, insights, onboarding are protected: fix problems found in them, never remove/restructure them
  as "unnecessary."
- Small, reviewable commits on `backend-takeover` branch. Merge to `main` only once verified not to break boot/tests.
- Prior hardening work in this codebase (rate-limit namespacing, IDOR guards, job idempotency, workspace
  re-verification) is preserved as-is unless a specific new defect is found in it.

## Milestone 1 — Fix startup validation (CRITICAL) — ✅ DONE
**Addresses:** AUDIT.md 1.1, 1.1b, 1.2

- Fixed the ESM import-hoisting problem: added `src/index.js`, `src/index.server.js`, `src/index.workers.js` as
  true entry points (dotenv + validateEnv only, then a dynamic `import()` of the real app/server/workers file).
  `package.json` start scripts updated accordingly.
- Fixed `SUPABASE_SERVICE_KEY` → `SUPABASE_SERVICE_ROLE_KEY` and `FIREBASE_PROJECT_ID` → `FIREBASE_SERVICE_ACCOUNT`
  name mismatches in validateEnv.js (found a second instance of the same bug class while fixing the first).
- Found and fixed a related bug surfaced while verifying the above: `config/bullmq.js` threw at import time when
  `REDIS_URL` was unset, crashing all three entry points before `app.listen()` — contradicting validateEnv's own
  "REDIS_URL is optional" classification. Fixed to degrade gracefully instead.
- Found and fixed a second-order gap surfaced by that fix: `app.js`/`server.js` had no process-level
  `unhandledRejection`/`uncaughtException` handler (unlike `workers/index.js`, which already had one) — added for
  consistency.
- Added `backend/.env.example`, covering not just validateEnv's required/optional lists but every env var actually
  referenced in the codebase (grepped directly, not assumed).
- Verified: all three entry points now exit cleanly with validateEnv's message on empty env (reproduced directly).
  With placeholder credentials, all three reach their running state; `index.js`'s `/health` endpoint confirmed
  responding via live `curl`. Full test suite (21/21, including 5 new regression tests) passing.

## Milestone 2 — Expand scoping/ownership review to remaining routers — ✅ DONE
**Addresses:** AUDIT.md section 2 (practice.js, chat.js, growth.js, feedback.js)

- Traced workspace/user scoping on every identifier-based route in practice.js, chat.js, growth.js, feedback.js —
  same method used for opportunities.js/calendar.js/workspaces.js.
- Result: no IDOR found. Every identifier-scoped query verifies ownership (user_id and/or workspace_id, matching
  the resolved request context) before returning or mutating data. AUDIT.md 1.3 updated to reflect the widened,
  now-complete-for-this-concern sample across all 7 major route files.
- No fixes were needed for this milestone — it was verification work, and the result (no defect found) is recorded
  as such rather than treated as "nothing happened."

## Milestone 3 — Background job idempotency review — ✅ DONE
**Addresses:** AUDIT.md 1.7, 1.8

- Traced redelivery/retry behavior across `messageQueueWorker.js` and `scheduledWorker.js`'s dispatch layer.
- Found and fixed: `handleSkillScores`/`handleCoachingAnnotations` re-ran expensive Groq calls on every BullMQ
  retry with no guard, unlike their neighbor `handlePlaybook`. Added matching guards.
- Found and fixed a more serious issue while investigating: `pattern_insights` was enqueued live but had zero
  registered handler in `scheduledWorker.js` — every invocation failed silently in production. Added the missing
  `HANDLERS` entry; verified the fix with a test that fails without it (proven by reverting and re-testing).
- Found, investigated, and downgraded: `handleGhost`/`handleReply` looked like a worse version of the same
  idempotency gap (insert + notify, not just update) but are confirmed dead code, never enqueued live. Flagged for
  a cleanup pass rather than fixed, since there's no live bug to fix.
- `backgroundWorker.js` itself not re-traced beyond milestone 1's initial read (looked sound there); noted as a
  worthwhile follow-up rather than claimed as fully verified.

## Milestone 4 — Migration/schema consistency check — ✅ DONE
**Addresses:** AUDIT.md 1.9

- Confirmed `schema.sql` is the canonical fresh-install source (README.md already documented this) and
  `migrations/*.sql` are the historical/applied-change record — checked by tracing every migration file against
  `schema.sql`'s current table definitions, not assumed.
- Found one real gap: `add_event_id_to_commitments_signals.sql` was never folded into `schema.sql`, and three live
  query sites (calendar.js x2, backgroundWorker.js) depend on the column it adds. Fixed by adding the column, FK
  constraints, and indexes to `schema.sql` directly, matching the file's existing formatting precisely.
- Resolved an open question a prior migration (`20260719120000_drop_users_archetype.sql`) had explicitly flagged
  for future verification — confirmed `archetype_detected_at` only ever existed on `workspace_profiles`, never as
  a separate `users` column, so there was nothing further to drop. Updated that migration's own comment to record
  the resolution.
- Honest limitation: no Postgres available in this environment to execute the edited `schema.sql` and confirm it
  applies cleanly. The edit is high-confidence (exact structural match to working examples in the same file) but
  unverified by actual execution — flagged plainly in AUDIT.md rather than claimed as confirmed.

## Milestone 6 — Real-infrastructure verification of schema.sql — ✅ DONE
**Addresses:** AUDIT.md 1.11

Prompted by the person offering to install Postgres/Redis locally rather than continuing to rely on structural
read-only confidence for the schema.sql fixes made in milestone 4.

- Installed Postgres 16 and Redis locally (`apt-get install postgresql redis-server`), started both services.
- Applied `schema.sql` to a genuinely fresh, empty database and found it failed partway through — a real,
  critical, previously-undetected bug: functions dumped before the tables they reference, and two patterns
  (`%ROWTYPE` declarations, `LANGUAGE sql` bodies) are validated eagerly at `CREATE FUNCTION` time rather than
  deferred, so ~24 functions failed to create.
- Fixed by relocating the entire function-definition block to after all tables, verified line-count-exact (no
  content lost) and the fix's effect confirmed by successful full application afterward.
- Found and documented a second, related gap: `pg_trgm` needs to be in `public` specifically for this project (not
  Supabase's `extensions` default), undocumented anywhere — added to README.md with the exact error a developer
  would hit without it.
- Fixed two more stale variable names in README.md's prose (`SUPABASE_SERVICE_KEY`, `FIREBASE_PROJECT_ID`) found
  while editing the same section — these were already fixed in code during milestone 1 but the README text was
  never updated to match.
- Final verification: applied the fully-fixed `schema.sql` end to end against a correctly-baselined local Postgres
  instance. All 48 tables, 55 functions, 241 indexes created successfully; milestone 4's `event_id` columns and
  milestone 5's de-duplicated index both confirmed present. Only remaining output is the single, externally-
  confirmed-harmless `schema "public" already exists` message every Supabase/Postgres restore produces.
- This resolves the "no Postgres available, high confidence not proof" caveat from milestone 4 — the file is now
  verified by actual execution, not just structural pattern-matching against the rest of the dump.
- Separately, the live boot test against real Redis (not a placeholder) surfaced a genuine, previously-undetected
  bug: `services/redis.js` hardcoded TLS unconditionally, silently breaking rate limiting, workspace/auth caching,
  and distributed locking (7 files' worth of callers) for any non-TLS Redis — the common case for local dev and
  self-hosted setups. Fixed to derive TLS from the URL scheme, matching the pattern `config/bullmq.js` already used
  correctly. Verified by re-running the live boot test: Redis-backed rate limiting now initializes correctly
  instead of silently falling back to in-memory. See AUDIT.md 1.12.

## Milestone 7 — backgroundWorker.js idempotency trace — ✅ DONE
**Addresses:** AUDIT.md 1.13

Closed the gap noted since milestone 1: this file hadn't been re-traced with the same rigor milestone 3 gave the
other job files. Read all 15 handlers plus every service they delegate to; confirmed 13 are correctly guarded (one
is naturally idempotent by design, several are explicitly commented as such). One real gap found and fixed
(`TIP_CARD_GENERATE`, a genuine missing guard vs. its two structurally-identical, correctly-guarded neighbors). One
gap found and deliberately left for the person's decision rather than fixed unilaterally (`SEED_MEMORY`, inside the
protected onboarding flow, where the correct fix shape is a product judgment call).

## Deferred / needs a decision, not yet scheduled

- **`SEED_MEMORY`'s redelivery behavior** (AUDIT.md 1.13) — `seedMemoryFromOnboarding` doesn't guard against
  inserting duplicate-ish memory facts on a genuine job redelivery (bounded by `MEMORY_CAP`, not prevented). Two
  reasonable fixes exist (skip entirely if onboarding-sourced facts already exist, vs. the current re-extract/cap
  behavior) and choosing between them is a product decision about onboarding behavior, not an engineering one —
  flagging for the person rather than picking unilaterally inside an explicitly protected flow.
- **`TIP_CARD_GENERATE`'s guard precision** (AUDIT.md 1.13) — the fix added is deliberately coarser (one
  goal-note tip per user per day) than a precise per-goal-note check would be, because the precise version needs a
  PostgREST JSONB-path filter this environment can't verify against a real Supabase project. Worth tightening once
  that verification gap (see PROGRESS.md) is closed.

- ~~`handleGhost`/`handleReply` dead code in `messageQueueWorker.js`~~ — **done.** Removed, along with dispatch
  cases and the unused `PRACTICE_SCENARIOS` import. `DELIVERY_STATUS.GHOSTED` specifically checked and kept, since
  it's actively used by the live V3 code path, not part of the dead handler. See AUDIT.md 1.7.
- **Recommend validating the `schema.sql` changes (AUDIT.md 1.9, 1.10) against a real Postgres instance** before
  relying on them for an actual fresh deployment — this sandbox has no Postgres available to execute and confirm
  them.


- **Duplicate workspace-switch endpoints** (AUDIT.md 1.4) — see DECISIONS.md. Not removing either without
  confirming the frontend's actual usage, since frontend changes are out of scope and I can't verify which one（s）
  it calls without reading frontend code, which is permitted to *read* for this purpose even though not to *change*.
- ~~multer dependency upgrade~~ — **done.** Confirmed 4 real CVEs via GitHub Advisories/OSV (not just npm's
  deprecation notice), upgraded to 2.5.0, verified functionally with real multipart requests. See AUDIT.md 1.5.
- **Broad test-suite expansion** — regression tests will be added alongside each fix; a dedicated
  "increase coverage" milestone is not planned unless scope grows to justify it.

## Completion criteria for this engagement (realistic, not aspirational)

Given the size of this codebase, full completion of the mission's 10-milestone sequence in one engagement is not
realistic. This plan targets: confirmed critical/high defects fixed and verified, the scoping/ownership review
widened across all routers, job idempotency reviewed, and an honest PROGRESS.md reflecting exactly what was and
wasn't completed. Remaining work will be left as clearly scoped, prioritized follow-ups — not hidden gaps.
