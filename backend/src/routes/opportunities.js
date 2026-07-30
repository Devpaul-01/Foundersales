// src/routes/opportunities.js — Gap 4 (team view, assign), Gap 5 (member+ on writes), Gap 3 (opportunity_created activity), Gap 6 (push on assign), CRIT-03 (logger)
//
// FIXES APPLIED (refinement plan):
//  Issue 5:  Route order already correct in this version —
//            /team and /:id/assign are registered before /:id.
//  Issue 15: recordTokenUsage in GET /:id/intel changed from
//            (userId, ...) → (workspaceId, ...) to match every other
//            call site in the codebase (chat.js, backgroundWorker.js, etc).
//            Token usage is aggregated at workspace level for billing/quota.
//  Bug F:    Pagination uses offset/limit from validated req.query.
//            The validate(listOpportunitiesQuerySchema, 'query') middleware runs
//            Zod before the handler — verify ../validators/opportunities.js uses
//            z.coerce.number() for offset/limit (not z.number()) so string query
//            params are cast to numbers before reaching .range(). If the schema
//            uses z.number(), string inputs will fail validation before this handler.
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { requirePermission, buildUserContext } from '../middleware/workspace.js';
import { validate }        from '../middleware/validate.js';
import { createLogger }    from '../utils/logger.js';
import {
  listOpportunitiesQuerySchema,
  updateStatusSchema,
  assignOpportunitySchema,
} from '../validators/opportunities.js';
import { sendDealAssignedEmail } from '../services/email.js';
import { LIMITERS } from '../config/limiters.js';
import {
  PIPELINE_STAGES,
  OPPORTUNITY_STATUS,
  OPPORTUNITIES_PER_RUN,
  MIN_COMPOSITE_SCORE,
  SENT_PROMPT_DELAY_MS,
  ACTIVITY_EVENTS,
} from '../config/constants.js';
import {
  discoverOpportunities,
  
  searchForChat,
} from '../services/exa.js';

import {checkWorkspaceExaUsage} from '../services/tokenTracker.js';


import { callWithFallbackGroq } from '../services/multiProvider.js';
import { notifyUser }       from '../services/notifications.js';
import supabaseAdmin        from '../config/supabase.js';


const router = Router();
const { log, logError, logDB, logAI } = createLogger('Opportunities');

// PHASE 3 (Redis Store & Rate Limiting Consistency refactor): these two
// limiters previously shared ONE module-level `sharedRateLimitStore`
// variable, itself built from `createRateLimitStore()` with no namespace
// argument (defaulting to 'default' — the same collision-prone namespace
// several OTHER unrelated limiters across the app also fell back to).
// That meant refreshRateLimiter and intelRateLimiter — two genuinely
// different actions with different costs — were incrementing the SAME
// Redis counter for any user, since both key on `req.user?.id || req.ip`.
// They're now LIMITERS.opportunitiesRefreshLimiter and
// LIMITERS.opportunitiesIntelLimiter, each with its own namespace
// ('opportunities_refresh' / 'opportunities_intel') defined once in
// config/limiters.js. Behavior for each (5/hour and 10/hour respectively)
// is unchanged — only the isolation is fixed.
const refreshRateLimiter = LIMITERS.opportunitiesRefreshLimiter;
const intelRateLimiter = LIMITERS.opportunitiesIntelLimiter;


const computeIntelNeeded = (targetContext = '', targetName = '') => {
  if (targetName?.trim()) return true;
  return [
    /\b(ceo|cto|founder|head of|director|vp |vice president)\b/i,
    /@[a-zA-Z0-9_]{3,}/,
    /u\/[a-zA-Z0-9_]+/,
    /\bat\s+[A-Z][a-zA-Z]{2,}/,
    /\b[A-Z][a-zA-Z]+\.(com|io|ai|co)\b/,
    /\bour\s+(product|company|startup|app|tool|platform|service)\b/i,
    /\bwe\s+(built|launched|created|founded|started)\b/i,
    /\b(Series [A-C]|raised|funding|investors)\b/i,
  ].some(p => p.test(targetContext));
};


// POST /api/opportunities — manual creation
// POST /api/opportunities — manual creation (updated with new fields)
router.post('/', requirePermission('member'), asyncHandler(async (req, res) => {
  const {
    target_name,
    platform,
    prepared_message,
    target_context,
    source_url,
    stage,
    follow_up_message,
    fit_score,
    timing_score,
    intent_score,
  } = req.body;

  const userId = req.user.id, workspaceId = req.workspace.id;

  if (!platform || !prepared_message?.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'platform and prepared_message are required.' });
  }

  // Validate stage if provided
  const validStages = Object.values(PIPELINE_STAGES);
  const finalStage = stage && validStages.includes(stage) ? stage : PIPELINE_STAGES.NEW;

  // Set marked_sent_at if the stage is "contacted" or further along the pipeline
  const SENT_STAGES = new Set([
    PIPELINE_STAGES.CONTACTED,
    PIPELINE_STAGES.REPLIED,
    PIPELINE_STAGES.CALL_DEMO,
    PIPELINE_STAGES.CLOSED_WON,
    PIPELINE_STAGES.CLOSED_LOST,
  ]);
  const markedSentAt = SENT_STAGES.has(finalStage) ? new Date().toISOString() : null;

  const { data: opp, error } = await supabaseAdmin
    .from('opportunities')
    .insert({
      workspace_id:        workspaceId,
      user_id:             userId,
      target_name:         target_name?.trim()          || null,
      target_context:      target_context?.trim()       || null,
      source_url:          source_url?.trim()           || '',
      platform,
      prepared_message:    prepared_message.trim(),
      follow_up_message:   follow_up_message?.trim()    || null,
      status:              OPPORTUNITY_STATUS.PENDING,
      stage:               finalStage,
      marked_sent_at:      markedSentAt,
      generated_by:        'manual',
      fit_score:           Number.isInteger(fit_score) && fit_score >= 0 && fit_score <= 10 ? fit_score : null,
      timing_score:        Number.isInteger(timing_score) && timing_score >= 0 && timing_score <= 10 ? timing_score : null,
      intent_score:        Number.isInteger(intent_score) && intent_score >= 0 && intent_score <= 10 ? intent_score : null,
    })
    .select()
    .single();

  if (error) {
    logError('POST / manual', error, { userId });
    throw error;
  }

  log('CREATE_MANUAL', { userId, workspaceId, opportunityId: opp.id });
  res.status(201).json({ opportunity: opp });
}));
// GET /api/opportunities
router.get('/', validate(listOpportunitiesQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const { status, limit, offset } = req.query;
  log('LIST', { userId, workspaceId, status, limit, offset });

  const userFilter = `user_id.eq.${userId},assigned_to.eq.${userId}`;
  let query = supabaseAdmin
    .from('opportunities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(userFilter)
    .order('composite_score', { ascending: false })
    .range(offset, offset + limit - 1);

  // Opportunities list only shows actionable cards:
  //   - stage = new  (once stage advances via feedback the deal lives in pipeline)
  //   - status != sent  (sent = feedback logged = completed, nothing left to action)
  // The 'all' tab shows everything pending + viewed; specific tabs narrow further.
  query = query
    .eq('stage', PIPELINE_STAGES.NEW)
    .neq('status', OPPORTUNITY_STATUS.SENT);

  if (status !== 'all') query = query.eq('status', status);

  const { data: opps, error } = await query;
  if (error) { logError('GET /', error, { userId }); throw error; }

  const staleThreshold = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const shouldRefresh  = !opps?.length || (opps[0]?.created_at < staleThreshold);
  res.json({ opportunities: opps || [], should_refresh: shouldRefresh, workspace_id: workspaceId });
}));

// Issue 5: /team is registered BEFORE /:id — correct order maintained.
// GET /api/opportunities/team  (Gap 4: manager+)
router.get('/team', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const { data: opps, error } = await supabaseAdmin
    .from('opportunities')
    .select('id, target_name, target_context, platform, composite_score, status, stage, user_id, assigned_to, created_at, users!user_id(id, name, email)')
    .eq('workspace_id', workspaceId)
    .order('composite_score', { ascending: false })
    .limit(100);
  if (error) throw error;
  res.json({ opportunities: opps || [], workspace_id: workspaceId });
}));

// POST /api/opportunities/refresh  (Gap 5: member+, Gap 3: activity)
router.post('/refresh', requirePermission('member'), refreshRateLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const userCtx = buildUserContext(req);
  log('REFRESH', { userId, workspaceId });

  if (!userCtx.product_description || !userCtx.voice_profile) {
    return res.status(400).json({ error: 'ONBOARDING_REQUIRED', message: 'Complete onboarding first.' });
  }

  const usage = await checkWorkspaceExaUsage(workspaceId, userCtx.tier);
  if (!usage.allowed) {
    return res.status(429).json({ error: 'QUOTA_EXCEEDED', message: 'Daily discovery limit reached.' });
  }

  const result = await discoverOpportunities(userId, workspaceId, userCtx);

  const discovered = result?.opportunities || [];
  if (!discovered.length) {
    return res.json({ opportunities: [], count: 0, notice: result?.notice || null });
  }

  const scored   = discovered.filter(o => (o.composite_score || 0) >= MIN_COMPOSITE_SCORE);
  const toInsert = scored.map(o => ({
    workspace_id:    workspaceId,
    user_id:         userId,
    target_name:     o.target_name     || null,
    target_context:  o.target_context,
    platform:        o.platform,
    source_url:      o.source_url      || null,
    composite_score: o.composite_score,
    fit_score:       o.fit_score       || null,
    timing_score:    o.timing_score    || null,
    intent_score:    o.intent_score    || null,
    status:          OPPORTUNITY_STATUS.PENDING,
    stage:           PIPELINE_STAGES.NEW,
    created_at: new Date()
  }));

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('opportunities')
    .upsert(toInsert, { onConflict: 'workspace_id,user_id,source_url', ignoreDuplicates: true })
    .select('id');
  if (insertErr) { logError('REFRESH insert', insertErr, { userId }); throw insertErr; }


  if ((inserted?.length || 0) > 0) {
    try {
      await supabaseAdmin.from('workspace_activity').insert({
        workspace_id: workspaceId,
        user_id:      userId,
        event_type:   ACTIVITY_EVENTS.OPPORTUNITY_CREATED,
        metadata:     { count: inserted.length },
      });
    } catch (_) {}
  }

  logDB('INSERT', 'opportunities', { userId, workspaceId, count: inserted?.length || 0 });
  res.json({
    opportunities: inserted || [],
    count:         inserted?.length || 0,
    notice:        result?.notice   || null,
    is_fallback:   result?.is_fallback ?? false,
  });
}));

router.put('/:id/assign', requirePermission('manager'), validate(assignOpportunitySchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user_id: assigneeId } = req.body;
  const workspaceId = req.workspace.id;

  // Verify assignee is an active member
  const { data: member } = await supabaseAdmin
    .from('workspace_members').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', assigneeId).eq('status', 'active').single();
  if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'Assignee is not an active member.' });

  // Fetch deal, assignee, and assigner in parallel
  const [{ data: opp }, { data: assignee }, { data: assigner }] = await Promise.all([
    supabaseAdmin.from('opportunities').select('id, target_name, target_context')
      .eq('id', id).eq('workspace_id', workspaceId).single(),
    supabaseAdmin.from('users').select('email, name').eq('id', assigneeId).single(),
    supabaseAdmin.from('users').select('name').eq('id', req.user.id).single(),
  ]);
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND', message: 'Opportunity not found.' });

  const dealName = opp.target_name || extractName(opp.target_context) || 'Unnamed prospect';

  // Core update
  await supabaseAdmin.from('opportunities').update({ assigned_to: assigneeId }).eq('id', id);

  // Side effects — all fire-and-forget so they never fail the request
  notifyUser(assigneeId, {
    title: "You've been assigned a new opportunity",
    body:  `New opportunity: ${dealName}`,
    data:  { type: 'opportunity_assigned', opportunity_id: id, workspace_id: workspaceId },
  }).catch(err => logError('ASSIGN_NOTIFY_FAILED', err, { opportunityId: id, assigneeId }));

  if (assignee?.email) {
    sendDealAssignedEmail({
      assigneeEmail: assignee.email,
      assigneeName:  assignee.name,
      assignerName:  assigner?.name,
      dealName,
      opportunityId: id,
    }).catch(err => logError('ASSIGN_EMAIL_FAILED', err, { opportunityId: id, assigneeId }));
  }

  Promise.resolve(supabaseAdmin.from('workspace_activity').insert({
    workspace_id: workspaceId,
    user_id:      req.user.id,
    event_type:   ACTIVITY_EVENTS.OPPORTUNITY_ASSIGNED,
    metadata:     { opportunity_id: id, assigned_to: assigneeId, target_name: dealName },
  })).catch(err => logError('ASSIGN_ACTIVITY_FAILED', err, { opportunityId: id, assigneeId }));

  log('ASSIGN', { workspaceId, opportunityId: id, assigneeId, byUserId: req.user.id });
  res.json({ success: true, assigned_to: assigneeId });
}));

// PUT /api/opportunities/:id/message-copied
// Stamps message_copied_at the first time the prepared message is copied.
router.put('/:id/message-copied', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities')
    .select('id, message_copied_at')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (!opp) return res.status(404).json({ error: 'NOT_FOUND' });

  // Only stamp once — preserve the original first-copy timestamp.
  if (!opp.message_copied_at) {
    const message_copied_at = new Date().toISOString();
    await supabaseAdmin
      .from('opportunities')
      .update({ message_copied_at })
      .eq('id', id);
    log('MESSAGE_COPIED', { userId, workspaceId, opportunityId: id });
    return res.json({ success: true, message_copied_at });
  }

  return res.json({ success: true, message_copied_at: opp.message_copied_at });
}));

// PUT /api/opportunities/:id/link-clicked
// Stamps link_clicked_at the first time a user opens the source URL.
router.put('/:id/link-clicked', requirePermission('member'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities')
    .select('id, link_clicked_at')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .single();

  if (!opp) return res.status(404).json({ error: 'NOT_FOUND' });

  // Only stamp once — preserve the original first-click timestamp.
  if (!opp.link_clicked_at) {
    const link_clicked_at = new Date().toISOString();
    await supabaseAdmin
      .from('opportunities')
      .update({ link_clicked_at })
      .eq('id', id);
    log('LINK_CLICKED', { userId, workspaceId, opportunityId: id });
    return res.json({ success: true, link_clicked_at });
  }

  return res.json({ success: true, link_clicked_at: opp.link_clicked_at });
}));

// GET /api/opportunities/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId     = req.user.id, workspaceId = req.workspace.id;
  const memberRole = req.membership?.role || 'member';
  const isManager  = ['manager', 'admin', 'owner'].includes(memberRole);

  // FIX 3: Managers can view any workspace opportunity; members only their own.
  let oppQuery = supabaseAdmin
    .from('opportunities').select('*')
    .eq('id', id).eq('workspace_id', workspaceId);
  if (!isManager) oppQuery = oppQuery.or(`user_id.eq.${userId},assigned_to.eq.${userId}`);

  const { data: opp, error } = await oppQuery.single();
  if (error || !opp) return res.status(404).json({ error: 'NOT_FOUND' });
  if (opp.status === OPPORTUNITY_STATUS.PENDING) {
    await supabaseAdmin.from('opportunities').update({viewed_at: new Date(), status: OPPORTUNITY_STATUS.VIEWED }).eq('id', id);
  }
  res.json({
    opportunity: {
      ...opp,
      status: opp.status === OPPORTUNITY_STATUS.PENDING ? OPPORTUNITY_STATUS.VIEWED : opp.status,
    },
  });
}));

// PUT /api/opportunities/:id/status  (Gap 5: member+)
router.put('/:id/status', requirePermission('member'), validate(updateStatusSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('id')
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND' });

  const updates = { status };
  // SENT is the terminal status — stamp the time so follow-up jobs can use it.
  // (DONE/ACTED were removed in the status lifecycle simplification; see constants.js)
  if (status === OPPORTUNITY_STATUS.SENT) updates.marked_sent_at = new Date().toISOString();

  await supabaseAdmin.from('opportunities').update(updates).eq('id', id);
  res.json({ success: true, status });
}));

// GET /api/opportunities/:id/intel
//
// CHANGES:
//  - Cache check: returns intel_snapshot from DB if fresh (< INTEL_CACHE_TTL_MS),
//    skipping both AI calls entirely on repeat requests.
//  - Dual parallel AI calls via Promise.all:
//      Call 1 (research)  — Groq analyses Exa search results into pain_points,
//                           talking_points, risks, and confidence.
//      Call 2 (outreach)  — Groq generates personalised outreach details
//                           (opening_line, message_suggestion, follow_up_hook,
//                           tone, personalization_angle) using the same Exa
//                           context + the user's voice profile.
//  - Combined snapshot { intel, outreach, research: { citations } } is written
//    to intel_snapshot + intel_generated_at so the next request hits the cache.
//  - intel_fetch_failed is set on any hard error so callers can surface a retry CTA.
//  - Token usage for both calls is recorded together under workspaceId.
const INTEL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FIX 4: Guard added — unprotected endpoint was triggering expensive AI calls for any caller.
// IMPL-RATELIMIT-01 (C2): intelRateLimiter added — see its definition
// above for why this endpoint specifically needed a tighter limit than
// the router-level aiRateLimiter alone provides.
router.get('/:id/intel', requirePermission('member'), intelRateLimiter, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: opp } = await supabaseAdmin
    .from('opportunities').select('*')
    .eq('id', id).eq('workspace_id', workspaceId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`).single();
  if (!opp) return res.status(404).json({ error: 'NOT_FOUND' });

  if (!computeIntelNeeded(opp.target_context, opp.target_name)) {
    return res.json({ intel: null, outreach: null, reason: 'no_named_entity' });
  }

  // ── Cache hit — skip both AI calls ───────────────────────────────────────
  if (opp.intel_snapshot && opp.intel_generated_at && !opp.intel_fetch_failed) {
    const cacheAge = Date.now() - new Date(opp.intel_generated_at).getTime();
    if (cacheAge < INTEL_CACHE_TTL_MS) {
      logAI('INTEL_CACHE_HIT', { id, workspaceId, ageMs: cacheAge });
      return res.json({ ...opp.intel_snapshot, cached: true });
    }
  }

  const userCtx = buildUserContext(req);
  // Normalise string fields that downstream services call .trim() on.
  // product_description can be stored as a JSON object in Supabase; coerce to string.
  userCtx.product_description = String(userCtx.product_description ?? '');

  try {
    // ── Exa search — shared context for both Groq calls ──────────────────
    
    
    const searchQuery = `${opp.target_name || ''} ${opp.target_context?.slice(0, 300) || ''}`.trim();
    const searchResult = await searchForChat(searchQuery, userCtx);

    // searchForChat returns { content, citations } — see perplexity.js
    const intelText = searchResult?.content?.slice(0, 2000) || '';
    const citations = searchResult?.citations               || [];

    if (!intelText) {
      try {
        await supabaseAdmin
          .from('opportunities')
          .update({ intel_fetch_failed: true })
          .eq('id', id);
      } catch (_) {}
      return res.json({ intel: null, outreach: null, reason: 'no_results' });
    }

    const prospectLabel  = opp.target_name || 'Unknown prospect';
    const targetContext  = opp.target_context?.slice(0, 500) || '';
    const voiceProfile   = JSON.stringify(userCtx.voice_profile || {});

    // ── Dual Groq calls — run in parallel ────────────────────────────────
    const [researchResult, outreachResult] = await Promise.all([

      // Call 1 — Research: pain points, talking points, risks, confidence
      callWithFallbackGroq({
        systemPrompt: 'You generate prospect intelligence for sales outreach. Return only JSON.',
        messages: [{
          role:    'user',
          content: `Generate intel for outreach to: ${prospectLabel}.
Opportunity context: ${targetContext}.
Research context: ${intelText}.
Product: ${userCtx.product_description}.
Return ONLY JSON: {"pain_points":["..."],"talking_points":["..."],"risks":["..."],"confidence":"low|medium|high"}`,
        }],
        temperature: 0.3,
        maxTokens:   400,
        workspaceId, userId, sourceJob: 'opportunity_intel_research',
      }),

      // Call 2 — Outreach: personalised message details using voice profile
      callWithFallbackGroq({
        systemPrompt: 'You craft hyper-personalised outreach details for sales founders. Return only JSON.',
        messages: [{
          role:    'user',
          content: `Generate outreach details for prospect: ${prospectLabel}.
Opportunity context: ${targetContext}.
Research context: ${intelText}.
Product: ${userCtx.product_description}.
Voice/tone profile: ${voiceProfile}.
Return ONLY JSON: {"opening_line":"...","message_suggestion":"...","follow_up_hook":"...","tone":"...","personalization_angle":"..."}`,
        }],
        temperature: 0.5,
        maxTokens:   450,
        workspaceId, userId, sourceJob: 'opportunity_intel_outreach',
      }),
    ]);

    const intel    = JSON.parse(researchResult.content.replace(/```json|```/g, '').trim());
    const outreach = JSON.parse(outreachResult.content.replace(/```json|```/g, '').trim());

    const snapshot = { intel, outreach, research: { citations } };

    // ── Persist to cache ─────────────────────────────────────────────────
    try {
      await supabaseAdmin
        .from('opportunities')
        .update({
          intel_snapshot:     snapshot,
          intel_generated_at: new Date().toISOString(),
          intel_fetch_failed: false,
        })
        .eq('id', id);
    } catch (dbErr) {
      logError('INTEL cache write', dbErr, { id, workspaceId });
    }

    logAI('INTEL_GENERATED', { id, workspaceId, citations: citations.length });
    res.json({ ...snapshot, cached: false });

  } catch (err) {
    logError('GET /:id/intel', err, { userId, id });
    try {
      await supabaseAdmin
        .from('opportunities')
        .update({ intel_fetch_failed: true })
        .eq('id', id);
    } catch (_) {}
    res.json({ intel: null, outreach: null, reason: 'error' });
  }
}));

export default router;
