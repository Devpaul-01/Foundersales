// src/routes/growth.js
import { Router }           from 'express';
import { asyncHandler }     from '../middleware/errorHandler.js';
import { requirePermission, buildUserContext } from '../middleware/workspace.js';
import { validate }         from '../middleware/validate.js';
import { createLogger }     from '../utils/logger.js';
import {
  checkInSubmitSchema,
  feedQuerySchema,
  historyQuerySchema,
} from '../validators/growth.js';
import supabaseAdmin        from '../config/supabase.js';
import groqService          from '../services/groq.js';
import { backgroundQueue }  from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES } from '../config/constants.js';
import { createLogger as _l } from '../utils/logger.js';

const router = Router();
const { log, logError, logDB, logAI } = createLogger('Growth');

// GET /api/growth/feed
// Accepts `limit` and `offset` for pagination through historical growth cards.
// Previously only `limit` was supported — the card list had no page-through.
// NOTE: feedQuerySchema in validators/growth.js must include:
//   offset: z.coerce.number().int().min(0).default(0)
router.get('/feed', validate(feedQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const userId    = req.user.id, workspaceId = req.workspace.id;
  const archetype = req.workspaceProfile?.archetype || 'seller';
  const limit  = parseInt(req.query.limit  || '20', 10);
  const offset = parseInt(req.query.offset || '0',  10);
  log('FEED request', { userId, workspaceId, archetype, limit, offset });

  const now = new Date().toISOString();
  const [cardsResult, oppsResult] = await Promise.allSettled([
    supabaseAdmin.from('growth_cards')
      .select('id, card_type, title, body, action_label, action_type, priority, metadata, created_at, is_read')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_dismissed', false)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('priority', { ascending: false }).order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    supabaseAdmin.from('opportunities')
      .select('id, target_name, target_context, platform, prepared_message, composite_score, created_at')
      .eq('workspace_id', workspaceId)
      .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
      .eq('stage', 'new')
      .order('composite_score', { ascending: false }).limit(5),
  ]);

  const cards = cardsResult.status === 'fulfilled' ? cardsResult.value.data || [] : [];
  const opps  = oppsResult.status  === 'fulfilled' ? oppsResult.value.data  || [] : [];

  const { count } = await supabaseAdmin
    .from('growth_cards').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('is_dismissed', false).or(`expires_at.is.null,expires_at.gt.${now}`);

  if ((count || 0) === 0 && offset === 0) {
    log('FEED first-time user — queuing card generation', { userId });
    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.FIRST_TIME_CARDS_GENERATE,
      { userId, workspaceId, userCtx: buildUserContext(req) }
    ).catch(err => logError('backgroundQueue first_time_cards', err, { userId }));
  }

  const { data: goals } = await supabaseAdmin
    .from('user_goals').select('id, goal_text, current_value, target_value, target_unit, status')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3);

  res.json({
    cards,
    opportunities: opps,
    goals:         goals || [],
    archetype,
    pagination: {
      limit,
      offset,
      total:    count || 0,
      has_more: offset + cards.length < (count || 0),
    },
  });
}));

// POST /api/growth/cards/:id/read
router.post('/cards/:id/read', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspace.id;
  await supabaseAdmin.from('growth_cards').update({ is_read: true })
    .eq('id', id).eq('workspace_id', workspaceId).eq('user_id', req.user.id);
  res.json({ success: true });
}));

// POST /api/growth/cards/:id/dismiss
router.post('/cards/:id/dismiss', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspace.id;
  await supabaseAdmin.from('growth_cards').update({ is_dismissed: true })
    .eq('id', id).eq('workspace_id', workspaceId).eq('user_id', req.user.id);
  res.json({ success: true });
}));

// GET /api/growth/checkin/today
router.get('/checkin/today', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const archetype = req.workspaceProfile?.archetype || 'seller';
  const today = new Date().toISOString().split('T')[0];
  
  log('=== CHECKIN TODAY START ===', { userId, workspaceId, today, archetype });

  // 1. Check for existing check-in
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('daily_check_ins')
    .select('*')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('date', today)
    .single();
  
  if (existingError && existingError.code !== 'PGRST116') {
    log('ERROR fetching existing check-in', { error: existingError });
  }
  
  if (existing) {
    log('✅ Existing check-in found', { 
      id: existing.id, 
      hasQuestions: !!existing.questions,
      questionsLength: Array.isArray(existing.questions) ? existing.questions.length : 'not_array',
      questionsType: typeof existing.questions,
      questionsPreview: JSON.stringify(existing.questions).slice(0, 200)
    
    });
    return res.json({ check_in: existing, is_new: false });
  }

  // 2. Fetch recent messages
  const { data: recentMessages, error: messagesError } = await supabaseAdmin
    .from('chat_messages')
    .select('content, role')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(8);
  
  if (messagesError) {
    log('ERROR fetching messages', { error: messagesError });
  }
  
  const chatContext = recentMessages?.map(m => m.content?.slice(0, 200)).join(' | ').slice(0, 600) || '';
  log('📝 Chat context', { 
    messageCount: recentMessages?.length || 0,
    contextLength: chatContext.length,
    contextPreview: chatContext.slice(0, 100)
  });

  // 3. Fetch active goals
  const { data: goals, error: goalsError } = await supabaseAdmin
    .from('user_goals')
    .select('goal_text, target_value, target_unit, current_value')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(2);
  
  if (goalsError) {
    log('ERROR fetching goals', { error: goalsError });
  }
  
  log('🎯 Goals fetched', { 
    goalCount: goals?.length || 0,
    goals: goals?.map(g => ({ text: g.goal_text?.slice(0, 50), target: g.target_value }))
  });

  // 4. Generate questions with GROQ
  logAI('generateCheckInQuestions START', { userId, archetype });
  const userCtx = buildUserContext(req);
  log('👤 User context', { 
    userCtxLength: JSON.stringify(userCtx).length,
    userCtxPreview: JSON.stringify(userCtx).slice(0, 200)
  });
  
  let questions;
  try {
    questions = await groqService.generateCheckInQuestions(userCtx, archetype, chatContext, goals || []);
    
    // Comprehensive logging of GROQ response
    log('🤖 GROQ Response Details', {
      questionsType: typeof questions,
      isArray: Array.isArray(questions),
      length: Array.isArray(questions) ? questions.length : 'N/A',
      rawValue: JSON.stringify(questions),
      firstQuestion: Array.isArray(questions) && questions[0] ? JSON.stringify(questions[0]) : 'none',
      questionsPreview: JSON.stringify(questions).slice(0, 500)
    });
    
    // Validate questions format
    if (!questions) {
      log('⚠️ GROQ returned null/undefined', { questions });
      questions = [];
    }
    
    if (!Array.isArray(questions)) {
      log('❌ GROQ did not return an array!', { type: typeof questions, value: questions });
      questions = [];
    }
    
    if (questions.length === 0) {
      log('⚠️ GROQ returned empty array');
    }
    
    // Check each question format
    questions.forEach((q, idx) => {
      if (!q.id || !q.question) {
        log(`⚠️ Question ${idx} missing id or question field`, { 
          id: q.id, 
          question: q.question,
          hasId: !!q.id,
          hasQuestion: !!q.question,
          fullObject: JSON.stringify(q)
        });
      }
    });
    
  } catch (groqError) {
    log('❌ GROQ generation failed', { 
      error: groqError.message,
      stack: groqError.stack,
      name: groqError.name
    });
    questions = []; // Fallback to empty array
  }

  // 5. Ensure proper format before insertion
  const formattedQuestions = questions.map((q, idx) => ({
    id: q.id || `q${idx + 1}`,
    question: q.question || q.text || q.prompt || `Question ${idx + 1}`,
    ...(q.type && { type: q.type }) // preserve any additional fields
  }));
  
  log('📦 Formatted questions for DB', {
    originalCount: questions.length,
    formattedCount: formattedQuestions.length,
    formattedPreview: JSON.stringify(formattedQuestions).slice(0, 300)
  });

  // 6. Insert into database
  const insertData = {
    user_id: userId,
    workspace_id: workspaceId,
    date: today,
    questions: formattedQuestions,
    chat_context: chatContext
  };
  
  log('💾 Inserting check-in', { 
    insertData: {
      ...insertData,
      questions_length: formattedQuestions.length,
      questions_sample: JSON.stringify(formattedQuestions).slice(0, 200)
    }
  });
  
  const { data: newCheckIn, error: insertError } = await supabaseAdmin
    .from('daily_check_ins')
    .insert(insertData)
    .select()
    .single();
  
  if (insertError) {
    log('❌ Database insert failed', { 
      error: insertError,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint
    });
    throw new Error(`Failed to create check-in: ${insertError.message}`);
  }
  
  logDB('INSERT', 'daily_check_ins', { 
    userId, 
    workspaceId, 
    date: today,
    checkInId: newCheckIn.id,
    questionsStored: Array.isArray(newCheckIn.questions) ? newCheckIn.questions.length : 'invalid'
  });
  
  // 7. Final response validation
  const responseData = { check_in: newCheckIn, is_new: true };
  log('✅ CHECKIN TODAY COMPLETE', {
    checkInId: newCheckIn.id,
    hasQuestions: !!newCheckIn.questions,
    questionsType: typeof newCheckIn.questions,
    questionsLength: Array.isArray(newCheckIn.questions) ? newCheckIn.questions.length : 'not_array',
    questionsValue: JSON.stringify(newCheckIn.questions).slice(0, 200),
    fullResponsePreview: JSON.stringify(responseData).slice(0, 300)
  });
  
  res.json(responseData);
}));

// POST /api/growth/checkin
router.post('/checkin', requirePermission('member'), validate(checkInSubmitSchema), asyncHandler(async (req, res) => {
  const { answers, mood_score, date } = req.body;
  const userId    = req.user.id, workspaceId = req.workspace.id;
  const archetype = req.workspaceProfile?.archetype || 'seller';
  const today     = date || new Date().toISOString().split('T')[0];
  log('CHECKIN SUBMIT', { userId, workspaceId, today, mood_score });

  if (JSON.stringify(answers).length > 5000) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check-in answers too long.' });
  }

  const { data: checkIn } = await supabaseAdmin
    .from('daily_check_ins').select('*')
    .eq('user_id', userId).eq('workspace_id', workspaceId).eq('date', today).single();
  if (!checkIn) return res.status(404).json({ error: 'NOT_FOUND', message: 'No check-in found for today' });
  if (checkIn.processed_at) {
    return res.status(409).json({
      error:           'ALREADY_SUBMITTED',
      message:         "Already completed today's check-in.",
      check_in_streak: req.user.check_in_streak || 0,
    });
  }

  const { data: goals } = await supabaseAdmin
    .from('user_goals').select('goal_text, current_value, target_value, target_unit')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3);

  const [lastSentResult, lastAnalysisResult] = await Promise.allSettled([
    supabaseAdmin.from('opportunities')
      .select('platform, target_context, prepared_message, marked_sent_at')
      .eq('workspace_id', workspaceId)
      .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
      .not('marked_sent_at', 'is', null)
      .order('marked_sent_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('conversation_analyses')
      .select('composite_score, hook_score, personalization_score, failure_categories, outcome, created_at')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const lastSentData     = lastSentResult.status     === 'fulfilled' ? lastSentResult.value.data     : null;
  const lastAnalysisData = lastAnalysisResult.status === 'fulfilled' ? lastAnalysisResult.value.data : null;

  logAI('generateCheckInResponse', { userId, archetype, mood_score });
  const userCtx = buildUserContext(req);
  const { response_text, next_tip_seed } = await groqService.generateCheckInResponse(
    userCtx, archetype, checkIn.questions, answers, goals || [], mood_score || null,
    { lastSentMessage: lastSentData, lastAnalysis: lastAnalysisData }
  );
  console.log(`Responss receibed: ${response_text}`);

  await supabaseAdmin.from('daily_check_ins').update({
    answers, mood_score: mood_score || null,
    ai_response: response_text, processed_at: new Date().toISOString(),
  }).eq('id', checkIn.id);

  const newStreak = await computeCheckInStreak(userId, workspaceId, today);
  await supabaseAdmin.from('users').update({
    last_check_in_at: new Date().toISOString(),
    check_in_streak:  newStreak,
  }).eq('id', userId);

  await backgroundQueue.add(BACKGROUND_JOB_TYPES.CHECKIN_TIP_GENERATE, {
    userId, workspaceId, userCtx, answers, next_tip_seed,
    goals: goals || [], moodScore: mood_score || null, archetype,
  }).catch(err => logError('backgroundQueue checkin_tip_generate', err, { userId }));

  log('CHECKIN SUBMIT complete', { userId, streak: newStreak });
  res.json({ success: true, ai_response: response_text, check_in_streak: newStreak, message: 'Check-in saved.' });
}));

// GET /api/growth/history
router.get('/history', validate(historyQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { limit, offset, type } = req.query;

  let query = supabaseAdmin.from('growth_cards')
    .select('id, card_type, title, body, action_label, generated_by, created_at, is_read, metadata')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type === 'tips')       query = query.in('card_type', ['tip', 'challenge', 'reflection', 'resource']);
  else if (type === 'plans') query = query.eq('card_type', 'strategy').eq('generated_by', 'ai_weekly');
  else                       query = query.in('generated_by', ['ai_daily', 'ai_weekly', 'ai_checkin', 'ai_pattern_detection']);

  const { data: cards, error } = await query;
  if (error) { logError('history query', error, { userId }); throw error; }
  res.json({ cards: cards || [], total: cards?.length || 0 });
}));

// POST /api/growth/archetype/detect
router.post('/archetype/detect', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: profile } = await supabaseAdmin
    .from('workspace_profiles')
    .select('product_description, target_audience, role, industry, bio, onboarding_answers, archetype, archetype_detected_at')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!profile?.product_description) {
    return res.status(400).json({ error: 'ONBOARDING_REQUIRED', message: 'Complete onboarding first' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  if (profile.archetype && profile.archetype_detected_at && new Date(profile.archetype_detected_at) > sevenDaysAgo) {
    return res.json({ success: true, archetype: profile.archetype, confidence: null, cached: true, message: 'Re-detection available after 7 days.' });
  }

  logAI('detectUserArchetype', { userId, workspaceId });
  const userCtx = buildUserContext(req);
  const result  = await groqService.detectUserArchetype(userCtx, profile.onboarding_answers || {});
  await supabaseAdmin.from('workspace_profiles').update({
    archetype: result.archetype, archetype_detected_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('user_id', userId);
  logDB('UPDATE', 'workspace_profiles', { userId, workspaceId, archetype: result.archetype });
  res.json({ success: true, archetype: result.archetype, confidence: result.confidence, cached: false });
}));

// GET /api/growth/plan
router.get('/plan', asyncHandler(async (req, res) => {
  const userId    = req.user.id, workspaceId = req.workspace.id;
  const archetype = req.workspaceProfile?.archetype || 'seller';
  const weekStart = getWeekStart();

  const { data: existingCard } = await supabaseAdmin
    .from('growth_cards').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('card_type', 'strategy').eq('generated_by', 'ai_weekly')
    .gte('created_at', weekStart).single();
  if (existingCard) return res.json({ plan: existingCard, cached: true });

  const { data: goals }         = await supabaseAdmin.from('user_goals').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3);
  const { data: metrics }        = await supabaseAdmin.from('user_performance_profiles').select('*').eq('user_id', userId).single();
  const { data: recentCheckIns } = await supabaseAdmin.from('daily_check_ins').select('answers, mood_score, date').eq('user_id', userId).eq('workspace_id', workspaceId).not('processed_at', 'is', null).order('date', { ascending: false }).limit(3);

  logAI('generateWeeklyPlan', { userId, goals: goals?.length || 0 });
  const userCtx = buildUserContext(req);
  const plan    = await groqService.generateWeeklyPlan(userCtx, archetype, metrics, goals || [], recentCheckIns || []);

  const { data: card } = await supabaseAdmin.from('growth_cards').insert({
    workspace_id: workspaceId, user_id: userId, card_type: 'strategy',
    title: plan.title, body: plan.body,
    action_label: "Explore this week's plan with Clutch", action_type: 'internal_chat',
    priority: 9, expires_at: getNextWeekStart(), generated_by: 'ai_weekly',
    metadata: { daily_actions: plan.daily_actions, focus_area: plan.focus_area },
  }).select().single();
  logDB('INSERT', 'growth_cards', { userId, workspaceId, cardId: card?.id });
  res.json({ plan: card, cached: false });
}));

// ── Internal helpers ──────────────────────────────────────────

const computeCheckInStreak = async (userId, workspaceId, today) => {
  const { data: checkIns } = await supabaseAdmin
    .from('daily_check_ins').select('date, processed_at')
    .eq('user_id', userId).eq('workspace_id', workspaceId)
    .not('processed_at', 'is', null).order('date', { ascending: false }).limit(60);
  if (!checkIns?.length) return 1;
  const datesWithCheckIn = new Set(checkIns.map(c => c.date));
  datesWithCheckIn.add(today);
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    if (datesWithCheckIn.has(d)) streak++;
    else if (i > 0) break;
  }
  return streak;
};

const getWeekStart = () => {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString();
};
const getNextWeekStart = () => {
  const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay())); d.setHours(0, 0, 0, 0); return d.toISOString();
};

export default router;
