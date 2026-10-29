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

## Milestone 4 — Migration/schema consistency check
**Addresses:** AUDIT.md section 2 (migrations vs schema.sql)

- Determine whether `schema.sql` is the canonical fresh-install source and `migrations/*.sql` are historical/applied
  records, or whether a fresh setup needs to run both. Document the actual answer in README/ARCHITECTURE — this is
  likely a documentation gap, not a code defect, but needs to be confirmed rather than assumed.

## Deferred / needs a decision, not yet scheduled

- **`handleGhost`/`handleReply` dead code in `messageQueueWorker.js`** (AUDIT.md 1.7) — confirmed unreachable
  (`PRACTICE_GHOST`/`PRACTICE_REPLY` job types are never enqueued anywhere live). Candidate for removal, not acted
  on yet — deserves its own deliberate pass rather than folding a deletion into an unrelated idempotency-fix commit.


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
