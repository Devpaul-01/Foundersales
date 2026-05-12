// src/routes/practice.js
// ============================================================
// PRACTICE MODE V3 — WORKSPACE REFACTOR
//
// FIXES APPLIED (refinement plan):
//  Issue 1:  PRACTICE_REPLY job removed from message route (was already
//            removed in this version — confirmed no enqueue of PRACTICE_REPLY)
//  Issue 2:  V3 call signature corrected (already correct in this version)
//  Issue 3:  Ghost branch added before V3 call — evaluateMessageQualityForGhost
//            decides whether message earns a reply or stays ghosted
//  Issue 9:  pressureEffects keys aligned to PRESSURE_MODIFIERS constants
//            (investor_present → decision_maker_watching,
//             security_audit   → compliance_concern)
//  Issue 10: patience_remaining removed from initialBuyerState and retry
//            route's initialBuyerState. patience_delta removed from
//            pressureEffects (patience field retired from buyerState).
//  Section 5: GET /sessions allSessions 500-row fetch replaced with 3
//             targeted aggregate queries (count, reply count, recent scores).
// ============================================================

import { Router }                from 'express';
import { asyncHandler }          from '../middleware/errorHandler.js';
import { buildUserContext }      from '../middleware/workspace.js';
import {
  PRACTICE_SCENARIOS,
  QUEUE_JOB_TYPES,
  GHOST_TIMEOUT_SECONDS,
  PRESSURE_MODIFIERS,
} from '../config/constants.js';
import groqService               from '../services/groq.js';
import { preprocessAttachmentsForGrok, buildGrokAttachmentPrompt } from '../utils/attachmentProcessor.js';
import { checkPerplexityUsage, searchForChat } from '../services/perplexity.js';
import supabaseAdmin             from '../config/supabase.js';
import { enqueueJob }           from '../jobs/practiceWorker.js';
import { createLogger }          from '../utils/logger.js';

const router = Router();
const { log, logError, logDB } = createLogger('Practice');

const logAIRequest  = (fn, payload) => console.log(`[Practice] 🤖 AI Request [${fn}] →`, JSON.stringify(payload, null, 2));
const logAIResponse = (fn, response) => console.log(`[Practice] 🤖 AI Response [${fn}] →`, JSON.stringify(response, null, 2));

const logDeadLetterJobs = async (jobs, reason, sessionId) => {
  const rows = jobs.map(j => ({
    job_name:      j.job_type,
    status:        'dead_letter',
    error_message: reason,
    metadata:      { ...j.payload, session_id: sessionId },
  }));
  await supabaseAdmin.from('job_logs').insert(rows).catch(err =>
    console.error('[Practice] Dead-letter DB log failed:', err.message)
  );
  console.error(`[Practice] ❌ Dead-letter: ${jobs.length} job(s) permanently failed — sessionId=${sessionId} reason=${reason}`);
  const webhookUrl = process.env.DEAD_LETTER_WEBHOOK_URL;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `⚠️ Dead-letter jobs: sessionId=${sessionId} reason=${reason} count=${jobs.length}`, jobs: jobs.map(j => j.job_type) }),
    }).catch(() => {});
  }
};

const rng    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp  = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const selectWeightedScenario = () => {
  const total  = PRACTICE_SCENARIOS.reduce((s, p) => s + (p.weight || 1), 0);
  let   random = Math.random() * total;
  for (const s of PRACTICE_SCENARIOS) { random -= (s.weight || 1); if (random <= 0) return s.type; }
  return PRACTICE_SCENARIOS[0].type;
};

const applyStateDelta = (current, delta) => ({
  interest_score:  clamp((current.interest_score  || 30) + (delta.interest_delta  || 0), 0, 100),
  trust_score:     clamp((current.trust_score     || 15) + (delta.trust_delta     || 0), 0, 100),
  confusion_score: clamp((current.confusion_score ||  0) + (delta.confusion_delta || 0), 0, 100),
  last_reasoning:  delta.reasoning || '',
});

const getDifficultyForUser = async (userId) => {
  const { data } = await supabaseAdmin
    .from('practice_sessions').select('completed, reply_received').eq('user_id', userId).eq('completed', true);
  const total   = data?.length || 0;
  const replied = data?.filter(s => s.reply_received)?.length || 0;
  const rate    = total > 0 ? replied / total : 0;
  if (total < 5)                 return 'beginner';
  if (total < 15)                return 'standard';
  if (total < 30 || rate < 0.3) return 'advanced';
  return 'expert';
};

const getPracticeInstruction = (scenarioType, difficulty = 'standard', sessionGoal = '') => {
  const diff = difficulty !== 'standard' ? ` [${difficulty.toUpperCase()}]` : '';
  const goal = sessionGoal ? ` · Goal: "${sessionGoal}"` : '';
  const map = {
    interested:      `This person might be open. Write a genuine, low-pressure opener.`,
    polite_decline:  `This one's a long shot. Send your best anyway.`,
    ghost:           `Write like you expect a response. A strong enough message can revive even a cold prospect.`,
    skeptical:       `This person will push back. Be confident. Don't over-explain.`,
    price_objection: `Lead with value, not features. Price objections are interest in disguise.`,
    not_right_time:  `Timing matters. Show you understand their situation.`,
  };
  return (map[scenarioType] || 'Write your best outreach message.') + diff + goal;
};

const getLastSessionDebrief = async (userId) => {
  const { data } = await supabaseAdmin
    .from('practice_sessions').select('session_debrief, scenario_type, skill_scores')
    .eq('user_id', userId).eq('completed', true).not('session_debrief', 'is', null)
    .order('completed_at', { ascending: false }).limit(1).single();
  return data || null;
};

const checkAndAwardBadges = async (userId, scenarioType, totalCompleted, isGhost) => {
  const { data: earned } = await supabaseAdmin.from('practice_badges').select('badge_type').eq('user_id', userId);
  const earnedSet = new Set((earned || []).map(b => b.badge_type));
  const candidates = [
    { type: 'first_session',    cond: totalCompleted >= 1,  label: '🎯 First Steps',        desc: 'Completed first practice session' },
    { type: 'first_rejection',  cond: scenarioType !== 'interested' && !earnedSet.has('first_rejection'), label: '💪 Rejection Survivor', desc: 'Survived first rejection' },
    { type: 'ghostbuster',      cond: isGhost && !earnedSet.has('ghostbuster'), label: '👻 Ghostbuster', desc: 'Practiced getting ghosted' },
    { type: '5_sessions',       cond: totalCompleted >= 5,  label: '🔥 Getting Comfortable', desc: '5 sessions complete' },
    { type: '10_sessions',      cond: totalCompleted >= 10, label: '⚡ Rejection Proof',      desc: '10 sessions done' },
    { type: '25_sessions',      cond: totalCompleted >= 25, label: '🏆 Practice Pro',         desc: '25 sessions — real habit built' },
    { type: 'price_handler',    cond: scenarioType === 'price_objection' && !earnedSet.has('price_handler'), label: '💰 Money Talks', desc: 'Practiced price objection' },
    { type: 'advanced_reached', cond: totalCompleted >= 15 && !earnedSet.has('advanced_reached'), label: '🎓 Advanced Mode', desc: 'Unlocked advanced difficulty' },
  ];
  for (const b of candidates) {
    if (b.cond && !earnedSet.has(b.type)) {
      await supabaseAdmin.from('practice_badges').insert({ user_id: userId, badge_type: b.type, badge_label: b.label, badge_description: b.desc }).catch(() => {});
    }
  }
};

const calculateStreak = (sessions) => {
  if (!sessions?.length) return 0;
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    if (sessions.some(s => s.created_at?.startsWith(date))) streak++;
    else if (i > 0) break;
  }
  return streak;
};

// ── POST /api/practice/start ──────────────────────────────────
router.post('/start', asyncHandler(async (req, res) => {
  const {
    scenario_type, scenario_text, opportunity_context,
    triggered_by_feedback_id, session_goal, bio_note,
    drill_type, pressure_modifier,
  } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const userCtx = buildUserContext(req);

  log('Session Start Requested', { userId, workspaceId, scenario_type, pressure_modifier: pressure_modifier || 'none', session_goal: session_goal || null });

  const selectedType   = scenario_type || selectWeightedScenario();
  const scenarioConfig = PRACTICE_SCENARIOS.find(s => s.type === selectedType);
  const difficulty     = await getDifficultyForUser(userId);

  const validPressure = selectedType === 'ghost' ? null
    : (PRESSURE_MODIFIERS.find(p => p.type === pressure_modifier)?.type || null);
  const finalPressure = selectedType === 'interested' ? null : validPressure;

  let practicePrompt;
  if (scenario_text?.trim()) {
    practicePrompt = scenario_text.trim();
  } else if (opportunity_context?.trim()) {
    logAIRequest('generatePracticeScenarioFromOpportunity', { userId, scenarioType: selectedType });
    practicePrompt = await groqService.generatePracticeScenarioFromOpportunity(userCtx, selectedType, opportunity_context);
    logAIResponse('generatePracticeScenarioFromOpportunity', { promptLength: practicePrompt?.length });
  } else {
    logAIRequest('generatePracticeScenarioPrompt', { userId, scenarioType: selectedType });
    practicePrompt = await groqService.generatePracticeScenarioPrompt(userCtx, selectedType);
    logAIResponse('generatePracticeScenarioPrompt', { promptLength: practicePrompt?.length });
  }

  logAIRequest('generateBuyerProfile', { userId, scenarioType: selectedType });
  const buyerProfile = await groqService.generateBuyerProfile(userCtx, selectedType, bio_note || '');
  logAIResponse('generateBuyerProfile', { name: buyerProfile?.name, role: buyerProfile?.role });

  // Issue 9: pressureEffects keys now match PRESSURE_MODIFIERS in constants.js.
  // Previously used investor_present/security_audit which don't exist in constants —
  // meaning decision_maker_watching and compliance_concern never got stat adjustments.
  // Issue 10: patience_delta removed — patience_remaining is retired from buyerState.
  if (finalPressure) {
    const pressureEffects = {
      decision_maker_watching: { trust_delta: -5 },
      aggressive_buyer:        { interest_delta: -10, trust_delta: -10 },
      competitor_mentioned:    { interest_delta: -5,  trust_delta: -5 },
      compliance_concern:      { trust_delta: -8 },
    };
    const effect = pressureEffects[finalPressure] || {};
    if (effect.interest_delta) buyerProfile.interest_score = Math.max(15, (buyerProfile.interest_score || 30) + effect.interest_delta);
    if (effect.trust_delta)    buyerProfile.trust_score    = Math.max(5,  (buyerProfile.trust_score    || 15) + effect.trust_delta);
  }

  // Issue 10: patience_remaining removed from initialBuyerState.
  // V3 never used it in its prompt — it was dead state. V2's patience exit
  // logic is no longer relevant since V2 is not called in the message route.
  const initialBuyerState = {
    interest_score:  buyerProfile.interest_score  || 30,
    trust_score:     buyerProfile.trust_score     || 15,
    confusion_score: buyerProfile.confusion_score || 0,
    mood:            buyerProfile.opening_mood    || 'neutral',
    last_reasoning:  '',
  };

  const lastSession = await getLastSessionDebrief(userId);

  logDB('INSERT', 'chats', { userId, workspaceId, type: 'practice', scenario: selectedType });
  const { data: chat, error: chatErr } = await supabaseAdmin.from('chats').insert({
    workspace_id: workspaceId,
    user_id:      userId,
    title:        `Practice: ${scenarioConfig?.label || selectedType}${finalPressure ? ` [${PRESSURE_MODIFIERS.find(p => p.type === finalPressure)?.label || finalPressure}]` : ''}${session_goal ? ` — "${session_goal.slice(0, 40)}"` : ''}`,
    chat_type:    'practice',
  }).select().single();
  if (chatErr) { logError('POST /start', chatErr, { userId, step: 'chat_insert' }); throw chatErr; }

  logDB('INSERT', 'practice_sessions', { userId, chatId: chat.id, scenario: selectedType, difficulty });
  const { data: session, error: sessionErr } = await supabaseAdmin.from('practice_sessions').insert({
    user_id:                  userId,
    scenario_type:            selectedType,
    practice_prompt:          practicePrompt,
    triggered_by_feedback_id: triggered_by_feedback_id || null,
    chat_id:                  chat.id,
    difficulty_level:         difficulty,
    completed:                false,
    session_goal:             session_goal?.trim()  || null,
    bio_note:                 bio_note?.trim()      || null,
    drill_type:               drill_type            || null,
    pressure_modifier:        finalPressure,
    buyer_profile:            buyerProfile,
    buyer_state:              initialBuyerState,
    buyer_state_history:      [{ ...initialBuyerState, message_index: 0 }],
    goal_achieved:            false,
    ai_ended_session:         false,
    interruption_count:       0,
  }).select().single();
  if (sessionErr) { logError('POST /start', sessionErr, { userId, chatId: chat.id }); throw sessionErr; }

  await supabaseAdmin.from('chats').update({ practice_session_id: session.id }).eq('id', chat.id);

  await supabaseAdmin.from('chat_messages').insert({
    workspace_id:  workspaceId,
    chat_id:       chat.id,
    user_id:       userId,
    role:          'system',
    content:       practicePrompt,
    scenario_type: selectedType,
  });

  let previousDebriefContext = null;
  if (lastSession?.session_debrief) {
    const d = lastSession.session_debrief;
    previousDebriefContext = `💡 From your last session (${lastSession.scenario_type}): ${d.coachable_moment || d.improvement || 'Focus on asking questions before pitching.'}`;
    await supabaseAdmin.from('chat_messages').insert({
      workspace_id:  workspaceId,
      chat_id:       chat.id,
      user_id:       userId,
      role:          'system',
      content:       previousDebriefContext,
      scenario_type: selectedType,
    });
  }

  log('Session Start Complete', { sessionId: session.id, chatId: chat.id, userId, workspaceId });

  res.status(201).json({
    session_id:               session.id,
    chat_id:                  chat.id,
    scenario_type:            selectedType,
    scenario_label:           scenarioConfig?.label,
    practice_prompt:          practicePrompt,
    instruction:              getPracticeInstruction(selectedType, difficulty, session_goal),
    difficulty,
    buyer_profile:            buyerProfile,
    buyer_state:              initialBuyerState,
    session_goal:             session_goal   || null,
    drill_type:               drill_type     || null,
    pressure_modifier:        finalPressure,
    pressure_modifier_label:  finalPressure ? PRESSURE_MODIFIERS.find(p => p.type === finalPressure)?.label : null,
    previous_debrief_context: previousDebriefContext,
    realtime_channel:         `chat:${chat.id}`,
  });
}));

// ── GET /api/practice/sessions ────────────────────────────────
// Section 5: Replaced the 500-row allSessions fetch with 3 targeted DB-level
// aggregate queries. The old approach loaded every completed session just to
// compute total, replyRate, avgScore, and streak — all of which can be derived
// without fetching full row data. At 500+ sessions this was a meaningful
// payload; with DB aggregates it is a constant-time operation.
router.get('/sessions', asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const userId = req.user.id;

  const [
    { data: sessions },
    { count: totalCount },
    { count: replyCount },
    { data: scoreRows },
    { data: badges },
    { data: curriculum },
  ] = await Promise.all([
    supabaseAdmin.from('practice_sessions')
      .select('id, scenario_type, completed, rating, created_at, chat_id, completed_at, difficulty_level, reply_received, message_strength_score, session_debrief, session_goal, goal_achieved, buyer_profile, skill_scores, retry_of_session_id, drill_type, pressure_modifier, conversation_outcome, ai_ended_session')
      .eq('user_id', userId).order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1),

    // Total completed (for stats)
    supabaseAdmin.from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('completed', true),

    // Completed with reply received (for reply rate)
    supabaseAdmin.from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('completed', true).eq('reply_received', true),

    // Recent scored sessions for avgScore + streak (limit 30, lightweight)
    supabaseAdmin.from('practice_sessions')
      .select('message_strength_score, created_at')
      .eq('user_id', userId).eq('completed', true)
      .not('message_strength_score', 'is', null)
      .order('created_at', { ascending: false }).limit(30),

    supabaseAdmin.from('practice_badges').select('badge_type, badge_label, badge_description, earned_at').eq('user_id', userId).order('earned_at', { ascending: false }),
    supabaseAdmin.from('practice_curriculum').select('curriculum, expires_at').eq('user_id', userId).single(),
  ]);

  const total     = totalCount  || 0;
  const replyRate = total > 0   ? Math.round((replyCount || 0) / total * 100) : 0;
  const avgScore  = scoreRows?.length > 0
    ? Math.round(scoreRows.reduce((a, s) => a + s.message_strength_score, 0) / scoreRows.length)
    : 0;
  // calculateStreak needs created_at — scoreRows has it; fall back to empty array
  const streak = calculateStreak(scoreRows || []);

  res.json({
    sessions:       sessions || [],
    stats: { total, completed: total, reply_rate: replyRate, streak, avg_score: avgScore },
    badges:         badges || [],
    curriculum:     curriculum || null,
  });
}));

// ── GET /api/practice/:sessionId ──────────────────────────────
router.get('/:sessionId', asyncHandler(async (req, res) => {
  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('*').eq('id', req.params.sessionId).eq('user_id', req.user.id).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ session });
}));

// ── GET /api/practice/:sessionId/messages ─────────────────────
router.get('/:sessionId/messages', asyncHandler(async (req, res) => {
  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('chat_id, completed').eq('id', req.params.sessionId).eq('user_id', req.user.id).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, created_at, delivery_status, delivered_at, seen_at, scenario_type, chunk_index, is_final_chunk')
    .eq('chat_id', session.chat_id).neq('role', 'system')
    .order('created_at', { ascending: true });

  const cleaned = session.completed
    ? (messages || [])
    : (messages || []).map(m => { const { internal_monologue, ...safe } = m; return safe; });

  res.json({ messages: cleaned });
}));

// ── POST /api/practice/:sessionId/message ────────────────────
router.post('/:sessionId/message', asyncHandler(async (req, res) => {
  const { content, attachments } = req.body;
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  if (!content?.trim() && !attachments?.length) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'content or attachments required' });
  }

  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('*').eq('id', req.params.sessionId).eq('user_id', userId).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });
  if (session.completed) return res.status(400).json({ error: 'SESSION_ENDED', message: 'This session has already ended.' });

  const userCtx = buildUserContext(req);

  logDB('INSERT', 'chat_messages', { chatId: session.chat_id, role: 'user', workspaceId });
  const { data: userMsg } = await supabaseAdmin.from('chat_messages').insert({
    workspace_id:    workspaceId,
    chat_id:         session.chat_id,
    user_id:         userId,
    role:            'user',
    content:         content || '',
    delivery_status: 'delivered',
    delivered_at:    new Date().toISOString(),
  }).select('id').single();

  const { data: history } = await supabaseAdmin.from('chat_messages')
    .select('role, content').eq('chat_id', session.chat_id)
    .in('role', ['user', 'assistant']).order('created_at', { ascending: true }).limit(50);

  const currentState = session.buyer_state || {};
  const stateHistory = session.buyer_state_history || [];

  // ── ISSUE 3: GHOST SCENARIO PATH ─────────────────────────────
  // V3 returns null for ghost scenarios, which previously caused an empty
  // assistant message to be inserted. Now we gate on message quality:
  //   - reply_worthy=true  → ghost breaks silence (V3 as 'interested')
  //   - reply_worthy=false → ghost stays silent, coaching tip shown
  if (session.scenario_type === 'ghost') {
    logAIRequest('evaluateMessageQualityForGhost', { userId, sessionId: session.id, messagePreview: content?.slice(0, 80) });
    const ghostEval = await groqService.evaluateMessageQualityForGhost(
      userCtx, content || '', history || []
    );
    logAIResponse('evaluateMessageQualityForGhost', { qualityScore: ghostEval.quality_score, replyWorthy: ghostEval.reply_worthy });

    if (ghostEval.reply_worthy) {
      // Message was strong enough — ghost breaks silence for one turn
      logAIRequest('generatePracticeProspectReplyV3 (ghost-break)', { userId, sessionId: session.id });
      const ghostReply = await groqService.generatePracticeProspectReplyV3(
        userCtx,
        content || '',
        {
          ...session,
          scenario_type:    'interested',   // override for this turn only
          buyer_profile:    session.buyer_profile || {},
          buyer_state:      currentState,
          difficulty_level: session.difficulty_level || 'standard',
        },
        history || [],
        {}
      );
      logAIResponse('generatePracticeProspectReplyV3 (ghost-break)', { replyLength: ghostReply?.reply?.length });

      const newState     = applyStateDelta(currentState, ghostReply?.state_delta || {});
      const newStateHist = [...stateHistory, { ...newState, message_index: stateHistory.length }];
      const chunks       = groqService.splitIntoChunks ? groqService.splitIntoChunks(ghostReply?.reply || '') : [ghostReply?.reply || ''];

      const insertedMsgs = [];
      for (let i = 0; i < chunks.length; i++) {
        const { data: aiMsg } = await supabaseAdmin.from('chat_messages').insert({
          workspace_id:    workspaceId,
          chat_id:         session.chat_id,
          user_id:         userId,
          role:            'assistant',
          content:         chunks[i],
          delivery_status: 'pending',
          scenario_type:   'interested',
          internal_monologue: i === 0 ? (ghostReply?.internal_monologue || null) : null,
          chunk_index:     i,
          is_final_chunk:  i === chunks.length - 1,
        }).select('id').single();
        if (aiMsg) insertedMsgs.push(aiMsg.id);
      }

      await supabaseAdmin.from('practice_sessions').update({
        buyer_state:         newState,
        buyer_state_history: newStateHist,
        reply_received:      true,
      }).eq('id', session.id);

      const deliveryJobs = [
        { type: QUEUE_JOB_TYPES.PRACTICE_DELIVERED, payload: { message_id: insertedMsgs[0] }, delay: 500 },
        { type: QUEUE_JOB_TYPES.PRACTICE_SEEN,      payload: { message_id: insertedMsgs[0] }, delay: 1500 },
      ];
      for (const j of deliveryJobs) {
        await enqueueJob(j.type, j.payload, { delay: j.delay }).catch(err =>
          logError(`enqueueJob [${j.type}]`, err, { sessionId: session.id })
        );
      }

      return res.json({
        message_ids:   insertedMsgs,
        buyer_state:   newState,
        session_ended: false,
        ghost_broke:   true,
        quality_score: ghostEval.quality_score,
      });
    }

    // Ghost stays silent — mark user message as ghosted and show coaching tip
    if (userMsg?.id) {
      await supabaseAdmin.from('chat_messages')
        .update({ delivery_status: 'ghosted', ghosted_at: new Date().toISOString() })
        .eq('id', userMsg.id);
    }

    const coachingTip = await groqService.generateCoachingTip(
      userCtx, content || '', 'ghost', null
    ).catch(() => ({
      what_worked: 'N/A',
      what_didnt:  "The message didn't earn a reply.",
      improvement: 'Reference their specific situation and end with one easy question.',
    }));

    const summary = coachingTip?.coaching_summary || coachingTip?.what_didnt || '';
    await supabaseAdmin.from('chat_messages').insert({
      workspace_id: workspaceId,
      chat_id:      session.chat_id,
      user_id:      userId,
      role:         'system',
      content:      `👻 No reply.\n\n💡 ${summary}`,
      coaching_tip: coachingTip,
    });

    return res.json({
      message_ids:   [],
      buyer_state:   currentState,
      session_ended: false,
      ghosted:       true,
      quality_score: ghostEval.quality_score,
      hint:          ghostEval.hint,
    });
  }
  // ── END GHOST PATH ────────────────────────────────────────────

  logAIRequest('generatePracticeProspectReplyV3', { userId, sessionId: session.id, scenario: session.scenario_type, difficulty: session.difficulty_level, stateHistory: stateHistory.length });

  // Issue 2: correct V3 argument order (already correct in uploaded version)
  const attachmentContext = attachments?.length
    ? ` [Attachments: ${attachments.map(a => a.name).join(', ')}]`
    : '';

  const replyResult = await groqService.generatePracticeProspectReplyV3(
    userCtx,
    content || '',
    {
      buyer_profile:      session.buyer_profile || {},
      buyer_state:        currentState,
      scenario_type:      session.scenario_type,
      difficulty_level:   session.difficulty_level || 'standard',
      pressure_modifier:  session.pressure_modifier || null,
      drill_type:         session.drill_type || null,
      session_goal:       session.session_goal || null,
      interruption_count: session.interruption_count || 0,
    },
    history || [],
    { attachmentContext }
  );

  logAIResponse('generatePracticeProspectReplyV3', {
    replyLength: replyResult?.reply?.length,
    stateChange: replyResult?.state_delta,
    sessionEnd:  replyResult?.end_session,
  });

  const newState = applyStateDelta(currentState, replyResult?.state_delta || {});
  const newStateHistory = [...stateHistory, { ...newState, message_index: stateHistory.length }];

  const chunks = groqService.splitIntoChunks ? groqService.splitIntoChunks(replyResult?.reply || '') : [replyResult?.reply || ''];

  const insertedMsgs = [];
  for (let i = 0; i < chunks.length; i++) {
    const { data: aiMsg } = await supabaseAdmin.from('chat_messages').insert({
      workspace_id:    workspaceId,
      chat_id:         session.chat_id,
      user_id:         userId,
      role:            'assistant',
      content:         chunks[i],
      delivery_status: 'pending',
      scenario_type:   session.scenario_type,
      internal_monologue: i === 0 ? (replyResult?.internal_monologue || null) : null,
      chunk_index:     i,
      is_final_chunk:  i === chunks.length - 1,
    }).select('id').single();
    if (aiMsg) insertedMsgs.push(aiMsg.id);
  }

  await supabaseAdmin.from('practice_sessions').update({
    buyer_state:         newState,
    buyer_state_history: newStateHistory,
    reply_received:      true,
    interruption_count:  replyResult?.is_interruption ? (session.interruption_count || 0) + 1 : session.interruption_count,
    ...(replyResult?.end_session ? { ai_ended_session: true } : {}),
  }).eq('id', session.id);

  // Issue 1: jobsToEnqueue contains ONLY DELIVERED and SEEN.
  // PRACTICE_REPLY is intentionally absent — V3 inline reply is the single
  // source of truth. No V2 path runs for real-time replies.
  const thinkingDelay = groqService.computeThinkingDelay ? groqService.computeThinkingDelay(replyResult?.reply || '') : 1000;
  const jobsToEnqueue = [
    { type: QUEUE_JOB_TYPES.PRACTICE_DELIVERED, payload: { message_id: insertedMsgs[0] }, delay: 500 },
    { type: QUEUE_JOB_TYPES.PRACTICE_SEEN,      payload: { message_id: insertedMsgs[0] }, delay: 1500 },
  ];

  const enqueuedJobs = [];
  const failedEnqueues = [];
  for (const j of jobsToEnqueue) {
    try {
      await enqueueJob(j.type, j.payload, { delay: j.delay });
      enqueuedJobs.push(j.type);
    } catch (err) {
      logError(`enqueueJob [${j.type}]`, err, { sessionId: session.id });
      failedEnqueues.push(j);
    }
  }
  if (failedEnqueues.length) await logDeadLetterJobs(failedEnqueues, 'enqueue_failed', session.id);

  res.json({
    message_ids:          insertedMsgs,
    buyer_state:          newState,
    session_ended:        !!replyResult?.end_session,
    conversation_outcome: replyResult?.conversation_outcome || null,
    chunk_count_hint:     chunks.length,
  });
}));

// ── POST /api/practice/:sessionId/complete ────────────────────
router.post('/:sessionId/complete', asyncHandler(async (req, res) => {
  const { rating } = req.body;
  const userId = req.user.id;

  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('*').eq('id', req.params.sessionId).eq('user_id', userId).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });

  if (session.completed) {
    return res.json({ success: true, session_id: session.id, already_completed: true });
  }

  await supabaseAdmin.from('practice_sessions').update({
    completed:    true,
    completed_at: new Date().toISOString(),
    rating:       rating || null,
  }).eq('id', session.id);

  const { count: totalCompleted } = await supabaseAdmin.from('practice_sessions')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('completed', true);

  await checkAndAwardBadges(userId, session.scenario_type, totalCompleted || 0, session.scenario_type === 'ghost');

  const postSessionJobs = [
    { type: QUEUE_JOB_TYPES.PRACTICE_SKILL_SCORES,         payload: { session_id: session.id, user_id: userId }, delay: 2000 },
    { type: QUEUE_JOB_TYPES.PRACTICE_COACHING_ANNOTATIONS, payload: { session_id: session.id, user_id: userId }, delay: 5000 },
    { type: QUEUE_JOB_TYPES.PRACTICE_PLAYBOOK,             payload: { session_id: session.id, user_id: userId }, delay: 2 * 60 * 60 * 1000 },
  ];

  for (const j of postSessionJobs) {
    await enqueueJob(j.type, j.payload, { delay: j.delay }).catch(err =>
      logError(`enqueueJob [${j.type}]`, err, { sessionId: session.id })
    );
  }

  res.json({ success: true, session_id: session.id, total_completed: totalCompleted || 0 });
}));

// ── GET /api/practice/:sessionId/outcome ─────────────────────
router.get('/:sessionId/outcome', asyncHandler(async (req, res) => {
  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('id, completed, conversation_outcome, ai_ended_session, buyer_state, session_debrief, skill_scores, coaching_annotations, playbook')
    .eq('id', req.params.sessionId).eq('user_id', req.user.id).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ session });
}));

// ── GET /api/practice/:sessionId/replay ──────────────────────
router.get('/:sessionId/replay', asyncHandler(async (req, res) => {
  const { data: session } = await supabaseAdmin.from('practice_sessions')
    .select('*').eq('id', req.params.sessionId).eq('user_id', req.user.id).single();
  if (!session) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!session.completed) return res.status(400).json({ error: 'SESSION_NOT_COMPLETED' });

  const { data: messages } = await supabaseAdmin.from('chat_messages')
    .select('id, role, content, internal_monologue, created_at, chunk_index, is_final_chunk')
    .eq('chat_id', session.chat_id).neq('role', 'system')
    .order('created_at', { ascending: true });

  const monologueMoments = (messages || [])
    .filter(m => m.role === 'assistant' && m.internal_monologue)
    .map(m => ({ message_id: m.id, thought: m.internal_monologue }));

  res.json({ session, messages: messages || [], internal_monologues: monologueMoments });
}));

// ── GET /api/practice/progress-summary ───────────────────────
router.get('/progress-summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: recentSessions }, { data: latestProgression }, { data: recentAnalyses }] = await Promise.all([
    supabaseAdmin.from('practice_sessions').select('id, scenario_type, skill_scores, completed_at, session_goal, goal_achieved').eq('user_id', userId).eq('completed', true).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }),
    supabaseAdmin.from('user_skill_profile').select('*').eq('user_id', userId).order('period_start', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('conversation_analyses').select('composite_score, outcome').eq('workspace_id', workspaceId).eq('user_id', userId).gte('created_at', sevenDaysAgo),
  ]);

  const sessions      = recentSessions || [];
  const avgSkillScore = sessions.filter(s => s.skill_scores?.session_score != null).length > 0
    ? Math.round(sessions.reduce((a, s) => a + (s.skill_scores?.session_score || 0), 0) / sessions.filter(s => s.skill_scores?.session_score != null).length)
    : null;

  const realWorldRate = recentAnalyses?.length > 0
    ? Math.round(recentAnalyses.filter(a => a.outcome === 'positive').length / recentAnalyses.length * 100) : null;

  res.json({
    sessions_this_week:   sessions.length,
    avg_skill_score:      avgSkillScore,
    real_world_win_rate:  realWorldRate,
    weakest_axis:         latestProgression?.weakest_axis  || null,
    strongest_axis:       latestProgression?.strongest_axis || null,
    weekly_progression:   latestProgression || null,
  });
}));

// ── GET /api/practice/skill-dashboard ────────────────────────
router.get('/skill-dashboard', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [{ data: skillRows }, { data: recentSessions }, { data: badges }] = await Promise.all([
    supabaseAdmin.from('user_skill_profile').select('*').eq('user_id', userId).order('period_start', { ascending: false }).limit(4),
    supabaseAdmin.from('practice_sessions').select('id, scenario_type, skill_scores, session_debrief, completed_at, retry_comparison').eq('user_id', userId).eq('completed', true).not('skill_scores', 'is', null).order('completed_at', { ascending: false }).limit(10),
    supabaseAdmin.from('practice_badges').select('badge_type, badge_label, earned_at').eq('user_id', userId).order('earned_at', { ascending: false }),
  ]);

  res.json({ skill_history: skillRows || [], recent_sessions: recentSessions || [], badges: badges || [] });
}));

// ── POST /api/practice/:sessionId/retry ──────────────────────
router.post('/:sessionId/retry', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const userCtx = buildUserContext(req);

  const { data: original } = await supabaseAdmin.from('practice_sessions')
    .select('*').eq('id', req.params.sessionId).eq('user_id', userId).single();
  if (!original) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!original.completed) return res.status(400).json({ error: 'ORIGINAL_NOT_COMPLETED' });

  const scenarioConfig = PRACTICE_SCENARIOS.find(s => s.type === original.scenario_type);
  const difficulty     = await getDifficultyForUser(userId);
  const buyerProfile   = await groqService.generateBuyerProfile(userCtx, original.scenario_type, '');

  // Issue 10: patience_remaining removed from retry initialBuyerState as well.
  const initialBuyerState = {
    interest_score:  buyerProfile.interest_score  || 30,
    trust_score:     buyerProfile.trust_score     || 15,
    confusion_score: buyerProfile.confusion_score || 0,
    mood:            buyerProfile.opening_mood    || 'neutral',
    last_reasoning:  '',
  };

  const { data: chat } = await supabaseAdmin.from('chats').insert({
    workspace_id: workspaceId,
    user_id:      userId,
    title:        `Retry: ${scenarioConfig?.label || original.scenario_type}`,
    chat_type:    'practice',
  }).select().single();

  const { data: session } = await supabaseAdmin.from('practice_sessions').insert({
    user_id:             userId,
    scenario_type:       original.scenario_type,
    practice_prompt:     original.practice_prompt,
    chat_id:             chat.id,
    difficulty_level:    difficulty,
    completed:           false,
    session_goal:        original.session_goal  || null,
    drill_type:          original.drill_type    || null,
    pressure_modifier:   original.pressure_modifier || null,
    buyer_profile:       buyerProfile,
    buyer_state:         initialBuyerState,
    buyer_state_history: [{ ...initialBuyerState, message_index: 0 }],
    goal_achieved:       false,
    ai_ended_session:    false,
    interruption_count:  0,
    retry_of_session_id: original.id,
  }).select().single();

  await supabaseAdmin.from('chats').update({ practice_session_id: session.id }).eq('id', chat.id);
  await supabaseAdmin.from('chat_messages').insert({
    workspace_id:  workspaceId,
    chat_id:       chat.id,
    user_id:       userId,
    role:          'system',
    content:       original.practice_prompt,
    scenario_type: original.scenario_type,
  });

  res.status(201).json({
    session_id:       session.id,
    chat_id:          chat.id,
    scenario_type:    original.scenario_type,
    practice_prompt:  original.practice_prompt,
    instruction:      getPracticeInstruction(original.scenario_type, difficulty, original.session_goal),
    difficulty,
    buyer_profile:    buyerProfile,
    buyer_state:      initialBuyerState,
    realtime_channel: `chat:${chat.id}`,
  });
}));

router.get('/badges', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { data: badges, error } = await supabaseAdmin
    .from('practice_badges')
    .select('id, badge_type, badge_label, badge_description, earned_at')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });

  if (error) throw error;

  res.json({ badges: badges || [], total: badges?.length || 0 });
}));

// ── GET /api/practice/history ─────────────────────────────────
// Lightweight paginated session history.
// Unlike GET /sessions (which loads stats, badges, and curriculum
// in parallel), this endpoint fetches only the session list — useful
// for "Load more" pagination in a history feed without re-fetching
// the full dashboard on every page increment.
router.get('/history', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 50);
  const offset = parseInt(req.query.offset || '0', 10);
  const type   = req.query.type; // optional filter: scenario_type

  let query = supabaseAdmin
    .from('practice_sessions')
    .select('id, scenario_type, completed, reply_received, message_strength_score, session_debrief, completed_at, created_at, difficulty_level, session_goal, goal_achieved, conversation_outcome, drill_type, pressure_modifier')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) query = query.eq('scenario_type', type);

  const { data: sessions, error } = await query;
  if (error) throw error;

  // Return total count only on first page (offset=0) to avoid a count
  // query on every paginated request.
  let total = null;
  if (offset === 0) {
    const countQuery = supabaseAdmin
      .from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (type) countQuery.eq('scenario_type', type);
    const { count } = await countQuery;
    total = count;
  }

  res.json({
    sessions: sessions || [],
    pagination: {
      limit,
      offset,
      total,
      has_more: (sessions?.length || 0) === limit,
    },
  });
}));

// ── DELETE /api/practice/:sessionId ───────────────────────────
// Cancel / delete an incomplete practice session.
// Only incomplete (completed=false) sessions can be deleted — this
// prevents accidental erasure of scored sessions. Completed sessions
// should use a soft-archive approach (not currently implemented) rather
// than hard delete, since they feed into skill_progression aggregation.
router.delete('/:sessionId', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const sessionId = req.params.sessionId;

  // Verify ownership and completion status
  const { data: session } = await supabaseAdmin
    .from('practice_sessions')
    .select('id, completed, chat_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!session) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found.' });
  }

  if (session.completed) {
    return res.status(409).json({
      error:   'SESSION_ALREADY_COMPLETED',
      message: 'Completed sessions cannot be deleted. They are used for skill tracking.',
    });
  }

  // Delete the associated chat and messages (cascade expected via FK,
  // but explicit chat delete is a safety net if cascade is not set).
  if (session.chat_id) {
    await supabaseAdmin.from('chat_messages').delete().eq('chat_id', session.chat_id).catch(() => {});
    await supabaseAdmin.from('chats').delete().eq('id', session.chat_id).eq('user_id', userId).catch(() => {});
  }

  const { error } = await supabaseAdmin
    .from('practice_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) throw error;

  log('Session Deleted', { userId, sessionId });
  res.json({ success: true });
}));


export default router;
