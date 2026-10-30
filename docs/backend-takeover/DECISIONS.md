# Decisions

## D1 — Branch base: use `main`, ignore other stale branches
**Date:** 2026-10-29

The repo has 9 remote branches besides main (`develop`, `test`, `BookingPage`, several `feat/`/`fix/`/`refactor/`
branches). Checked ancestry: `main` is NOT a descendant of any of them (history was rebased/squashed at some point),
but `main`'s latest commit (2026-10-11) is substantially more recent than all others (`develop`/`test` top out at
2026-09-07/09). A commit-message diff showed main already contains equivalent (same message, different hash)
versions of every commit unique to `refactor/phase-2-production-hardening` / `refactor/rate-limit-consistency`,
plus additional newer work (test suite, CI, separate worker entry point). Conclusion: these branches are stale
snapshots already superseded by main through a different history, not unmerged work waiting to land. Building on
`main` via a new `backend-takeover` branch, not attempting to merge any of the stale branches.

## D2 — RLS: not adding Row-Level Security policies reactively
**Date:** 2026-10-29

Schema has zero RLS policies across 48 tables. The backend exclusively uses the Supabase service-role client, which
bypasses RLS regardless, so the absence of RLS is not itself a bug — it means tenant isolation is 100%
application-layer. Considered adding RLS as defense-in-depth. Decided against doing so as a standalone action in
this engagement: retrofitting RLS onto a schema that's never had it is real schema-design work (every table needs
correct policies derived from its actual access patterns), carries real risk of breaking legitimate `supabaseAdmin`
queries if policies are written without matching the app's exact access patterns, and isn't justified by a specific
confirmed gap — the spot-checked routes all correctly enforce isolation in application code. Documented as an
architectural characteristic in AUDIT.md 1.3, with a commitment to widen the spot-check (milestone 2) rather than
add a blanket defensive layer without evidence it's needed.

## D3 — Duplicate workspace-switch endpoints: deduplicated the logic, kept both routes
**Date:** 2026-10-29 (resolved 2026-10-30)

`POST /api/user/switch-workspace` and `POST /api/workspaces/switch` were functionally redundant, independently
implemented, and had already started drifting (different response shapes, different log labels). Checked the
frontend (reading, not changing, is in scope) to see which one is actually used:
`frontend/src/contexts/WorkspaceContext.tsx` — the only code path the real UI uses to switch workspaces — calls
`/api/workspaces/switch` exclusively, confirmed by two separate references including an explicit "canonical switch
endpoint" comment already in the frontend code. `frontend/src/api/user.ts`'s wrapper for `/api/user/switch-workspace`
has zero callers anywhere in the frontend.

Decided against deleting `/api/user/switch-workspace` outright despite it being dead from the frontend's
perspective: an external API consumer (mobile app, third-party integration, something not in this repo) could
still depend on it, and that can't be ruled out from this codebase alone. Instead: extracted
`workspaces.js`'s `/switch` logic into an exported `switchWorkspaceHandler`, and made `user.js`'s route delegate to
the exact same handler instead of maintaining a second, independently-drifting copy. This eliminates the
duplicated business logic (the actual "unnecessary complexity" problem) while keeping both URLs live for any
caller this review couldn't see. Verified both routes are still registered and route correctly (both return 401
under auth middleware, not 404) after the change, and the full test suite still passes.

## D4 — Not pinning down multer upgrade in this pass
**Date:** 2026-10-29

multer 1.x has known patched-in-2.x vulnerabilities per npm's deprecation notice. Upgrading is an API-shape change
(touches `routes/upload.js`, differs in error handling between multer 1.x and 2.x) and not a one-line bump. No
confirmed exploit path specific to this app's usage was found (would need to check exactly which multer CVEs apply
to how this app configures it — not yet done). Tracked in IMPLEMENTATION_PLAN.md as a flagged follow-up rather than
treated as urgent without that confirmation.
