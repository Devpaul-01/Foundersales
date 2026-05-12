// src/routes/followup.js — Gap 5 (requirePermission member+), CRIT-03 (shared logger)
import { Router }            from 'express';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import supabaseAdmin         from '../config/supabase.js';
import { PIPELINE_STAGES }   from '../config/constants.js';

export const followupRouter = Router();
const { log, logError, logDB } = createLogger('Followup');

// GET /api/followup — list pending follow-ups
followupRouter.get('/', asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  log('Get Follow-ups', { userId, workspaceId });

  const { data: opps, error } = await supabaseAdmin
    .from('opportunities')
    .select(`
      id, platform, target_name, target_context, stage,
      follow_up_message, follow_up_count, follow_up_sent_at,
      marked_sent_at, last_stage_changed_at, composite_score
    `)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .not('follow_up_message', 'is', null)
    .in('stage', [PIPELINE_STAGES.CONTACTED, PIPELINE_STAGES.REPLIED, PIPELINE_STAGES.CALL_DEMO])
    .order('follow_up_sent_at', { ascending: false })
    .limit(20);

  if (error) { logError('GET /', error, { userId }); throw error; }
  log('Get Follow-ups Done', { userId, count: opps?.length || 0 });
  res.json({ opportunities: opps || [] });
}));

// POST /api/followup/:id/sent  (Gap 5: member+)
followupRouter.post('/:id/sent', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  logDB('UPDATE', 'opportunities', { id: req.params.id, userId, workspaceId, fields: 'follow_up_sent_at,follow_up_count' });

  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_sent_at: new Date().toISOString(),
      follow_up_count:   supabaseAdmin.rpc('increment', { x: 1 }),
    })
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('id, follow_up_count')
    .single();

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ success: true, follow_up_count: data.follow_up_count });
}));

// POST /api/followup/:id/dismiss  (Gap 5: member+)
followupRouter.post('/:id/dismiss', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  logDB('UPDATE', 'opportunities', { id: req.params.id, userId, workspaceId, fields: 'follow_up_message,follow_up_dismissed_at' });

  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_message:      null,
      follow_up_dismissed_at: new Date().toISOString(),
      follow_up_count:        supabaseAdmin.rpc('increment', { x: 1 }),
    })
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('id')
    .single();

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ success: true });
}));

export default followupRouter;
