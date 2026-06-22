// src/routes/followup.js — Gap 5 (requirePermission member+), CRIT-03 (shared logger)
import { Router }            from 'express';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import supabaseAdmin         from '../config/supabase.js';
import { PIPELINE_STAGES }   from '../config/constants.js';

export const followupRouter = Router();
const { log, logError, logDB } = createLogger('Followup');

// Safely serialize a Supabase error into a readable string for logError,
// since logError string-coerces its second arg and Supabase errors are objects.
function fmtErr(e) {
  if (!e) return 'null';
  return JSON.stringify({
    message: e.message,
    code:    e.code,
    details: e.details,
    hint:    e.hint,
  });
}

// GET /api/followup/unviewed-count
followupRouter.get('/unviewed-count', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  log(`unviewed-count → userId=${userId} workspaceId=${workspaceId}`);

  const { error, count } = await supabaseAdmin
    .from('opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .not('follow_up_message', 'is', null)
    .is('follow_up_viewed_at', null)
    .in('stage', [PIPELINE_STAGES.CONTACTED, PIPELINE_STAGES.REPLIED, PIPELINE_STAGES.CALL_DEMO]);

  if (error) {
    logError(`unviewed-count → DB error ${fmtErr(error)}`);
    throw error;
  }

  log(`unviewed-count → result count=${count ?? 0}`);
  res.json({
    unviewed_count: count ?? 0,
    has_unviewed:   (count ?? 0) > 0,
  });
}));

// GET /api/followup — list pending follow-ups
followupRouter.get('/', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  log(`list → userId=${userId} workspaceId=${workspaceId}`);

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

  if (error) {
    logError(`list → DB error ${fmtErr(error)}`);
    throw error;
  }

  log(`list → returned ${opps?.length ?? 0} opportunities`);

  if (opps?.length) {
    const ids = opps.map(o => o.id);
    log(`list → marking ${ids.length} opportunities as viewed`);
    const { error: viewError } = await supabaseAdmin
      .from('opportunities')
      .update({ follow_up_viewed_at: new Date().toISOString() })
      .in('id', ids);
    if (viewError) logError(`list → mark-viewed error ${fmtErr(viewError)}`);
  }

  res.json({ opportunities: opps || [] });
}));

// POST /api/followup/:id/sent  (Gap 5: member+)
followupRouter.post('/:id/sent', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const { id }      = req.params;
  log(`sent → START id=${id} userId=${userId} workspaceId=${workspaceId}`);

  // FETCH — read current row to get follow_up_count for manual increment
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('opportunities')
    .select('id, follow_up_count, user_id, assigned_to, workspace_id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (fetchError) {
    logError(`sent → FETCH DB error id=${id} ${fmtErr(fetchError)}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'fetch', reason: fetchError.message });
  }
  if (!current) {
    logError(`sent → FETCH no row (ownership/workspace mismatch?) id=${id} userId=${userId} workspaceId=${workspaceId}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'fetch', reason: 'no_row' });
  }
  log(`sent → FETCH ok follow_up_count=${current.follow_up_count} owner=${current.user_id} assigned=${current.assigned_to}`);

  // UPDATE
  logDB('UPDATE', 'opportunities', { id, userId, workspaceId, fields: 'follow_up_sent_at,follow_up_count' });
  // Ownership already verified in FETCH above — .or() on UPDATE causes
  // PostgREST to generate invalid SQL ("column does not exist"), so omit it.
  const { data, error: updateError } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_sent_at: new Date().toISOString(),
      follow_up_count:   (current.follow_up_count || 0) + 1,
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, follow_up_count')
    .single();

  if (updateError) {
    logError(`sent → UPDATE DB error id=${id} ${fmtErr(updateError)}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'update', reason: updateError.message });
  }
  if (!data) {
    logError(`sent → UPDATE no row (race condition / RLS?) id=${id} userId=${userId}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'update', reason: 'no_row' });
  }

  log(`sent → UPDATE ok follow_up_count=${data.follow_up_count}`);
  res.json({ success: true, follow_up_count: data.follow_up_count });
}));

// POST /api/followup/:id/dismiss  (Gap 5: member+)
followupRouter.post('/:id/dismiss', requirePermission('member'), asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const { id }      = req.params;
  log(`dismiss → START id=${id} userId=${userId} workspaceId=${workspaceId}`);

  // FETCH — read current row to get follow_up_count for manual increment
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('opportunities')
    .select('id, follow_up_count, user_id, assigned_to, workspace_id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (fetchError) {
    logError(`dismiss → FETCH DB error id=${id} ${fmtErr(fetchError)}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'fetch', reason: fetchError.message });
  }
  if (!current) {
    logError(`dismiss → FETCH no row (ownership/workspace mismatch?) id=${id} userId=${userId} workspaceId=${workspaceId}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'fetch', reason: 'no_row' });
  }
  log(`dismiss → FETCH ok follow_up_count=${current.follow_up_count} owner=${current.user_id} assigned=${current.assigned_to}`);

  // UPDATE
  logDB('UPDATE', 'opportunities', { id, userId, workspaceId, fields: 'follow_up_message,follow_up_dismissed_at,follow_up_count' });
  // Ownership already verified in FETCH above — .or() on UPDATE causes
  // PostgREST to generate invalid SQL ("column does not exist"), so omit it.
  const { data, error: updateError } = await supabaseAdmin
    .from('opportunities')
    .update({
      follow_up_message:      null,
      follow_up_dismissed_at: new Date().toISOString(),
      follow_up_count:        (current.follow_up_count || 0) + 1,
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id')
    .single();

  if (updateError) {
    logError(`dismiss → UPDATE DB error id=${id} ${fmtErr(updateError)}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'update', reason: updateError.message });
  }
  if (!data) {
    logError(`dismiss → UPDATE no row (race condition / RLS?) id=${id} userId=${userId}`);
    return res.status(404).json({ error: 'NOT_FOUND', stage: 'update', reason: 'no_row' });
  }

  log(`dismiss → UPDATE ok id=${data.id}`);
  res.json({ success: true });
}));

export default followupRouter;
