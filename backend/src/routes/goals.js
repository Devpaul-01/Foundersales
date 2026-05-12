// src/routes/goals.js — IMP-02 (backgroundQueue for tip cards), Gap 5 (member+), Gap 3 (activity on goal_reached), CRIT-03 (logger)
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { requirePermission, buildUserContext } from '../middleware/workspace.js';
import { createLogger }    from '../utils/logger.js';
import supabaseAdmin       from '../config/supabase.js';
import { callWithFallback } from '../services/multiProvider.js';
import { recordTokenUsage } from '../services/tokenTracker.js';
import { getCache, setCache } from '../services/redis.js';
import { backgroundQueue } from '../jobs/queues.js';
import { BACKGROUND_JOB_TYPES, ACTIVITY_EVENTS } from '../config/constants.js';

const router = Router();
const { log, logError, logDB, logAI } = createLogger('Goals');

// GET /api/goals
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  log('LIST_GOALS', { userId, workspaceId });
  const { data: goals, error } = await supabaseAdmin.from('user_goals').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).order('created_at', { ascending: false });
  if (error) { logError('GET /', error, { userId }); throw error; }
  res.json({ goals: goals || [] });
}));

// POST /api/goals  (Gap 5: member+)
router.post('/', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { goal_text, goal_type, target_value, target_unit, target_date } = req.body;
  if (!goal_text?.trim()) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'goal_text required' });
  const { data: goal, error } = await supabaseAdmin.from('user_goals').insert({ workspace_id: workspaceId, user_id: userId, goal_text: goal_text.trim(), goal_type: goal_type || 'custom', target_value: target_value || null, target_unit: target_unit || null, target_date: target_date || null }).select().single();
  if (error) { logError('POST /', error, { userId }); throw error; }
  res.json({ success: true, goal });
}));

// PUT /api/goals/:id  (Gap 5: member+)
router.put('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: goal } = await supabaseAdmin.from('user_goals').select('id').eq('id', id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!goal) return res.status(404).json({ error: 'NOT_FOUND' });
  const allowed = ['goal_text','goal_type','target_value','target_unit','target_date','status'];
  const updates = {};
  for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Nothing to update' });
  const { error } = await supabaseAdmin.from('user_goals').update(updates).eq('id', id);
  if (error) throw error;
  res.json({ success: true });
}));

// DELETE /api/goals/:id  (Gap 5: member+)
router.delete('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: goal } = await supabaseAdmin.from('user_goals').select('id').eq('id', id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!goal) return res.status(404).json({ error: 'NOT_FOUND' });
  await supabaseAdmin.from('user_goals').delete().eq('id', id);
  res.json({ success: true });
}));

// GET /api/goals/:goalId/notes
router.get('/:goalId/notes', asyncHandler(async (req, res) => {
  const { goalId } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: goal } = await supabaseAdmin.from('user_goals').select('id').eq('id', goalId).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!goal) return res.status(404).json({ error: 'NOT_FOUND' });
  const { data: notes, error } = await supabaseAdmin.from('goal_notes').select('*').eq('goal_id', goalId).order('created_at', { ascending: false });
  if (error) throw error;
  res.json({ notes: notes || [] });
}));

// POST /api/goals/:goalId/notes  (Gap 5: member+, IMP-02: durable queue)
router.post('/:goalId/notes', requirePermission('member'), asyncHandler(async (req, res) => {
  const { goalId } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { note_text, explicit_delta } = req.body;
  if (!note_text?.trim()) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'note_text required' });

  const { data: goal, error: goalErr } = await supabaseAdmin.from('user_goals').select('*').eq('id', goalId).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (goalErr || !goal) return res.status(404).json({ error: 'NOT_FOUND' });

  const userCtx = buildUserContext(req);
  logAI('goal note coaching', { userId, goalId });

  const prompt = `You are a performance coach. The user is working towards: "${goal.goal_text}". Current progress: ${goal.current_value ?? 0}/${goal.target_value ?? '?'} ${goal.target_unit ?? ''}. Their note: "${note_text}". Product: ${userCtx.product_description ?? 'not specified'}. Respond ONLY as JSON: {"coaching_response":"<2-3 sentence response>","progress_delta":<number or null>,"needs_tip_card":<boolean>,"tip_context":"<brief context if needs_tip_card else null>"}`;

  let parsed = { coaching_response: 'Keep going!', progress_delta: null, needs_tip_card: false, tip_context: null };
  try {
    const { content, tokens_in, tokens_out } = await callWithFallback({ systemPrompt: 'You are a performance coach. Return only valid JSON.', messages: [{ role: 'user', content: prompt }], temperature: 0.4, maxTokens: 200 });
    await recordTokenUsage(userId, 'groq', tokens_in, tokens_out);
    parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch (aiErr) { logError('goal note AI', aiErr, { userId, goalId }); }

  const delta    = explicit_delta != null ? (parseFloat(explicit_delta) || 0) : (parseFloat(parsed.progress_delta) || 0);
  const newValue = Math.max(0, (goal.current_value ?? 0) + delta);

  if (delta !== 0) await supabaseAdmin.rpc('increment_goal_progress', { p_goal_id: goalId, p_delta: delta }).catch(() => {});

  let goalCompleted = false;
  if (goal.target_value && newValue >= goal.target_value && goal.status === 'active') {
    await supabaseAdmin.from('user_goals').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', goalId);
    goalCompleted = true;
    // Gap 3: activity event
    await supabaseAdmin.from('workspace_activity').insert({ workspace_id: workspaceId, user_id: userId, event_type: ACTIVITY_EVENTS.GOAL_REACHED, metadata: { goal_text: goal.goal_text } }).catch(() => {});
  }

  const { data: note, error: noteError } = await supabaseAdmin.from('goal_notes').insert({ goal_id: goalId, user_id: userId, note_text: note_text.trim(), ai_response: parsed.coaching_response, progress_delta: delta, sentiment: parsed.needs_tip_card ? 'negative' : delta > 0 ? 'positive' : 'neutral' }).select().single();
  if (noteError) throw noteError;

  // IMP-02: replace inline IIFE with durable background queue
  if (parsed.needs_tip_card && parsed.tip_context) {
    await backgroundQueue.add(BACKGROUND_JOB_TYPES.TIP_CARD_GENERATE, { userId, workspaceId, goalId, tip_context: parsed.tip_context, goal_text: goal.goal_text, product_description: userCtx.product_description }).catch(err => logError('backgroundQueue tip_card', err, { userId }));
  }

  res.status(201).json({ success: true, note, coaching_response: parsed.coaching_response, progress_delta: delta, new_value: newValue, goal_completed: goalCompleted });
}));

// DELETE /api/goals/:goalId/notes/:noteId  (Gap 5: member+)
router.delete('/:goalId/notes/:noteId', requirePermission('member'), asyncHandler(async (req, res) => {
  const { goalId, noteId } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: goal } = await supabaseAdmin.from('user_goals').select('id').eq('id', goalId).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!goal) return res.status(404).json({ error: 'NOT_FOUND' });
  await supabaseAdmin.from('goal_notes').delete().eq('id', noteId).eq('user_id', userId);
  res.json({ success: true });
}));

// GET /api/goals/pipeline-insight
router.get('/pipeline-insight', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const cKey = `goals:pipeline-insight:${userId}:${workspaceId}`;
  const cached = await getCache(cKey).catch(() => null);
  if (cached) return res.json({ insight: cached, cached: true });

  const [{ data: goals }, { data: pipelineMetrics }] = await Promise.all([
    supabaseAdmin.from('user_goals').select('goal_text, current_value, target_value, target_unit, status').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3),
    supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).single(),
  ]);

  if (!goals?.length || !pipelineMetrics) return res.json({ insight: null, cached: false, reason: 'insufficient_data' });

  const userCtx = buildUserContext(req);
  const prompt = `Connect this seller's pipeline metrics to their active goals and give ONE high-leverage observation.\nProduct: ${userCtx.product_description || 'not specified'}\nActive goals: ${goals.map(g => `"${g.goal_text}" (${g.current_value || 0}/${g.target_value || '?'} ${g.target_unit || ''})`).join(', ')}\nPipeline: ${pipelineMetrics.replied_count || 0} replies, ${pipelineMetrics.call_demo_count || 0} demos, ${pipelineMetrics.closed_won_count || 0} wins\nReturn ONLY JSON: {"title":"short title","body":"2-3 specific sentences","action":"one concrete action or null"}`;

  try {
    const { content, tokens_in, tokens_out } = await callWithFallback({ systemPrompt: 'You connect sales pipeline metrics to goals. Return only JSON.', messages: [{ role: 'user', content: prompt }], temperature: 0.4, maxTokens: 250 });
    await recordTokenUsage(userId, 'groq', tokens_in, tokens_out);
    const insight = JSON.parse(content.replace(/```json|```/g, '').trim());
    await setCache(cKey, insight, 24*60*60).catch(() => {});
    res.json({ insight, cached: false });
  } catch (err) {
    logError('pipeline-insight', err, { userId });
    res.json({ insight: null, cached: false });
  }
}));

export default router;
