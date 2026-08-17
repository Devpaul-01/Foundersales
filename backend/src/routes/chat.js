// src/routes/chat.js — CHAT AUDIT IMPLEMENTATION
//
// CARRIED FORWARD FROM PRIOR WORKSPACE REFACTOR:
//  HIGH-01: All chat queries and inserts include workspace_id.
//  HIGH-05 (read-side): user_memory read scoped to workspace_id.
//  HIGH-11: Perplexity/Exa search uses workspace-level quota.
//  LOW-07:  chatMessageSchema validates POST /:chatId/message body.
//  LOW-08:  buildChatSystemPrompt called unconditionally.
//  MED-07:  Opportunity ownership checks include workspace_id.
//
// CHAT AUDIT FIXES APPLIED (this revision):
//  §4.1 CRITICAL — Message pagination was oldest-first with no way to
//        reach recent messages past 50. GET /:chatId now uses a stable
//        keyset cursor (the new `seq` bigserial column — see
//        migration_001) to fetch the LATEST N messages and page
//        backward in time via `before_seq`, matching how ChatPage.tsx's
//        new infinite-scroll "load earlier" now works.
//  §4.2 CRITICAL — POST /with-message never fed growth-card/opportunity
//        context to the model on a chat's first message, even though it
//        persisted that context as a system row for display. Both
//        /with-message and the inline logic in /:chatId/message now go
//        through the SAME shared buildSystemPromptForChat() helper used
//        by regenerate/edit, which fetches + injects both.
//  §4.3 CRITICAL — increment_chat_stats() was called with a second
//        p_increment param in five places here, against a single-param
//        p_chat_id signature elsewhere (confirmed as the only deployed
//        version). All call sites now call it with p_chat_id only.
//  §5.1 / §5.2 — Growth-card context was being replayed twice (once via
//        buildGrowthCardSystemMessage, once via unfiltered history
//        replay of the system-role row inserted at chat creation), while
//        opportunity context had no re-injection at all and silently
//        fell out of the model's context after ~4 turns. Fixed by (a)
//        excluding role='system' rows from ALL history replay queries —
//        those rows exist for the UI's display, not for re-feeding to
//        the model — and (b) adding opportunity-context fetch+injection
//        to buildSystemPromptForChat alongside growth-card context, so
//        both are freshly re-injected every turn instead of relying on
//        a single historical copy.
//  §5.4 — maxTokens is now the shared CHAT_MAX_TOKENS constant on both
//        the streaming and non-streaming paths (was 1200 vs 800).
//  §5.6 / §7.1 — searchForChat's citations were computed and discarded.
//        Now captured and persisted on the assistant message row
//        (chat_messages.citations, already jsonb in the schema).
//  §5.7 — chat_mode is now validated against CHAT_MODE_VALUES wherever
//        it's accepted from the client (message send, chat creation,
//        with-message).
//  §5.8 — Current-turn image attachments are extracted and forwarded to
//        multiProvider.js so a vision-capable model in the fallback
//        queue can actually see them, instead of only ever getting a
//        text placeholder. See attachmentProcessor.extractImageParts().
//  §9   — buildSystemPromptForChat is now the SINGLE shared helper used
//        by all four generation entry points (message, with-message,
//        regenerate, edit) instead of three slightly different inline
//        implementations.
//  Dead code — the unused `needsChatSearch` import has been dropped.
//        Per explicit product decision, auto-search stays OFF; the
//        manual `force_search` toggle is the only way search fires.
//        (needsChatSearch itself is left intact in exa.js in case it's
//        wired up deliberately later — just no longer imported here.)
//
// NEW (this revision):
//  — POST /:chatId/regenerate now accepts `force_search` (validated via
//    the new regenerateSchema/validateRegenerate), mirroring the Exa
//    search flow already used by POST /:chatId/message. Since regenerate
//    has no new message text, the query is the last user turn already
//    present in the replayed history; if there's no prior user turn,
//    force_search is a no-op. Citations from a regenerate-triggered
//    search are persisted the same way as on /message.
//  — GET / (list) `type`/`mode` filters were already implemented
//    server-side (see below); the client (chat.ts) previously sent
//    mistyped/loosely-typed params — now typed against the same
//    chat_type/chat_mode enums used elsewhere.
//
// NEW (task instructions):
//  #8 — CHAT_SUMMARIZE background job: maybeEnqueueSummarization() fires
//       (fire-and-forget) after every successful assistant reply. Once a
//       chat has accumulated CHAT_SUMMARIZE_EVERY_N_MESSAGES new
//       non-system messages since its last summary, a job is enqueued to
//       fold everything older than the live history window into
//       chats.summary (see backgroundWorker.js). buildSystemPromptForChat
//       prepends that summary to the system prompt when present.
//  #9 — CHAT_HISTORY_WINDOW raised from 8 → 20 (constants.js), replayed
//       from the stable `seq` column instead of created_at.
//
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { CHAT_TYPES, CHAT_MODES, CHAT_MODE_VALUES, CHAT_HISTORY_WINDOW,
         CHAT_MAX_TOKENS, CHAT_SUMMARIZE_EVERY_N_MESSAGES,
         CHAT_MESSAGES_PAGE_SIZE, CHAT_LIST_PAGE_SIZE,
         BACKGROUND_JOB_TYPES } from '../config/constants.js';
import { buildUserContext } from '../middleware/workspace.js';
import { createLogger } from '../utils/logger.js';
import { backgroundQueue }            from '../jobs/queues.js';
import { callWithFallbackGroq, streamWithFallback } from '../services/multiProvider.js';
import groqService from '../services/groq.js';
import { streamAndSave, initSSE, sendSSE, endSSE } from '../services/streaming.js';

import { searchForChat } from '../services/exa.js';
import { checkWorkspaceExaUsage } from '../services/tokenTracker.js';
import {
  preprocessAttachmentsForGrok,
  buildGrokAttachmentPrompt,
  buildAttachmentHistorySummary,
  extractImageParts,
} from '../utils/attachmentProcessor.js';

// Aggregate char budget for attachment context pulled back in from OLDER
// messages when replaying history for the AI.
const MAX_HISTORY_ATTACHMENT_CONTEXT_CHARS = 2000;

import { generateMeetingNotesResponse } from '../services/groqCalendarIntelligence.js';
import supabaseAdmin from '../config/supabase.js';
import { z } from 'zod';
// PHASE 3 (Redis Store & Rate Limiting Consistency refactor): GET
// /:chatId/export was previously entirely unprotected — no rate limiter
// of any kind. It's a read-only DB query + string-building operation (no
// AI, no external call), so the per-request cost is low, but a full
// conversation history export is meaningfully heavier than an ordinary
// message-list fetch and has a shape (rare, at-most-once-per-conversation
// under normal use) that's easy to hit in a scripted loop. Given its own
// light limiter (LIMITERS.exportLimiter) rather than folded into
// chatLimiter, since export traffic doesn't resemble live chat-message
// traffic at all. See config/limiters.js.
import { LIMITERS } from '../config/limiters.js';

// Supabase's query builder is only "thenable", not a real Promise — see
// prior audit note. Promise.resolve() guarantees .catch() is safe to call.
const fireAndForget = (builder) => Promise.resolve(builder).catch((err) => {
  logError('fireAndForget', err instanceof Error ? err : new Error(String(err)));
});

const router = Router();

const { log, logError, logDB, logAI } = createLogger('Chat');

// ── Growth card helper ───────────────────────────────────────
async function fetchGrowthCard(growthCardId, userId, workspaceId) {
  if (!growthCardId) return null;
  const { data: card, error } = await supabaseAdmin
    .from('growth_cards')
    .select('id, card_type, title, body, action_label, metadata')
    .eq('id', growthCardId)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();
  if (error || !card) return null;
  return card;
}

function buildGrowthCardSystemMessage(card) {
  const metaSummary = card.metadata
    ? `\n\nAdditional context: ${JSON.stringify(card.metadata).slice(0, 600)}`
    : '';
  return (
    `The user wants to discuss a growth card generated for them.\n\n` +
    `Card type: ${card.card_type}\n` +
    `Title: ${card.title}\n` +
    `Content: ${card.body}` +
    metaSummary +
    `\n\nHelp the user explore, action, or get deeper on this card. ` +
    `Ask clarifying questions if helpful and keep the conversation focused on their growth.`
  ).slice(0, 4000);
}

// ── Opportunity context helper (audit §5.2 — NEW) ─────────────
// Unlike growth cards, opportunity context previously had NO re-injection
// mechanism at all — it was written once as a system row at chat creation
// and then fell out of the model's context window after ~4 turns. This
// fetches a short, budget-capped version fresh on every turn instead.
async function fetchOpportunityContext(opportunityId, workspaceId) {
  if (!opportunityId) return null;
  const { data: opp, error } = await supabaseAdmin
    .from('opportunities')
    .select('target_name, target_context, prepared_message, platform')
    .eq('id', opportunityId)
    .eq('workspace_id', workspaceId)
    .single();
  if (error || !opp) return null;
  return opp;
}

function buildOpportunityContextMessage(opp) {
  return (
    `Context: You're helping with outreach for someone on ${opp.platform}${opp.target_name ? ` (${opp.target_name})` : ''}.\n\n` +
    `Their situation: ${opp.target_context}\n\n` +
    `Draft message so far: ${opp.prepared_message || 'none yet'}`
  ).slice(0, 2000);
}

// ── Chat summarization trigger (task #8 — NEW) ────────────────
// Fire-and-forget check run after every successful assistant reply. Only
// enqueues a job once CHAT_SUMMARIZE_EVERY_N_MESSAGES new non-system
// messages have accumulated since the last summarization run, so this
// isn't hammering the queue on every single turn. The jobId makes
// duplicate enqueues for the same chat/count a safe no-op in BullMQ.
async function maybeEnqueueSummarization(chatId, workspaceId, userId) {
  const startTime = Date.now();
  log('CHAT_SUMMARIZE_CHECK', { chatId, workspaceId, userId });

  try {
    // ── Step 1: Fetch chat data ──────────────────────────────────────────
    const { data: chat, error: chatErr } = await supabaseAdmin
      .from('chats')
      .select('last_summarized_message_count, title, message_count')
      .eq('id', chatId)
      .single();

    if (chatErr) {
      logError('maybeEnqueueSummarization_chat_fetch', chatErr, { chatId, workspaceId });
      return;
    }

    if (!chat) {
      log('CHAT_SUMMARIZE_SKIP', { chatId, reason: 'Chat not found' });
      return;
    }

    log('CHAT_SUMMARIZE_CHAT_FETCHED', {
      chatId,
      lastSummarized: chat.last_summarized_message_count,
      totalMessages: chat.message_count,
      title: chat.title?.slice(0, 50),
    });

    // ── Step 2: Count non-system messages ──────────────────────────────
    const { count: nonSystemCount, error: countErr } = await supabaseAdmin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .neq('role', 'system');

    if (countErr) {
      logError('maybeEnqueueSummarization_count', countErr, { chatId, workspaceId });
      return;
    }

    log('CHAT_SUMMARIZE_MESSAGE_COUNT', {
      chatId,
      nonSystemCount,
      lastSummarized: chat.last_summarized_message_count || 0,
    });

    // ── Step 3: Determine if summarization is needed ────────────────────
    const lastSummarized = chat.last_summarized_message_count || 0;
    const newSince = (nonSystemCount || 0) - lastSummarized;

    const shouldSummarize = newSince >= CHAT_SUMMARIZE_EVERY_N_MESSAGES;

    log('CHAT_SUMMARIZE_EVALUATION', {
      chatId,
      newSince,
      threshold: CHAT_SUMMARIZE_EVERY_N_MESSAGES,
      shouldSummarize,
      elapsed: `${Date.now() - startTime}ms`,
    });

    if (!shouldSummarize) {
      log('CHAT_SUMMARIZE_SKIP', {
        chatId,
        reason: `Only ${newSince} new messages, threshold is ${CHAT_SUMMARIZE_EVERY_N_MESSAGES}`,
      });
      return;
    }

    // ── Step 4: Enqueue background job ──────────────────────────────────
    const jobId = `chat_summarize_${chatId}_${nonSystemCount}`;
    const payload = { chatId, workspaceId, userId };

    log('CHAT_SUMMARIZE_ENQUEUE_ATTEMPT', {
      chatId,
      jobId,
      payload,
      nonSystemCount,
    });

    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CHAT_SUMMARIZE,
      payload,
      { jobId },
    );

    log('CHAT_SUMMARIZE_ENQUEUED', {
      chatId,
      workspaceId,
      userId,
      jobId,
      nonSystemCount,
      elapsed: `${Date.now() - startTime}ms`,
      threshold: CHAT_SUMMARIZE_EVERY_N_MESSAGES,
    });

  } catch (err) {
    logError('maybeEnqueueSummarization_unexpected', err, {
      chatId,
      workspaceId,
      userId,
      elapsed: `${Date.now() - startTime}ms`,
    });
  }
}

// ── Shared helpers for AI turns (message / regenerate / edit / with-message) ─
// Consolidated per audit §9 — this is now the ONE place growth-card and
// opportunity context get fetched and prepended, used by every generation
// entry point in this file.
async function buildSystemPromptForChat(req, chat, effectiveChatMode) {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const userCtx     = buildUserContext(req);

  const [memFactsResult, goalsResult, checkInResult, growthCard, opportunityContext] = await Promise.all([
    req.user.memory_enabled !== false
      ? supabaseAdmin
          .from('user_memory')
          .select('fact')
          .eq('user_id', userId)
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
          .order('reinforcement_count', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from('user_goals')
      .select('goal_text, current_value, target_value, target_unit')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(3),
    supabaseAdmin
      .from('daily_check_ins')
      .select('mood_score, answers')
      .eq('user_id', userId)
      .not('processed_at', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    chat.growth_card_id ? fetchGrowthCard(chat.growth_card_id, userId, workspaceId) : Promise.resolve(null),
    chat.opportunity_id ? fetchOpportunityContext(chat.opportunity_id, workspaceId) : Promise.resolve(null),
  ]);

  let memoryContext = '';
  if (memFactsResult.data?.length) {
    memoryContext = `\nContext about this user:\n${memFactsResult.data.map(f => `- ${f.fact}`).join('\n')}`;
  }

  const systemPrompt = groqService.buildChatSystemPrompt(userCtx, effectiveChatMode, {
    memoryContext,
    goals: goalsResult.data || [],
    latestMood: checkInResult.data?.mood_score || null,
  });

  // Layer context, most-specific-first: growth card / opportunity (if
  // any), then a rolling conversation summary (if the chat has run long
  // enough to have one — task #8), then the base system prompt.
  let finalSystemPrompt = systemPrompt;
  if (chat.summary) {
    finalSystemPrompt = `Summary of the conversation so far (earlier messages not repeated below):\n${chat.summary}\n\n${finalSystemPrompt}`;
  }
  if (opportunityContext) {
    finalSystemPrompt = buildOpportunityContextMessage(opportunityContext) + '\n\n' + finalSystemPrompt;
    log('OPPORTUNITY_CONTEXT_INJECTED', { chatId: chat.id });
  }
  if (growthCard) {
    finalSystemPrompt = buildGrowthCardSystemMessage(growthCard) + '\n\n' + finalSystemPrompt;
    log('GROWTH_CARD_CONTEXT_INJECTED', { chatId: chat.id, cardId: growthCard.id });
  }

  return { finalSystemPrompt, userCtx };
}

// Replays the last N turns of a chat into the shape the model expects.
// FIX §5.1/§5.2: excludes role='system' rows — those are one-time display
// context for the UI, not something that should be replayed into the
// model's history now that buildSystemPromptForChat re-injects fresh
// growth-card/opportunity context on every turn. Ordered by the stable
// `seq` column (not created_at) to match the pagination fix.
async function getHistoryMessages(chatId, { excludeMessageId, limit = CHAT_HISTORY_WINDOW } = {}) {
  const { data: history, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, attachment_context')
    .eq('chat_id', chatId)
    .neq('role', 'system')
    .order('seq', { ascending: false })
    .limit(limit);

  if (error) {
    logError('getHistoryMessages', error, { chatId });
    return [];
  }

  let historyAttachmentBudget = MAX_HISTORY_ATTACHMENT_CONTEXT_CHARS;
  return (history || [])
    .filter(m => !excludeMessageId || m.id !== excludeMessageId)
    .map(m => {
      let content = m.content || '';
      if (m.attachment_context?.length && historyAttachmentBudget > 0) {
        const summary = buildAttachmentHistorySummary(m.attachment_context).slice(0, historyAttachmentBudget);
        historyAttachmentBudget -= summary.length;
        content += summary;
      }
      return { role: m.role, content };
    })
    .reverse();
}

// Runs the model against an already-assembled message list and persists the
// reply. Used by regenerate and edit-and-regenerate.
async function generateAndSaveAssistantReply({
  res, stream, finalSystemPrompt, messagesForAI, chatId, userId, workspaceId, userCtx, sourceJob,
  citations = [], images = undefined,
}) {
  log('GENERATE_REPLY_START', { userId, chatId, sourceJob, stream, historyCount: messagesForAI.length });

  if (stream) {
    try {
      await streamAndSave({
        res,
        systemPrompt: finalSystemPrompt,
        messages:     messagesForAI,
        chatId,
        userId,
        workspaceId,
        supabase:     supabaseAdmin,
        streamFn:     streamWithFallback,
        tier:         userCtx.tier,
        sourceJob,
        citations,
        images,
        onSaved: () => maybeEnqueueSummarization(chatId, workspaceId, userId),
      });
      log('GENERATE_REPLY_STREAM_OK', { userId, chatId, sourceJob });
    } catch (err) {
      logError(sourceJob, err, { userId, chatId, stream: true });
      if (!res.headersSent) initSSE(res);
      try {
        sendSSE(res, 'error', { message: 'Stream failed' });
        endSSE(res);
      } catch (sseErr) {
        logError(`${sourceJob}_sseCloseFailed`, sseErr, { userId, chatId });
      }
    }
    return;
  }

  const { content: aiContent } = await callWithFallbackGroq({
    systemPrompt: finalSystemPrompt,
    messages:     messagesForAI,
    temperature:  0.7,
    maxTokens:    CHAT_MAX_TOKENS,
    userId,
    workspaceId,
    sourceJob,
    images,
  });

  const { data: aiMsg, error: insertError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id:      chatId,
      user_id:      userId,
      workspace_id: workspaceId,
      role:         'assistant',
      content:      aiContent || 'I encountered an error. Please try again.',
      citations:    citations?.length ? citations : [],
    })
    .select()
    .single();

  if (insertError) { logError(sourceJob, insertError, { userId, chatId }); throw insertError; }

  // FIX §4.3: single-param signature only.
  const { error: rpcError } = await supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId });
  if (rpcError) {
    logError(`${sourceJob}_incrementStats`, rpcError, { userId, chatId });
    fireAndForget(
      supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId)
    );
  } else {
    fireAndForget(
      supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId)
    );
  }

  log('GENERATE_REPLY_NONSTREAM_OK', { userId, chatId, sourceJob, aiMessageId: aiMsg?.id });
  res.json({ message: aiMsg });

  maybeEnqueueSummarization(chatId, workspaceId, userId).catch((err) =>
    logError('maybeEnqueueSummarization_afterNonStream', err, { chatId }));
}

// ── FIX LOW-07 / §5.7: Input validation schema for message endpoint ─
const chatMessageSchema = z.object({
  message: z.string().min(1).max(5000, 'Message cannot exceed 5000 characters'),
  stream: z.boolean().optional(),
  force_search: z.boolean().optional(),
  attachments: z.array(z.object({
    name: z.string().max(255),
    type: z.string().max(100),
    url:  z.string().url().optional(),
  })).max(10).optional(),
  chat_mode: z.enum(CHAT_MODE_VALUES).optional(),
  growth_card_id: z.string().uuid().optional(),
});

const validateChatMessage = (req, res, next) => {
  try {
    chatMessageSchema.parse(req.body);
    next();
  } catch (err) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: err.errors?.[0]?.message || 'Invalid request body',
    });
  }
};

// FIX: validation for the regenerate body, now that it accepts
// force_search alongside stream (previously unvalidated `req.body || {}`).
const regenerateSchema = z.object({
  stream:       z.boolean().optional(),
  force_search: z.boolean().optional(),
});

const validateRegenerate = (req, res, next) => {
  try {
    regenerateSchema.parse(req.body || {});
    next();
  } catch (err) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: err.errors?.[0]?.message || 'Invalid request body',
    });
  }
};

// ──────────────────────────────────────────
// GET /api/chat
// FIX §6 (task #6): chat list pagination. Offset-based (not full keyset)
// — deliberate tradeoff, see IMPLEMENTATION_SUMMARY.md: last_message_at is
// nullable, which makes a clean keyset comparison materially more complex
// for limited benefit at "hundreds/thousands of chats per user" scale.
// Returns has_more/next_offset via the standard limit+1 trick instead of
// a separate COUNT query.
// ──────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { type, mode, limit = CHAT_LIST_PAGE_SIZE, offset = 0, search } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const limitNum    = Math.min(parseInt(limit) || CHAT_LIST_PAGE_SIZE, 100);
  const offsetNum   = Math.max(parseInt(offset) || 0, 0);

  log('LIST_CHATS', { userId, workspaceId, type, mode, limit: limitNum, offset: offsetNum, search });

  let query = supabaseAdmin
    .from('chats')
    .select(`
      id, title, chat_type, chat_mode, opportunity_id, prospect_id, event_id, growth_card_id,
      created_at, updated_at, last_message_at, message_count, is_archived
    `)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('seq', { ascending: false })
    // Fetch one extra row so we know whether there's a next page without
    // a separate COUNT(*) query.
    .range(offsetNum, offsetNum + limitNum);

  if (type) query = query.eq('chat_type', type);
  if (mode) query = query.eq('chat_mode', mode);

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().slice(0, 200).replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike('title', `%${escaped}%`);
  }

  const { data: rows, error } = await query;
  if (error) {
    logError('LIST_CHATS', error, { userId });
    throw error;
  }

  const hasMore   = (rows || []).length > limitNum;
  const chats     = (rows || []).slice(0, limitNum);
  const nextOffset = hasMore ? offsetNum + limitNum : null;

  log('LIST_CHATS_OK', { userId, count: chats.length, hasMore });
  res.json({ chats, has_more: hasMore, next_offset: nextOffset });
}));

// ──────────────────────────────────────────
// POST /api/chat
// ──────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const {
    title, chat_type = CHAT_TYPES.GENERAL, chat_mode = CHAT_MODES.GENERAL,
    opportunity_id, initial_context, prospect_id, event_id, growth_card_id,
  } = req.body;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('CREATE_CHAT', { userId, workspaceId, chat_type, chat_mode, opportunity_id, event_id, growth_card_id });

  if (!Object.values(CHAT_TYPES).includes(chat_type)) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `chat_type must be one of: ${Object.values(CHAT_TYPES).join(', ')}`,
    });
  }
  // FIX §5.7: chat_mode is now validated the same way chat_type already was.
  if (chat_mode && !CHAT_MODE_VALUES.includes(chat_mode)) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: `chat_mode must be one of: ${CHAT_MODE_VALUES.join(', ')}`,
    });
  }

  const growthCard = await fetchGrowthCard(growth_card_id, userId, workspaceId);
  if (growth_card_id && !growthCard) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Growth card not found' });
  }

  let chatTitle = title;
  if (!chatTitle) {
    if (growthCard) {
      chatTitle = `Growth: ${growthCard.title}`.slice(0, 100);
    } else if (opportunity_id) {
      const { data: opp } = await supabaseAdmin
        .from('opportunities')
        .select('target_name, target_context, platform')
        .eq('id', opportunity_id)
        .eq('workspace_id', workspaceId)
        .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
        .single();
      chatTitle = opp ? `Outreach: ${opp.target_name || opp.platform}` : 'New conversation';
    } else {
      chatTitle = 'New conversation';
    }
  }

  logDB('INSERT', 'chats', { userId, workspaceId, chat_type, chat_mode });
  const { data: chat, error } = await supabaseAdmin
    .from('chats')
    .insert({
      user_id:        userId,
      workspace_id:   workspaceId,
      title:          chatTitle,
      chat_type,
      chat_mode:      chat_mode || CHAT_MODES.GENERAL,
      opportunity_id: opportunity_id || null,
      prospect_id:    prospect_id    || null,
      event_id:       event_id       || null,
      growth_card_id: growth_card_id || null,
    })
    .select()
    .single();

  if (error) {
    logError('CREATE_CHAT_INSERT', error, { userId });
    throw error;
  }

  if (growthCard) {
    logDB('INSERT', 'chat_messages', { chatId: chat.id, role: 'system', source: 'growth_card_context' });
    await supabaseAdmin.from('chat_messages').insert({
      chat_id:      chat.id,
      user_id:      userId,
      workspace_id: workspaceId,
      role:         'system',
      content:      buildGrowthCardSystemMessage(growthCard),
    });
  }

  if (opportunity_id) {
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('target_context, prepared_message, platform, source_url')
      .eq('id', opportunity_id)
      .eq('workspace_id', workspaceId)
      .single();

    if (opp) {
      logDB('INSERT', 'chat_messages', { chatId: chat.id, role: 'system', source: 'opportunity_context' });
      await supabaseAdmin.from('chat_messages').insert({
        chat_id:      chat.id,
        user_id:      userId,
        workspace_id: workspaceId,
        role:         'system',
        content:      `Context: You're helping with outreach for someone on ${opp.platform}.\n\nTheir situation: ${opp.target_context}\n\nDraft message: ${opp.prepared_message}`,
      });
    }
  }

  if (initial_context && typeof initial_context === 'string') {
    logDB('INSERT', 'chat_messages', { chatId: chat.id, role: 'system', source: 'initial_context' });
    await supabaseAdmin.from('chat_messages').insert({
      chat_id:      chat.id,
      user_id:      userId,
      workspace_id: workspaceId,
      role:         'system',
      content:      initial_context.slice(0, 4000),
    });
  }

  log('CREATE_CHAT_OK', { userId, workspaceId, chatId: chat.id, chat_type, chat_mode });
  res.status(201).json({ chat });
}));

// ──────────────────────────────────────────
// GET /api/chat/:chatId
// FIX §4.1 (CRITICAL): keyset pagination via the `seq` column. Returns the
// LATEST `limit` messages by default (not the oldest), in chronological
// order for display, plus has_more/oldest_seq so the client can page
// further back with ?before_seq=<oldest_seq>.
// ──────────────────────────────────────────
router.get('/:chatId', asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { limit = CHAT_MESSAGES_PAGE_SIZE, before_seq } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const limitNum    = Math.min(parseInt(limit) || CHAT_MESSAGES_PAGE_SIZE, 100);

  log('GET_CHAT', { userId, workspaceId, chatId, limit: limitNum, before_seq });

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (chatError || !chat) {
    log('GET_CHAT_NOT_FOUND', { userId, chatId });
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  let msgQuery = supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('seq', { ascending: false })
    .limit(limitNum + 1);

  if (before_seq) msgQuery = msgQuery.lt('seq', parseInt(before_seq));

  const { data: messagesDesc, error: msgError } = await msgQuery;
  if (msgError) {
    logError('GET_CHAT_MESSAGES', msgError, { chatId });
    throw msgError;
  }

  const rows       = messagesDesc || [];
  const hasMore    = rows.length > limitNum;
  const page       = rows.slice(0, limitNum).reverse(); // chronological for display
  const oldestSeq  = page.length ? page[0].seq : null;

  let linkedEvent = null;
  if (chat.event_id && chat.chat_mode === CHAT_MODES.MEETING_NOTES) {
    const { data: ev } = await supabaseAdmin
      .from('user_events')
      .select('id, title, event_type, attendee_name, start_time, event_date, debrief_completed_at')
      .eq('id', chat.event_id)
      .single();
    linkedEvent = ev;
  }

  log('GET_CHAT_OK', { userId, chatId, messageCount: page.length, hasMore });
  res.json({
    chat,
    messages:    page,
    linked_event: linkedEvent,
    has_more:    hasMore,
    oldest_seq:  oldestSeq,
  });
}));

// ──────────────────────────────────────────
// PATCH /api/chat/:chatId — rename
// ──────────────────────────────────────────
const chatRenameSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title cannot exceed 200 characters'),
});

router.patch('/:chatId', asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const parsed = chatRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: parsed.error.errors?.[0]?.message || 'Invalid request body',
    });
  }

  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!chat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });

  const { data: updated, error } = await supabaseAdmin
    .from('chats')
    .update({ title: parsed.data.title })
    .eq('id', chatId)
    .eq('workspace_id', workspaceId)
    .select(`
      id, title, chat_type, chat_mode, opportunity_id, prospect_id, event_id, growth_card_id,
      created_at, updated_at, last_message_at, message_count, is_archived
    `)
    .single();

  if (error) {
    logError('RENAME_CHAT', error, { userId, chatId });
    throw error;
  }

  log('RENAME_CHAT_OK', { userId, chatId });
  res.json({ chat: updated });
}));

// ──────────────────────────────────────────
// DELETE /api/chat/:chatId — soft delete (is_archived=true).
// Per product decision, no archived-chat browsing/restore UI is being
// built — this remains a one-way "remove from my list" action from the
// user's perspective even though the row itself is retained.
// ──────────────────────────────────────────
router.delete('/:chatId', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!chat) return res.status(404).json({ error: 'NOT_FOUND' });

  const { error } = await supabaseAdmin.from('chats').update({ is_archived: true }).eq('id', chatId).eq('workspace_id', workspaceId);
  if (error) {
    logError('ARCHIVE_CHAT', error, { userId, chatId });
    throw error;
  }
  log('ARCHIVE_CHAT', { userId, chatId });
  res.json({ success: true });
}));

// ──────────────────────────────────────────
// GET /api/chat/:chatId/search
// ──────────────────────────────────────────
router.get('/:chatId/search', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const { q, limit = 50 } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  if (!q || typeof q !== 'string' || !q.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'q is required' });
  }

  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!chat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });

  const escaped = q.trim().slice(0, 200).replace(/[%_]/g, (c) => `\\${c}`);

  const { data: messages, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, created_at, seq')
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .neq('role', 'system')
    .ilike('content', `%${escaped}%`)
    .order('seq', { ascending: true })
    .limit(Math.min(parseInt(limit) || 50, 100));

  if (error) {
    logError('SEARCH_CHAT_MESSAGES', error, { userId, chatId });
    throw error;
  }

  log('SEARCH_CHAT_MESSAGES_OK', { userId, chatId, count: messages?.length || 0 });
  res.json({ messages: messages || [], query: q });
}));

// ──────────────────────────────────────────
// GET /api/chat/:chatId/export?format=markdown
//
// NEW — a chat's output (e.g. a drafted follow-up sequence) is often the
// actual deliverable a sales user wants to take elsewhere, so this hands
// back the full transcript as Markdown. There's no PDF engine in this
// service (no puppeteer/pdfkit in the dependency graph), so `format=pdf`
// is intentionally rejected with a clear message — the client turns the
// same markdown into a PDF locally via the browser's print dialog
// instead of us maintaining a second rendering pipeline server-side. If
// server-rendered PDF ever becomes a real requirement, this is the seam
// to add it at.
// ──────────────────────────────────────────
function slugifyForFilename(title) {
  const slug = (title || 'chat')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'chat';
}

function formatExportTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return isoString || '';
  }
}

const EXPORT_ROLE_LABELS = { user: 'You', assistant: 'Clutch AI' };

function buildChatExportMarkdown(chat, messages) {
  const lines = [];
  lines.push(`# ${chat.title || 'Untitled chat'}`);
  lines.push('');
  lines.push(`_Exported ${formatExportTimestamp(new Date().toISOString())}_`);
  lines.push('');
  lines.push('---');

  for (const msg of messages) {
    const label = EXPORT_ROLE_LABELS[msg.role] || msg.role;
    lines.push('');
    lines.push(`### ${label} — ${formatExportTimestamp(msg.created_at)}`);
    lines.push('');
    lines.push((msg.content || '').trim());

    if (Array.isArray(msg.citations) && msg.citations.length) {
      lines.push('');
      lines.push('**Sources:**');
      for (const url of msg.citations) lines.push(`- ${url}`);
    }
    lines.push('');
    lines.push('---');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

router.get('/:chatId/export', LIMITERS.exportLimiter, asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { format = 'markdown' } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  if (format !== 'markdown') {
    return res.status(400).json({
      error:   'UNSUPPORTED_FORMAT',
      message: 'Server-side export only supports format=markdown. Generate a PDF client-side from the markdown via print-to-PDF.',
    });
  }

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('id, title')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (chatError || !chat) {
    log('EXPORT_CHAT_NOT_FOUND', { userId, chatId });
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  const { data: messages, error: msgError } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content, citations, created_at, seq')
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .neq('role', 'system')
    .order('seq', { ascending: true });

  if (msgError) {
    logError('EXPORT_CHAT_MESSAGES', msgError, { userId, chatId });
    throw msgError;
  }

  const content  = buildChatExportMarkdown(chat, messages || []);
  const filename = `${slugifyForFilename(chat.title)}.md`;

  log('EXPORT_CHAT_OK', { userId, chatId, format: 'markdown', messageCount: messages?.length || 0 });
  res.json({ chat_id: chat.id, format: 'markdown', filename, content });
}));

// ──────────────────────────────────────────
// POST /api/chat/:chatId/message
// ──────────────────────────────────────────
router.post('/:chatId/message', validateChatMessage, asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { message, stream = false, attachments, force_search, chat_mode: reqChatMode } = req.body;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('SEND_MESSAGE', { userId, workspaceId, chatId, hasMessage: !!message, stream, hasAttachments: !!attachments?.length, force_search });

  if (!message?.trim() && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'message or attachments required' });
  }

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (chatError || !chat) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  const effectiveChatMode = reqChatMode || chat.chat_mode || CHAT_MODES.GENERAL;

  // ── Context gathering, batched ──────────────────────────────
  const [historyMessages, { finalSystemPrompt, userCtx }, attachmentResult] = await Promise.all([
    getHistoryMessages(chatId),
    buildSystemPromptForChat(req, chat, effectiveChatMode),
    attachments?.length
      ? (async () => {
          log('ATTACHMENTS_RECEIVED', { userId, chatId, count: attachments.length });
          try {
            const processed = await preprocessAttachmentsForGrok(attachments, userId);
            const prompt = buildGrokAttachmentPrompt(processed);
            log('ATTACHMENTS_PROCESSED', { userId, chatId, processedCount: processed?.length || 0, promptChars: prompt.length });
            return { processed, prompt };
          } catch (err) {
            logError('preprocessAttachments', err, { userId, chatId });
            return { processed: null, prompt: '' };
          }
        })()
      : Promise.resolve({ processed: null, prompt: '' }),
  ]);

  const processedAttachments = attachmentResult.processed;
  const attachmentPrompt     = attachmentResult.prompt;
  // FIX §5.8: pull real image bytes back out for vision-capable models.
  const imageParts           = extractImageParts(processedAttachments);

  const userMessageContent = [message?.trim(), attachmentPrompt].filter(Boolean).join('\n\n');

  // ── Persist the user turn + (optional) web search, together ────────
  const [insertResult, searchResult] = await Promise.all([
    supabaseAdmin
      .from('chat_messages')
      .insert({
        chat_id:      chatId,
        user_id:      userId,
        workspace_id: workspaceId,
        role:         'user',
        content:      message?.trim() || (attachments?.length ? '[attachment]' : ''),
        attachments:  attachments?.length ? attachments : [],
        attachment_context: processedAttachments?.length ? processedAttachments : null,
      })
      .select('id')
      .single(),
    force_search
      ? (async () => {
          log('EXA_SEARCH_ATTEMPT', { userId, workspaceId, chatId, tier: userCtx.tier });
          try {
            const perplexityCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
            log('EXA_USAGE_CHECK_RESULT', { userId, workspaceId, chatId, allowed: perplexityCheck?.allowed ?? null, reason: perplexityCheck?.reason ?? null });

            if (!perplexityCheck?.allowed) {
              log('EXA_SEARCH_SKIPPED_NOT_ALLOWED', { userId, workspaceId, chatId, perplexityCheck });
              return { text: '', citations: [] };
            }

            const searchStartedAt = Date.now();
            const { content: searchText, citations } = await searchForChat(message, finalSystemPrompt, {
              workspaceId, userId, sourceJob: 'search_for_chat',
            });
            const durationMs = Date.now() - searchStartedAt;
            log('EXA_SEARCH_RESULT', { userId, workspaceId, chatId, durationMs, resultChars: searchText?.length || 0, citationCount: citations?.length || 0 });

            if (searchText?.trim()) {
              return { text: `\n\nWeb search results:\n${searchText}`, citations: citations || [] };
            }
            return { text: '', citations: [] };
          } catch (err) {
            logError('perplexitySearch', err, { userId, workspaceId, chatId, force_search });
            return { text: '', citations: [] };
          }
        })()
      : Promise.resolve({ text: '', citations: [] }),
  ]);

  if (insertResult.error) {
    logError('SEND_MESSAGE_INSERT_USER_TURN', insertResult.error, { userId, chatId });
    throw insertResult.error;
  }

  const searchContext = searchResult.text;
  // FIX §5.6/§7.1: citations captured instead of discarded.
  const citations      = searchResult.citations;

  log('SEND_MESSAGE_SEARCH_CONTEXT', { userId, chatId, force_search, searchContextChars: searchContext.length, citationCount: citations.length });

  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId }));

  const messagesForAI = [
    ...historyMessages,
    { role: 'user', content: userMessageContent + searchContext },
  ];

  if (effectiveChatMode === CHAT_MODES.MEETING_NOTES) {
    // FIX (found during audit implementation cross-check, not in the
    // original audit doc since it lacked groqCalendarIntelligence.js):
    // generateMeetingNotesResponse's real signature is
    // (noteFragment, conversationHistory, eventContext) => { content, is_end }
    // — this call site was previously passing (userCtx, chat, messagesForAI,
    // userMessageContent) and destructuring { response, event_id }, neither
    // of which the function actually produces. That meant meeting-notes
    // chats received `undefined` content (falling back to "Notes
    // captured.") and could, on an end-of-meeting phrase, literally save
    // the internal "__END_MEETING__" sentinel as visible message content.
    try {
      const linkedEvent = chat.event_id
        ? (await supabaseAdmin
            .from('user_events')
            .select('id, title, event_type, attendee_name')
            .eq('id', chat.event_id)
            .single()).data
        : null;

      const conversationHistory = historyMessages; // already fetched above, non-system, chronological

      const { content: notesReply, is_end } = await generateMeetingNotesResponse(
        userMessageContent,
        conversationHistory,
        linkedEvent || { title: chat.title },
      );

      const finalContent = is_end
        ? 'Meeting wrapped up — notes captured. You can review them anytime from this chat.'
        : (notesReply || 'Got it. Anything else to capture?');

      const { data: aiMsg } = await supabaseAdmin
        .from('chat_messages')
        .insert({
          chat_id:      chatId,
          user_id:      userId,
          workspace_id: workspaceId,
          role:         'assistant',
          content:      finalContent,
        })
        .select()
        .single();

      fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId }));
      fireAndForget(supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId));
      maybeEnqueueSummarization(chatId, workspaceId, userId).catch(() => {});

      return res.json({ message: aiMsg, event_id: chat.event_id || null, meeting_ended: !!is_end });
    } catch (err) {
      logError('meetingNotesResponse', err, { userId, chatId });
      // Fall through to general-purpose generation below rather than
      // leaving the request hanging, matching this route's existing
      // "log and continue" pattern for this branch.
    }
  }

  if (stream) {
    try {
      await streamAndSave({
        res,
        systemPrompt: finalSystemPrompt,
        messages:     messagesForAI,
        chatId,
        userId,
        workspaceId,
        supabase:     supabaseAdmin,
        streamFn:     streamWithFallback,
        tier:         userCtx.tier,
        sourceJob:    'chat_message',
        citations,
        images: imageParts.length ? imageParts : undefined,
        onSaved: () => maybeEnqueueSummarization(chatId, workspaceId, userId),
      });
    } catch (err) {
      logError('streamResponse', err, { userId, chatId });
      if (!res.headersSent) initSSE(res);
      try {
        sendSSE(res, 'error', { message: 'Stream failed' });
        endSSE(res);
      } catch (sseErr) {
        logError('streamResponse_sseCloseFailed', sseErr, { userId, chatId });
      }
    }
    return;
  }

  try {
    const { content: aiContent } = await callWithFallbackGroq({
      systemPrompt: finalSystemPrompt,
      messages:     messagesForAI,
      temperature:  0.7,
      maxTokens:    CHAT_MAX_TOKENS,
      userId,
      workspaceId,
      sourceJob:    'chat_message',
      images: imageParts.length ? imageParts : undefined,
    });

    const { data: aiMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        chat_id:      chatId,
        user_id:      userId,
        workspace_id: workspaceId,
        role:         'assistant',
        content:      aiContent || 'I encountered an error. Please try again.',
        citations:    citations.length ? citations : [],
      })
      .select()
      .single();

    fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id }));
    fireAndForget(supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId));

    log('SEND_MESSAGE_OK', { userId, chatId, messageId: aiMsg?.id });
    res.json({ message: aiMsg });

    maybeEnqueueSummarization(chatId, workspaceId, userId).catch(() => {});
  } catch (err) {
    logError('nonStreamResponse', err, { userId, chatId });
    throw err;
  }
}));

// ──────────────────────────────────────────
// POST /api/chat/:chatId/regenerate
// ──────────────────────────────────────────
router.post('/:chatId/regenerate', validateRegenerate, asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  // FIX: regenerate now supports the same `force_search` toggle as
  // POST /:chatId/message, so a regenerated reply can pull fresh Exa
  // results too (e.g. the first answer was stale/wrong because search
  // wasn't triggered originally). Since regenerate has no new message
  // text of its own, the last user turn's content is used as the query
  // — see below, after history is fetched.
  const { stream = false, force_search = false } = req.body || {};
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('REGENERATE_MESSAGE', { userId, workspaceId, chatId, stream, force_search });

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (chatError || !chat) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  const { data: recent, error: recentError } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, seq')
    .eq('chat_id', chatId)
    .order('seq', { ascending: false })
    .limit(10);

  if (recentError) {
    logError('REGENERATE_FETCH_RECENT', recentError, { userId, chatId });
    throw recentError;
  }

  const lastAssistant = (recent || []).find(m => m.role === 'assistant');
  if (!lastAssistant) {
    return res.status(400).json({ error: 'NO_ASSISTANT_MESSAGE', message: 'Nothing to regenerate yet' });
  }

  const newerThanAssistant = (recent || []).some(
    m => m.id !== lastAssistant.id && m.seq > lastAssistant.seq
  );
  if (newerThanAssistant) {
    return res.status(409).json({ error: 'STALE_STATE', message: 'A newer message already exists in this chat' });
  }

  await supabaseAdmin.from('chat_messages').delete().eq('id', lastAssistant.id).eq('workspace_id', workspaceId);

  const effectiveChatMode = chat.chat_mode || CHAT_MODES.GENERAL;
  const { finalSystemPrompt, userCtx } = await buildSystemPromptForChat(req, chat, effectiveChatMode);
  const messagesForAI = await getHistoryMessages(chatId);

  // FIX: force_search support (mirrors POST /:chatId/message). The query
  // is the last user turn already present in messagesForAI — regenerate
  // doesn't receive new message text, so there's nothing else to search
  // on. If there's no prior user turn to search from, force_search is a
  // no-op rather than an error.
  let citations = [];
  if (force_search) {
    const lastUserTurn = [...messagesForAI].reverse().find(m => m.role === 'user');
    if (lastUserTurn?.content?.trim()) {
      log('EXA_SEARCH_ATTEMPT', { userId, workspaceId, chatId, tier: userCtx.tier, sourceJob: 'chat_regenerate' });
      try {
        const exaCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
        if (!exaCheck?.allowed) {
          log('EXA_SEARCH_SKIPPED_NOT_ALLOWED', { userId, workspaceId, chatId, exaCheck });
        } else {
          const { content: searchText, citations: searchCitations } = await searchForChat(
            lastUserTurn.content, finalSystemPrompt, { workspaceId, userId, sourceJob: 'search_for_chat' },
          );
          if (searchText?.trim()) {
            messagesForAI[messagesForAI.length - 1] = {
              ...lastUserTurn,
              content: lastUserTurn.content + `\n\nWeb search results:\n${searchText}`,
            };
            citations = searchCitations || [];
          }
        }
      } catch (err) {
        logError('perplexitySearch', err, { userId, workspaceId, chatId, force_search, sourceJob: 'chat_regenerate' });
      }
    }
  }

  try {
    await generateAndSaveAssistantReply({
      res, stream, finalSystemPrompt, messagesForAI, chatId, userId, workspaceId, userCtx,
      sourceJob: 'chat_regenerate', citations,
    });
    if (!stream) log('REGENERATE_MESSAGE_OK', { userId, chatId });
  } catch (err) {
    if (!stream) {
      logError('regenerateResponse', err, { userId, chatId });
      throw err;
    }
  }
}));

// ──────────────────────────────────────────
// PATCH /api/chat/:chatId/message/:messageId
// ──────────────────────────────────────────
const editMessageSchema = z.object({
  message: z.string().trim().min(1).max(5000, 'Message cannot exceed 5000 characters'),
  stream:  z.boolean().optional(),
});

const editMessageHandler = asyncHandler(async (req, res) => {
  const { chatId, messageId } = req.params;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('EDIT_MESSAGE_START', { userId, workspaceId, chatId, messageId });

  const parsed = editMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    log('EDIT_MESSAGE_VALIDATION_FAILED', { userId, chatId, messageId, errors: parsed.error.errors });
    return res.status(400).json({
      error:   'VALIDATION_ERROR',
      message: parsed.error.errors?.[0]?.message || 'Invalid request body',
    });
  }
  const { message: newContent, stream = false } = parsed.data;

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();

  if (chatError || !chat) {
    log('EDIT_MESSAGE_CHAT_NOT_FOUND', { userId, chatId, messageId, chatError: chatError?.message });
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  const { data: target, error: targetError } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, seq')
    .eq('id', messageId)
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .single();

  if (targetError || !target) {
    log('EDIT_MESSAGE_TARGET_NOT_FOUND', { userId, chatId, messageId, targetError: targetError?.message });
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
  }
  if (target.role !== 'user') {
    log('EDIT_MESSAGE_INVALID_ROLE', { userId, chatId, messageId, role: target.role });
    return res.status(400).json({ error: 'INVALID_ROLE', message: 'Only user messages can be edited' });
  }

  const { data: lastUserMsg, error: lastUserMsgError } = await supabaseAdmin
    .from('chat_messages')
    .select('id')
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .eq('role', 'user')
    .order('seq', { ascending: false })
    .limit(1)
    .single();

  if (lastUserMsgError) {
    logError('EDIT_MESSAGE_LAST_USER_LOOKUP', lastUserMsgError, { userId, chatId, messageId });
  }

  if (!lastUserMsg || lastUserMsg.id !== target.id) {
    log('EDIT_MESSAGE_NOT_LAST_USER', { userId, chatId, messageId, targetId: target.id, lastUserMsgId: lastUserMsg?.id || null });
    return res.status(409).json({ error: 'NOT_LAST_USER_MESSAGE', message: 'Only your most recent message can be edited' });
  }

  const { error: deleteError, count: deletedCount } = await supabaseAdmin
    .from('chat_messages')
    .delete({ count: 'exact' })
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .gt('seq', target.seq);

  if (deleteError) {
    logError('EDIT_MESSAGE_TAIL_DELETE', deleteError, { userId, chatId, messageId });
    throw deleteError;
  }
  log('EDIT_MESSAGE_TAIL_DELETED', { userId, chatId, messageId, deletedCount: deletedCount ?? null });

  const { error: updateError } = await supabaseAdmin
    .from('chat_messages')
    .update({ content: newContent, attachment_context: null })
    .eq('id', target.id)
    .eq('workspace_id', workspaceId);

  if (updateError) {
    logError('EDIT_MESSAGE_UPDATE', updateError, { userId, chatId });
    throw updateError;
  }

  log('EDIT_MESSAGE_OK', { userId, chatId, messageId });

  const effectiveChatMode = chat.chat_mode || CHAT_MODES.GENERAL;
  const { finalSystemPrompt, userCtx } = await buildSystemPromptForChat(req, chat, effectiveChatMode);
  const messagesForAI = await getHistoryMessages(chatId);

  try {
    await generateAndSaveAssistantReply({
      res, stream, finalSystemPrompt, messagesForAI, chatId, userId, workspaceId, userCtx,
      sourceJob: 'chat_edit_regenerate',
    });
    if (!stream) log('EDIT_REGENERATE_OK', { userId, chatId, messageId });
  } catch (err) {
    if (!stream) {
      logError('editRegenerateResponse', err, { userId, chatId, messageId });
      throw err;
    }
  }
});

router.patch('/:chatId/message/:messageId', editMessageHandler);
router.post('/:chatId/message/:messageId', editMessageHandler);

// ──────────────────────────────────────────
// POST /api/chat/with-message
// FIX §4.2 (CRITICAL): now goes through buildSystemPromptForChat like
// every other entry point, so growth-card/opportunity context actually
// reaches the model on the very first reply — previously it was fetched
// and persisted as a display-only system row but never fed to the AI.
// ──────────────────────────────────────────
router.post('/with-message', validateChatMessage, asyncHandler(async (req, res) => {
  const {
    message,
    chat_mode = CHAT_MODES.GENERAL,
    chat_type = CHAT_TYPES.GENERAL,
    opportunity_id,
    prospect_id,
    event_id,
    title,
    force_search,
    attachments,
    growth_card_id,
  } = req.body;

  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  log('CREATE_CHAT_WITH_MESSAGE', { userId, workspaceId, chat_mode, chat_type, messageLength: message?.length, growth_card_id });

  if (!message?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'message is required' });
  }

  const growthCard = await fetchGrowthCard(growth_card_id, userId, workspaceId);
  if (growth_card_id && !growthCard) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Growth card not found' });
  }

  let chatTitle = title;
  if (!chatTitle) {
    if (growthCard) {
      chatTitle = `Growth: ${growthCard.title}`.slice(0, 100);
    } else if (opportunity_id) {
      const { data: opp } = await supabaseAdmin
        .from('opportunities')
        .select('target_name, target_context, platform')
        .eq('id', opportunity_id)
        .eq('workspace_id', workspaceId)
        .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
        .single();
      chatTitle = opp ? `Outreach: ${opp.target_name || opp.platform}` : 'New conversation';
    } else {
      chatTitle = message.slice(0, 50) + (message.length > 50 ? '...' : '');
    }
  }

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      title: chatTitle,
      chat_type,
      chat_mode,
      opportunity_id: opportunity_id || null,
      prospect_id: prospect_id || null,
      event_id: event_id || null,
      growth_card_id: growth_card_id || null,
    })
    .select()
    .single();

  if (chatError) {
    logError('CREATE_CHAT_WITH_MESSAGE_INSERT', chatError, { userId });
    throw chatError;
  }

  logDB('INSERT', 'chats', { userId, workspaceId, chatId: chat.id, chat_mode });

  if (growthCard) {
    await supabaseAdmin.from('chat_messages').insert({
      chat_id: chat.id, user_id: userId, workspace_id: workspaceId,
      role: 'system', content: buildGrowthCardSystemMessage(growthCard),
    });
  }

  if (opportunity_id) {
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('target_context, prepared_message, platform, source_url')
      .eq('id', opportunity_id)
      .eq('workspace_id', workspaceId)
      .single();

    if (opp) {
      await supabaseAdmin.from('chat_messages').insert({
        chat_id: chat.id, user_id: userId, workspace_id: workspaceId,
        role: 'system',
        content: `Context: You're helping with outreach for someone on ${opp.platform}.\n\nTheir situation: ${opp.target_context}\n\nDraft message: ${opp.prepared_message}`,
      });
    }
  }

  let attachmentPrompt = '';
  let processedAttachments = null;
  if (attachments?.length) {
    log('ATTACHMENTS_RECEIVED', { userId, count: attachments.length });
    try {
      processedAttachments = await preprocessAttachmentsForGrok(attachments, userId);
      attachmentPrompt = buildGrokAttachmentPrompt(processedAttachments);
      log('ATTACHMENTS_PROCESSED', { userId, processedCount: processedAttachments?.length || 0, promptChars: attachmentPrompt.length });
    } catch (err) {
      logError('preprocessAttachments', err, { userId });
    }
  }
  const imageParts = extractImageParts(processedAttachments);

  const userMessageContent = [message.trim(), attachmentPrompt].filter(Boolean).join('\n\n');

  const { error: userInsertError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id: chat.id, user_id: userId, workspace_id: workspaceId,
      role: 'user',
      content: message.trim() || (attachments?.length ? '[attachment]' : ''),
      attachments: attachments?.length ? attachments : [],
      attachment_context: processedAttachments?.length ? processedAttachments : null,
    });
  if (userInsertError) {
    logError('CREATE_CHAT_WITH_MESSAGE_USER_TURN', userInsertError, { userId, chatId: chat.id });
    throw userInsertError;
  }

  // FIX §4.2: shared helper now used here too — this is what actually
  // gets growth-card/opportunity context into the model's system prompt
  // on the very first reply of a new chat.
  const { finalSystemPrompt, userCtx } = await buildSystemPromptForChat(req, chat, chat_mode);

  let searchContext = '';
  let citations = [];
  if (force_search) {
    log('EXA_SEARCH_ATTEMPT', { userId, workspaceId, chatId: chat.id, tier: userCtx.tier });
    try {
      const perplexityCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
      if (!perplexityCheck?.allowed) {
        log('EXA_SEARCH_SKIPPED_NOT_ALLOWED', { userId, workspaceId, chatId: chat.id, perplexityCheck });
      } else {
        const { content: searchText, citations: searchCitations } = await searchForChat(message, finalSystemPrompt, {
          workspaceId, userId, sourceJob: 'search_for_chat',
        });
        if (searchText?.trim()) {
          searchContext = `\n\nWeb search results:\n${searchText}`;
          citations = searchCitations || [];
        }
      }
    } catch (err) {
      logError('perplexitySearch', err, { userId, workspaceId, chatId: chat.id, force_search });
    }
  }

  const messagesForAI = [
    { role: 'user', content: userMessageContent + searchContext },
  ];

  const { content: aiContent } = await callWithFallbackGroq({
    systemPrompt: finalSystemPrompt,
    messages:    messagesForAI,
    temperature: 0.7,
    maxTokens:   CHAT_MAX_TOKENS,
    userId,
    workspaceId,
    sourceJob:   'chat_with_message',
    images: imageParts.length ? imageParts : undefined,
  });

  const { data: aiMsg, error: aiInsertError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id: chat.id, user_id: userId, workspace_id: workspaceId,
      role: 'assistant',
      content: aiContent || 'I encountered an error. Please try again.',
      citations: citations.length ? citations : [],
    })
    .select()
    .single();
  if (aiInsertError) {
    logError('CREATE_CHAT_WITH_MESSAGE_AI_TURN', aiInsertError, { userId, chatId: chat.id });
    throw aiInsertError;
  }

  // FIX §4.3: single-param signature only (was p_increment:2).
  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id }));
  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id })); // two turns (user+assistant) inserted this request
  fireAndForget(supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chat.id));

  log('CREATE_CHAT_WITH_MESSAGE_OK', { userId, workspaceId, chatId: chat.id, messageId: aiMsg?.id });

  res.status(201).json({
    chat: chat,
    message: aiMsg,
  });
}));

export default router;
