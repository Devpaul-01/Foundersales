# Handoff Prompt — Continue the Backend Full Audit

Copy everything below into a new chat with Claude (or another agent) to pick up exactly where this one left off.

---

You're continuing a structured, file-by-file full audit of this backend codebase. A previous session already did
significant work — read the context below carefully before doing anything.

## Setup

1. Clone the repo:
   ```
   git clone https://github.com/Devpaul-01/Foundersales.git
   ```
   You'll need a GitHub personal access token for push access — ask the user for one if you don't have one. **If
   the user pastes a token directly into chat, treat it as compromised the moment it's visible in the
   conversation** — ask them to revoke it and generate a fresh one before you use it, same as happened earlier in
   this project's history (see `docs/backend-takeover/` for that exchange if curious).
2. Set git author config:
   ```
   git config user.name "Devpaul-01"
   git config user.email "oluwaseyiogunsola90@gmail.com"
   ```
3. `cd backend && npm install`, then `npx vitest run` to confirm the existing test suite passes (should be 8 test
   files, 23 tests, all passing) before you touch anything.
4. Read `docs/backend-takeover/FULL_AUDIT_PLAN.md` in full. It has the complete 80-file inventory, the per-file
   checklist, and a tracking table showing exactly which files are done (✅ clean / 🔧 fixed / 🚩 flagged) and
   which are still ⏳ pending. **35 of 80 files are done as of this handoff.**
5. Read `docs/backend-takeover/AUDIT.md` in full — every finding from every file reviewed so far, in detail, with
   reasoning. This is long; read all of it, not just the last few entries. It's the evidence trail for everything
   claimed in the tracking table.
6. Skim `docs/backend-takeover/IMPLEMENTATION_PLAN.md` (deferred items — things flagged but deliberately not
   fixed, several of which are still open) and `docs/backend-takeover/DECISIONS.md` (judgment calls made and why).

## The mission, in the project owner's own words (still binding)

> Take full ownership of this project's backend... I don't want you to limit yourself to auditing the code and
> presenting recommendations — implement the improvements, fix defects, carry out the work.

With explicit, hard boundaries that still apply:
- **No frontend changes.** Ever. You can read frontend code to trace a call site (e.g. "is this backend route
  actually called from the UI"), but never edit it.
- **No payment integration.** The project owner is building that themselves.
- **Calendar, metrics, insights, and onboarding are explicitly protected.** Don't remove or restructure
  functionality in these areas even if it looks redundant or over-engineered once you see the bigger picture.
  Flag problems you find there; don't unilaterally fix them the way you would elsewhere, especially for
  onboarding — read `docs/backend-takeover/AUDIT.md` entries 1.20 and 1.42 for the exact tone to take there (small
  mechanical fixes only, bugs and ambiguous judgment calls get flagged for the person, not decided by you).
- **Never reset branches, discard work, rewrite git history, or force-push.**
- **Never perform destructive database operations** or claim verification you haven't actually performed.
- **The person explicitly said they want a full, structured audit, not a finding-driven one.** An earlier
  attempt at this engagement did a faster, finding-driven pass and was told directly that wasn't what was asked
  for — that's why `FULL_AUDIT_PLAN.md` exists. Don't drift back into "only look where something seems wrong."
  Read every file, checklist and all, record a result for every single one, including files with nothing wrong
  (✅ clean is a real, useful result — document it, don't skip it because there's nothing to fix).

## Workflow that's been working — follow it exactly

For each file, in this order:
1. **Read the entire file.** For files over ~150 lines, use several `view` calls with `view_range` rather than one
   giant read, and actually read each section — don't skim.
2. **Apply the checklist from `FULL_AUDIT_PLAN.md`:** authorization/ownership scoping, input validation, error
   handling, idempotency/concurrency, DB interaction correctness, dead code, consistency with sibling files.
3. **Before trusting any comment's claim** (e.g. "this is still used by X", "this needs no workspace filter
   because Y"), verify it directly — grep the actual codebase, read the actual other file, don't take a comment's
   word for it. One earlier mistake in this audit (see AUDIT.md 1.48) happened specifically because a grep command
   accidentally excluded the file containing the real answer, leading to a confidently wrong conclusion that had
   to be corrected in a later pass. Be more careful than that: when grepping to check "is X called anywhere else,"
   don't exclude a file just because it also contains comment-only mentions — check what each result actually is.
4. **Fix what's clearly fixable and low-risk** (inconsistent scoping, unsafe JSON parsing, confirmed dead code,
   stale comments). **Flag, don't fix, anything that's:**
   - A product/design decision (e.g. "should this be scoped per-user or globally") rather than an engineering bug
   - Inside the protected areas (calendar/metrics/insights/onboarding) and non-trivial
   - A cross-file change where you've only read one of the files involved so far
5. **Verify every fix**: `node --check <file>` for syntax, then `cd backend && npx vitest run` for the full suite
   (should stay 23/23 passing after every single change — if it doesn't, stop and figure out why before moving
   on).
6. **Update three docs together, same commit:** add a numbered finding to `AUDIT.md` (follow the exact format of
   existing entries — severity, location, what you found, how you verified it, what you fixed and why, or why you
   flagged instead), update that file's row in `FULL_AUDIT_PLAN.md`'s tracking table, and if you flagged something
   for a decision, add it to `IMPLEMENTATION_PLAN.md`'s deferred-items list.
7. **Commit immediately** — one commit per file, with a detailed message following the exact style of existing
   commits (`git log --oneline` to see the pattern: `fix(scope): short summary (full audit, file N/80: path)`).
   Write the full reasoning in the commit body, not just the subject line.
8. **Push frequently — after every 1-2 files, not in large batches.** A container reset mid-session once lost two
   files' worth of uncommitted work earlier in this project (see the end of `AUDIT.md`'s entry 1.48 area / the
   conversation that led to this handoff). Don't let that happen again: work on a feature branch
   (`full-audit-N`, check existing branch names on remote first and pick the next number), but merge into `main`
   and push both branches every 1-2 files, not after accumulating a big batch. Confirm `main`'s tests pass after
   each merge before pushing.

## Where to pick up

The last file being read when this session ended was `backend/src/services/multiProvider.js` (929 lines) — the
AI provider fallback/routing layer. It had been read through line ~140 (the header comments and `MODEL_PRIORITY`
constants) but not finished, and **nothing had been changed in it yet** — no edits, no commit, so there's nothing
to recover, just continue reading it from where the file naturally continues. It's clearly a highly sophisticated,
heavily-commented file (multi-provider fallback chains, Redis-backed cross-instance cooldown state, a deliberate
kill-switch design, Sentry integration at two specific choke points) — read it with the same care you'd give any
other file, in sections, and expect it to reveal cross-references to several files already read (`providerCooldown.js`,
`utils/providerErrors.js`, `utils/reportDegradation.js` — none of which have been read yet either, check
`FULL_AUDIT_PLAN.md`'s services/utils tables for their current ⏳ status).

After `multiProvider.js`, continue through the rest of `FULL_AUDIT_PLAN.md`'s ⏳ rows in order: the remaining
services (`notifications.js`, `prospectDedup.js` is already ✅, `providerCooldown.js`, `storage.js`, `streaming.js`,
`tokenTracker.js`, `transcription.js`, `voiceMemoService.js` is already ✅), then middleware (3 of 5 remaining),
config (6 of 9 remaining), the one schema file, utils (6 of 9 remaining), and finally the deeper per-table database
constraint review noted as not yet done in `FULL_AUDIT_PLAN.md`'s Database section.

## Tone and pace

Be thorough, not fast. This audit has found real things by going slowly: a live cross-workspace data leak, two
separate HTML-injection vulnerabilities, a logic bug letting a user delete notes across their own other goals, a
cross-file timing-window correctness gap, a genuinely duplicated piece of business logic consolidated into one
shared implementation, and three functions that could silently store malformed AI output as if it were valid. All
of those were found by reading full files carefully against a checklist, not by skimming for obvious red flags.
Keep doing that.
