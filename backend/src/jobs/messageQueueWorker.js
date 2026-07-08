// src/jobs/messageQueueWorker.js
// ============================================================
// FIXES APPLIED (refinement plan):
//  Issue 12: handlePlaybook notifyUser call updated to include
//            chat_id and redirect_url in the data payload.
//            Previously only session_id was passed — the frontend
//            could not open the chat directly on tap.
//  Issue 13: handleReply chat_messages inserts now include workspace_id.
//            session.workspace_id is extracted after the session fetch
//            and added to every chat_messages row — consistent with all
//            other insert sites in the codebase.
// ============================================================

import supabaseAdmin    from '../config/supabase.js';
import { QUEUE_JOB_TYPES, DELIVERY_STATUS, PRACTICE_SCENARIOS } from '../config/constants.js';
import groqService      from '../services/groq.js';
import { notifyUser }   from '../services/notifications.js';
import { checkAndGenerateWeaknessCard } from './practiceWeaknessDetector.js';
import { createLogger } from '../utils/logger.js';

const { log, logError, logDB } = createLogger('Practice:Queue');

const isDebugMode = process.env.DEBUG_MODE === 'true';

const logAIRequest = (fn, payload) => {
  if (!isDebugMode) return;
  const safePayload = typeof payload === 'object'
    ? { ...payload, message: payload.message?.slice(0, 200) }
    : payload;
  console.log(`[Practice:Queue] 🤖 AI Request [${fn}] →`, JSON.stringify(safePayload, null, 2));
};

const logAIResponse = (fn, response) => {
  if (!isDebugMode) return;
  const safeResponse = typeof response === 'object' && response?.reply
    ? { ...response, reply: response.reply?.slice(0, 200) }
    : response;
  console.log(`[Practice:Queue] 🤖 AI Response [${fn}] →`, JSON.stringify(safeResponse, null, 2));
};

export const executeJob = async (job) => {
  log('Dispatching Job', { jobId: job.id, type: job.job_type });

  switch (job.job_type) {
    case QUEUE_JOB_TYPES.PRACTICE_DELIVERED:             return handleDelivered(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_SEEN:                  return handleSeen(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_REPLY:                 return handleReply(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_GHOST:                 return handleGhost(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_SKILL_SCORES:          return handleSkillScores(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_COACHING_ANNOTATIONS:  return handleCoachingAnnotations(job.payload, job.id);
    case QUEUE_JOB_TYPES.PRACTICE_PLAYBOOK:              return handlePlaybook(job.payload, job.id);
    default:
      logError('executeJob', new Error(`Unknown job type: ${job.job_type}`), { jobId: job.id });
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
};

// ──────────────────────────────────────────
// DELIVERED
// ──────────────────────────────────────────
const handleDelivered = async ({ message_id }, jobId) => {
  log('Delivered Handler Start', { jobId, messageId: message_id });

  logDB('UPDATE', 'chat_messages', { messageId: message_id, delivery_status: 'delivered' });
  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.DELIVERED, delivered_at: new Date().toISOString() })
    .eq('id', message_id);

  log('Message Marked Delivered', { jobId, messageId: message_id });
};

// ──────────────────────────────────────────
// SEEN
// ──────────────────────────────────────────
const handleSeen = async ({ message_id }, jobId) => {
  log('Seen Handler Start', { jobId, messageId: message_id });

  logDB('UPDATE', 'chat_messages', { messageId: message_id, delivery_status: 'seen' });
  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.SEEN, seen_at: new Date().toISOString() })
    .eq('id', message_id);

  log('Message Marked Seen (Frontend Should Show Typing Indicator)', { jobId, messageId: message_id });
};

// ──────────────────────────────────────────
// REPLY — Full V2
// NOTE: This handler remains for legacy support but the PRACTICE_REPLY job is
// no longer enqueued by the message route (Issue 1 fix). The route uses
// V3 inline reply as the single source of truth. This handler would only
// fire if a PRACTICE_REPLY job somehow exists from before the fix.
// ──────────────────────────────────────────
const handleReply = async ({
  session_id, chat_id, user_message_id, user_id, scenario_type,
  user_message_content, attachment_context = '', difficulty = 'standard',
  buyer_profile: bpRaw, buyer_state: bsRaw, session_goal = '', pressure_modifier = null,
}, jobId) => {
  log('Reply Handler Start', {
    jobId, sessionId: session_id, chatId: chat_id,
    userMessageId: user_message_id, userId: user_id, scenarioType: scenario_type,
    difficulty, pressureModifier: pressure_modifier || 'none',
    hasAttachmentContext: !!attachment_context, messagePreview: user_message_content?.slice(0, 80),
  });

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Reply Aborted — Session or User Not Found', { jobId, sessionId: session_id, userId: user_id });
    return;
  }
  if (session.completed) {
    log('Reply Aborted — Session Already Completed', { jobId, sessionId: session_id });
    return;
  }

  // Issue 13: extract workspace_id from session — add to all chat_messages inserts
  // below. Every other insert site in the codebase includes workspace_id;
  // this path was the only exception, causing un-scoped rows.
  const workspaceId = session.workspace_id || null;

  // The `user` row from `users` carries `active_workspace_id`, not
  // `workspace_id` — but groq-practice.js's usage-tracking now reads
  // `user.workspace_id` (matching the convention every other groq-*.js
  // caller already uses). Merge it in here so tracking actually fires
  // instead of silently no-op'ing on every practice reply.
  const userCtx = { ...user, workspace_id: workspaceId };

  log('Session and User Loaded', { jobId, sessionId: session_id, userId: user_id, scenarioType: session.scenario_type });

  const { data: history } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at')
    .eq('chat_id', chat_id).not('role', 'eq', 'system')
    .order('created_at', { ascending: true }).limit(50);
  const conversationHistory = history || [];

  let buyerProfile = session.buyer_profile || {};
  let buyerState   = session.buyer_state   || { interest_score: 30, trust_score: 15, confusion_score: 0 };
  try { if (typeof bpRaw === 'string') buyerProfile = JSON.parse(bpRaw); } catch {}
  try { if (typeof bsRaw === 'string') buyerState   = JSON.parse(bsRaw); } catch {}

  const fullContent = attachment_context
    ? `${user_message_content}\n${attachment_context}`
    : user_message_content;

  logAIRequest('generatePracticeProspectReplyV2', {
    userId: user_id, sessionId: session_id, message: user_message_content,
    scenarioType: scenario_type, difficulty, pressureModifier: pressure_modifier,
    buyerState: { interest: buyerState.interest_score, trust: buyerState.trust_score },
    historyLength: conversationHistory.length,
  });

  const bundle = await groqService.generatePracticeProspectReplyV2(
    userCtx, fullContent,
    { ...session, buyer_profile: buyerProfile, buyer_state: buyerState, difficulty_level: difficulty, pressure_modifier },
    conversationHistory, {}
  );

  logAIResponse('generatePracticeProspectReplyV2', {
    reply_length: bundle?.reply?.length, reply_preview: bundle?.reply?.slice(0, 100),
    needs_search: bundle?.needs_search,
    state_delta: bundle?.state_delta,
    has_coaching_tip: !!bundle?.coaching_tip,
  });

  let replyText     = bundle?.reply || null;
  const stateDelta  = bundle?.state_delta  || { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: '' };
  const coachingTip = bundle?.coaching_tip || null;

  if (bundle?.needs_search && replyText && process.env.EXA_API_KEY) {
    log('Real-Time Search Triggered (Exa)', { jobId, sessionId: session_id });
    try {
      const { searchForChat } = await import('../services/exa.js');
      const { checkWorkspaceExaUsage } = await import('../services/tokenTracker.js');
      const usage = await checkWorkspaceExaUsage(workspaceId, user.tier || 'free');
      if (usage.allowed) {
        const { content: perpContent } = await searchForChat(
          user_message_content.slice(0, 120),
          'Answer in 2-3 sentences for realistic conversation context.',
          { workspaceId, userId: user_id, sourceJob: 'practice_reply_search' }
        );
        const enrichedContent = fullContent + `\n[Context: ${perpContent.slice(0, 350)}]`;
        const enriched = await groqService.generatePracticeProspectReplyV2(
          userCtx, enrichedContent,
          { ...session, buyer_profile: buyerProfile, buyer_state: buyerState, difficulty_level: difficulty, pressure_modifier },
          conversationHistory, {}
        );
        if (enriched?.reply) replyText = enriched.reply;
      }
    } catch (err) {
      logError('handleReply → exaSearch', err, { jobId, sessionId: session_id });
    }
  }

  if (!replyText) {
    log('Reply Aborted — No Reply Text Generated; inserting fallback', { jobId, sessionId: session_id });
    await supabaseAdmin.from('chat_messages').insert({
      // Issue 13: workspace_id added
      workspace_id:    workspaceId,
      chat_id, user_id, role: 'assistant',
      content:         "Thanks for the message — let me think on that and get back to you.",
      delivery_status: DELIVERY_STATUS.REPLIED,
      replied_at:      new Date().toISOString(),
      scenario_type,
      coaching_tip: {
        what_worked: 'N/A',
        what_didnt:  'Clutch was unable to generate a response for this message.',
        improvement: 'Try rephrasing or sending a clearer, shorter message.',
      },
      model_used: 'groq_fallback',
    }).catch(err => logError('handleReply → fallback_message_insert', err, { sessionId: session_id }));
    return;
  }

  const clamp    = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const newState = {
    interest_score:  clamp((buyerState.interest_score  || 30) + (stateDelta.interest_delta  || 0), 0, 100),
    trust_score:     clamp((buyerState.trust_score     || 15) + (stateDelta.trust_delta     || 0), 0, 100),
    confusion_score: clamp((buyerState.confusion_score ||  0) + (stateDelta.confusion_delta || 0), 0, 100),
    last_reasoning:  stateDelta.reasoning || '',
  };

  const now       = new Date();
  const stateHist = [...(session.buyer_state_history || []), {
    ...newState, message_id: user_message_id, message_index: conversationHistory.length,
    prev_interest: buyerState.interest_score,
  }];

  const chunks = groqService.splitIntoChunks(replyText);
  log('Reply Chunked', { jobId, sessionId: session_id, chunkCount: chunks.length });

  const insertedIds = [];
  for (let i = 0; i < chunks.length; i++) {
    logDB('INSERT', 'chat_messages', { chatId: chat_id, role: 'assistant', chunkIndex: i });
    const { data: chunkMsg } = await supabaseAdmin.from('chat_messages').insert({
      // Issue 13: workspace_id added to every chunk insert
      workspace_id:      workspaceId,
      chat_id, user_id, role: 'assistant',
      content:           chunks[i],
      delivery_status:   DELIVERY_STATUS.REPLIED,
      replied_at:        now.toISOString(),
      scenario_type,
      coaching_tip:      i === 0 ? coachingTip : null,
      model_used:        'groq',
      chunk_index:       i,
      parent_message_id: i > 0 ? insertedIds[0] : null,
    }).select().single();
    if (chunkMsg) {
      insertedIds.push(chunkMsg.id);
      log(`Chunk ${i + 1}/${chunks.length} Stored`, { jobId, messageId: chunkMsg.id, sessionId: session_id });
    }
  }

  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.REPLIED, replied_at: now.toISOString() })
    .eq('id', user_message_id);

  await supabaseAdmin.from('practice_sessions').update({
    buyer_state: newState, buyer_state_history: stateHist,
    exchanges_count: (session.exchanges_count || 0) + 1,
    reply_received: true,
  }).eq('id', session_id);

  await notifyUser(user_id, {
    title: 'Practice reply received 💬',
    body:  'They responded. Tap to see how it went.',
    data:  { type: 'practice_reply', chat_id, session_id },
  });

  log('Reply Handler Complete', { jobId, sessionId: session_id, chunkCount: chunks.length });
};

// ──────────────────────────────────────────
// GHOST
// Kept for legacy completeness — never enqueued from the message route
// since Issue 3 fix handles ghost inline via evaluateMessageQualityForGhost.
// ──────────────────────────────────────────
const handleGhost = async ({ session_id, chat_id, message_id, user_id, user_message_content }, jobId) => {
  log('Ghost Handler Start', { jobId, sessionId: session_id, messageId: message_id, userId: user_id });

  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('completed, workspace_id').eq('id', session_id).single();
  if (!session || session.completed) {
    log('Ghost Aborted', { jobId, sessionId: session_id });
    return;
  }
  const workspaceId = session.workspace_id || null;

  const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', user_id).single();

  const coachingTip = await groqService.generateCoachingTip(user, user_message_content || '', 'ghost', null)
    .catch(() => ({
      what_worked: 'N/A',
      what_didnt:  'The message didn\'t give them a compelling reason to reply.',
      improvement: 'Try opening with their specific situation and ending with one easy question.',
      coaching_summary: 'Getting ghosted means the message didn\'t earn a reply. That\'s data — iterate from here.',
    }));

  const summary = typeof coachingTip === 'object'
    ? coachingTip.coaching_summary || coachingTip.what_didnt || ''
    : coachingTip;

  await supabaseAdmin.from('chat_messages')
    .update({ delivery_status: DELIVERY_STATUS.GHOSTED, ghosted_at: new Date().toISOString(), coaching_tip: coachingTip })
    .eq('id', message_id);

  await supabaseAdmin.from('chat_messages').insert({
    workspace_id: workspaceId,
    chat_id, user_id, role: 'system',
    content: `👻 No reply.\n\n💡 ${summary}`,
    coaching_tip: coachingTip,
  });

  await supabaseAdmin.from('practice_sessions').update({ reply_received: false }).eq('id', session_id);

  await notifyUser(user_id, {
    title: 'Ghosted 👻',
    body:  "They didn't reply. Tap for your coaching tip.",
    data:  { type: 'practice_ghost', chat_id, session_id },
  });

  log('Ghost Handler Complete', { jobId, sessionId: session_id });
};

// ──────────────────────────────────────────
// SKILL SCORES
// ──────────────────────────────────────────
const handleSkillScores = async ({ session_id, user_id }, jobId) => {
  log('Skill Scores Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Scoring session ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Skill Scores Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  logAIRequest('generateMultiAxisScores', { userId: user_id, sessionId: session_id, messageCount: messages?.length });
  const skillScores = await groqService.generateMultiAxisScores(user, messages || [], session.buyer_profile || {});

  await supabaseAdmin.from('practice_sessions').update({ skill_scores: skillScores }).eq('id', session_id);

  if (session.retry_of_session_id) {
    const { data: origSession } = await supabaseAdmin.from('practice_sessions')
      .select('*').eq('id', session.retry_of_session_id).single();
    if (origSession) {
      const { data: origMessages } = await supabaseAdmin.from('chat_messages')
        .select('role, content').eq('chat_id', origSession.chat_id)
        .order('created_at', { ascending: true });
      const comparison = await groqService.generateRetryComparison(
        user, origMessages || [], messages || [],
        origSession.skill_scores?.session_score || origSession.message_strength_score,
        skillScores.session_score
      );
      if (comparison) {
        await supabaseAdmin.from('practice_sessions').update({ retry_comparison: comparison }).eq('id', session_id);
      }
    }
  }

  log('Skill Scores Handler Complete', { jobId, sessionId: session_id, score: skillScores?.session_score });
  console.log(`[Practice:Queue] Skill scores saved for ${session_id}: ${skillScores.session_score}/100`);
  await checkAndGenerateWeaknessCard({ user_id, session_id, skillScores }).catch(err =>
    logError('handleSkillScores → weaknessCard', err, { sessionId: session_id })
  );
};

// ──────────────────────────────────────────
// COACHING ANNOTATIONS
// ──────────────────────────────────────────
const handleCoachingAnnotations = async ({ session_id, user_id }, jobId) => {
  log('Coaching Annotations Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Generating coaching annotations for ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Annotations Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  const annotations = await groqService.generateCoachingAnnotations(
    user, messages || [], session.buyer_state_history || [], session.buyer_profile || {}
  );

  if (annotations.length > 0) {
    await supabaseAdmin.from('practice_sessions')
      .update({ coaching_annotations: annotations }).eq('id', session_id);
  }

  log('Coaching Annotations Handler Complete', { jobId, sessionId: session_id, annotationsCount: annotations.length });
  console.log(`[Practice:Queue] ${annotations.length} annotations saved for ${session_id}`);
};

// ──────────────────────────────────────────
// PLAYBOOK
// ──────────────────────────────────────────
const handlePlaybook = async ({ session_id, user_id }, jobId) => {
  log('Playbook Handler Start', { jobId, sessionId: session_id, userId: user_id });
  console.log(`[Practice:Queue] Generating playbook for ${session_id}`);

  const [{ data: session }, { data: user }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('*').eq('id', session_id).single(),
    supabaseAdmin.from('users').select('*').eq('id', user_id).single(),
  ]);

  if (!session || !user) {
    log('Playbook Aborted', { jobId, sessionId: session_id, userId: user_id });
    return;
  }
  if (session.playbook_generated) {
    log('Playbook Already Generated — Skipping', { jobId, sessionId: session_id });
    return;
  }

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content').eq('chat_id', session.chat_id)
    .order('created_at', { ascending: true });

  const playbook = await groqService.generatePlaybook(
    user, messages || [], session.buyer_profile || {},
    session.coaching_annotations || [], session.scenario_type
  );

  if (playbook) {
    await supabaseAdmin.from('practice_sessions')
      .update({ playbook, playbook_generated: true }).eq('id', session_id);

    // Issue 12: notify now includes chat_id and redirect_url so the frontend
    // can deep-link directly into the session chat on tap.
    // Previously only session_id was passed — no direct navigation was possible.
    await notifyUser(user_id, {
      title: `Your ${session.scenario_type} playbook is ready 📋`,
      body:  'Opening, discovery questions & objection responses — tap to see.',
      data:  {
        type:         'practice_playbook',
        session_id:   String(session_id),
        chat_id:      String(session.chat_id),          // Issue 12: added
        redirect_url: `/practice/${session_id}`,         // Issue 12: added
      },
    });

    log('User Notified — Playbook Ready', { jobId, userId: user_id, sessionId: session_id });
  }

  log('Playbook Handler Complete', { jobId, sessionId: session_id, generated: !!playbook });
  console.log(`[Practice:Queue] Playbook generated for ${session_id}`);
};
