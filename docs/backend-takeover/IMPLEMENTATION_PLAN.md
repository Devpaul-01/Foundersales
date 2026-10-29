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

## Milestone 2 — Expand scoping/ownership review to remaining routers
**Addresses:** AUDIT.md section 2 (practice.js, chat.js, growth.js, feedback.js)

- Trace workspace/user scoping on identifier-based routes in the not-yet-reviewed routers, same method used for
  opportunities.js/calendar.js/workspaces.js in AUDIT.md 1.3.
- Any confirmed IDOR-shaped gap gets fixed immediately as a critical/security item, with a regression test.
- If nothing is found, AUDIT.md 1.3 is updated to reflect the widened sample — this is verification work, not
  guaranteed to produce fixes.

## Milestone 3 — Background job idempotency review
**Addresses:** AUDIT.md section 2 (messageQueueWorker.js, practiceWorker.js, scheduledWorker.js)

- Trace redelivery/retry behavior the way `backgroundWorker.js`'s CALENDAR_PREP_GENERATE consolidation was already
  traced. Confirm whether the same "DB-state re-check as a second idempotency layer" pattern is applied consistently
  or only where it happened to be needed historically.

## Milestone 4 — Migration/schema consistency check
**Addresses:** AUDIT.md section 2 (migrations vs schema.sql)

- Determine whether `schema.sql` is the canonical fresh-install source and `migrations/*.sql` are historical/applied
  records, or whether a fresh setup needs to run both. Document the actual answer in README/ARCHITECTURE — this is
  likely a documentation gap, not a code defect, but needs to be confirmed rather than assumed.

## Deferred / needs a decision, not yet scheduled

- **Duplicate workspace-switch endpoints** (AUDIT.md 1.4) — see DECISIONS.md. Not removing either without
  confirming the frontend's actual usage, since frontend changes are out of scope and I can't verify which one（s）
  it calls without reading frontend code, which is permitted to *read* for this purpose even though not to *change*.
- **multer dependency upgrade** (AUDIT.md 1.5) — tracked, not scheduled; no confirmed live exploit path found yet in
  this app's specific upload usage.
- **Broad test-suite expansion** — regression tests will be added alongside each fix; a dedicated
  "increase coverage" milestone is not planned unless scope grows to justify it.

## Completion criteria for this engagement (realistic, not aspirational)

Given the size of this codebase, full completion of the mission's 10-milestone sequence in one engagement is not
realistic. This plan targets: confirmed critical/high defects fixed and verified, the scoping/ownership review
widened across all routers, job idempotency reviewed, and an honest PROGRESS.md reflecting exactly what was and
wasn't completed. Remaining work will be left as clearly scoped, prioritized follow-ups — not hidden gaps.
