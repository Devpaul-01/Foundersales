-- ============================================================
-- Migration: chat audit fixes
-- Covers:
--   - increment_chat_stats() signature fix (single p_chat_id param)
--   - stable keyset pagination for chat_messages (seq column)
--   - stable pagination support for chats list (seq column, index)
--   - conversation summarization columns on chats
-- ============================================================

-- ── 1. increment_chat_stats — confirmed single-param version already
--       deployed (per user confirmation). Re-declaring here idempotently
--       so this migration is the source of truth going forward and any
--       stray p_increment-accepting overload is removed.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS increment_chat_stats(uuid, integer);

CREATE OR REPLACE FUNCTION increment_chat_stats(p_chat_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE chats
  SET message_count    = COALESCE(message_count, 0) + 1,
      last_message_at  = NOW()
  WHERE id = p_chat_id;
$$;

-- ── 2. Stable ordering column for chat_messages ──────────────
-- Fixes the theoretical (and with attachment bursts, real) edge case
-- where two messages can share a created_at timestamp and a page
-- boundary based on created_at alone can skip/duplicate a row.
-- Also gives us a monotonic, indexable cursor for keyset pagination
-- instead of the broken ascending-limit-with-no-offset approach.
-- ------------------------------------------------------------
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS seq bigserial;

-- Backfill safety: bigserial auto-populates on insert; for any existing
-- rows the DEFAULT will have already assigned values in insertion order
-- at column-add time. No manual backfill needed on Postgres.

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_seq
  ON public.chat_messages (seq);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_seq
  ON public.chat_messages (chat_id, seq DESC);

-- Keep an index that also excludes system rows for the common
-- "history replay" and "summarization" queries, which always filter
-- role <> 'system'.
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_role_seq
  ON public.chat_messages (chat_id, role, seq);

-- ── 3. Stable ordering column for chats (list pagination) ────
-- Used as a documented, monotonic tiebreaker alongside last_message_at.
-- ------------------------------------------------------------
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE INDEX IF NOT EXISTS idx_chats_workspace_user_recency
  ON public.chats (workspace_id, user_id, is_archived, last_message_at DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_chats_title_search
  ON public.chats USING gin (title gin_trgm_ops);
-- NOTE: requires the pg_trgm extension. If not already enabled:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- If you'd rather not add the extension, drop this index — the existing
-- ILIKE search will still work, just without a trigram index assist.

-- ── 4. Conversation summarization support ─────────────────────
-- `summary` holds a rolling, model-generated condensation of everything
-- older than the live history window (CHAT_HISTORY_WINDOW, currently 20
-- non-system messages). `last_summarized_message_count` tracks how many
-- non-system messages have been folded into `summary` so far, so the
-- background job knows what's new since the last run.
-- ------------------------------------------------------------
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS last_summarized_message_count integer DEFAULT 0;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS summary_updated_at timestamp with time zone;

-- ── 5. Columns the application code already assumes exist ─────
-- These two are referenced throughout chat.js / attachmentProcessor.js
-- but were not present in the chat_messages / chats schema as shared.
-- The original code comments for `attachment_context` explicitly called
-- out "REQUIRES a migration if the column doesn't already exist" — this
-- is that migration. `growth_card_id` is used the same way `opportunity_id`
-- and `event_id` already are (linking a chat to the thing that spawned
-- it) and is read/written throughout chat.js and the Chat type on the
-- frontend, so it's added here rather than stripping that feature out.
-- ------------------------------------------------------------
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS attachment_context jsonb DEFAULT NULL;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS growth_card_id uuid;

-- ── 6. delivery_status gets a 'failed' value in practice now ──
-- (chat_messages.delivery_status is a free-text column already, so no
-- enum/constraint migration is needed — just noting the new value here
-- for anyone auditing the schema: 'sent' | 'delivered' | 'seen' | 'replied'
-- | 'ghosted' | 'failed'.)
