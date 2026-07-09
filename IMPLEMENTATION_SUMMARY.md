# Foundersales AI Chat — Audit Implementation Summary

This covers everything implemented against `foundersales-chat-audit (1).md`, scoped by your special instructions. Files not uploaded (`bullmq.js`, `logger.js`, `middleware/workspace.js`, `middleware/errorHandler.js`) are assumed unchanged and called exactly as the original code already called them.

---

## 1. Files changed

| File | What changed |
|---|---|
| `migration_001_chat_audit_fixes.sql` | **New.** RPC fix, `seq` columns, indexes, summarization columns, `attachment_context`/`growth_card_id` columns your schema was missing but the app code already assumed. |
| `constants.js` (backend) | New chat-audit constants: `CHAT_HISTORY_WINDOW` (20), `CHAT_SUMMARIZE_EVERY_N_MESSAGES`, `CHAT_MAX_TOKENS`, `CHAT_MESSAGES_PAGE_SIZE`, `CHAT_LIST_PAGE_SIZE`, `CHAT_MODE_VALUES`, `BACKGROUND_JOB_TYPES.CHAT_SUMMARIZE`. |
| `constants.ts` (frontend) | Added `CHAT_LIST_PAGE_SIZE`, `CHAT_MESSAGES_PAGE_SIZE`. |
| `chat.js` | Core of the implementation — see §2. |
| `streaming.js` | Shared `CHAT_MAX_TOKENS`, `delivery_status: 'failed'` on error, citations param, images param, `onSaved` callback, single-param RPC (already was), no silent catches. |
| `multiProvider.js` | Vision image passthrough (`images` param, only sent to vision-capable models), clean `model_used` (`provider:model`, no key index leaked). |
| `attachmentProcessor.js` | `extractImageParts()` added; stale "Grok-3-mini text-only" comment corrected; no more silent catches (unclassifiable failures now push an explicit placeholder). |
| `backgroundWorker.js` | New `CHAT_SUMMARIZE` job handler. |
| `chat.ts` (frontend API client) | `before_seq`-based `getById`, typed `ChatListResponse`/`ChatMessagesResponse`. |
| `types.ts` | `ChatMessage.citations`, `ChatMessage.seq`, `Chat.growth_card_id`, `Chat.summary`, `Chat.seq`, `DeliveryStatus` gains `'failed'`. |
| `useSSE.ts` | `onDone` now also receives `citations` from the `complete` SSE event. |
| `ChatPage.tsx` | `useInfiniteQuery` keyset pagination (`before_seq`), "Load earlier messages", citation pills, `aria-live` region + textarea `aria-label`. |
| `ChatListPage.tsx` | `useInfiniteQuery` offset pagination, "Load more chats". |

---

## 2. Critical fixes (audit §4)

**§4.1 — Message pagination.** `GET /:chatId` returned the oldest 50 messages with no way to reach recent ones. Added a `seq bigserial` column (stable, monotonic — `created_at` alone isn't safe under bursty inserts) and rewrote the query to fetch the **latest** N messages, paging backward via `?before_seq=`. `ChatPage.tsx` uses `useInfiniteQuery`; a "Load earlier messages" button at the top of the scroll pane calls `fetchNextPage()`, with scroll position explicitly preserved across the prepend so the view doesn't jump.

**§4.2 — First message never saw growth-card/opportunity context.** `POST /with-message` built its own system prompt inline and skipped the growth-card/opportunity injection that `buildSystemPromptForChat` did for other paths. Fixed by routing **all four** generation entry points (`message`, `with-message`, `regenerate`, `edit`) through the same `buildSystemPromptForChat()`.

**§4.3 — RPC signature mismatch.** You confirmed `increment_chat_stats` is deployed with `p_chat_id` only. Every call site in `chat.js` that was passing `p_increment` has been corrected. `migration_001` also drops any stray two-param overload defensively.

---

## 3. Medium-priority fixes (audit §5)

- **§5.1/§5.2 — Duplicated/missing context.** History replay now excludes `role='system'` rows everywhere (they're one-time display context for the UI, not model input). `buildSystemPromptForChat` fetches growth-card **and** opportunity context fresh every turn and layers them: opportunity → growth card → rolling summary → base prompt. Opportunity context previously had zero re-injection and fell out of context after ~4 turns; it's now refreshed every turn, same as growth cards, and capped to 2000 chars.
- **§5.3 — Compound `model_used` string.** Now `provider:model` (e.g. `groq:openai/gpt-oss-120b`) instead of `provider-model-keyN`.
- **§5.4 — Inconsistent token budgets.** Single `CHAT_MAX_TOKENS = 1000` shared by streaming and non-streaming paths (was 1200 vs 800).
- **§5.6/§7.1 — Citations discarded.** `searchForChat`'s `citations` are now threaded through `chat.js` → `streaming.js`/non-stream insert → persisted on `chat_messages.citations` (already `jsonb` in your schema) → sent in the `complete` SSE event → rendered as source pills under the reply.
- **§5.7 — `chat_mode` not validated.** Added `CHAT_MODE_VALUES` and validate it via zod (`chatMessageSchema`) and manually on chat creation, matching how `chat_type` was already checked.
- **§5.8 — Images never reached the model.** `attachmentProcessor.extractImageParts()` pulls the already-fetched base64 data back out; `multiProvider.js` attaches it to the outgoing request **only** when the specific model being tried in the fallback queue is vision-capable (currently `llama-4-scout` and `gemma-4-31b`). Every other model in the queue still gets the plain-text placeholder, so nothing breaks if vision models are cooling down or unavailable.
- **§5.9 — Rate limiting.** Explicitly *not* touched per your instructions (already exists).

---

## 4. Low-priority polish (audit §6)

- Stale "checkWorkspacePerplexityUsage" comment references corrected to `checkWorkspaceExaUsage`.
- `streaming.js`'s `onError` now sets `delivery_status: 'failed'` (was left at `'sent'`).
- `GET /:chatId/search` and pagination now order by `seq`, removing the theoretical same-timestamp skip risk from `created_at`-only ordering.
- No silent `catch {}` blocks remain in any file I touched — every catch either logs via the existing logger/`console.warn`/`console.error` or is a documented, safe no-op with a comment explaining why (per your error-handling instruction).

---

## 5. Hidden bug found during implementation (not in the original audit)

The audit didn't have `groqCalendarIntelligence.js`, so it couldn't catch this: `chat.js`'s meeting-notes branch called `generateMeetingNotesResponse(userCtx, chat, messagesForAI, userMessageContent)` and destructured `{ response, event_id }` — but the real function signature is `(noteFragment, conversationHistory, eventContext) => { content, is_end }`. Meeting-notes chats were getting `undefined` back (silently falling to `"Notes captured."`) and, worse, could persist the literal `"__END_MEETING__"` sentinel as visible message content if the user typed something like "done". Fixed: correct arguments, correct destructuring, fetches the linked event for context, and turns `is_end` into a friendly completion message instead of leaking the sentinel.

---

## 6. Your special instructions

1. **Search stays manual.** No `needsChatSearch` auto-search wiring added; the unused import was dropped from `chat.js` since you're keeping the manual toggle only (the function itself is untouched in `exa.js` in case you want it later).
2. **`increment_chat_stats` single-param.** Done — see §4.3.
3. **No silent exception swallowing.** Done throughout.
4. **No archived-chat UI.** Not built. `is_archived` soft-delete behavior is unchanged.
5. **Message pagination → cursor-based.** Implemented via the new `seq` column (see §4.1). This is genuine keyset pagination: stable, no duplicates/skips across pages, O(1) per page regardless of chat length.
6. **Chat list pagination.** Implemented — **offset-based**, not full keyset. See the tradeoff note below.
7. **Rate limiting untouched.** Confirmed — nothing in §5.9 was touched.
8. **Conversation summarization.** New `CHAT_SUMMARIZE` background job (`backgroundWorker.js`). Triggered fire-and-forget from `chat.js` after every successful assistant reply, but only actually enqueues once a chat has accumulated `CHAT_SUMMARIZE_EVERY_N_MESSAGES` (20) new non-system messages since its last summarization run — so it's not firing a job on every single turn. The job folds everything **older than the live `CHAT_HISTORY_WINDOW`** into `chats.summary`, merging with whatever summary already existed. `buildSystemPromptForChat` prepends that summary to the system prompt, so a chat's "memory" keeps extending indefinitely without resending the full raw transcript every turn.
9. **History window → 20.** `CHAT_HISTORY_WINDOW = 20` in `constants.js`, used by `getHistoryMessages()`.

### Why chat-list pagination is offset-based but message pagination is keyset-based

`chats.last_message_at` is **nullable** (a brand-new chat with no messages yet has `last_message_at: null`), and the list is ordered by it. A correct keyset cursor over a nullable, non-unique sort column needs a compound "seek" predicate that branches on null vs non-null and falls back to `seq` as a tiebreaker — solvable, but meaningfully more complex for a list that (per your own framing) will have "hundreds or thousands" of chats, not the "may run into millions of messages in one thread" scale that made the message-pagination bug actually painful. I used the standard `limit+1` trick (fetch one extra row, trim, and use its presence as `has_more`) instead of a separate `COUNT(*)` query, so it's still one query per page and stays responsive at the scale you described. If you later see users with truly enormous chat counts (10k+), keyset is a clean follow-up — the `seq` column is already there to support it.

---

## 7. Database migration

Run `migration_001_chat_audit_fixes.sql`. Summary of what it does:

1. Re-declares `increment_chat_stats(p_chat_id uuid)` as the single-param version (drops any stray 2-param overload).
2. Adds `chat_messages.seq bigserial` + indexes (`seq` unique, `(chat_id, seq DESC)`, `(chat_id, role, seq)`).
3. Adds `chats.seq bigserial` + a composite index for list pagination.
4. Adds a trigram index on `chats.title` for search (requires `pg_trgm` — noted as optional/droppable if you'd rather not add the extension).
5. Adds `chats.summary`, `chats.last_summarized_message_count`, `chats.summary_updated_at` for the summarization job.
6. Adds `chat_messages.attachment_context jsonb` and `chats.growth_card_id uuid` — both were already assumed present by the application code (original comments literally said "REQUIRES a migration if the column doesn't already exist") but weren't in the schema you shared, so this migration is that migration.

No data backfill is needed — `bigserial` populates automatically on any future insert, and existing rows get sequential values in insertion order the moment the column is added.

---

## 8. Background jobs

One new job type: `BACKGROUND_JOB_TYPES.CHAT_SUMMARIZE` (`'chat_summarize'`), handled in `backgroundWorker.js`. Enqueued via `backgroundQueue.add(CHAT_SUMMARIZE, { chatId, workspaceId, userId }, { jobId: 'chat_summarize:<chatId>:<count>' })` — the `jobId` makes duplicate/late enqueues for the same chat/message-count a safe no-op under BullMQ's built-in dedup.

---

## 9. Audit verification checklist

| Item | Status | Note |
|---|---|---|
| §4.1 Message pagination | ✅ | Keyset via `seq`, infinite scroll |
| §4.2 First-message context injection | ✅ | Unified via `buildSystemPromptForChat` |
| §4.3 RPC signature mismatch | ✅ | Single-param everywhere |
| §5.1 Growth-card double-injection | ✅ | System rows excluded from history replay |
| §5.2 Opportunity context re-injection | ✅ | Fetched fresh every turn |
| §5.3 Compound `model_used` | ✅ | Clean `provider:model` |
| §5.4 Inconsistent maxTokens | ✅ | Shared `CHAT_MAX_TOKENS` |
| §5.5 `needsChatSearch` dead code | ⏭️ | Import removed per your instruction; function left intact in `exa.js` |
| §5.6 Citations discarded | ✅ | Persisted + rendered |
| §5.7 `chat_mode` not validated | ✅ | zod enum + manual check |
| §5.8 Images never reach model | ✅ | Vision passthrough, model-gated |
| §5.9 Rate limiting | ⏭️ | Explicitly excluded per your instruction |
| §6 Stale comments / `delivery_status` | ✅ | Fixed |
| §6 `search` cursor edge case | ✅ | Now ordered by `seq` |
| §7 Missing features (citations, image understanding) | ✅ | Covered by §5.6/§5.8 |
| §7 Archived-chat UI | ⏭️ | Explicitly excluded per your instruction |
| §8 Post-stream flicker | ⚠️ | Not addressed this pass — out of the audit sections you listed as in-scope; flag if you want it included |
| §9 Growth-card/opportunity dedup | ✅ | One shared helper, all 4 entry points |
| §10 Accessibility (`aria-live`, textarea label) | ✅ | Added |
| §11 History window / summarization | ✅ | 20-message window + rolling summary job |
| Chat list pagination (task #6) | ✅ | Offset-based, see tradeoff note |
| Meeting-notes signature bug (found, not audited) | ⚠️ | Fixed — see §5 above |

No items were silently skipped. The two `⏭️` rows are your explicit exclusions; the two `⚠️` rows are deviations I made a judgment call on and explained above.
