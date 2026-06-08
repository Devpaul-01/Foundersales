// src/routes/pipeline.js
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/workspace.js';
import { createLogger }    from '../utils/logger.js';
import { PIPELINE_STAGES, PIPELINE_STAGE_VALUES, ACTIVITY_EVENTS } from '../config/constants.js';
import { sendDealAssignedEmail } from '../services/email.js';
import supabaseAdmin       from '../config/supabase.js';

const router = Router();
const { log, logError } = createLogger('Pipeline');
/*
// GET /api/pipeline
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const viewTeam = req.query.view === 'team';
  const memberRole = req.membership?.role || 'member';

  if (viewTeam && !['manager', 'admin', 'owner'].includes(memberRole)) {
    return res.status(403).json({ error: 'PERMISSION_DENIED', message: "Team view requires 'manager' role." });
  }

  let query = supabaseAdmin.from('opportunities')
    .select('id, stage, target_name, target_context, prepared_message, platform, source_url, composite_score, marked_sent_at, created_at, fit_score, timing_score, intent_score, user_id, assigned_to, last_stage_changed_at, follow_up_message, follow_up_count, feedback(deal_value_usd, outcome, scheduled_call, scheduled_call_date)')
    .eq('workspace_id', workspaceId)
    .not('stage', 'eq', PIPELINE_STAGES.NEW)
    .order('composite_score', { ascending: false });

  if (!viewTeam) query = query.or(`user_id.eq.${userId},assigned_to.eq.${userId}`);

  const { data: opportunities, error } = await query;
  if (error) throw error;

  const pipeline = {
    [PIPELINE_STAGES.CONTACTED]: [], [PIPELINE_STAGES.REPLIED]: [],
    [PIPELINE_STAGES.CALL_DEMO]: [], [PIPELINE_STAGES.CLOSED_WON]: [], [PIPELINE_STAGES.CLOSED_LOST]: [],
  };
  
  for (const opp of (opportunities || [])) {
    if (pipeline[opp.stage]) {
      // Simple feedback extraction - handle both array and object
      let feedback = null;
      if (opp.feedback) {
        feedback = Array.isArray(opp.feedback) ? opp.feedback[0] : opp.feedback;
      }
      
      pipeline[opp.stage].push({
        id: opp.id, stage: opp.stage, user_id: opp.user_id, assigned_to: opp.assigned_to,
        target_name: opp.target_name || extractName(opp.target_context),
        target_context: opp.target_context, platform: opp.platform, source_url: opp.source_url,
        composite_score: opp.composite_score, marked_sent_at: opp.marked_sent_at,
        last_stage_changed_at: opp.last_stage_changed_at || opp.marked_sent_at || opp.created_at,
        follow_up_message: opp.follow_up_message || null, follow_up_count: opp.follow_up_count || 0,
        deal_value_usd: feedback?.deal_value_usd ?? null,
        scheduled_call_date: feedback?.scheduled_call_date ?? null,
      });
    }
  }

  let metricsQuery = supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId);
  if (!viewTeam) metricsQuery = metricsQuery.eq('user_id', userId);
  const { data: metricsRows } = await metricsQuery;
  const metricsView = viewTeam ? aggregateTeamMetrics(metricsRows || []) : (metricsRows?.[0] || null);

  // SIMPLE DEBUGGING - Print metrics column values
  console.log('\n========== PIPELINE METRICS DEBUG ==========');
  console.log('View Team:', viewTeam);
  console.log('User ID:', userId);
  console.log('Workspace ID:', workspaceId);
  console.log('\n--- METRICS VALUES FROM VIEW ---');
  if (metricsView) {
    console.log('contacted_count:', metricsView.contacted_count);
    console.log('replied_count:', metricsView.replied_count);
    console.log('call_demo_count:', metricsView.call_demo_count);
    console.log('closed_won_count:', metricsView.closed_won_count);
    console.log('closed_lost_count:', metricsView.closed_lost_count);
    console.log('total_revenue:', metricsView.total_revenue);
    console.log('pipeline_value:', metricsView.pipeline_value);
    console.log('win_rate_pct:', metricsView.win_rate_pct);
  } else {
    console.log('No metrics found - using defaults');
  }
  
  console.log('\n--- RAW DATA COUNTS FROM OPPORTUNITIES ---');
  const counts = {
    contacted: pipeline.contacted.length,
    replied: pipeline.replied.length,
    call_demo: pipeline.call_demo.length,
    closed_won: pipeline.closed_won.length,
    closed_lost: pipeline.closed_lost.length
  };
  console.log(counts);
  
  console.log('\n--- DEAL VALUES CHECK ---');
  const dealsWithValues = pipeline.closed_won.filter(d => d.deal_value_usd > 0);
  console.log('Closed won deals with deal_value_usd > 0:', dealsWithValues.length);
  if (dealsWithValues.length > 0) {
    console.log('Sample values:', dealsWithValues.slice(0, 3).map(d => ({ id: d.id, value: d.deal_value_usd })));
  }
  
  const nullValues = pipeline.closed_won.filter(d => !d.deal_value_usd);
  if (nullValues.length > 0) {
    console.log('Closed won deals with NULL/0 value:', nullValues.length);
    console.log('Sample IDs:', nullValues.slice(0, 3).map(d => d.id));
  }
  console.log('==========================================\n');

  log('get', { userId, workspaceId, view: viewTeam ? 'team' : 'individual', opportunityCount: (opportunities || []).length });
  res.json({ pipeline, view: viewTeam ? 'team' : 'individual', metrics: metricsView || { total_revenue: 0, pipeline_value: 0, win_rate_pct: 0 } });
}));
*/
router.get('/', asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // ─── Input Extraction ─────────────────────────────────────────────────────
  const userId     = req.user.id;
  const workspaceId = req.workspace.id;
  const viewTeam   = req.query.view === 'team';
  const memberRole = req.membership?.role || 'member';

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`[PIPELINE GET] requestId=${requestId}`);
  console.log(`[PIPELINE GET] userId=${userId} | workspaceId=${workspaceId}`);
  console.log(`[PIPELINE GET] view=${viewTeam ? 'team' : 'individual'} | memberRole=${memberRole}`);

  // ─── Permission Check ─────────────────────────────────────────────────────
  if (viewTeam && !['manager', 'admin', 'owner'].includes(memberRole)) {
    console.warn(`[PIPELINE GET] ✖ Permission denied | userId=${userId} | role=${memberRole} | requestId=${requestId}`);
    return res.status(403).json({ error: 'PERMISSION_DENIED', message: "Team view requires 'manager' role." });
  }

  // ─── Opportunities Query ──────────────────────────────────────────────────
  console.log(`[PIPELINE GET] Fetching opportunities | viewTeam=${viewTeam}...`);
  const oppFetchStart = Date.now();

  let query = supabaseAdmin
    .from('opportunities')
    .select('id, stage, target_name, target_context, prepared_message, platform, source_url, composite_score, marked_sent_at, created_at, fit_score, timing_score, intent_score, user_id, assigned_to, last_stage_changed_at, follow_up_message, follow_up_count, feedback(deal_value_usd, outcome, scheduled_call, scheduled_call_date)')
    .eq('workspace_id', workspaceId)
    .not('stage', 'eq', PIPELINE_STAGES.NEW)
    .order('composite_score', { ascending: false });

  if (!viewTeam) {
    console.log(`[PIPELINE GET] Scoping query to userId=${userId} (user_id or assigned_to)`);
    query = query.or(`user_id.eq.${userId},assigned_to.eq.${userId}`);
  }

  const { data: opportunities, error: oppError } = await query;
  console.log(`[PIPELINE GET] Opportunities fetch: ${Date.now() - oppFetchStart}ms`);

  if (oppError) {
    console.error(`[PIPELINE GET] ✖ Opportunities query failed | error=${oppError.message} | code=${oppError.code} | requestId=${requestId}`);
    throw oppError;
  }

  console.log(`[PIPELINE GET] ✔ Fetched ${(opportunities || []).length} opportunities`);

  // ─── Pipeline Bucketing ───────────────────────────────────────────────────
  const pipeline = {
    [PIPELINE_STAGES.CONTACTED]:   [],
    [PIPELINE_STAGES.REPLIED]:     [],
    [PIPELINE_STAGES.CALL_DEMO]:   [],
    [PIPELINE_STAGES.CLOSED_WON]:  [],
    [PIPELINE_STAGES.CLOSED_LOST]: [],
  };

  let skippedCount      = 0;
  let missingNameCount  = 0;
  let feedbackArrayHits = 0;

  for (const opp of (opportunities || [])) {
    if (!pipeline[opp.stage]) {
      console.warn(`[PIPELINE GET] Skipping opp id=${opp.id} | unrecognized stage="${opp.stage}"`);
      skippedCount++;
      continue;
    }

    let feedback = null;
    if (opp.feedback) {
      if (Array.isArray(opp.feedback)) {
        feedback = opp.feedback[0] ?? null;
        feedbackArrayHits++;
      } else {
        feedback = opp.feedback;
      }
    }

    const resolvedName = opp.target_name || extractName(opp.target_context);
    if (!opp.target_name) missingNameCount++;

    pipeline[opp.stage].push({
      id:                   opp.id,
      stage:                opp.stage,
      user_id:              opp.user_id,
      assigned_to:          opp.assigned_to,
      target_name:          resolvedName,
      target_context:       opp.target_context,
      platform:             opp.platform,
      source_url:           opp.source_url,
      composite_score:      opp.composite_score,
      marked_sent_at:       opp.marked_sent_at,
      last_stage_changed_at: opp.last_stage_changed_at || opp.marked_sent_at || opp.created_at,
      follow_up_message:    opp.follow_up_message || null,
      follow_up_count:      opp.follow_up_count || 0,
      deal_value_usd:       feedback?.deal_value_usd ?? null,
      scheduled_call_date:  feedback?.scheduled_call_date ?? null,
    });
  }

  // ─── Bucketing Summary ────────────────────────────────────────────────────
  const stageCounts = Object.fromEntries(
    Object.keys(pipeline).map(stage => [stage, pipeline[stage].length])
  );
  console.log(`[PIPELINE GET] Bucketing complete:`, JSON.stringify(stageCounts));

  if (skippedCount > 0)      console.warn(`[PIPELINE GET] ✖ Skipped ${skippedCount} opps with unrecognized stage`);
  if (missingNameCount > 0)  console.log(`[PIPELINE GET] extractName() fallback used for ${missingNameCount} opps`);
  if (feedbackArrayHits > 0) console.log(`[PIPELINE GET] Feedback returned as array (not object) for ${feedbackArrayHits} opps — check Supabase relation config`);

  // ─── Deal Value Integrity ─────────────────────────────────────────────────
  const closedWon         = pipeline[PIPELINE_STAGES.CLOSED_WON];
  const dealsWithValues   = closedWon.filter(d => d.deal_value_usd > 0);
  const dealsNullValue    = closedWon.filter(d => !d.deal_value_usd);

  console.log(`[PIPELINE GET] closed_won total=${closedWon.length} | with_value=${dealsWithValues.length} | null_or_zero=${dealsNullValue.length}`);

  if (dealsWithValues.length > 0) {
    console.log(`[PIPELINE GET] Sample deal values:`, dealsWithValues.slice(0, 3).map(d => ({ id: d.id, value: d.deal_value_usd })));
  }
  if (dealsNullValue.length > 0) {
    console.warn(`[PIPELINE GET] ✖ ${dealsNullValue.length} closed_won deal(s) have no deal_value_usd | sample ids:`, dealsNullValue.slice(0, 3).map(d => d.id));
  }

  // ─── Metrics Query ────────────────────────────────────────────────────────
  console.log(`[PIPELINE GET] Fetching pipeline_metrics | viewTeam=${viewTeam}...`);
  const metricsStart = Date.now();

  let metricsQuery = supabaseAdmin
    .from('pipeline_metrics')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (!viewTeam) metricsQuery = metricsQuery.eq('user_id', userId);

  const { data: metricsRows, error: metricsError } = await metricsQuery;
  console.log(`[PIPELINE GET] Metrics fetch: ${Date.now() - metricsStart}ms | rows=${metricsRows?.length ?? 0}`);

  if (metricsError) {
    // Non-fatal: pipeline data is still valid; surface the error but don't throw
    console.error(`[PIPELINE GET] ✖ Metrics query failed (non-fatal) | error=${metricsError.message} | code=${metricsError.code} | requestId=${requestId}`);
  }

  const metricsView = viewTeam
    ? aggregateTeamMetrics(metricsRows || [])
    : (metricsRows?.[0] || null);

  // ─── Metrics Summary ──────────────────────────────────────────────────────
  if (metricsView) {
    console.log(`[PIPELINE GET] Metrics resolved (${viewTeam ? 'aggregated-team' : 'individual'}):`, JSON.stringify({
      contacted_count:  metricsView.contacted_count,
      replied_count:    metricsView.replied_count,
      call_demo_count:  metricsView.call_demo_count,
      closed_won_count: metricsView.closed_won_count,
      closed_lost_count: metricsView.closed_lost_count,
      total_revenue:    metricsView.total_revenue,
      pipeline_value:   metricsView.pipeline_value,
      win_rate_pct:     metricsView.win_rate_pct,
    }));

    // Drift check: warn if metrics counts disagree with live opportunity counts
    const driftWarnings = [];
    if (metricsView.contacted_count  !== stageCounts[PIPELINE_STAGES.CONTACTED])   driftWarnings.push(`contacted: metrics=${metricsView.contacted_count} live=${stageCounts[PIPELINE_STAGES.CONTACTED]}`);
    if (metricsView.replied_count    !== stageCounts[PIPELINE_STAGES.REPLIED])     driftWarnings.push(`replied: metrics=${metricsView.replied_count} live=${stageCounts[PIPELINE_STAGES.REPLIED]}`);
    if (metricsView.call_demo_count  !== stageCounts[PIPELINE_STAGES.CALL_DEMO])   driftWarnings.push(`call_demo: metrics=${metricsView.call_demo_count} live=${stageCounts[PIPELINE_STAGES.CALL_DEMO]}`);
    if (metricsView.closed_won_count !== stageCounts[PIPELINE_STAGES.CLOSED_WON])  driftWarnings.push(`closed_won: metrics=${metricsView.closed_won_count} live=${stageCounts[PIPELINE_STAGES.CLOSED_WON]}`);
    if (driftWarnings.length > 0) {
      console.warn(`[PIPELINE GET] ✖ Metrics/live count drift detected | ${driftWarnings.join(' | ')} | requestId=${requestId}`);
    }
  } else {
    console.warn(`[PIPELINE GET] No metrics row found — returning zero defaults | userId=${userId} | requestId=${requestId}`);
  }

  // ─── Response ─────────────────────────────────────────────────────────────
  const totalMs = Date.now() - startTime;
  const view    = viewTeam ? 'team' : 'individual';

  console.log(`[PIPELINE GET] ✔ Complete | view=${view} | opps=${(opportunities || []).length} | totalMs=${totalMs} | requestId=${requestId}`);
  console.log(`${'═'.repeat(55)}\n`);

  log('get', { userId, workspaceId, view, opportunityCount: (opportunities || []).length, totalMs });
  res.json({
    pipeline,
    view,
    metrics: metricsView || { total_revenue: 0, pipeline_value: 0, win_rate_pct: 0 },
  });
}));

// GET /api/pipeline/:id — single deal detail view
router.get('/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId      = req.user.id;

  console.log('[DEBUG] GET /api/pipeline/:id - Starting request');
  console.log('[DEBUG] Request params:', { id: req.params.id, workspaceId, userId });

  // Get the opportunity first
  const { data: opp, error } = await supabaseAdmin
    .from('opportunities')
    .select('*')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  console.log('[DEBUG] Supabase query result:', { error, found: !!opp });

  if (error || !opp) {
    console.log('[ERROR] Deal not found:', error);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });
  }

  // Then get feedback separately to ensure it's an array
  const { data: feedback } = await supabaseAdmin
    .from('feedback')
    .select('id, outcome, outcome_note, deal_value_usd, scheduled_call, scheduled_call_date, created_at')
    .eq('opportunity_id', req.params.id);
  
  console.log('[DEBUG] Feedback query result:', { 
    feedbackLength: feedback?.length, 
    feedback: feedback 
  });

  // Always return feedback as an array (even if empty)
  const response = {
    ...opp,
    feedback: feedback || []  // ← Always an array
  };

  console.log('[DEBUG] Final response feedback array length:', response.feedback.length);
  console.log('[DEBUG] First feedback item:', response.feedback[0]);

  res.json({ deal: response });
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
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${req.user.id},assigned_to.eq.${req.user.id}`).single();
  if (findError || !opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found' });

  const previousStage = opp.stage;
  const updates = { stage, last_stage_changed_at: new Date().toISOString() };
  if (stage === PIPELINE_STAGES.CLOSED_LOST && lost_reason?.trim()) updates.lost_reason = lost_reason.trim();
  await supabaseAdmin.from('opportunities').update(updates).eq('id', id);

  if (stage === PIPELINE_STAGES.CLOSED_WON) {
  try {
    await supabaseAdmin.from('workspace_activity').insert({
      workspace_id: workspaceId, 
      user_id: req.user.id,
      event_type: ACTIVITY_EVENTS.DEAL_CLOSED,
      metadata: { deal_name: opp.target_name || 'Unnamed deal', opportunity_id: id },
    });
  } catch (err) {
    // Log but don't fail the main operation
    console.error('Failed to log workspace activity:', err);
  }
}

  log('stage', { userId: req.user.id, workspaceId, opportunityId: id, previousStage, newStage: stage });
  res.json({
    success: true, previous_stage: previousStage, new_stage: stage,
    calendar_prompt: stage === PIPELINE_STAGES.CALL_DEMO ? buildCalendarPrompt(opp) : null,
  });
}));

// PATCH /api/pipeline/:id/deal-value
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
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  // Check if feedback already exists
  const { data: existingFeedback, error: lookupError } = await supabaseAdmin
  .from('feedback')
  .select('id')
  .eq('opportunity_id', id)
  .single();

console.log('existingFeedback:', existingFeedback, 'lookupError:', lookupError);

  let error;
  
  if (existingFeedback) {
    // Update only deal_value_usd, preserve existing outcome
    const result = await supabaseAdmin
      .from('feedback')
      .update({
        deal_value_usd: dealValue,
        updated_at: new Date().toISOString()
      })
      .eq('opportunity_id', id);
    error = result.error;
  } else {
    // Insert new feedback with 'pending' outcome
    const result = await supabaseAdmin
      .from('feedback')
      .insert({
        opportunity_id: id,
        user_id: userId,
        workspace_id: workspaceId,
        deal_value_usd: dealValue,
        outcome: 'pending',
        created_at: new Date().toISOString()
      });
    error = result.error;
  }

  if (error) throw error;

  log('deal-value', { userId, workspaceId, opportunityId: id, dealValue });
  res.json({ success: true, deal_value_usd: dealValue});
}));


// DELETE /api/pipeline/:id — remove a deal from the pipeline
router.delete('/:id', requirePermission('member'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const userId      = req.user.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('id')
    .eq('id', req.params.id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  const { error } = await supabaseAdmin
    .from('opportunities')
    .delete()
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`);

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
// PUT /api/pipeline/:id/assign
router.put('/:id/assign', requirePermission('manager'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user_id: assigneeId } = req.body;
  const workspaceId = req.workspace.id;

  if (!assigneeId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'user_id is required' });

  // Verify assignee is an active workspace member
  const { data: member } = await supabaseAdmin
    .from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', assigneeId).eq('status', 'active').single();
  if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'Assignee is not an active member.' });

  // Fetch deal + assignee email + assigner name in parallel
  const [{ data: opp }, { data: assignee }, { data: assigner }] = await Promise.all([
    supabaseAdmin.from('opportunities').select('id, target_name, target_context')
      .eq('id', id).eq('workspace_id', workspaceId).single(),
    supabaseAdmin.from('users').select('email, name').eq('id', assigneeId).single(),
    supabaseAdmin.from('users').select('name').eq('id', req.user.id).single(),
  ]);

  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Deal not found.' });

  await supabaseAdmin.from('opportunities').update({ assigned_to: assigneeId }).eq('id', id);

  // Send email — fire and forget, don't fail the request if email fails
  if (assignee?.email) {
    sendDealAssignedEmail({
      assigneeEmail: assignee.email,
      assigneeName:  assignee.name,
      assignerName:  assigner?.name,
      dealName:      opp.target_name || extractName(opp.target_context),
      opportunityId: id,
    }).catch(err => logError('ASSIGN_EMAIL_FAILED', err, { opportunityId: id, assigneeId }));
  }

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
