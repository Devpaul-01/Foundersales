// src/routes/chat.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  HIGH-01: All chat queries and inserts now include workspace_id.
//            - GET / (list chats) filters by workspace_id
//            - POST / (create chat) inserts with workspace_id
//            - GET /:chatId fetches by workspace_id
//            - POST /:chatId/message filters by workspace_id
//            - All chat_messages inserts include workspace_id
//  HIGH-05 (read-side): user_memory read in POST /:chatId/message now
//            filters by workspace_id. The write side (memoryExtractionJob)
//            was already fixed; the read side here was missed, meaning
//            memory facts from other workspaces could surface in chat.
//  HIGH-11: Perplexity/Exa search now uses workspace-level quota
//            workspace-level quota (checkWorkspacePerplexityUsage)
//            instead of per-user quota functions.
//  LOW-07:  chatMessageSchema validates POST /:chatId/message body,
//            enforcing message max 5000 chars.
//  LOW-08:  buildChatSystemPrompt is now called unconditionally (the
//            optional-chaining guard `groqService.buildChatSystemPrompt ?`
//            has been removed now that the function exists on groqService).
//  LOGGER:  Local inline log/logError/logDB/logAI functions replaced with
//            createLogger('Chat') from utils/logger.js for consistency.
//  MED-07:  Opportunity ownership checks include workspace_id.
//  Token tracking: handled automatically by callWithFallbackGroq.
//  NEW:     User messages now persist their `attachments` metadata (name/
//            type/url) as structured data instead of only folding it into
//            the AI prompt text. REQUIRES a migration if the column doesn't
//            already exist:
//              ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS
//                attachments jsonb DEFAULT NULL;
//  NEW (attachment context in history): `content` now stores the raw user
//            message text only. Processed attachment content (extracted
//            PDF/doc text) is stored separately in `attachment_context`, so
//            it's available as structured data for later turns instead of
//            being permanently baked into `content`. REQUIRES:
//              ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS
//                attachment_context jsonb DEFAULT NULL;
//            When history is replayed for the AI on a later turn, older
//            messages' attachments are re-included as a heavily-truncated
//            summary (attachmentProcessor.buildAttachmentHistorySummary),
//            capped by an aggregate char budget across the whole history
//            window, rather than resending full document text on every
//            subsequent message (previous behavior — silent token bloat as
//            a conversation grows). The CURRENT turn's attachments still
//            get full processed content, same as before.

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { CHAT_TYPES } from '../config/constants.js';
import { buildUserContext } from '../middleware/workspace.js';
import { createLogger } from '../utils/logger.js';

import { callWithFallbackGroq, streamWithFallback } from '../services/multiProvider.js';
import groqService from '../services/groq.js';
import { streamAndSave, initSSE, sendSSE, endSSE } from '../services/streaming.js';

import { needsChatSearch, searchForChat } from '../services/exa.js';
import {checkWorkspaceExaUsage} from '../services/tokenTracker.js';
import { preprocessAttachmentsForGrok, buildGrokAttachmentPrompt, buildAttachmentHistorySummary } from '../utils/attachmentProcessor.js';

// Aggregate char budget for attachment context pulled back in from OLDER
// messages when replaying history for the AI. This is separate from (and
// much smaller than) the per-message attachment budget in
// attachmentProcessor.js — it exists so that a chat with many past
// attachment-bearing turns doesn't keep re-billing tokens for all of them,
// every single subsequent message, forever. Spent newest-first so the most
// recently discussed attachments get priority over ones from far earlier.
const MAX_HISTORY_ATTACHMENT_CONTEXT_CHARS = 2000;

import { generateMeetingNotesResponse } from '../services/groqCalendarIntelligence.js';
import supabaseAdmin from '../config/supabase.js';
import { z } from 'zod';

// Supabase's query builder returned by .rpc()/.from() is only a "thenable"
// (it implements .then() so `await`/Promise.all work), not a real Promise
// instance — so .catch()/.finally() aren't guaranteed to exist on it. Calling
// .catch() directly on it can throw synchronously ("...catch is not a
// function"), which for a fire-and-forget bookkeeping call turns into an
// unhandled exception that fails the whole request. Wrapping in
// Promise.resolve() guarantees a real Promise before we swallow the error.
const fireAndForget = (builder) => Promise.resolve(builder).catch(() => {});

const router = Router();

// ── Centralised logger (LOGGER FIX) ─────────────────────────
// Previously this file defined inline log/logError/logDB/logAI functions.
// All routes now use the shared createLogger utility for consistency.
const { log, logError, logDB, logAI } = createLogger('Chat');

const CHAT_MODES = {
  GENERAL:        'general',
  MEETING_NOTES:  'meeting_notes',
  PREP:           'prep',
  FOLLOWUP_COACH: 'followup_coach',
};

// ── Growth card helper ───────────────────────────────────────
// Fetches a growth card (scoped to workspace + user), builds a rich system
// message from it, and returns the card data so callers can store the id.
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

// ── Shared helpers for AI turns (message / regenerate / edit) ─
// Factored out so regenerate + edit-and-regenerate don't have to duplicate
// the system-prompt assembly and history-replay logic that already lived
// inline in POST /:chatId/message.

async function buildSystemPromptForChat(req, chat, effectiveChatMode) {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const userCtx     = buildUserContext(req);

  // These four lookups are all independent — none of them depends on the
  // result of another — but were previously awaited one after another,
  // costing 3-4 sequential DB round-trips before the model call could even
  // start. Running them together turns that into one round-trip's worth
  // of wall-clock time.
  const [memFactsResult, goalsResult, checkInResult, growthCard] = await Promise.all([
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

  const finalSystemPrompt = growthCard
    ? buildGrowthCardSystemMessage(growthCard) + '\n\n' + systemPrompt
    : systemPrompt;

  return { finalSystemPrompt, userCtx };
}

// Replays the last N turns of a chat into the shape the model expects,
// folding in condensed attachment context the same way /:chatId/message
// does. Pass `excludeMessageId` to drop a specific row (e.g. a stale
// assistant reply that's about to be regenerated) before it's re-sent.
async function getHistoryMessages(chatId, { excludeMessageId, limit = 8 } = {}) {
  const { data: history } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, attachment_context')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);

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
// reply, handling both the streaming and non-streaming response shapes.
// Used by regenerate and edit-and-regenerate, which (unlike the main send
// endpoint) never need to insert a *new* user message — the history they
// pass in already ends with the user turn to respond to.
async function generateAndSaveAssistantReply({
  res, stream, finalSystemPrompt, messagesForAI, chatId, userId, workspaceId, userCtx, sourceJob,
}) {
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
      });
    } catch (err) {
      logError(sourceJob, err, { userId, chatId });
      if (!res.headersSent) initSSE(res);
      try {
        sendSSE(res, 'error', { message: 'Stream failed' });
        endSSE(res);
      } catch { /* response already closed */ }
    }
    return;
  }

  const { content: aiContent } = await callWithFallbackGroq({
    systemPrompt: finalSystemPrompt,
    messages:     messagesForAI,
    temperature:  0.7,
    maxTokens:    800,
    userId,
    workspaceId,
    sourceJob,
  });

  const { data: aiMsg, error: insertError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id:      chatId,
      user_id:      userId,
      workspace_id: workspaceId,
      role:         'assistant',
      content:      aiContent || 'I encountered an error. Please try again.',
    })
    .select()
    .single();

  if (insertError) { logError(sourceJob, insertError, { userId, chatId }); throw insertError; }

  // Bookkeeping — not something the client needs to wait on before it gets
  // its reply back.
  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId, p_increment: 1 }));
  supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId)
    .then(({ error }) => { if (error) logError(sourceJob, error, { userId, chatId, step: 'update_last_message_at' }); });

  res.json({ message: aiMsg });
}

// ── FIX LOW-07: Input validation schema for message endpoint ─
const chatMessageSchema = z.object({
  message: z.string().min(1).max(5000, 'Message cannot exceed 5000 characters'),
  stream: z.boolean().optional(),
  force_search: z.boolean().optional(),
  attachments: z.array(z.object({
    name: z.string().max(255),
    type: z.string().max(100),
    url:  z.string().url().optional(),
  })).max(10).optional(),
  chat_mode: z.string().optional(),
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

// ──────────────────────────────────────────
// GET /api/chat
// FIX HIGH-01: added workspace_id filter
// ──────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { type, mode, limit = 20, offset = 0, search } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  log('LIST_CHATS', { userId, workspaceId, type, mode, limit, offset, search });

  let query = supabaseAdmin
    .from('chats')
    .select(`
      id, title, chat_type, chat_mode, opportunity_id, prospect_id, event_id, growth_card_id,
      created_at, updated_at, last_message_at, message_count, is_archived
    `)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)   // FIX HIGH-01
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (type) query = query.eq('chat_type', type);
  if (mode) query = query.eq('chat_mode', mode);

  // NEW: search chats by title. Escape ILIKE wildcards (% and _) so user
  // input can't accidentally (or deliberately) turn into a broader pattern
  // match than intended, and cap length defensively.
  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().slice(0, 200).replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike('title', `%${escaped}%`);
  }

  const { data: chats, error } = await query;
  if (error) {
    logError('LIST_CHATS', error, { userId });
    throw error;
  }

  log('LIST_CHATS_OK', { userId, count: chats?.length || 0 });
  res.json({ chats: chats || [] });
}));

// ──────────────────────────────────────────
// POST /api/chat
// FIX HIGH-01: chats insert includes workspace_id
// FIX MED-07:  opportunity ownership check includes workspace_id
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

  // Fetch growth card early so we can use its title if needed
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
        .eq('workspace_id', workspaceId)   // FIX MED-07
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
      workspace_id:   workspaceId,   // FIX HIGH-01
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

  // Inject growth card context as system message
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

  // Inject opportunity context as system message
  if (opportunity_id) {
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('target_context, prepared_message, platform, source_url')
      .eq('id', opportunity_id)
      .eq('workspace_id', workspaceId)   // FIX MED-07
      .single();

    if (opp) {
      logDB('INSERT', 'chat_messages', { chatId: chat.id, role: 'system', source: 'opportunity_context' });
      await supabaseAdmin.from('chat_messages').insert({
        chat_id:      chat.id,
        user_id:      userId,
        workspace_id: workspaceId,   // FIX HIGH-01
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
      workspace_id: workspaceId,   // FIX HIGH-01
      role:         'system',
      content:      initial_context.slice(0, 4000),
    });
  }

  log('CREATE_CHAT_OK', { userId, workspaceId, chatId: chat.id, chat_type, chat_mode });
  res.status(201).json({ chat });
}));

// ──────────────────────────────────────────
// GET /api/chat/:chatId
// FIX HIGH-01: added workspace_id to chat lookup
// ──────────────────────────────────────────
router.get('/:chatId', asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { limit = 50, before } = req.query;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  log('GET_CHAT', { userId, workspaceId, chatId, limit, before });

  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)   // FIX HIGH-01
    .single();

  if (chatError || !chat) {
    log('GET_CHAT_NOT_FOUND', { userId, chatId });
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  let msgQuery = supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(parseInt(limit));

  if (before) msgQuery = msgQuery.lt('created_at', before);

  const { data: messages, error: msgError } = await msgQuery;
  if (msgError) {
    logError('GET_CHAT_MESSAGES', msgError, { chatId });
    throw msgError;
  }

  let linkedEvent = null;
  if (chat.event_id && chat.chat_mode === CHAT_MODES.MEETING_NOTES) {
    const { data: ev } = await supabaseAdmin
      .from('user_events')
      .select('id, title, event_type, attendee_name, start_time, event_date, debrief_completed_at')
      .eq('id', chat.event_id)
      .single();
    linkedEvent = ev;
  }

  log('GET_CHAT_OK', { userId, chatId, messageCount: messages?.length || 0 });
  res.json({ chat, messages: messages || [], linked_event: linkedEvent });
}));

// ──────────────────────────────────────────
// PATCH /api/chat/:chatId
// NEW: rename a chat (title only, for now).
// Ownership scoped to user_id + workspace_id like every other route here.
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
// DELETE /api/chat/:chatId
// FIX HIGH-01: added workspace_id
// Soft-delete: marks the chat archived rather than dropping rows, so it
// disappears from the list (GET / already filters is_archived=false) but
// nothing is destructively lost server-side.
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
    .eq('workspace_id', workspaceId)   // FIX HIGH-01
    .single();

  if (!chat) return res.status(404).json({ error: 'NOT_FOUND' });

  await supabaseAdmin.from('chats').update({ is_archived: true }).eq('id', chatId).eq('workspace_id', workspaceId);
  log('ARCHIVE_CHAT', { userId, chatId });
  res.json({ success: true });
}));

// ──────────────────────────────────────────
// GET /api/chat/:chatId/search
// NEW: full-text-ish search across a single chat's messages (as opposed to
// GET / which searches chat titles across the whole list). Scoped to the
// same user_id + workspace_id ownership check as every other route here.
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

  // Escape ILIKE wildcards, same defensive pattern as the chat-list search.
  const escaped = q.trim().slice(0, 200).replace(/[%_]/g, (c) => `\\${c}`);

  const { data: messages, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .neq('role', 'system')
    .ilike('content', `%${escaped}%`)
    .order('created_at', { ascending: true })
    .limit(Math.min(parseInt(limit) || 50, 100));

  if (error) {
    logError('SEARCH_CHAT_MESSAGES', error, { userId, chatId });
    throw error;
  }

  log('SEARCH_CHAT_MESSAGES_OK', { userId, chatId, count: messages?.length || 0 });
  res.json({ messages: messages || [], query: q });
}));

// ──────────────────────────────────────────
// POST /api/chat/:chatId/message
// FIX HIGH-01: chat ownership and message inserts use workspace_id
// FIX HIGH-05: user_memory read now scoped to workspace_id
// FIX HIGH-11: Perplexity quota uses workspace-level functions
// FIX LOW-07:  validateChatMessage middleware applied
// FIX LOW-08:  buildChatSystemPrompt called unconditionally
// Token tracking uses workspaceId
// ──────────────────────────────────────────
router.post('/:chatId/message', validateChatMessage, asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { message, stream = false, attachments, force_search, chat_mode: reqChatMode } = req.body;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('SEND_MESSAGE', { userId, workspaceId, chatId, hasMessage: !!message, stream, hasAttachments: !!attachments?.length });

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
  const userCtx = buildUserContext(req);

  // ── Context gathering, batched ──────────────────────────────
  // All of these reads are independent of one another — history, memory,
  // goals, check-in, growth card, and attachment preprocessing don't touch
  // anything the others produce. They used to be awaited one at a time,
  // which meant up to 6 sequential DB/processing round-trips before the
  // model call could even begin (the main source of the slow
  // time-to-first-token). Firing them together collapses that to roughly
  // one round-trip's worth of wall-clock time.
  const [
    historyResult,
    memFactsResult,
    goalsResult,
    checkInResult,
    growthCard,
    attachmentResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('chat_messages')
      .select('role, content, attachment_context')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(8),
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
    attachments?.length
      ? (async () => {
          log('ATTACHMENTS_RECEIVED', { userId, chatId, count: attachments.length, attachments });
          try {
            const processed = await preprocessAttachmentsForGrok(attachments, userId);
            const prompt = buildGrokAttachmentPrompt(processed);
            log('ATTACHMENTS_PROCESSED', {
              userId, chatId,
              processedCount: processed?.length || 0,
              promptChars: prompt.length,
            });
            return { processed, prompt };
          } catch (err) {
            logError('preprocessAttachments', err, { userId });
            return { processed: null, prompt: '' };
          }
        })()
      : Promise.resolve({ processed: null, prompt: '' }),
  ]);

  // FIX: older messages' attachment content was never being re-included
  // when replaying history for the AI (only the bare `content` text was
  // selected/sent), so the model would lose track of anything attached in
  // earlier turns. We now pull it back in from `attachment_context`, but
  // condensed and under a shared budget — full per-message detail isn't
  // worth resending on every later turn. `history` is newest-first here,
  // so we spend the budget in that order (recent attachments win) before
  // reversing into chronological order for the AI payload.
  let historyAttachmentBudget = MAX_HISTORY_ATTACHMENT_CONTEXT_CHARS;
  const historyMessages = (historyResult.data || [])
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

  let memoryContext = '';
  if (memFactsResult.data?.length) {
    memoryContext = `\nContext about this user:\n${memFactsResult.data.map(f => `- ${f.fact}`).join('\n')}`;
  }

  const systemPrompt = groqService.buildChatSystemPrompt(userCtx, effectiveChatMode, {
    memoryContext,
    goals: goalsResult.data || [],
    latestMood: checkInResult.data?.mood_score || null,
  });

  // If this chat is linked to a growth card, prepend card context to the system prompt
  let finalSystemPrompt = systemPrompt;
  if (growthCard) {
    finalSystemPrompt = buildGrowthCardSystemMessage(growthCard) + '\n\n' + systemPrompt;
    log('GROWTH_CARD_CONTEXT_INJECTED', { chatId, cardId: growthCard.id });
  }

  const processedAttachments = attachmentResult.processed;
  const attachmentPrompt     = attachmentResult.prompt;

  // `userMessageContent` is what gets sent to the AI for THIS turn — full
  // message text plus the fully-processed (but budget-capped, see
  // attachmentProcessor.js) attachment text. This is intentionally kept
  // separate from what we persist to `content` below: full attachment text
  // is only worth paying tokens for on the turn it's actually discussed.
  const userMessageContent = [message?.trim(), attachmentPrompt].filter(Boolean).join('\n\n');

  // ── Persist the user turn + (optional) web search, together ────────
  // Neither depends on the other's result, so run them side by side rather
  // than paying for the search round-trip before the insert even starts.
  const [, searchContext] = await Promise.all([
    supabaseAdmin
      .from('chat_messages')
      .insert({
        chat_id:      chatId,
        user_id:      userId,
        workspace_id: workspaceId,
        role:         'user',
        // `content` now stores the raw message text only (no attachment text
        // baked in) — keeps the DB row lean and stops history replay from
        // silently accumulating attachment text turn after turn.
        content:      message?.trim() || (attachments?.length ? '[attachment]' : ''),
        // Raw attachment metadata (name/type/url), for client-side previews.
        attachments:  attachments?.length ? attachments : null,
        // NEW: processed attachment content (extracted PDF/doc text, or an
        // image placeholder), stored structured so future turns can pull a
        // condensed summary back in via buildAttachmentHistorySummary instead
        // of re-reading `content`. Not stored for images since there's no
        // text payload worth persisting there.
        attachment_context: processedAttachments?.length ? processedAttachments : null,
      })
      .select('id')
      .single(),
    force_search
      ? (async () => {
          try {
            const perplexityCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
            if (perplexityCheck.allowed) {
              const { content: searchResult } = await searchForChat(message, finalSystemPrompt, {
                workspaceId, userId, sourceJob: 'search_for_chat',
              });
              if (searchResult?.trim()) {
                return `\n\nWeb search results:\n${searchResult}`;
              }
            }
            return '';
          } catch (err) {
            logError('perplexitySearch', err, { userId });
            return '';
          }
        })()
      : Promise.resolve(''),
  ]);

  // Bookkeeping only — not on the critical path to the model call, so this
  // is fired without blocking the response on it (still logged/ignored the
  // same way a failure here was already treated before).
  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId, p_increment: 1 }));

  const messagesForAI = [
    ...historyMessages,
    { role: 'user', content: userMessageContent + searchContext },
  ];

  if (effectiveChatMode === CHAT_MODES.MEETING_NOTES) {
    try {
      const { response, event_id } = await generateMeetingNotesResponse(
        userCtx, chat, messagesForAI, userMessageContent
      );

      const { data: aiMsg } = await supabaseAdmin
        .from('chat_messages')
        .insert({
          chat_id:      chatId,
          user_id:      userId,
          workspace_id: workspaceId,
          role:         'assistant',
          content:      response || 'Notes captured.',
        })
        .select()
        .single();

      fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chatId, p_increment: 1 }));
      supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId)
        .then(({ error }) => { if (error) logError('meetingNotesResponse', error, { userId, chatId, step: 'update_last_message_at' }); });

      return res.json({ message: aiMsg, event_id });
    } catch (err) {
      logError('meetingNotesResponse', err, { userId, chatId });
    }
  }

  if (stream) {
    // NOTE: streamAndSave is a complete handler — it calls initSSE itself,
    // inserts the placeholder assistant message, updates it on completion,
    // increments chat stats, records token usage, sends its own SSE events
    // (message_id / token / complete / error), and ends the response. We
    // must NOT duplicate any of that here — we just pass it what it needs.
    try {
      await streamAndSave({
        res,
        systemPrompt: finalSystemPrompt,
        messages:     messagesForAI,
        chatId,
        userId,
        workspaceId,
        supabase:     supabaseAdmin,
        streamFn:     streamWithFallback,   // enable multi-model fallback, matching non-stream path
        tier:         userCtx.tier,
        sourceJob:    'chat_message',       // matches sourceJob used by the non-stream path below
      });
    } catch (err) {
      logError('streamResponse', err, { userId, chatId });
      // Defensive fallback only — streamAndSave already handles its own
      // error SSE event/close in the normal failure paths.
      if (!res.headersSent) initSSE(res);
      try {
        sendSSE(res, 'error', { message: 'Stream failed' });
        endSSE(res);
      } catch { /* response already closed */ }
    }
    return;
  }

  try {
    const { content: aiContent } = await callWithFallbackGroq({
      systemPrompt: finalSystemPrompt,
      messages:     messagesForAI,
      temperature:  0.7,
      maxTokens:    800,
      userId,
      workspaceId,
      sourceJob:    'chat_message',
    });

    const { data: aiMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        chat_id:      chatId,
        user_id:      userId,
        workspace_id: workspaceId,
        role:         'assistant',
        content:      aiContent || 'I encountered an error. Please try again.',
      })
      .select()
      .single();

    fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id, p_increment: 1 }));
    supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chatId)
      .then(({ error }) => { if (error) logError('nonStreamResponse', error, { userId, chatId, step: 'update_last_message_at' }); });

    log('SEND_MESSAGE_OK', { userId, chatId, messageId: aiMsg?.id });
    res.json({ message: aiMsg });
  } catch (err) {
    logError('nonStreamResponse', err, { userId, chatId });
    throw err;
  }
}));

// ──────────────────────────────────────────
// POST /api/chat/:chatId/regenerate
// NEW: Regenerates the most recent assistant reply. Deletes the stale
// assistant message and re-runs the model against the same history (the
// last user turn, replayed as-is) — nothing new is inserted on the user
// side. Supports streaming, matching /:chatId/message.
// ──────────────────────────────────────────
router.post('/:chatId/regenerate', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const { stream = false } = req.body || {};
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  log('REGENERATE_MESSAGE', { userId, workspaceId, chatId, stream });

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
    .select('id, role, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (recentError) {
    logError('REGENERATE_FETCH_RECENT', recentError, { userId, chatId });
    throw recentError;
  }

  const lastAssistant = (recent || []).find(m => m.role === 'assistant');
  if (!lastAssistant) {
    return res.status(400).json({ error: 'NO_ASSISTANT_MESSAGE', message: 'Nothing to regenerate yet' });
  }

  // Guard against regenerating a reply that isn't actually the latest turn
  // (e.g. a stale client retrying against a chat that's moved on).
  const newerThanAssistant = (recent || []).some(
    m => m.id !== lastAssistant.id && new Date(m.created_at) > new Date(lastAssistant.created_at)
  );
  if (newerThanAssistant) {
    return res.status(409).json({ error: 'STALE_STATE', message: 'A newer message already exists in this chat' });
  }

  await supabaseAdmin.from('chat_messages').delete().eq('id', lastAssistant.id).eq('workspace_id', workspaceId);

  const effectiveChatMode = chat.chat_mode || CHAT_MODES.GENERAL;
  const { finalSystemPrompt, userCtx } = await buildSystemPromptForChat(req, chat, effectiveChatMode);
  const messagesForAI = await getHistoryMessages(chatId);

  try {
    await generateAndSaveAssistantReply({
      res, stream, finalSystemPrompt, messagesForAI, chatId, userId, workspaceId, userCtx,
      sourceJob: 'chat_regenerate',
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
// NEW: Edits a user message and regenerates the response that followed it.
// Restricted to the single most recent message in the chat, so the edit
// flow stays linear (rewrite the tail of the conversation) rather than
// branching mid-history. Anything after the edited message — typically just
// its old assistant reply — is discarded before the model is re-run.
// ──────────────────────────────────────────
const editMessageSchema = z.object({
  message: z.string().trim().min(1).max(5000, 'Message cannot exceed 5000 characters'),
  stream:  z.boolean().optional(),
});

router.patch('/:chatId/message/:messageId', asyncHandler(async (req, res) => {
  const { chatId, messageId } = req.params;
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const parsed = editMessageSchema.safeParse(req.body);
  if (!parsed.success) {
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
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Chat not found' });
  }

  const { data: target, error: targetError } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, created_at')
    .eq('id', messageId)
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .single();

  if (targetError || !target) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
  }
  if (target.role !== 'user') {
    return res.status(400).json({ error: 'INVALID_ROLE', message: 'Only user messages can be edited' });
  }

  const { data: lastMsg } = await supabaseAdmin
    .from('chat_messages')
    .select('id')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastMsg || lastMsg.id !== target.id) {
    // The common case here is the target being a user message that already
    // has an assistant reply after it (the reply is now the "last" message)
    // — editing would silently discard that reply, so we require the
    // client to only offer editing on the actual last message in the chat.
    return res.status(409).json({ error: 'NOT_LAST_MESSAGE', message: 'Only the most recent message can be edited' });
  }

  // Drop anything after the edited message (its old reply, if any) — the
  // edit rewrites the tail of the conversation from this point forward.
  await supabaseAdmin
    .from('chat_messages')
    .delete()
    .eq('chat_id', chatId)
    .eq('workspace_id', workspaceId)
    .gt('created_at', target.created_at);

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
    if (!stream) log('EDIT_REGENERATE_OK', { userId, chatId });
  } catch (err) {
    if (!stream) {
      logError('editRegenerateResponse', err, { userId, chatId });
      throw err;
    }
  }
}));

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

  // Fetch growth card early for title + context injection
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
      chat_type: chat_type,
      chat_mode: chat_mode,
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

  // Inject growth card context as system message
  if (growthCard) {
    await supabaseAdmin.from('chat_messages').insert({
      chat_id: chat.id,
      user_id: userId,
      workspace_id: workspaceId,
      role: 'system',
      content: buildGrowthCardSystemMessage(growthCard),
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
        chat_id: chat.id,
        user_id: userId,
        workspace_id: workspaceId,
        role: 'system',
        content: `Context: You're helping with outreach for someone on ${opp.platform}.\n\nTheir situation: ${opp.target_context}\n\nDraft message: ${opp.prepared_message}`,
      });
    }
  }
  
  let attachmentPrompt = '';
  let processedAttachments = null;
  if (attachments?.length) {
    log('ATTACHMENTS_RECEIVED', { userId, count: attachments.length, attachments });
    try {
      const { preprocessAttachmentsForGrok, buildGrokAttachmentPrompt } = await import('../utils/attachmentProcessor.js');
      processedAttachments = await preprocessAttachmentsForGrok(attachments, userId);
      attachmentPrompt = buildGrokAttachmentPrompt(processedAttachments);
      log('ATTACHMENTS_PROCESSED', {
        userId,
        processedCount: processedAttachments?.length || 0,
        promptChars: attachmentPrompt.length,
      });
    } catch (err) {
      logError('preprocessAttachments', err, { userId });
    }
  }
  
  // Full text (message + fully-processed attachment content) is what goes
  // to the AI for this turn. `content` persisted below stays clean/raw so
  // this doesn't get permanently baked in and re-billed every later turn
  // (see matching fix in /:chatId/message).
  const userMessageContent = [message.trim(), attachmentPrompt].filter(Boolean).join('\n\n');
  
  await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id: chat.id,
      user_id: userId,
      workspace_id: workspaceId,
      role: 'user',
      content: message.trim() || (attachments?.length ? '[attachment]' : ''),
      // Raw attachment metadata (see matching fix in /:chatId/message)
      attachments: attachments?.length ? attachments : null,
      // Structured processed attachment content, for condensed reuse if
      // this chat continues via /:chatId/message later.
      attachment_context: processedAttachments?.length ? processedAttachments : null,
    })
    .select('id')
    .single();
  
  const userCtx = buildUserContext(req);

  // Independent lookups, run together (see the matching fix in
  // POST /:chatId/message for why this was sequential before and what that
  // was costing).
  const [memFactsResult, goalsResult, checkInResult] = await Promise.all([
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
  ]);

  let memoryContext = '';
  if (memFactsResult.data?.length) {
    memoryContext = `\nContext about this user:\n${memFactsResult.data.map(f => `- ${f.fact}`).join('\n')}`;
  }

  const systemPrompt = groqService.buildChatSystemPrompt(userCtx, chat_mode, {
    memoryContext,
    goals: goalsResult.data || [],
    latestMood: checkInResult.data?.mood_score || null,
  });
  
  let searchContext = '';
  if (force_search) {
    try {
      const {searchForChat } = await import('../services/exa.js');
      const {checkWorkspaceExaUsage } = await import('../services/tokenTracker.js');

      
      const perplexityCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
      if (perplexityCheck.allowed) {
        const { content: searchResult } = await searchForChat(message, systemPrompt, {
          workspaceId, userId, sourceJob: 'search_for_chat',
        });
        if (searchResult?.trim()) {
          searchContext = `\n\nWeb search results:\n${searchResult}`;
        }
      }
    } catch (err) {
      logError('perplexitySearch', err, { userId });
    }
  }
  
  const messagesForAI = [
    { role: 'user', content: userMessageContent + searchContext },
  ];
  
  const { content: aiContent } = await callWithFallbackGroq({
    systemPrompt,
    messages:    messagesForAI,
    temperature: 0.7,
    maxTokens:   800,
    userId,
    workspaceId,
    sourceJob:   'chat_with_message',
  });
  
  const { data: aiMsg } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      chat_id: chat.id,
      user_id: userId,
      workspace_id: workspaceId,
      role: 'assistant',
      content: aiContent || 'I encountered an error. Please try again.',
    })
    .select()
    .single();

  // Bookkeeping — fired without blocking the client's response on it.
  fireAndForget(supabaseAdmin.rpc('increment_chat_stats', { p_chat_id: chat.id, p_increment: 2 }));
  supabaseAdmin.from('chats').update({ last_message_at: new Date().toISOString() }).eq('id', chat.id)
    .then(({ error }) => { if (error) logError('CREATE_CHAT_WITH_MESSAGE', error, { userId, chatId: chat.id, step: 'update_last_message_at' }); });
  
  log('CREATE_CHAT_WITH_MESSAGE_OK', { userId, workspaceId, chatId: chat.id, messageId: aiMsg?.id });
  
  res.status(201).json({
    chat: chat,
    message: aiMsg,
  });
}));
export default router;
