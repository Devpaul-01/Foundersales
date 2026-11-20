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

> **ADDENDUM (full audit, see AUDIT.md 1.66):** D2's reasoning covers the *backend* only. The frontend also talks to the database directly with the public
> anon key (`hooks/useRealtime.ts` subscribes to `chat_messages` and `user_events` as the anon role), and no table has RLS. If the live project's anon role has
> table grants (Supabase's default), the "not justified by a specific confirmed gap" premise no longer holds. Verify with the curl check in 1.66 before treating this decision as settled.

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

## D4 — multer upgrade: initially deferred, then confirmed and fixed
**Date:** 2026-10-29 (resolved 2026-10-30)

Initially deferred pending confirmation of an actual exploit path, rather than treating npm's install-time
deprecation notice as sufficient justification on its own. Followed up properly: `npm audit` on this project
reports no multer entry at all (its advisory data lagged behind GitHub's own advisory feed for this specific
package — worth knowing on its own). Checked GitHub Advisories/OSV/NVD directly instead and found the installed
version (`1.4.5-lts.2`) is confirmed vulnerable to four real, high-severity CVEs: CVE-2025-47944 (7.5, unhandled
exception/DoS via malformed multipart request), CVE-2025-47935, CVE-2025-48997, and CVE-2025-7338 — all affecting
versions through `1.4.5-lts.2`, all fixed by `2.0.x` or later. This directly handles user-controlled file uploads
(`routes/upload.js`, `routes/calendar.js`'s voice-memo upload), about as attacker-reachable a surface as a
dependency gets.

Checked actual usage before upgrading: both call sites use only the stable, unchanged-across-1.x/2.x API surface
(`multer({ storage, limits, fileFilter })`, `.single('file')`) — no `diskStorage` with custom filename functions,
no `.fields()`, and no code anywhere checks `err instanceof multer.MulterError` or any version-sensitive error
shape (errors flow through the generic error handler as plain `Error` objects). Low-risk upgrade given this usage
pattern.

Upgraded to `multer@2.5.0` (npm installed cleanly, `package.json` range auto-updated). Verified functionally, not
just by syntax check or the existing test suite (which has zero coverage of the upload routes): wrote a standalone
script that sends a real `multipart/form-data` request through the exact `multer({...}).single('file')`
configuration this app uses, confirming the file is parsed correctly (right filename, mimetype, size, and a real
`Buffer`), and a second script confirming the `fileFilter` rejection path (`cb(new Error(...))`) still surfaces
the same error message through Express's error handler. Full app boot + `/health` check also confirmed clean
post-upgrade.

## D5 — AI layer: replaced the in-repo four-provider chain with a self-hosted llm-gateway
**Date:** 2026-11-20

`services/multiProvider.js` used to be a full failover engine inside the product: a fixed Cerebras → Groq → Mistral
→ OpenRouter queue, a pool of keys per provider, Redis-cached model discovery with a distributed refresh lock, and
per-key cooldowns. The owner already runs a separate multi-provider gateway (`Devpaul-01/llm-gateway`) that does
model-alias resolution, `fallback_models` chaining, and upstream key rotation server-side, so keeping a second copy
of that logic here meant two layers doing the same job. Decided to make FounderSales a plain client of the gateway.

Choices made, and why:
- **Replace, not add.** The gateway is the only chat upstream. Considered keeping it first in the old chain, or as a
  last-resort fallback; chose full replacement because the whole point of the gateway is to own failover.
- **Strip-down rewrite, not a minimal swap.** One key, one provider entry, no model discovery, no multi-key pool.
  Kept the Redis-backed cooldown (a revoked or rejected gateway key is a failure the gateway can't self-heal) and the
  four exported functions with unchanged signatures and return shapes, so none of the ~24 call sites changed.
- **Models.** `openai/gpt-oss-120b` primary for text; the gateway's own default priority models sent as
  `fallback_models`. For image requests, `meta-llama/llama-4-scout-17b-16e-instruct` is sent as the primary, because
  a text-only primary can't see the image no matter what trails it. All overridable via `GATEWAY_*` env vars.
- **429 handling fix.** The gateway returns 429 for a bad key, an exhausted daily token budget, and a concurrency
  cap, distinguishing them only by `error.code`. The classifier previously treated every 429 as `KEY_FAULT` (cool the
  key for an hour). `daily_token_budget_exceeded` and `too_many_concurrent_requests` now classify as
  `PROVIDER_TRANSIENT`; plain 429s are unchanged.
- **`GROQ_API_KEY` stays required.** Voice-memo transcription (`services/transcription.js`) calls Groq Whisper
  directly and has no gateway equivalent. `GATEWAY_API_KEY` was added to the required set alongside it.
- **Left alone on purpose.** `services/groq-client.js` / `groq.js` (a legacy direct-to-Groq client no live route or
  job calls) was not deleted or repointed; that was explicitly out of scope for this change.

Verification: full backend suite passing (158/158 at the time of the change), including rewritten
`multiProvider.test.js` and new cases in `providerErrors.test.js` for the admission-limit codes. Not verified:
a live request against the deployed gateway; the default `GATEWAY_BASE_URL` is a placeholder and must be set to the
real deployment.
