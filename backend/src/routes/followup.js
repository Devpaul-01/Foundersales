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
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
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
  const { id }      = req.params;
  logDB('UPDATE', 'opportunities', { id, userId, workspaceId, fields: 'follow_up_sent_at,follow_up_count' });

  // Fetch first so we can increment follow_up_count manually.
  // Note: there is no generic increment() RPC in the schema — all increment_*
  // functions are column-specific. A read-then-write is the safe approach here.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('opportunities')
    .select('id, follow_up_count')
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (fetchError || !current) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_sent_at: new Date().toISOString(),
      follow_up_count:   (current.follow_up_count || 0) + 1,
    })
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .select('id, follow_up_count')
    .single();

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ success: true, follow_up_count: data.follow_up_count });
}));

// POST /api/followup/:id/dismiss  (Gap 5: member+)
followupRouter.post('/:id/dismiss', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const { id }      = req.params;
  logDB('UPDATE', 'opportunities', { id, userId, workspaceId, fields: 'follow_up_message,follow_up_count' });

  // Read current count before incrementing (no generic increment() RPC in schema).
  // follow_up_dismissed_at is tracked via the migration adding the column.
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('opportunities')
    .select('id, follow_up_count')
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (fetchError || !current) return res.status(404).json({ error: 'NOT_FOUND' });

  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_message:      null,
      follow_up_dismissed_at: new Date().toISOString(),
      follow_up_count:        (current.follow_up_count || 0) + 1,
    })
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .select('id')
    .single();

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ success: true });
}));

export default followupRouter;
