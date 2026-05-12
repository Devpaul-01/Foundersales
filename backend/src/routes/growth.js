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
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('stage', 'new')
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
  const userId = req.user.id, workspaceId = req.workspace.id;
  const archetype = req.workspaceProfile?.archetype || 'seller';
  const today     = new Date().toISOString().split('T')[0];
  log('CHECKIN TODAY', { userId, workspaceId, today });

  const { data: existing } = await supabaseAdmin
    .from('daily_check_ins').select('*')
    .eq('user_id', userId).eq('workspace_id', workspaceId).eq('date', today).single();
  if (existing) return res.json({ check_in: existing, is_new: false });

  const { data: recentMessages } = await supabaseAdmin
    .from('chat_messages').select('content, role')
    .eq('user_id', userId).eq('workspace_id', workspaceId)
    .in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(8);
  const chatContext = recentMessages?.map(m => m.content?.slice(0, 200)).join(' | ').slice(0, 600) || '';

  const { data: goals } = await supabaseAdmin
    .from('user_goals').select('goal_text, target_value, target_unit, current_value')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(2);

  logAI('generateCheckInQuestions', { userId, archetype });
  const userCtx   = buildUserContext(req);
  const questions = await groqService.generateCheckInQuestions(userCtx, archetype, chatContext, goals || []);

  const { data: newCheckIn } = await supabaseAdmin
    .from('daily_check_ins')
    .insert({ user_id: userId, workspace_id: workspaceId, date: today, questions, chat_context: chatContext })
    .select().single();
  logDB('INSERT', 'daily_check_ins', { userId, workspaceId, date: today });
  res.json({ check_in: newCheckIn, is_new: true });
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
      .eq('workspace_id', workspaceId).eq('user_id', userId)
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
