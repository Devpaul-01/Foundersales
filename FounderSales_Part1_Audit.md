# FounderSales: Principal Architecture Document — V2
## Investor-Grade System Audit & Complete Multi-Tenant Redesign Blueprint
**Version 2.0 — Updated after full source code review of all 18 route and service files**

---

## PREFACE

This document supersedes V1. It is based on direct inspection of every uploaded source file: `auth.js`, `calendar.js`, `chat.js`, `commitments.js`, `feedback.js`, `followup.js`, `goals.js`, `growth.js`, `insights.js`, `metrics.js`, `onboarding.js`, `opportunities.js`, `pipeline.js`, `practice.js`, `prospects.js`, `user.js`, `groq.js`, and `perplexity.js`. Every issue cited is anchored to a specific line or pattern in the actual code. New issues discovered during this review are marked **[NEW]**. Every route in the system now has an explicit workspace migration design in Part 2.

---

# PART 1 — SYSTEM AUDIT: CONFIRMED, CORRECTED & NEW ISSUES

## Section 1.1 — Issues Confirmed in Source Code

### ISSUE 1 — Single-User Data Model (Confirmed)
Every entity is keyed exclusively to `user_id`. Confirmed across all 18 files. Every Supabase query uses `.eq('user_id', userId)` with no concept of workspace, organization, or team scope.

### ISSUE 2 — Background Jobs Have No Workspace Awareness (Confirmed)
Jobs fetch all users with `.eq('onboarding_completed', true)` and process them independently. No workspace batching, no team-level aggregations.

### ISSUE 3 — Practice Feature is Entirely Single-Player (Confirmed)
Confirmed in `practice.js`. The full V3 system — buyer state simulation, multi-axis scoring, playbooks — has no team visibility, no manager view, no shared scenario library.

### ISSUE 4 — AI Memory Has No Institutional Knowledge Layer (Confirmed)
Confirmed in `groq.js`. `seedMemoryFromOnboarding` inserts to `user_memory` only. All memory is per-user with no workspace promotion path.

### ISSUE 5 — No Role-Based Access Control (Confirmed)
Confirmed in all route files. The `authenticate` middleware attaches `req.user` and every route uses `req.user.id` directly. There is no `requirePermission`, no role check, no feature flag anywhere.

### ISSUE 6 — Opportunity Deduplication is Fragile (Confirmed, with clarification)
**Confirmed with correction:** The `await` on `runOpportunitiesRefreshForUser` in the GET handler is present in the code at line ~153: `await runOpportunitiesRefreshForUser(...).catch(...)`. The `await` blocks the response despite the "fire-and-forget" comment. This is confirmed. However, the POST `/refresh` route **does** have URL dedup — the background `runOpportunitiesRefreshForUser` function used by the GET route does **not** have that same dedup check.

### ISSUE 7 — Metrics Uses Two Conflicting Data Sources (Confirmed, with nuance)
Confirmed in `metrics.js`. `buildChartData` seeds from `daily_metrics` first, then overlays live opp data. The `dashboard` endpoint still calls `supabaseAdmin.from('daily_metrics')` in its `Promise.all`. The dual-source pattern persists. The A-02 fix is a partial improvement, not a full resolution.

### ISSUE 8 — In-Memory Intelligence Cache is Not Production-Safe (Confirmed)
Confirmed at the top of `metrics.js`: `const intelligenceCache = new Map()` is a module-level singleton. Will fail under any load-balanced deployment.

### ISSUE 9 — Groq Concurrency Guard is Process-Local (Confirmed)
Confirmed in `onboarding.js`. The `ConcurrencyGuard` class with `#running` counter and `#pending` array is a module-level singleton. Zero protection across Node.js instances.

### ISSUE 10 — Auth Rollback is Incomplete (Confirmed)
Confirmed in `auth.js`. The CRITICAL log on orphaned auth user exists with no automated recovery. The `/profile/ensure` OAuth path uses a plain `.insert()` with no retry mechanism — a different failure mode from the retry-protected registration path.

### ISSUE 11 — Perplexity Usage Tracking Race Condition (Confirmed)
Confirmed in `perplexity.js`. `incrementUsage` uses `supabaseAdmin.from('perplexity_usage').upsert({ user_id: userId, date: today, call_count: 1 }, { onConflict: 'user_id,date', ignoreDuplicates: false })`. This replaces the value rather than atomically incrementing it. The `global_usage` table has the same pattern.

### ISSUE 12 — Streaming Disconnect Still Increments Counter (Confirmed, with nuance)
Confirmed in `chat.js`. In `streamPerplexityResponse`, `updateChatStats(chatId)` is called at line ~800 **without checking `clientConnected`** first. The `clientConnected` check only wraps the SSE `sendSSE` call, not the stat increment. The Groq streaming path has similar handling.

### ISSUE 13 — Calendar Rate Limiter IP Fallback (Confirmed, low risk)
Confirmed in `calendar.js`. `keyGenerator: (req) => req.user?.id || req.ip`. Since calendar routes are behind `authenticate`, the fallback never fires in practice. The risk is real only if `authenticate` is ever removed from this router.

### ISSUE 14 — Onboarding Prompt Injection (Confirmed)
Confirmed in `onboarding.js`. The `POST /answers` endpoint accepts `answers` with only a 30-key count check. Keys and values are injected directly into the `buildVoiceProfile` Groq prompt via `Object.entries(onboardingAnswers)`. No key allowlist, no value sanitization, no length truncation.

### ISSUE 15 — user_memory Capacity Bypass on Rebuild (Confirmed)
Confirmed in `groq.js`. `seedMemoryFromOnboarding` with `isRebuild=true` deletes facts where `source_chat_id IS NULL AND reinforcement_count <= 2`, then re-inserts. The `MEMORY_CAP` check is not present in `groq.js` — it lives only in the extraction job. Multiple rebuilds with reinforced facts will accumulate beyond cap.

### ISSUE 16 — Pattern Detection Has No Growth Card Idempotency (Confirmed)
Confirmed in `growth.js`. Growth cards are inserted, not upserted. No conflict guard on the `growth_cards` table during card creation. Duplicate job runs produce duplicate cards.

### ISSUE 17 — Email Digest Has No Per-User Idempotency (Confirmed)
`last_digest_sent_at` is updated after delivery but there is no pre-check guard that skips users who already received a digest in this run cycle. A partial batch failure causes re-sends.

### ISSUE 18 — Practice Queue Has No Dead Letter Queue (Confirmed)
Confirmed in the practice system. Failed jobs after 3 retries are logged silently. No user-visible fallback message, no alerting webhook.

### ISSUE 19 — PENDING Feedback Creates Re-notification Loop (Confirmed)
Confirmed in `feedback.js`. When outcome is `PENDING`, the opportunity stage stays at `SENT`. The hourly `runFeedbackPromptJob` doesn't exclude `PENDING` feedback records — it just checks for `SENT` stage, so these opportunities stay in the notification queue and users get a second prompt.

### ISSUE 20 — avoid_phrases Never Validated Post-Generation (Confirmed)
Confirmed in `groq.js`. `avoid_phrases` from `voice_profile` are injected into the `generateOutreachMessage` prompt as a hint string only: `Avoid sounding like: ${(vp.avoid_phrases || []).join(', ')}`. No post-generation string check exists. Generated messages can and do contain the avoided phrases.

### ISSUE 21 — groq.js is a 3,000+ Line God Object (Confirmed)
Confirmed. The file exports 40+ functions across every domain and is the single most imported module in the system.

---

## Section 1.2 — New Issues Found During Source Code Review

### ISSUE 22 [NEW] — needsRealTimeSearch Has a Hardcoded Debug Return
**File:** `perplexity.js`, line 81
**Code:** `return { needed: true, reason: 'seyi' };`

This line sits at the top of the `needsRealTimeSearch` function, before all the smart-routing logic. It means **every user, on every opportunity refresh, unconditionally calls Perplexity** regardless of their profile quality, product description completeness, or target audience clarity. The smart cost router — which was designed to save Perplexity quota for profiles that actually benefit — is completely bypassed. This is a debug shortcut left in production.

**Cost Impact:** Every `discoverOpportunities` call routes through Perplexity. If Perplexity is configured, this generates real API charges for every user on every refresh, even users with thin profiles who would have correctly fallen back to the free Groq path.

**Recommended Fix:** Remove the hardcoded return. The logic below it is correct and should run.

### ISSUE 23 [NEW] — `queries` ReferenceError in discoverOpportunities
**File:** `perplexity.js`, line 476
**Code:** `` console.log(`[Perplexity] ${rawOpportunities.length} unique opportunities from ${queries.length} queries`) ``

The variable `queries` does not exist at this scope. The local variable is `queryConfigs`. This is a `ReferenceError` that will throw in production on every successful Perplexity search run — meaning the log line crashes the function before it returns results. The actual opportunities ARE discovered and parsed by this point, but the error causes the entire `discoverOpportunities` function to fall into its `catch` block, which then calls `searchWithGroqFallback` and discards the real Perplexity results.

**Net Effect:** Even when Perplexity finds real leads, the system silently throws them away and returns Groq-generated practice examples instead — with a misleading "Live search had an issue" notice.

**Recommended Fix:** Change `queries.length` to `queryConfigs.length` on line 476.

### ISSUE 24 [NEW] — Background runOpportunitiesRefreshForUser Has No URL Dedup
**File:** `opportunities.js`, `runOpportunitiesRefreshForUser` function
**Context:** The POST `/refresh` route has a full `existingUrls` dedup check before inserting. The exported `runOpportunitiesRefreshForUser` (called from the GET auto-refresh and from onboarding) does **not** have this check. Every background auto-refresh can insert duplicate opportunity URLs because the dedup guard was only applied to the manual refresh path.

**Recommended Fix:** Extract the dedup logic into a shared helper used by both the POST handler and `runOpportunitiesRefreshForUser`.

### ISSUE 25 [NEW] — commitments.js Auto-Marks Overdue on Every GET Request
**File:** `commitments.js`, `GET /` handler
**Code:** On every `GET /api/commitments` call, the handler runs an `UPDATE` on `conversation_commitments` to mark overdue records before returning the list. This means every page load triggers a write query. Under high load or frequent polling this creates unnecessary DB write pressure, and the lack of a `RETURNING` clause means the update's effect isn't reflected in the subsequent `SELECT` within the same request — there's a small window where the freshly-marked overdue records are still fetched as `pending` and then re-marked on the next request.

**Recommended Fix:** Move overdue detection to a scheduled job (it already fits naturally with the existing background job pattern). The GET handler should only read.

### ISSUE 26 [NEW] — prospects.js Has No user_id Filter in refresh-summary Event Queries
**File:** `prospects.js`, `POST /:id/refresh-summary`
**Code:** The events and signals queries inside `refresh-summary` filter by `prospect_id` but not by `user_id`. If two workspaces ever share a prospect record (or if a UUID collision occurs), signals and events from other users' data could be incorporated into the AI summary.

**Recommended Fix:** Add `.eq('user_id', req.user.id)` to both queries in the summary refresh path.

### ISSUE 27 [NEW] — pipeline.js GET Returns All Opportunities Without Pagination
**File:** `pipeline.js`, `GET /` handler
**Code:** The query has no `.range()` or `.limit()`. For users with hundreds of pipeline entries, the entire set is loaded into memory and returned. At scale, this is a significant performance and memory issue.

**Recommended Fix:** Add server-side pagination with a reasonable default limit (50 cards per column), and add a separate count query for the Kanban column headers.

### ISSUE 28 [NEW] — insights.js why-losing and patterns Endpoints Have No Caching
**File:** `insights.js`
**Context:** The `/why-losing` and `/patterns` endpoints both run AI generation calls synchronously on every request. The metrics `/intelligence` endpoint has a 4-hour in-memory cache (Issue 8 notwithstanding). The insights endpoints have no equivalent. A user who rapidly navigates between pages will trigger multiple expensive AI calls for the same data.

**Recommended Fix:** Apply the same TTL cache pattern (even with the Redis improvement from Issue 8) to both endpoints.

### ISSUE 29 [NEW] — goals.js pipeline-insight Cache is Per-Process
**File:** `goals.js`, `GET /pipeline-insight`
**Context:** The `FEAT-03` pipeline insight is documented as "cached 24h per user" but the implementation uses a module-level object for caching — the same process-local pattern as Issue 8. Same multi-instance failure mode.

---

*END OF PART 1 — See Part 2 for the complete multi-tenant redesign blueprint.*
