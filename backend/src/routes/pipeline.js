// src/routes/pipeline.js
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/workspace.js';
import { createLogger }    from '../utils/logger.js';
import { PIPELINE_STAGES, PIPELINE_STAGE_VALUES, ACTIVITY_EVENTS } from '../config/constants.js';
import supabaseAdmin       from '../config/supabase.js';

const router = Router();
const { log, logError } = createLogger('Pipeline');

// GET /api/pipeline
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const viewTeam   = req.query.view === 'team';
  const memberRole = req.membership?.role || 'member';

  if (viewTeam && !['manager', 'admin', 'owner'].includes(memberRole)) {
    return res.status(403).json({ error: 'PERMISSION_DENIED', message: "Team view requires 'manager' role." });
  }

  let query = supabaseAdmin.from('opportunities')
    .select('id, stage, target_name, target_context, prepared_message, platform, source_url, composite_score, marked_sent_at, created_at, fit_score, timing_score, intent_score, user_id, assigned_to, last_stage_changed_at, follow_up_message, follow_up_count, feedback(deal_value_usd, outcome, scheduled_call, scheduled_call_date)')
    .eq('workspace_id', workspaceId)
    .not('stage', 'eq', PIPELINE_STAGES.NEW)
    .order('composite_score', { ascending: false });

  if (!viewTeam) query = query.eq('user_id', userId);

  const { data: opportunities, error } = await query;
  if (error) throw error;

  const pipeline = {
    [PIPELINE_STAGES.CONTACTED]: [], [PIPELINE_STAGES.REPLIED]: [],
    [PIPELINE_STAGES.CALL_DEMO]: [], [PIPELINE_STAGES.CLOSED_WON]: [], [PIPELINE_STAGES.CLOSED_LOST]: [],
  };
  for (const opp of (opportunities || [])) {
    if (pipeline[opp.stage]) {
      pipeline[opp.stage].push({
        id: opp.id, stage: opp.stage, user_id: opp.user_id, assigned_to: opp.assigned_to,
        target_name: opp.target_name || extractName(opp.target_context),
        target_context: opp.target_context, platform: opp.platform, source_url: opp.source_url,
        composite_score: opp.composite_score, marked_sent_at: opp.marked_sent_at,
        last_stage_changed_at: opp.last_stage_changed_at || opp.marked_sent_at || opp.created_at,
        follow_up_message: opp.follow_up_message || null, follow_up_count: opp.follow_up_count || 0,
        deal_value_usd: opp.feedback?.[0]?.deal_value_usd || null,
        scheduled_call_date: opp.feedback?.[0]?.scheduled_call_date || null,
      });
    }
  }

  let metricsQuery = supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId);
  if (!viewTeam) metricsQuery = metricsQuery.eq('user_id', userId);
  const { data: metricsRows } = await metricsQuery;
  const metricsView = viewTeam ? aggregateTeamMetrics(metricsRows || []) : (metricsRows?.[0] || null);

  log('get', { userId, workspaceId, view: viewTeam ? 'team' : 'individual', opportunityCount: (opportunities || []).length });
  res.json({ pipeline, view: viewTeam ? 'team' : 'individual', metrics: metricsView || { total_revenue: 0, pipeline_value: 0, win_rate_pct: 0 } });
}));

// GET /api/pipeline/:id — single deal detail view
router.get('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId      = req.user.id;

  const { data: opp, error } = await supabaseAdmin
    .from('opportunities')
    .select('*, feedback(id, outcome, outcome_note, deal_value_usd, scheduled_call, scheduled_call_date, created_at)')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  res.json({ deal: opp });
}));

// PUT /api/pipeline/:id/stage
router.put('/:id/stage', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { stage, lost_reason } = req.body;
  const workspaceId = req.workspace.id;

  if (!stage || !PIPELINE_STAGE_VALUES.includes(stage)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `stage must be one of: ${PIPELINE_STAGE_VALUES.join(', ')}` });
  }

  const { data: opp, error: findError } = await supabaseAdmin
    .from('opportunities').select('id, user_id, workspace_id, stage, target_name, target_context')
    .eq('id', id).eq('workspace_id', workspaceId).eq('user_id', req.user.id).single();
  if (findError || !opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found' });

  const previousStage = opp.stage;
  const updates = { stage, last_stage_changed_at: new Date().toISOString() };
  if (stage === PIPELINE_STAGES.CLOSED_LOST && lost_reason?.trim()) updates.lost_reason = lost_reason.trim();
  await supabaseAdmin.from('opportunities').update(updates).eq('id', id);

  if (stage === PIPELINE_STAGES.CLOSED_WON) {
    await supabaseAdmin.from('workspace_activity').insert({
      workspace_id: workspaceId, user_id: req.user.id,
      event_type: ACTIVITY_EVENTS.DEAL_CLOSED,
      metadata: { deal_name: opp.target_name || 'Unnamed deal', opportunity_id: id },
    }).catch(() => {});
  }

  log('stage', { userId: req.user.id, workspaceId, opportunityId: id, previousStage, newStage: stage });
  res.json({
    success: true, previous_stage: previousStage, new_stage: stage,
    calendar_prompt: stage === PIPELINE_STAGES.CALL_DEMO ? buildCalendarPrompt(opp) : null,
  });
}));

// PATCH /api/pipeline/:id/deal-value — update deal value independent of full feedback submission
router.patch('/:id/deal-value', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspace.id;
  const userId      = req.user.id;

  const dealValue = parseFloat(req.body.deal_value_usd);
  if (isNaN(dealValue) || dealValue < 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'deal_value_usd must be a non-negative number.' });
  }

  // Verify opportunity belongs to this user/workspace
  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('id')
    .eq('id', id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  // Upsert into feedback table — creates a feedback row if none exists yet
  const { error } = await supabaseAdmin
    .from('feedback')
    .upsert({
      opportunity_id: id,
      user_id:        userId,
      workspace_id:   workspaceId,
      deal_value_usd: dealValue,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'opportunity_id' });

  if (error) throw error;

  log('deal-value', { userId, workspaceId, opportunityId: id, dealValue });
  res.json({ success: true, deal_value_usd: dealValue });
}));

// DELETE /api/pipeline/:id — remove a deal from the pipeline
router.delete('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId      = req.user.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('id')
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', userId).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  const { error } = await supabaseAdmin
    .from('opportunities')
    .delete()
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) throw error;

  log('delete', { userId, workspaceId, opportunityId: req.params.id });
  res.json({ success: true });
}));

// GET /api/pipeline/metrics
router.get('/metrics', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { data: metrics } = await supabaseAdmin.from('pipeline_metrics').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId).single();
  res.json(metrics || { total_revenue: 0, pipeline_value: 0, win_rate_pct: 0, contacted_count: 0, replied_count: 0, call_demo_count: 0, closed_won_count: 0, closed_lost_count: 0 });
}));

// GET /api/pipeline/team
router.get('/team', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { data: deals, error } = await supabaseAdmin.from('opportunities')
    .select('id, stage, target_name, target_context, platform, composite_score, user_id, assigned_to, created_at, marked_sent_at, users!user_id(id, name, email)')
    .eq('workspace_id', workspaceId)
    .not('stage', 'eq', PIPELINE_STAGES.NEW)
    .order('composite_score', { ascending: false });
  if (error) throw error;
  res.json({ deals: deals || [], workspace_id: workspaceId });
}));

// PUT /api/pipeline/:id/assign
router.put('/:id/assign', requirePermission('manager'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user_id: assigneeId } = req.body;
  const workspaceId = req.workspace.id;

  if (!assigneeId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'user_id is required' });

  const { data: member } = await supabaseAdmin.from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', assigneeId).eq('status', 'active').single();
  if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'Assignee is not an active member.' });

  const { data: opp } = await supabaseAdmin.from('opportunities').select('id, target_name')
    .eq('id', id).eq('workspace_id', workspaceId).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  await supabaseAdmin.from('opportunities').update({ assigned_to: assigneeId }).eq('id', id);
  log('ASSIGN', { workspaceId, opportunityId: id, assigneeId, byUserId: req.user.id });
  res.json({ success: true, assigned_to: assigneeId });
}));

// ── Helpers ───────────────────────────────────────────────────
const buildCalendarPrompt = (opp) => ({
  show: true,
  suggested_title:   `Call with ${opp.target_name || 'prospect'}`,
  opportunity_id:    opp.id,
  suggested_type:    'call_demo',
  message:           'Want to add this call to Clutch Calendar?',
});

const extractName = (context) => {
  if (!context) return 'Prospect';
  const redditUser = context.match(/u\/([a-zA-Z0-9_-]+)/);
  if (redditUser) return `u/${redditUser[1]}`;
  const twitterHandle = context.match(/@([a-zA-Z0-9_]+)/);
  if (twitterHandle) return `@${twitterHandle[1]}`;
  return 'Prospect';
};

const aggregateTeamMetrics = (rows) => {
  if (!rows.length) return null;
  return rows.reduce((acc, row) => ({
    total_revenue:     (acc.total_revenue     || 0) + (row.total_revenue     || 0),
    pipeline_value:    (acc.pipeline_value    || 0) + (row.pipeline_value    || 0),
    contacted_count:   (acc.contacted_count   || 0) + (row.contacted_count   || 0),
    replied_count:     (acc.replied_count     || 0) + (row.replied_count     || 0),
    call_demo_count:   (acc.call_demo_count   || 0) + (row.call_demo_count   || 0),
    closed_won_count:  (acc.closed_won_count  || 0) + (row.closed_won_count  || 0),
    closed_lost_count: (acc.closed_lost_count || 0) + (row.closed_lost_count || 0),
    win_rate_pct: (() => {
      const w = (acc.closed_won_count  || 0) + (row.closed_won_count  || 0);
      const l = (acc.closed_lost_count || 0) + (row.closed_lost_count || 0);
      return (w + l) > 0 ? Math.round(w * 100 / (w + l)) : 0;
    })(),
  }), {});
};

export default router;
