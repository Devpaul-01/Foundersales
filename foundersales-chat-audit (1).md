# Foundersales AI Chat — Production Review & Refinement Audit

**Reviewed:** `attachmentProcessor.js`, `chat.js`, `exa.js`, `streaming.js`, `multiProvider.js`, `chat.ts`, `useSmoothStream.ts`, `ChatListPage.tsx`, `ChatPage.tsx`
**Not provided (and relevant):** upload route/service, `groqService.buildChatSystemPrompt`, `tokenTracker.js`, `groqCalendarIntelligence.js`, `useSSE.ts`, DB schema/migrations, auth/workspace middleware internals. Findings that depend on these are marked *(unverified)*.

---

## 1. Executive Summary

The chat feature is well-engineered in the places that are easy to overlook — workspace scoping, key-pool cooldown/fallback, token-budget discipline on attachments, retry/backoff on the client, and a genuinely thoughtful smooth-streaming reveal hook. It reads like a codebase that has already been through one hardening pass (the inline "FIX HIGH-01" style comments confirm this).

However, tracing data end-to-end surfaced several **real, load-bearing bugs** rather than style nits:

1. Opening any chat with more than 50 messages shows the **oldest** messages, not the most recent ones, and the frontend never paginates forward — long conversations are effectively unreadable past message 50.
2. `POST /with-message` (the "new chat + first message" endpoint) fetches growth-card/opportunity context, persists it, but **never feeds it to the model** on the very first reply — the one time it matters most.
3. On later turns, growth-card context is very likely **duplicated** in the prompt (once via `finalSystemPrompt`, once via unfiltered history replay), while opportunity context has **no re-injection mechanism at all** and silently falls out of the AI's context window after ~4 turns.
4. Two call sites invoke the same-named `increment_chat_stats` RPC with **different parameter signatures**, and the failure is swallowed by `fireAndForget`.
5. Search citations are computed by `searchForChat()` and then **thrown away** — never persisted, never rendered.
6. The auto-search router (`needsChatSearch`) is fully built and exported but **never called** — search is 100% manual toggle.
7. Vision-capable models (`llama-4-scout` per `multiProvider.js`'s own comments) are wired up, but the attachment pipeline is still written for a **text-only "Grok-3-mini"** assumption and never sends image bytes to the model at all.

None of these are exotic — they're the kind of thing that only shows up when you follow a value from where it's fetched to where (or whether) it's actually used. The good news: all seven are narrowly scoped and fixable without architectural surgery.

---

## 2. Overall Product Assessment

The core mechanics — SSE streaming with a decoupled reveal-pace hook, optimistic UI, multi-provider fallback with per-key cooldown, budget-capped attachment/history context — are genuinely above the bar for a first production pass. The gaps are concentrated in **context plumbing** (data computed but not connected to the model) and **one pagination bug**, not in the streaming/rendering/infra layers, which are solid.

---

## 3. Strengths

- **Workspace isolation is consistently enforced** — every query in `chat.js` chains `.eq('workspace_id', workspaceId)`, including the trickier spots (opportunity ownership, memory reads) that are easy to miss.
- **Attachment token budgeting is genuinely well thought out**: per-file cap (8k chars) → aggregate per-message cap (16k) → a *separate, much smaller* cap for re-surfacing old attachments in history (2k total, 400/file) so a conversation doesn't silently balloon in cost as it grows. The comments explaining *why* each cap exists are excellent and made this easy to verify.
- **Key-pool cooldown design** (both `multiProvider.js` and `exa.js`) is symmetric, provider-agnostic, and correctly distinguishes retryable vs. non-retryable errors before cooling a key down.
- **`useSmoothStream`** decouples bursty SSE delivery from on-screen reveal pace with a backlog-based ramp — this is a nicer solution than most chat UIs bother with, and it's isolated/testable.
- **The `Promise.all` batching** of independent DB reads (memory, goals, check-in, growth card, history, attachment processing) in `POST /:chatId/message` is a real, documented latency fix, not just decoration.
- **Stop-generation correctness**: routing every async callback through `stopRequestedRef` (rather than just calling `abort()`) is the right way to make Stop deterministic against straggling SSE events — this is a common source of "stop doesn't really stop" bugs elsewhere.
- **`fireAndForget`'s `Promise.resolve()` wrapper** around Supabase's thenable-but-not-Promise query builder is a subtle, correct fix for a real footgun.

---

## 4. Critical Issues

### 4.1 Long chats show the wrong 50 messages (data-loss-feeling bug)
`GET /:chatId` in `chat.js`:
```js
let msgQuery = supabaseAdmin
  .from('chat_messages')
  .select('*')
  .eq('chat_id', chatId)
  .order('created_at', { ascending: true })
  .limit(parseInt(limit));      // default limit = 50
if (before) msgQuery = msgQuery.lt('created_at', before);
```
Ascending order + `limit` with no offset returns the **oldest** N messages, not the most recent N. The `before` cursor is designed to page *backward in time from a known point*, which only makes sense if the initial page already contains the most recent messages — it doesn't here. `ChatPage.tsx` calls `chatApi.getById(chatId!)` with no `before` param at all and has no "load older messages" affordance.

**Net effect:** any chat past ~50 messages permanently shows ancient history at the top and the AI's most recent replies never render, with no way to reach them from the UI. This will look like data loss to users and is the single highest-priority fix in this audit.

**Fix direction:** fetch the *latest* N (`order('created_at', {ascending:false}).limit(N)`) then reverse client-side for display, and implement `before`-based "load earlier messages" on scroll-to-top (the backend cursor logic is otherwise correct for that use case).

### 4.2 First message of a new chat never sees growth-card/opportunity context
In `POST /with-message`, growth-card and opportunity context are fetched and written to `chat_messages` as `role: 'system'` rows for later display — but the actual model call is:
```js
const systemPrompt = groqService.buildChatSystemPrompt(userCtx, chat_mode, {...});
...
const messagesForAI = [{ role: 'user', content: userMessageContent + searchContext }];
const { content: aiContent } = await callWithFallbackGroq({ systemPrompt, messages: messagesForAI, ... });
```
There is no `finalSystemPrompt`/`buildGrowthCardSystemMessage` prepend here (unlike `POST /:chatId/message`, `buildSystemPromptForChat` used by regenerate/edit), and no history query (there's nothing to query yet — it's a brand-new chat). So the card/opportunity context that presumably motivated the user to start this chat is **completely absent from the very first AI response**, even though the UI shows the context bubble above it (implying it was used).

**Fix direction:** reuse the same `buildGrowthCardSystemMessage(...) + '\n\n' + systemPrompt` pattern already used in the other three code paths.

### 4.3 `increment_chat_stats` RPC called with mismatched signatures
`streaming.js` documents and calls:
```js
await supabase.rpc('increment_chat_stats', { p_chat_id: chatId });
```
with an accompanying SQL comment showing `increment_chat_stats(p_chat_id UUID)` — a single-parameter function. But `chat.js` calls the *same-named* RPC in five places with a second parameter:
```js
fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId, p_increment: 1 }));
// and, in /with-message:
fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id, p_increment: 2 }));
```
Postgres will only accept both calls if there are two actually-overloaded versions of this function deployed, which isn't evidenced anywhere in the comments (only the single-param version is documented). If only one version exists, one of these two call shapes is failing on every single request. Because every call site wraps this in `fireAndForget` (which swallows errors) or a bare `.then(({error}) => logError(...))`, **this could be silently broken in production right now** with `message_count` never incrementing correctly, and you'd only notice it by grepping logs for `logError` calls that never fire (because the streaming.js path doesn't even log on RPC failure — it falls back to a non-atomic read-then-write instead, silently).

**Fix direction:** verify the deployed SQL function signature(s); pick one (a `p_increment` param with a default of `1` is the most flexible) and make every call site match it.

---

## 5. Medium-Priority Improvements

### 5.1 Growth-card context is likely duplicated on every subsequent turn
`getHistoryMessages`/the inline history-replay logic in `POST /:chatId/message` selects `role, content, ...` from `chat_messages` **with no `role` filter**, meaning the `role: 'system'` growth-card context row inserted at chat creation gets replayed verbatim as part of history on every later turn. Meanwhile, `buildSystemPromptForChat` / the inline duplicate in `POST /:chatId/message` **also** re-fetches the growth card and prepends `buildGrowthCardSystemMessage(...)` fresh, every turn. If both are true, the model receives the same growth-card block twice per request — wasted tokens and a real (if minor) source of prompt confusion, especially since one copy is truncated to 4000 chars and the other isn't (`buildGrowthCardSystemMessage` uses `.slice(0, 4000)`; the raw system-message row inserted at creation isn't length-limited the same way).

### 5.2 Opportunity context has no re-injection mechanism and will silently fall out of context
Unlike growth cards, opportunity context (`target_context`, `prepared_message`, platform) is *only* ever written once, as a system-role row, at chat/with-message creation. It's never re-fetched or re-prepended on later turns the way growth-card context is. Since the AI-facing history window is capped at the last 8 messages, **any opportunity-linked chat that runs past ~4 exchanges will have the model silently forget who the outreach target is and what was already said to them** — with no error, no log, just gradually worse responses. This is worth fixing the same way growth cards are handled (fetch + prepend on every turn), and worth capping/summarizing it the way attachment context already is.

### 5.3 `model_used` is stored as a compound provider string, not a clean model id
`callWithFallback` returns `model_used: provider.name`, which is built as `` `${providerId}-${model}-key${keyEntry.index}` `` (e.g. `groq-openai/gpt-oss-120b-key1`). This gets persisted directly to `chat_messages.model_used` and forwarded to `recordGroqUsage`. Any downstream analytics/billing/"which model answered this" UI will have to re-parse this string. Consider storing `{ provider, model, key_index }` as separate fields, or at least a clean `model` alongside the compound debug string.

### 5.4 Non-streaming vs. streaming responses have different length budgets
Non-streaming calls (`callWithFallbackGroq` in the message/regenerate/edit/with-message paths) use `maxTokens: 800`; `streamAndSave` hardcodes `maxTokens: 1200`. Since both paths can be hit for the same user (stream is a request-time boolean, not fixed per-chat), users may notice their replies are systematically shorter depending on which code path served them, with no product-facing explanation. Worth aligning these unless the difference is intentional.

### 5.5 `needsChatSearch` (the auto-search router) is dead code
It's fully implemented in `exa.js` and imported in `chat.js`, but never called — search is purely driven by the frontend's manual toggle (`force_search`). This is either wasted investment or evidence that a "smart search" feature was planned but never wired in. See §7.

### 5.6 Search citations are computed and discarded
`searchForChat` returns `{ content, citations }`. Every call site (`POST /:chatId/message`, `POST /with-message`) destructures only `content` (as `searchResult`) and folds it into the prompt as raw text (`Web search results:\n${searchResult}`) — `citations` is never captured, never stored, never sent to the client. Users have no way to know which sources the "web search results" text came from, which matters a lot for trust in a sales-context AI tool. See §7.

### 5.7 `chat_mode` is not validated against the known enum
`chatMessageSchema` (message send) and the chat-creation body both accept `chat_mode` as a bare `z.string()`; only `chat_type` is checked against `Object.values(CHAT_TYPES)` at creation. An arbitrary string in `chat_mode` will flow into `buildChatSystemPrompt(userCtx, effectiveChatMode, ...)` *(unverified how that function handles unknown modes — worth checking it degrades gracefully rather than throwing)*.

### 5.8 Vision-capable models never receive image content
`multiProvider.js`'s own comments describe `llama-4-scout` as "vision-capable (multimodal)" and rank it in the Groq priority list. But `attachmentProcessor.js` (`buildGrokAttachmentPrompt`) hardcodes:
```js
// Note: Grok-3-mini is text-only. If xAI releases vision model,
// this block will pass inline_data through the messages API.
return `[Image attached: "${att.filename}" — describe this image if asked about it]`;
```
This appears to be leftover logic from an earlier xAI-Grok-based integration (function names like `preprocessAttachmentsForGrok`/`buildGrokAttachmentPrompt`, comments about "Grok does not support direct URL ingestion") that was never updated after the switch to the current Cerebras/Groq-Cloud/Mistral/OpenRouter multi-provider stack — note "Grok" (xAI) and "Groq" (Groq Cloud) are different providers entirely, and only the latter appears anywhere in `multiProvider.js`. Net effect: **every image a user uploads is invisible to the model** — it gets a placeholder string instead of pixels, even when the routed model can see images. This is a meaningful missing capability for a chat product that accepts image uploads.

### 5.9 No per-user rate limiting visible on message send
Beyond Exa's workspace-level search quota, there's no apparent limiter on `POST /:chatId/message` itself *(unverified — may exist in middleware not provided)*. Combined with `maxTokens: 1200` streamed responses across four fallback providers, a scripted client could generate meaningful cost quickly. Worth confirming this exists somewhere in the stack.

---

## 6. Low-Priority Polish

- **Comment/rename drift**: `chat.js`'s file-header comment still says "workspace-level quota (checkWorkspacePerplexityUsage)" — that function was renamed to `checkWorkspaceExaUsage` per `exa.js`'s own migration notes. Stale comments like this compound over time and mislead the next reader (as this audit nearly demonstrates).
- **`streaming.js`'s `onError` handler** updates `content` to a failure message but doesn't set `delivery_status` — the row stays `'sent'` from the initial insert rather than something like `'failed'`, making it harder to distinguish "genuinely delivered" from "errored" messages later via a DB query.
- **`GET /:chatId/search` and pagination cursors** use `lt('created_at', before)` — with sub-millisecond-close inserts (e.g., a burst of attachments), it's theoretically possible for two messages to share a timestamp and for the boundary one to be skipped on a page transition. Very low likelihood, but a stable secondary sort key (e.g., `id`) would remove the theoretical edge case entirely.
- No `aria-live` region around the streaming message content — screen readers won't be notified as tokens arrive (§10).

---

## 7. Missing AI Features

Ranked by how directly they'd improve a sales-coaching chat product, given what's *already half-built* in this codebase:

1. **Surface citations from `searchForChat`.** The data already exists (`citations` array); it's just not being captured. This is the lowest-effort, highest-trust-payoff fix on this list.
2. **Wire up `needsChatSearch`.** It's fully implemented and unused. Either use it to auto-decide when to search (Perplexity-style) as a complement to the manual toggle, or remove it — right now it's confusing dead code that looks load-bearing.
3. **"Searching the web…" distinct loading state.** `ThinkingIndicator` doesn't distinguish "waiting on Exa" from "waiting on the model" — for `force_search` turns, that gap could plausibly be a few seconds of silence with no explanation.
4. **Actual image understanding**, once §5.8 is fixed — right now attaching an image is a UX dead end (the model is told an image exists but never shown it).
5. **"Continue generating"** for responses that hit the `maxTokens` ceiling (800/1200) — there's currently no way to tell a truncated reply from a complete one, and no way to extend it without regenerating from scratch.
6. **Suggested follow-up questions** after a response — `ChatListPage`/composer already has an empty-state "suggestions" pattern (`suggestionsApi`); extending that pattern to post-response follow-ups would be a natural, low-effort addition given the existing infrastructure.
7. **Conversation export** (Markdown/PDF) — reasonable for a sales tool where a chat's output (e.g., a drafted follow-up sequence) is often the actual deliverable a user wants to take elsewhere.

---

## 8. UX & Interaction Improvements

- **Fix §4.1 (message pagination) — this is a UX-breaking bug**, not a UX nice-to-have, for anyone with a chat history longer than ~50 messages.
- **Post-stream flicker**: `handleStreamRevealComplete` does `queryClient.invalidateQueries(...)` and then synchronously `setLocalMessages([])`. The invalidation is async; clearing `localMessages` happens immediately, so there's a window where the just-sent user message and the just-completed reply both vanish from `visibleMessages` until the refetch resolves and re-populates `dbMessages`. On a slow network this will visibly flash. Safer: keep `localMessages` populated until the refetch has actually resolved (e.g., clear inside the query's `onSuccess`, or key off `isFetching`).
- **No archived-chats view.** `DELETE /:chatId` soft-deletes via `is_archived: true`, and `GET /` filters `is_archived: false` — but there's no UI (or endpoint) shown to view/restore archived chats. If "delete" is meant to be recoverable, users need a way to actually recover it; if not, consider whether soft-delete is worth the complexity over a hard delete.
- **No "load earlier messages"** despite the backend cursor supporting it (see §4.1) — once fixed, this should be surfaced as scroll-to-top pagination.
- **Keyboard shortcuts are minimal** — Enter-to-send and Escape-to-cancel-edit exist; there's no shortcut for stop, new chat, or focusing the composer, which most comparable products offer.

---

## 9. Backend Improvements

- Fix the RPC signature mismatch (§4.3) — this is the kind of bug that's invisible until someone audits `message_count` against actual row counts.
- Consolidate the growth-card/opportunity-context injection logic into one shared helper used by *all four* entry points (`POST /:chatId/message`, `POST /with-message`, `regenerate`, `edit`) instead of three slightly different inline implementations — this is what caused §4.2 and §5.1 in the first place. `buildSystemPromptForChat` already exists for this purpose for two of the four paths; extend it to cover `/with-message` and to include opportunity context, not just growth cards.
- Validate `chat_mode` against `CHAT_MODES` consistently everywhere it's accepted from the client (§5.7).
- `POST /with-message` duplicates a large amount of logic that's already factored out elsewhere in the file (system prompt assembly, search block, growth-card fetch) rather than reusing `buildSystemPromptForChat`. Given it's also missing the growth-card injection that the other paths have, this is a good candidate for deduplication — it would have prevented §4.2 by construction.
- `POST /with-message` has no `stream` support at all, unlike every other generation endpoint in the file — the first message in a new chat renders as a single non-streamed blob while every subsequent message streams. Confirm this is intentional; if not, it's a jarring first impression.

---

## 10. Frontend Improvements

- Accessibility: no `aria-live="polite"` region around the streaming bubble content, so screen-reader users get no indication that a response is arriving token-by-token. The composer `<textarea>` also has no explicit `aria-label` (placeholder text alone isn't a reliable substitute).
- `ChatListPage`'s chat list has no virtualization — fine at current scale, worth revisiting if a workspace can accumulate hundreds of chats.
- The retry/backoff logic in `chat.ts` (`withRetry`) is duplicated conceptually in `ChatPage.tsx` (`withSendRetry`) with different retry conditions (network-error-only for streaming vs. network-or-5xx for reads) — reasonable given the different risk profiles (idempotent GET vs. non-idempotent stream), but worth a comment cross-referencing the two so a future reader doesn't "fix" one without checking the other.

---

## 11. AI Infrastructure Improvements

- **Provider fallback and key cooldown are solid** — no changes recommended there beyond what's already noted.
- **History window is fixed at 8 messages (4 exchanges)** with no summarization/compaction strategy for anything older. Combined with §5.2 (opportunity context has no re-injection), this means longer conversations progressively lose both raw history *and* the structured context that motivated the chat. A lightweight rolling summary (even just "last N messages verbatim + a compressed summary of everything before that") would meaningfully extend effective conversation length without a major rebuild.
- **Dynamic model discovery caches indefinitely for the process lifetime** (`_discoveryDone`/`_discoveredModels` in `multiProvider.js`) — a provider adding/removing models requires a process restart to pick up. Fine for now, but worth a TODO if deploys are infrequent.

---

## 12. Performance & Scalability Recommendations

- The `Promise.all` batching in `POST /:chatId/message` and `buildSystemPromptForChat` is already the right pattern — no further action needed there.
- Fixing §4.1 will also reduce the payload size for long chats materially, since currently there's no mechanism forcing "only fetch what's visible."
- Attachment/history token budgeting (§3) already protects against runaway prompt costs — this is one of the stronger parts of the system as-is.

---

## 13. Security & Reliability Review

- Workspace scoping is consistently applied across the routes reviewed — no cross-workspace leak found in `chat.js`.
- `ilike` search inputs are escaped for `%`/`_` in both the chat-title search and in-chat message search — correct defensive handling.
- Attachment URLs are trusted as-is for `<img src>`/`<a href>` rendering in `ChatPage.tsx`; this is fine *if* the upload service only ever returns URLs it controls (e.g., your own storage bucket) — worth confirming since that service wasn't provided.
- Rate limiting on message send is not visible in the provided files (§5.9) — flag for confirmation.
- No CSRF/auth details are visible in these files; assumed handled by middleware not in scope.

---

## 14. Hidden Bugs & Edge Cases

| # | Bug | Where | Severity |
|---|-----|-------|----------|
| 1 | Message list pagination returns oldest-first with no forward pagination in the UI | `GET /:chatId`, `ChatPage.tsx` | Critical |
| 2 | First AI response in a new chat never receives growth-card/opportunity context | `POST /with-message` | Critical |
| 3 | `increment_chat_stats` called with mismatched param signatures across two files | `chat.js` vs `streaming.js` | Critical (silent) |
| 4 | Growth-card context likely double-injected into every later turn's prompt | `chat.js` history replay + `buildSystemPromptForChat` | Medium |
| 5 | Opportunity context has no re-injection; falls out of AI context after ~4 turns | `chat.js` | Medium |
| 6 | Search citations computed, never persisted/rendered | `exa.js` → `chat.js` | Medium |
| 7 | `needsChatSearch` built, imported, never invoked | `exa.js`/`chat.js` | Low (dead code) |
| 8 | Image attachments never sent to vision-capable models | `attachmentProcessor.js` | Medium |
| 9 | Post-stream UI flicker from `setLocalMessages([])` racing `invalidateQueries` | `ChatPage.tsx` | Low |
| 10 | `streamAndSave`'s `onError` doesn't set `delivery_status` on failed messages | `streaming.js` | Low |

---

## 15. Suggested Feature Refinements

- **Unify growth-card/opportunity context injection** into a single helper called from every generation entry point (see §9) — this single change fixes items 2, 4, and 5 in §14 at once.
- **Promote `needsChatSearch` from dead code to either a real feature or a deletion** — leaving unused, imported, half-built router logic in a production file is worse than not having started it, because the next engineer will assume it's live.
- **Surface citations** wherever `searchContext` is folded into a prompt — this is a small, high-leverage change (§5.6, §7.1).

---

## 16. Features to Remove or Simplify

- `needsChatSearch` and `needsRealTimeSearch`'s LLM-based "is this worth an API call" routing logic (in `exa.js`) is reasonable for `discoverOpportunities`, but if it's never going to be wired into chat (§5.5), remove the unused import/reference from `chat.js` to reduce confusion about what's actually driving search behavior.
- Nothing else reviewed here looks over-engineered relative to its purpose — the budget-capping logic in particular looks verbose in isolation but each layer (per-file, per-message, per-history-turn) solves a distinct, documented cost problem and shouldn't be collapsed.

---

## 17. Competitive Feature Gap Analysis

| Capability | This product | ChatGPT/Claude/Perplexity |
|---|---|---|
| Streaming with smooth reveal | ✅ (custom, well-built) | ✅ |
| Stop generation | ✅ (deterministic, via `stopRequestedRef`) | ✅ |
| Edit + regenerate last message | ✅ | ✅ |
| Regenerate last response | ✅ | ✅ |
| Conversation branching (multiple regenerations kept) | ❌ (edit discards the old branch permanently) | ✅ (ChatGPT/Claude keep branches) |
| Continue truncated generation | ❌ | ✅ (ChatGPT) |
| Citations for web-sourced answers | ⚠️ Computed, not surfaced (§5.6) | ✅ |
| Image understanding | ⚠️ Uploaded but not sent to model (§5.8) | ✅ |
| Auto-decide when to search | ⚠️ Built, unused (§5.5) | ✅ (Perplexity, Claude) |
| In-chat message search | ✅ | ✅ (ChatGPT) |
| Long-conversation pagination | ❌ (broken — §4.1) | ✅ |
| Conversation export | ❌ | ✅ (ChatGPT) |
| Retry with backoff on network failure | ✅ (both client layers) | Varies |

The gaps here are mostly "half-built and disconnected" rather than "never attempted" — which is actually a favorable position, since the fixes are wiring, not new subsystems.

---

## 18. Final Launch Checklist

**Must fix before launch:**
- [ ] Fix `GET /:chatId` to return the most recent N messages, and implement forward/backward pagination in `ChatPage.tsx` (§4.1)
- [ ] Inject growth-card/opportunity context into the AI call in `POST /with-message` (§4.2)
- [ ] Verify the actual deployed signature of `increment_chat_stats` and make all call sites consistent; confirm `message_count` is accurate against real row counts (§4.3)

**Should fix before launch:**
- [ ] Deduplicate/confirm growth-card context isn't sent twice per request (§5.1)
- [ ] Add re-injection (or summarization) for opportunity context so it survives past 4 turns (§5.2)
- [ ] Decide fate of `needsChatSearch` — wire it in or remove the dead import (§5.5)
- [ ] Persist and render search citations (§5.6)
- [ ] Confirm whether attaching an image should actually reach the model, and fix the stale "Grok-3-mini text-only" assumption if so (§5.8)
- [ ] Confirm a rate limiter exists somewhere on `POST /:chatId/message` (§5.9)

**Worth doing, not blocking:**
- [ ] Align `maxTokens` between streamed/non-streamed paths (§5.4)
- [ ] Add `aria-live` region for streamed content (§10)
- [ ] Fix post-stream UI flicker (§14.9)
- [ ] Clean up stale comments referencing renamed functions (§6)
- [ ] Add archived-chats view or reconsider soft-delete (§8)

**Verify (not visible in provided files):**
- [ ] `groqService.buildChatSystemPrompt` degrades gracefully on unknown `chat_mode` values
- [ ] Upload endpoint sanitizes/validates URLs before they're persisted as `attachments`
- [ ] Auth/CSRF middleware covers all chat routes
- [ ] DB migrations for `attachments`, `attachment_context`, `increment_chat_stats` are actually applied in production, matching the comments in `chat.js`
