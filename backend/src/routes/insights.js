// src/routes/insights.js
import { Router }            from 'express';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { buildUserContext, requirePermission } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import supabaseAdmin         from '../config/supabase.js';
import { callWithFallbackGroq } from '../services/multiProvider.js';

import { getCache, setCache } from '../services/redis.js';
import { parseAIJson }       from '../utils/parseAIJson.js';

const router = Router();
const { log, logError, logDB } = createLogger('Insights');

// GET /api/insights/summary
router.get('/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [patternsResult, progressResult, analysesResult] = await Promise.allSettled([
    supabaseAdmin.from('communication_patterns').select('pattern_label, pattern_type, confidence_score, affected_outcome').eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true).order('confidence_score', { ascending: false }).limit(3),
    supabaseAdmin.from('skill_progression').select('composite_score_avg, composite_delta, top_weakness, top_strength, positive_outcome_rate, week_start').eq('workspace_id', workspaceId).eq('user_id', userId).order('week_start', { ascending: false }).limit(2),
    supabaseAdmin.from('conversation_analyses').select('outcome, composite_score, created_at').eq('workspace_id', workspaceId).eq('user_id', userId).not('outcome', 'is', null).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('created_at', { ascending: false }),
  ]);

  const patterns = patternsResult.status === 'fulfilled' ? patternsResult.value.data || [] : [];
  const weeks    = progressResult.status  === 'fulfilled' ? progressResult.value.data  || [] : [];
  const analyses = analysesResult.status  === 'fulfilled' ? analysesResult.value.data  || [] : [];

  const currentWeek   = weeks[0] || null;
  const positiveCount = analyses.filter(a => a.outcome === 'positive').length;
  const positiveRate  = analyses.length > 0 ? parseFloat((positiveCount / analyses.length).toFixed(3)) : null;

  res.json({
    has_patterns:      patterns.length > 0,
    top_pattern:       patterns[0] || null,
    patterns_count:    patterns.length,
    composite_score:   currentWeek?.composite_score_avg || null,
    composite_delta:   currentWeek?.composite_delta || null,
    top_weakness:      currentWeek?.top_weakness || null,
    top_strength:      currentWeek?.top_strength || null,
    positive_rate_30d: positiveRate,
    messages_analyzed: analyses.length,
    has_enough_data:   analyses.length >= 3,
  });
}));

// GET /api/insights/patterns — raw paginated pattern list
// The summary endpoint only exposed the top 3. This allows the frontend
// to list all active patterns and provide dismiss/management controls.
router.get('/patterns', asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;
  const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 50);
  const offset = parseInt(req.query.offset || '0', 10);

  const { data: patterns, error, count } = await supabaseAdmin
    .from('communication_patterns')
    .select('id, pattern_label, pattern_type, pattern_detail, confidence_score, affected_outcome, sample_count, first_detected_at, last_detected_at, is_active', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('confidence_score', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  res.json({ patterns: patterns || [], total: count || 0, limit, offset });
}));

// DELETE /api/insights/patterns/:id — dismiss a stale pattern
router.delete('/patterns/:id', asyncHandler(async (req, res) => {
  const userId      = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: pattern } = await supabaseAdmin
    .from('communication_patterns')
    .select('id')
    .eq('id', req.params.id)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (!pattern) return res.status(404).json({ error: 'NOT_FOUND', message: 'Pattern not found.' });

  await supabaseAdmin
    .from('communication_patterns')
    .update({ is_active: false, dismissed_at: new Date().toISOString() })
    .eq('id', req.params.id);

  res.json({ success: true });
}));

// GET /api/insights/weekly
router.get('/weekly', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: insights, error } = await supabaseAdmin.from('prospect_insights')
    .select('*').eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('is_dismissed', false).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false }).limit(10);

  if (error) throw error;
  res.json({ insights: insights || [] });
}));

// POST /api/insights/weekly/dismiss/:id
router.post('/weekly/dismiss/:id', asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  await supabaseAdmin.from('prospect_insights').update({ is_dismissed: true })
    .eq('id', req.params.id).eq('workspace_id', workspaceId).eq('user_id', req.user.id);
  res.json({ success: true });
}));

// GET /api/insights/signals/summary
router.get('/signals/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: signals } = await supabaseAdmin.from('conversation_signals')
    .select('signal_type, detected_at').eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('is_active', true).gte('detected_at', thirtyDaysAgo);

  const summary = (signals || []).reduce((acc, s) => {
    acc[s.signal_type] = (acc[s.signal_type] || 0) + 1;
    return acc;
  }, {});

  res.json({ summary, total: signals?.length || 0 });
}));

// GET /api/insights/commitments/summary
router.get('/commitments/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const today = new Date().toISOString().split('T')[0];
  const twoDaysFromNow = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];

  const { data: active } = await supabaseAdmin.from('conversation_commitments')
    .select('status, due_date, owner').eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('owner', 'founder').in('status', ['pending', 'overdue']);

  const overdue  = (active || []).filter(c => c.due_date && c.due_date < today).length;
  const due_soon = (active || []).filter(c => c.due_date && c.due_date >= today && c.due_date <= twoDaysFromNow).length;

  res.json({ overdue, due_soon, total_active: (active || []).length });
}));

// GET /api/insights/why-losing
router.get('/why-losing', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const cacheKey = `insights:why-losing:${userId}:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ ...cached, cached: true });

  const [patternsRes, negRes, posRes, weekRes, objRes] = await Promise.allSettled([
    supabaseAdmin.from('communication_patterns').select('pattern_label, pattern_detail').eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true).limit(5),
    supabaseAdmin.from('conversation_analyses').select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score, failure_categories, outcome_note').eq('workspace_id', workspaceId).eq('user_id', userId).eq('outcome', 'negative').gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(50),
    supabaseAdmin.from('conversation_analyses').select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score').eq('workspace_id', workspaceId).eq('user_id', userId).eq('outcome', 'positive').gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(50),
    supabaseAdmin.from('skill_progression').select('composite_score_avg, composite_delta, top_weakness').eq('workspace_id', workspaceId).eq('user_id', userId).order('week_start', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('objection_tracker').select('objection_type, occurrence_count').eq('workspace_id', workspaceId).eq('user_id', userId).order('occurrence_count', { ascending: false }).limit(5),
  ]);

  const patterns    = patternsRes.status === 'fulfilled' ? patternsRes.value.data || [] : [];
  const negative    = negRes.status      === 'fulfilled' ? negRes.value.data      || [] : [];
  const positive    = posRes.status      === 'fulfilled' ? posRes.value.data      || [] : [];
  const currentWeek = weekRes.status     === 'fulfilled' ? weekRes.value.data         : null;
  const objections  = objRes.status      === 'fulfilled' ? objRes.value.data      || [] : [];

  if (negative.length + positive.length < 5) {
    return res.json({ has_data: false, message: 'Not enough data yet. Analyze a few more conversations first.' });
  }

  const userCtx = buildUserContext(req);
  const prompt  = buildWhyLosingPrompt(userCtx, patterns, negative, positive, currentWeek, objections);

  try {
    const { content } = await callWithFallbackGroq({
      systemPrompt: 'You generate diagnostic sales intelligence reports. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, maxTokens: 600,
      workspaceId, userId, sourceJob: 'why_losing',
    });
    const report = parseAIJson(content);
    const result = { has_data: true, report, generated_at: new Date().toISOString() };
    await setCache(cacheKey, result, 4 * 60 * 60).catch(() => {});
    res.json(result);
  } catch (err) {
    logError('why-losing', err, { userId, workspaceId });
    res.status(500).json({ error: 'GENERATION_FAILED' });
  }
}));

// GET /api/insights/skill-trends
router.get('/skill-trends', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: weeks, error } = await supabaseAdmin.from('skill_progression')
    .select('week_start, composite_score_avg, composite_delta, top_weakness, top_strength, hook_avg, clarity_avg, value_prop_avg, personalization_avg, cta_avg, tone_avg, messages_analyzed, positive_outcome_rate')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .order('week_start', { ascending: false }).limit(8);

  if (error) { logError('skill-trends', error, { userId }); throw error; }
  if (!weeks?.length || weeks.length < 2) return res.json({ has_data: false });

  const current  = weeks[0];
  const previous = weeks[1];

  const LABEL = { hook: 'Hook Strength', clarity: 'Message Clarity', value_prop: 'Value Proposition', personalization: 'Personalization', cta: 'Call to Action', tone: 'Tone Fit' };

  const deltas = {};
  for (const key of Object.keys(LABEL)) {
    const cur = current[`${key}_avg`]  ?? null;
    const prv = previous[`${key}_avg`] ?? null;
    deltas[key] = (cur !== null && prv !== null) ? { current: cur, previous: prv, delta: parseFloat((cur - prv).toFixed(2)) } : null;
  }

  const validDeltas = Object.entries(deltas).filter(([, v]) => v !== null).map(([k, v]) => ({ key: k, ...v }));
  const biggestGain = validDeltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta)[0] || null;
  const biggestDrop = validDeltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta)[0] || null;

  let summary = 'Your skill scores are stable this week.';
  if (biggestGain && biggestDrop) summary = `${LABEL[biggestGain.key]} improved (+${biggestGain.delta.toFixed(1)}) while ${LABEL[biggestDrop.key]} needs attention (${biggestDrop.delta.toFixed(1)}).`;
  else if (biggestGain) summary = `${LABEL[biggestGain.key]} improved the most this week (+${biggestGain.delta.toFixed(1)}).`;
  else if (biggestDrop) summary = `${LABEL[biggestDrop.key]} had the sharpest drop this week (${biggestDrop.delta.toFixed(1)}).`;

  res.json({
    has_data: true,
    current_week:      current.week_start,
    previous_week:     previous.week_start,
    composite_delta:   current.composite_delta,
    composite_current: current.composite_score_avg,
    trend_status:      computeTrend(deltas),
    summary,
    biggest_gain:      biggestGain,
    biggest_drop:      biggestDrop,
    dimensions:        deltas,
    top_weakness:      current.top_weakness,
    top_strength:      current.top_strength,
  });
}));

// GET /api/insights/workspace/why-losing (manager+)
router.get('/workspace/why-losing', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const cacheKey = `insights:ws-why-losing:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ ...cached, cached: true });

  const [negRes, posRes, patternsRes] = await Promise.allSettled([
    supabaseAdmin.from('conversation_analyses').select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score, failure_categories, user_id').eq('workspace_id', workspaceId).eq('outcome', 'negative').gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(200),
    supabaseAdmin.from('conversation_analyses').select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score, user_id').eq('workspace_id', workspaceId).eq('outcome', 'positive').gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(200),
    supabaseAdmin.from('communication_patterns').select('pattern_label, pattern_detail').eq('workspace_id', workspaceId).eq('is_active', true).order('confidence_score', { ascending: false }).limit(10),
  ]);

  const neg      = negRes.status      === 'fulfilled' ? negRes.value.data      || [] : [];
  const pos      = posRes.status      === 'fulfilled' ? posRes.value.data      || [] : [];
  const patterns = patternsRes.status === 'fulfilled' ? patternsRes.value.data || [] : [];

  if (neg.length + pos.length < 10) {
    return res.json({ has_data: false, message: 'Not enough workspace data yet.' });
  }

  const userCtx = buildUserContext(req);
  const prompt  = buildWhyLosingPrompt(userCtx, patterns, neg, pos, null, []);

  try {
    const { content } = await callWithFallbackGroq({
      systemPrompt: 'You generate diagnostic sales intelligence reports for teams. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, maxTokens: 600,
      workspaceId, userId: req.user.id, sourceJob: 'workspace_why_losing',
    });
    const report = parseAIJson(content);
    const result = { has_data: true, report, scope: 'workspace', generated_at: new Date().toISOString() };
    await setCache(cacheKey, result, 4 * 60 * 60).catch(() => {});
    res.json(result);
  } catch (err) {
    logError('workspace/why-losing', err, { workspaceId });
    res.status(500).json({ error: 'GENERATION_FAILED' });
  }
}));

// ============================================================
// NET-NEW INSIGHTS ENDPOINTS
// Added per Foundersales Insights & Metrics Refinement.
// Every endpoint below compares, correlates, or detects a
// pattern over time — see design doc for the "insight vs metric" bar.
// ============================================================

// GET /api/insights/pipeline/lost-reasons
router.get('/pipeline/lost-reasons', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: lostOpps, error } = await supabaseAdmin
    .from('opportunities')
    .select('id, lost_reason, created_at, feedback(deal_value_usd)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('stage', 'closed_lost')
    .gte('created_at', ninetyDaysAgo);

  if (error) { logError('pipeline/lost-reasons', error, { userId }); throw error; }

  if (!lostOpps?.length) {
    return res.json({ has_data: false, message: 'No lost deals in the last 90 days.' });
  }

  const byReason = {};
  for (const opp of lostOpps) {
    const reason = opp.lost_reason || 'unspecified';
    if (!byReason[reason]) byReason[reason] = { count: 0, deals_with_known_value: 0, total_value_lost: 0 };
    byReason[reason].count++;
    const fb = Array.isArray(opp.feedback) ? opp.feedback[0] : opp.feedback;
    if (fb?.deal_value_usd != null) {
      byReason[reason].deals_with_known_value++;
      byReason[reason].total_value_lost += fb.deal_value_usd;
    }
  }

  const totalLost = lostOpps.length;
  const results = Object.entries(byReason).map(([type, v]) => ({
    type,
    count: v.count,
    deals_with_known_value: v.deals_with_known_value,
    total_value_lost: v.deals_with_known_value > 0 ? v.total_value_lost : null,
    pct_of_losses: Math.round((v.count / totalLost) * 100),
  }));

  const byFrequency = [...results].sort((a, b) => b.count - a.count);
  const byValue = [...results].filter(r => r.total_value_lost != null).sort((a, b) => b.total_value_lost - a.total_value_lost);

  const highestFrequency = byFrequency[0]?.type || null;
  const highestValueImpact = byValue[0]?.type || null;

  let insight;
  if (highestValueImpact && highestValueImpact === highestFrequency) {
    insight = `${highestValueImpact} accounts for both your most frequent AND most costly losses ($${byValue[0].total_value_lost.toLocaleString()} across ${byValue[0].deals_with_known_value} known-value deals) — this is your single highest-leverage fix.`;
  } else if (highestValueImpact) {
    insight = `${highestValueImpact} isn't your most common loss reason, but it's your costliest ($${byValue[0].total_value_lost.toLocaleString()} lost) — don't just chase frequency here.`;
  } else {
    insight = `${highestFrequency || 'Unspecified reasons'} is your most frequent loss reason, though no deal values are logged yet to measure cost impact.`;
  }

  res.json({
    has_data: true,
    by_reason: byFrequency,
    highest_value_impact: highestValueImpact,
    highest_frequency: highestFrequency,
    insight,
    total_lost_count: totalLost,
  });
}));

// GET /api/insights/practice/coaching-report
router.get('/practice/coaching-report', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const cacheKey = `insights:coaching-report:${userId}:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ ...cached, cached: true });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [sessionsRes, skillProfileRes, patternsRes] = await Promise.allSettled([
    supabaseAdmin.from('practice_sessions')
      .select('scenario_type, skill_scores, coaching_annotations, retry_comparison, goal_achieved, created_at')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('completed', true)
      .gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('user_skill_profile')
      .select('clarity_avg, value_avg, discovery_avg, objection_avg, brevity_avg, cta_avg, weakest_axis, strongest_axis')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('period_start', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('communication_patterns')
      .select('pattern_label, pattern_detail, affected_outcome')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true)
      .order('confidence_score', { ascending: false }).limit(5),
  ]);

  const sessions = sessionsRes.status === 'fulfilled' ? sessionsRes.value.data || [] : [];
  const skillProfile = skillProfileRes.status === 'fulfilled' ? skillProfileRes.value.data : null;
  const patterns = patternsRes.status === 'fulfilled' ? patternsRes.value.data || [] : [];

  if (sessions.length < 3) {
    return res.json({ has_data: false, message: 'Complete at least 3 practice sessions to generate a coaching report.' });
  }

  const userCtx = buildUserContext(req);

  const sessionSummary = sessions.map(s =>
    `${s.scenario_type} | score: ${s.skill_scores?.session_score ?? 'N/A'} | goal_achieved: ${s.goal_achieved}`
  ).join('\n');

  const prompt = `Analyze this seller's last ${sessions.length} practice sessions and generate a coaching report.

Product: ${userCtx.product_description || 'not specified'}
Target audience: ${userCtx.target_audience || 'not specified'}

SESSION HISTORY:
${sessionSummary}

CURRENT SKILL AXES (0-100):
Clarity: ${skillProfile?.clarity_avg ?? 'N/A'} | Value: ${skillProfile?.value_avg ?? 'N/A'} | Discovery: ${skillProfile?.discovery_avg ?? 'N/A'}
Objection handling: ${skillProfile?.objection_avg ?? 'N/A'} | Brevity: ${skillProfile?.brevity_avg ?? 'N/A'} | CTA: ${skillProfile?.cta_avg ?? 'N/A'}
Weakest: ${skillProfile?.weakest_axis || 'N/A'} | Strongest: ${skillProfile?.strongest_axis || 'N/A'}

REAL-WORLD COMMUNICATION PATTERNS DETECTED:
${patterns.map(p => `- ${p.pattern_label}: ${p.pattern_detail}`).join('\n') || 'None yet'}

Identify persistent strengths and weaknesses (not one-off session results), and generate a prioritized drill plan.
Return ONLY this JSON:
{"persistent_strengths":["..."],"persistent_weaknesses":["..."],"drill_priority":[{"axis":"...","current_avg":0,"suggested_scenario":"...","drill_note":"..."}],"summary":"2-3 sentences"}`;

  const { content } = await callWithFallbackGroq({
    systemPrompt: 'You are a sales coaching analyst. Return only valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3, maxTokens: 600,
    tier: 'quality', workspaceId, userId, sourceJob: 'practice_coaching_report',
  });

  let report;
  try {
    report = parseAIJson(content);
  } catch (err) {
    logError('practice/coaching-report parse', err, { userId, workspaceId });
    return res.status(500).json({ error: 'GENERATION_FAILED' });
  }

  const result = { has_data: true, ...report, generated_at: new Date().toISOString() };
  await setCache(cacheKey, result, 24 * 60 * 60).catch(() => {});
  res.json({ ...result, cached: false });
}));


// GET /api/insights/intelligence
router.get('/intelligence', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const cacheKey = `metrics:intelligence:${userId}:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ insights: cached, cached: true });

  const userCtx = buildUserContext(req);

  // Fetch ALL relevant data in parallel.
  //
  // Fix: destructure `data` directly off each Supabase response (same
  // pattern as /dashboard) instead of carrying the full {data, error}
  // wrapper around. The previous version kept the wrapper and then read
  // `profile?.data?.[0]` / `pipeline?.data?.[0]` further down — but those two
  // queries use .maybeSingle(), which resolves to a single object (or null),
  // not an array. `[0]` on a plain object is always undefined, so every
  // performance/pipeline stat fed into the AI prompt (and into the
  // rule-based fallback below) was silently 0/undefined.
  const [
    { data: profile },
    { data: pipeline },
    { data: goals },
    { data: checkIns },
    { data: signals },
    { data: patterns },
    { data: objections },
    { data: commitments },
    { data: practice },
    { data: skillTrends },
    { data: recentOpps },
    { data: unreadTips },
  ] = await Promise.all([
    supabaseAdmin.from('user_performance_profiles')
      .select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),

    supabaseAdmin.from('pipeline_metrics')
      .select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),

    supabaseAdmin.from('user_goals')
      .select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3),

    supabaseAdmin.from('daily_check_ins')
      .select('mood_score, answers').eq('user_id', userId).eq('workspace_id', workspaceId)
      .order('date', { ascending: false }).limit(5),

    supabaseAdmin.from('conversation_signals')
      .select('signal_type, signal_text, confidence').eq('workspace_id', workspaceId)
      .eq('user_id', userId).eq('is_active', true)
      .order('detected_at', { ascending: false }).limit(10),

    supabaseAdmin.from('communication_patterns')
      .select('pattern_type, pattern_label, confidence_score, affected_outcome')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true)
      .order('confidence_score', { ascending: false }).limit(5),

    supabaseAdmin.from('objection_tracker')
      .select('objection_type, objection_phrase, occurrence_count, best_response')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('occurrence_count', { ascending: false }).limit(5),

    supabaseAdmin.from('conversation_commitments')
      .select('commitment_text, owner, due_date, status')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true }).limit(5),

    supabaseAdmin.from('practice_sessions')
      .select('scenario_type, skill_scores, outcome, difficulty_level')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('completed', true)
      .order('created_at', { ascending: false }).limit(10),

    supabaseAdmin.from('skill_progression')
      .select('composite_score_avg, composite_delta, top_weakness, top_strength')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('week_start', { ascending: false }).limit(4),

    supabaseAdmin.from('opportunities')
      .select('stage, status, marked_sent_at, feedback_prompted_at')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .in('stage', ['contacted', 'replied', 'call_demo'])
      .order('created_at', { ascending: false }).limit(10),

    supabaseAdmin.from('growth_cards')
      .select('card_type, is_read, is_dismissed, priority, created_at')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_read', false).eq('is_dismissed', false)
      .order('priority', { ascending: false }).limit(5),
  ]);

  // Build rich context
  const positiveRatePct   = Math.round((profile?.positive_rate || 0) * 100);
  const recentCheckInMood = checkIns?.length
    ? Math.round(checkIns.reduce((s, c) => s + (c.mood_score || 5), 0) / checkIns.length)
    : null;

  // Analyze stalled deals
  const stalledDeals = recentOpps?.filter(o =>
    o.marked_sent_at && !o.feedback_prompted_at &&
    new Date(o.marked_sent_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ) || [];

  // Analyze skill trends
  const skillTrend  = skillTrends?.[0];
  const isImproving = skillTrend?.composite_delta > 0;

  // Analyze practice weaknesses
  const weakSkills = practice
    ?.filter(p => p.skill_scores)
    .flatMap(p => Object.entries(p.skill_scores || {})
      .filter(([_, score]) => score < 60)
      .map(([skill]) => skill)
    ) || [];

  const topWeakness = [...new Set(weakSkills)].slice(0, 3);

  // Build enhanced prompt
  const prompt = [
    'Generate 3-5 specific, actionable intelligence insights for this seller based on ALL their data.',
    '',
    `Product: ${userCtx.product_description || 'not specified'}`,
    `Target audience: ${userCtx.target_audience || 'not specified'}`,
    `Archetype: ${userCtx.archetype || 'not specified'}`,
    '',
    '== Performance Profile ==',
    `Positive reply rate: ${positiveRatePct}%`,
    `Total sent: ${profile?.total_sent || 0}`,
    `Positive: ${profile?.total_positive || 0}`,
    `Negative: ${profile?.total_negative || 0}`,
    `Best platform: ${profile?.best_platform || 'unknown'}`,
    `Best message style: ${profile?.best_message_style || 'unknown'}`,
    `Best message length: ${profile?.best_message_length || 'unknown'}`,
    profile?.learned_patterns ? `Learned patterns: ${profile.learned_patterns}` : '',
    '',
    '== Pipeline Metrics ==',
    `Contacted: ${pipeline?.contacted_count || 0}`,
    `Replied: ${pipeline?.replied_count || 0}`,
    `Call/Demo: ${pipeline?.call_demo_count || 0}`,
    `Won: ${pipeline?.closed_won_count || 0}`,
    `Pipeline value: $${pipeline?.pipeline_value || 0}`,
    `Win rate: ${pipeline?.win_rate_pct || 0}%`,
    '',
    '== Active Goals ==',
    (goals || []).map(g => `- ${g.goal_text} (${g.current_value || 0}/${g.target_value || 100})`).join('\n') || 'No active goals',
    '',
    '== Conversation Signals Detected ==',
    (signals || []).map(s => `- ${s.signal_type}: ${s.signal_text} (${Math.round(s.confidence * 100)}% confidence)`).join('\n') || 'No signals detected',
    '',
    '== Communication Patterns ==',
    (patterns || []).map(p =>
      `- ${p.pattern_label}: ${p.affected_outcome} outcome (${Math.round(p.confidence_score * 100)}% confidence)`
    ).join('\n') || 'No patterns detected',
    '',
    '== Top Objections ==',
    (objections || []).map(o =>
      `- "${o.objection_phrase}" (${o.occurrence_count} times)${o.best_response ? ` → Best response: ${o.best_response}` : ''}`
    ).join('\n') || 'No objections tracked',
    '',
    '== Pending Commitments ==',
    (commitments || []).map(c =>
      `- ${c.commitment_text} (Due: ${c.due_date || 'No date'}, Status: ${c.status})`
    ).join('\n') || 'No pending commitments',
    '',
    `== Practice Summary ==`,
    `Total completed: ${practice?.length || 0}`,
    practice?.length ? `Weakest skills: ${topWeakness.join(', ') || 'None identified'}` : '',
    skillTrend ? `Skill trend: ${isImproving ? '✅ Improving' : '⚠️ Declining'} (${skillTrend.composite_delta > 0 ? '+' : ''}${(skillTrend.composite_delta || 0).toFixed(2)})` : '',
    skillTrend?.top_weakness ? `Top weakness: ${skillTrend.top_weakness}` : '',
    skillTrend?.top_strength ? `Top strength: ${skillTrend.top_strength}` : '',
    '',
    `== Opportunity Health ==`,
    `Stalled deals (no feedback >7 days): ${stalledDeals.length}`,
    recentOpps?.length ? `Recent activity: ${recentOpps.length} active opportunities` : 'No recent activity',
    '',
    `== Coaching Engagement ==`,
    `Unread growth tips: ${unreadTips?.length || 0}`,
    // Fix: mood_score is on a 1–5 scale per schema, was previously labeled "/10".
    recentCheckInMood != null ? `Recent mood average: ${recentCheckInMood}/5` : '',
    '',
    'Generate insights that are SPECIFIC, ACTIONABLE, and DATA-DRIVEN. Focus on:',
    '1. What patterns are helping or hurting the seller',
    '2. Which objections need better responses',
    '3. Skill gaps revealed by practice',
    '4. Pipeline risks (stalled deals, weak win rate)',
    '5. Behavioral adjustments for better outcomes',
    '',
    'Return ONLY a JSON array (no markdown):',
    '[{"type":"pattern|opportunity|warning|coaching","icon":"emoji","title":"short, punchy title","body":"2-3 sentences with specific data","action":"one specific action or null"}]'
  ].filter(Boolean).join('\n');

  try {
    const { content } = await callWithFallbackGroq({
      systemPrompt: 'You are a sales intelligence expert. Generate insights based on data. Return only valid JSON arrays.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5, maxTokens: 1200,
    tier: 'fast', workspaceId, userId, sourceJob: 'intelligence'

    });
    

    const insights = parseAIJson(content);
    await setCache(cacheKey, insights, INTELLIGENCE_TTL_S).catch(() => {});
    res.json({ insights, cached: false });
  } catch (err) {
    logError('intelligence', err, { userId, workspaceId });
    res.json({
      insights: generateRuleBasedInsights(profile, pipeline, goals || [], objections, patterns, stalledDeals),
      cached: false,
      fallback: true
    });
  }
}));

// GET /api/insights/performance-profile
router.get('/performance-profile', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: profile, error } = await supabaseAdmin
    .from('user_performance_profiles')
    .select('total_sent, total_positive, total_negative, positive_rate, best_platform, best_message_style, best_message_length, learned_patterns, last_summarized_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) { logError('performance-profile', error, { userId }); throw error; }

  if (!profile) {
    return res.json({ has_data: false, message: 'Not enough sent messages yet to build a performance profile.' });
  }

  res.json({
    has_data: true,
    total_sent: profile.total_sent || 0,
    total_positive: profile.total_positive || 0,
    total_negative: profile.total_negative || 0,
    positive_rate: profile.positive_rate || 0,
    best_platform: profile.best_platform || null,
    best_message_style: profile.best_message_style || null,
    best_message_length: profile.best_message_length || null,
    learned_patterns: profile.learned_patterns || null,
    last_summarized_at: profile.last_summarized_at || null,
  });
}));

// POST /api/insights/win-story
router.post('/win-story', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const { opportunity_id, audience = 'personal' } = req.body || {};

  let analysisQuery = supabaseAdmin
    .from('conversation_analyses')
    .select('id, message_text, composite_score, hook_score, personalization_score, cta_score, opportunity_id, outcome, opportunities(platform, target_name, target_context)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('outcome', 'positive');

  if (opportunity_id) {
    analysisQuery = analysisQuery.eq('opportunity_id', opportunity_id);
  } else {
    analysisQuery = analysisQuery.order('composite_score', { ascending: false }).limit(1);
  }

  const { data: analyses, error } = await analysisQuery;
  if (error) { logError('win-story', error, { userId }); throw error; }

  const best = analyses?.[0];
  if (!best) {
    return res.json({ has_data: false, message: 'No positive-outcome message found yet to build a win story from.' });
  }

  const userCtx = buildUserContext(req);
  const audienceNote = audience === 'team_training'
    ? 'Write this for team training — focus on the transferable technique, not just praise.'
    : 'Write this for the seller themselves — build confidence while being specific about what worked.';

  const prompt = `A seller sent this message and got a positive outcome. Explain concretely WHY it worked, in 3-4 sentences.

Product: ${userCtx.product_description || 'not specified'}
Platform: ${best.opportunities?.platform || 'unknown'}
Message (composite score ${best.composite_score}/10, hook ${best.hook_score}/10, personalization ${best.personalization_score}/10, cta ${best.cta_score}/10):
"${best.message_text}"

${audienceNote}
Be specific — reference actual structural choices in the message (length, ordering, ask type), not generic praise.
Return ONLY the narrative text, no preamble, no quotes.`;

  const { content } = await callWithFallbackGroq({
    systemPrompt: 'You explain why a sales message worked, concretely and specifically. Return only the narrative.',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5, maxTokens: 400,
    tier: 'fast', workspaceId, userId, sourceJob: 'win_story',
  });

  res.json({
    has_data: true,
    opportunity_id: best.opportunity_id,
    platform: best.opportunities?.platform || null,
    composite_score: best.composite_score,
    story: content?.trim(),
    generated_at: new Date().toISOString(),
  });
}));

// GET /api/insights/practice/buyer-state-trajectory
router.get('/practice/buyer-state-trajectory', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: sessions, error } = await supabaseAdmin
    .from('practice_sessions')
    .select('buyer_state_history')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('completed', true)
    .not('buyer_state_history', 'eq', '[]')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) { logError('practice/buyer-state-trajectory', error, { userId }); throw error; }

  if (!sessions?.length) {
    return res.json({ has_data: false, message: 'No completed practice sessions with buyer state data yet.' });
  }

  const interestByIndex = {};
  const trustByIndex = {};

  for (const session of sessions) {
    const history = Array.isArray(session.buyer_state_history) ? session.buyer_state_history : [];
    history.forEach((entry, idx) => {
      const exchangeIdx = entry.message_index ?? idx;
      if (entry.interest_score != null) {
        if (!interestByIndex[exchangeIdx]) interestByIndex[exchangeIdx] = [];
        interestByIndex[exchangeIdx].push(entry.interest_score);
      }
      if (entry.trust_score != null) {
        if (!trustByIndex[exchangeIdx]) trustByIndex[exchangeIdx] = [];
        trustByIndex[exchangeIdx].push(entry.trust_score);
      }
    });
  }

  const maxIndex = Math.max(...Object.keys(interestByIndex).map(Number), 0);
  const avgInterestByExchange = [];
  const avgTrustByExchange = [];
  for (let i = 0; i <= maxIndex; i++) {
    const iVals = interestByIndex[i] || [];
    const tVals = trustByIndex[i] || [];
    avgInterestByExchange.push(iVals.length ? Math.round(iVals.reduce((a, b) => a + b, 0) / iVals.length) : null);
    avgTrustByExchange.push(tVals.length ? Math.round(tVals.reduce((a, b) => a + b, 0) / tVals.length) : null);
  }

  if (!avgInterestByExchange.some(v => v != null)) {
    return res.json({ has_data: false, message: 'Not enough buyer state history to compute a trajectory yet.' });
  }

  let peakExchange = 0, peakValue = -1;
  avgInterestByExchange.forEach((v, i) => { if (v != null && v > peakValue) { peakValue = v; peakExchange = i; } });

  let dropOffExchange = null;
  for (let i = peakExchange + 1; i < avgInterestByExchange.length; i++) {
    const v = avgInterestByExchange[i];
    if (v != null && peakValue > 0 && (peakValue - v) / peakValue > 0.15) { dropOffExchange = i; break; }
  }

  const insight = dropOffExchange != null
    ? `Interest peaks at exchange ${peakExchange} and drops meaningfully by exchange ${dropOffExchange} — whatever you say right after the prospect engages is costing you momentum.`
    : `Interest peaks at exchange ${peakExchange} and holds fairly steady afterward — you're not losing much momentum once you've hooked them.`;

  res.json({
    has_data: true,
    sessions_analyzed: sessions.length,
    avg_interest_by_exchange: avgInterestByExchange,
    avg_trust_by_exchange: avgTrustByExchange,
    peak_exchange: peakExchange,
    drop_off_exchange: dropOffExchange,
    insight,
  });
}));

// GET /api/insights/practice/roi-correlation
router.get('/practice/roi-correlation', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: weeks, error } = await supabaseAdmin
    .from('skill_progression')
    .select('practice_sessions, positive_outcome_rate, week_start')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(12);

  if (error) { logError('practice/roi-correlation', error, { userId }); throw error; }

  const withPractice = (weeks || []).filter(w => (w.practice_sessions || 0) > 0 && w.positive_outcome_rate != null);
  const withoutPractice = (weeks || []).filter(w => (w.practice_sessions || 0) === 0 && w.positive_outcome_rate != null);

  if (withPractice.length < 3 || withoutPractice.length < 3) {
    return res.json({
      has_data: false,
      reason: 'Need at least 3 weeks in each group to compare reliably.',
      weeks_with_practice: withPractice.length,
      weeks_without_practice: withoutPractice.length,
    });
  }

  const avg = (arr) => arr.reduce((s, w) => s + w.positive_outcome_rate, 0) / arr.length;
  const avgWith = avg(withPractice);
  const avgWithout = avg(withoutPractice);
  const liftPct = avgWithout > 0 ? Math.round(((avgWith - avgWithout) / avgWithout) * 1000) / 10 : null;

  res.json({
    has_data: true,
    weeks_with_practice: withPractice.length,
    weeks_without_practice: withoutPractice.length,
    avg_positive_rate_with_practice: parseFloat(avgWith.toFixed(3)),
    avg_positive_rate_without_practice: parseFloat(avgWithout.toFixed(3)),
    lift_pct: liftPct,
    insight: liftPct != null
      ? `On weeks where you practiced, your real-world reply rate was ${liftPct > 0 ? liftPct : Math.abs(liftPct)}% ${liftPct >= 0 ? 'higher' : 'lower'} than weeks you skipped it.`
      : 'Not enough baseline data to compute a reliable lift percentage yet.',
  });
}));

// GET /api/insights/mood-performance
router.get('/mood-performance', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const period = req.query.period === '30d' ? 30 : 14;
  const cutoff = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];

  const [checkInsRes, metricsRes] = await Promise.allSettled([
    supabaseAdmin.from('daily_check_ins').select('date, mood_score')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .gte('date', cutoff).not('mood_score', 'is', null),
    supabaseAdmin.from('daily_metrics').select('date, messages_sent, positive_rate')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .gte('date', cutoff),
  ]);

  const checkIns = checkInsRes.status === 'fulfilled' ? checkInsRes.value.data || [] : [];
  const metrics  = metricsRes.status  === 'fulfilled' ? metricsRes.value.data  || [] : [];

  const metricsByDate = {};
  metrics.forEach(m => { metricsByDate[m.date] = m; });

  const trend = checkIns
    .filter(c => metricsByDate[c.date])
    .map(c => ({
      date: c.date,
      mood_score: c.mood_score,
      messages_sent: metricsByDate[c.date].messages_sent || 0,
      positive_rate: metricsByDate[c.date].positive_rate || 0,
    }))
    .filter(d => d.messages_sent > 0)
    .sort((a, b) => a.date < b.date ? -1 : 1);

  if (trend.length < 5) {
    return res.json({ has_data: false, message: 'Need at least 5 active days with a check-in to compute a reliable correlation.' });
  }

  const highMood = trend.filter(d => d.mood_score >= 4);
  const lowMood  = trend.filter(d => d.mood_score <= 2);

  const avgRate = (arr) => arr.length ? arr.reduce((s, d) => s + d.positive_rate, 0) / arr.length : null;
  const avgHigh = avgRate(highMood);
  const avgLow  = avgRate(lowMood);

  // Pearson correlation between mood_score and positive_rate
  const n = trend.length;
  const meanMood = trend.reduce((s, d) => s + d.mood_score, 0) / n;
  const meanRate = trend.reduce((s, d) => s + d.positive_rate, 0) / n;
  let cov = 0, varMood = 0, varRate = 0;
  trend.forEach(d => {
    cov += (d.mood_score - meanMood) * (d.positive_rate - meanRate);
    varMood += (d.mood_score - meanMood) ** 2;
    varRate += (d.positive_rate - meanRate) ** 2;
  });
  const correlation = (varMood > 0 && varRate > 0) ? parseFloat((cov / Math.sqrt(varMood * varRate)).toFixed(2)) : null;

  let insight;
  if (avgHigh != null && avgLow != null && avgLow >= 0) {
    insight = avgLow > 0
      ? `On days you rate your mood 4 or higher, your positive reply rate is ${(avgHigh / avgLow).toFixed(1)}x what it is on low-mood days (${Math.round(avgHigh * 100)}% vs ${Math.round(avgLow * 100)}%). Today's check-in matters more than it feels like.`
      : `On days you rate your mood 4 or higher, your positive reply rate averages ${Math.round(avgHigh * 100)}% — on low-mood days it's essentially zero.`;
  } else {
    insight = 'Not enough high- or low-mood days yet to compare directly — check back after a few more check-ins.';
  }

  res.json({
    has_data: true,
    days_analyzed: trend.length,
    correlation,
    avg_positive_rate_high_mood: avgHigh != null ? parseFloat(avgHigh.toFixed(3)) : null,
    avg_positive_rate_low_mood: avgLow != null ? parseFloat(avgLow.toFixed(3)) : null,
    insight,
    trend,
  });
}));

// GET /api/insights/meetings/prep-effectiveness
router.get('/meetings/prep-effectiveness', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const { data: events, error } = await supabaseAdmin
    .from('user_events')
    .select('outcome, prep_generated')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .not('outcome', 'is', null)
    .gte('event_date', ninetyDaysAgo);

  if (error) { logError('meetings/prep-effectiveness', error, { userId }); throw error; }

  const prepped = (events || []).filter(e => e.prep_generated);
  const unprepped = (events || []).filter(e => !e.prep_generated);

  if (prepped.length < 3 || unprepped.length < 3) {
    return res.json({
      has_data: false,
      message: 'Need at least 3 meetings in each group (prepped / unprepped) to compare reliably.',
      prepped_meetings: prepped.length,
      unprepped_meetings: unprepped.length,
    });
  }

  const positiveRate = (arr) => arr.filter(e => e.outcome === 'positive').length / arr.length;
  const preppedRate = positiveRate(prepped);
  const unpreppedRate = positiveRate(unprepped);

  res.json({
    has_data: true,
    prepped_meetings: prepped.length,
    unprepped_meetings: unprepped.length,
    prepped_positive_rate: parseFloat(preppedRate.toFixed(3)),
    unprepped_positive_rate: parseFloat(unpreppedRate.toFixed(3)),
    insight: `Meetings you prep for close positively ${Math.round(preppedRate * 100)}% of the time, vs ${Math.round(unpreppedRate * 100)}% when you go in cold. Prep is generated automatically the morning of — make sure notifications are on.`,
  });
}));

// GET /api/insights/meetings/recurring-blockers
router.get('/meetings/recurring-blockers', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const [insightsRes, oppsRes] = await Promise.allSettled([
    supabaseAdmin.from('prospect_insights')
      .select('insight_type, title, body, affected_count')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('is_dismissed', false)
      .in('insight_type', ['question_cluster', 'stall']),
    supabaseAdmin.from('opportunities')
      .select('stage, lost_reason, target_context')
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .in('stage', ['closed_lost', 'closed_won']),
  ]);

  const topicInsights = insightsRes.status === 'fulfilled' ? insightsRes.value.data || [] : [];
  const opps = oppsRes.status === 'fulfilled' ? oppsRes.value.data || [] : [];

  if (!topicInsights.length) {
    return res.json({ has_data: false, message: 'No recurring meeting topics detected yet.' });
  }

  const lostOpps = opps.filter(o => o.stage === 'closed_lost');
  const totalClosed = opps.length;

  const blockers = topicInsights.map(t => {
    const topicWords = (t.title || '').toLowerCase().split(/[\s/]+/).filter(w => w.length > 3);
    const matchingLost = lostOpps.filter(o => {
      const text = `${o.lost_reason || ''} ${o.target_context || ''}`.toLowerCase();
      return topicWords.some(w => text.includes(w));
    }).length;
    const matchingTotal = opps.filter(o => {
      const text = `${o.lost_reason || ''} ${o.target_context || ''}`.toLowerCase();
      return topicWords.some(w => text.includes(w));
    }).length;

    const coOccursPct = matchingTotal > 0 ? parseFloat((matchingLost / matchingTotal).toFixed(2)) : null;

    return {
      topic: t.title,
      times_raised: t.affected_count || 1,
      co_occurs_with_lost_deal_pct: coOccursPct,
      insight: coOccursPct != null
        ? (coOccursPct >= 0.5
            ? `"${t.title}" comes up often, and ${Math.round(coOccursPct * 100)}% of those deals were ultimately lost — this is a high-leverage topic to fix, not just a common one.`
            : `"${t.title}" comes up often but rarely correlates with losing the deal — likely not worth prioritizing.`)
        : `"${t.title}" has been raised ${t.affected_count || 1} time(s) but there isn't enough closed-deal data yet to measure its impact.`,
    };
  }).sort((a, b) => (b.co_occurs_with_lost_deal_pct || 0) - (a.co_occurs_with_lost_deal_pct || 0));

  res.json({ has_data: true, blockers, deals_analyzed: totalClosed });
}));

// GET /api/insights/skill-persistence
router.get('/skill-persistence', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;

  const { data: weeks, error } = await supabaseAdmin
    .from('skill_progression')
    .select('top_weakness, week_start')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(8);

  if (error) { logError('skill-persistence', error, { userId }); throw error; }

  const weaknesses = (weeks || []).map(w => w.top_weakness).filter(Boolean);

  if (weaknesses.length < 2) {
    return res.json({ has_data: false, message: 'Need at least 2 weeks of skill data to assess persistence.' });
  }

  const current = weaknesses[0];
  let streak = 1;
  for (let i = 1; i < weaknesses.length; i++) {
    if (weaknesses[i] === current) streak++;
    else break;
  }

  const classification = streak >= 3 ? 'persistent' : 'noisy';
  const insight = classification === 'persistent'
    ? `${humanizeAxis(current)} has been your top weakness for ${streak} straight weeks — this isn't noise, it's a real gap worth a dedicated practice block this week.`
    : `Your weakest dimension has changed almost every week recently — this likely reflects small sample size (few messages analyzed) rather than a real pattern yet.`;

  res.json({
    has_data: true,
    current_weakness: current,
    consecutive_weeks: streak,
    classification,
    recent_weaknesses: weaknesses.slice(0, 4),
    insight,
  });
}));

// GET /api/insights/pipeline/silent-risk
router.get('/pipeline/silent-risk', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.workspace.id;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const today = new Date().toISOString().split('T')[0];

  const { data: activeOpps, error } = await supabaseAdmin
    .from('opportunities')
    .select('id, target_name, stage, prepared_message, last_stage_changed_at, prospect_id, target_context')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .in('stage', ['contacted', 'replied', 'call_demo'])
    .gte('last_stage_changed_at', sevenDaysAgo); // recently moved — a naive staleness check would miss these

  if (error) { logError('pipeline/silent-risk', error, { userId }); throw error; }

  if (!activeOpps?.length) {
    return res.json({ has_data: true, silent_risks: [], total_flagged: 0 });
  }

  const prospectIds = [...new Set(activeOpps.map(o => o.prospect_id).filter(Boolean))];

  const [signalsRes, commitmentsRes, prospectsRes] = await Promise.allSettled([
    prospectIds.length
      ? supabaseAdmin.from('conversation_signals')
          .select('prospect_id, signal_type, detected_at')
          .eq('workspace_id', workspaceId).eq('user_id', userId)
          .in('prospect_id', prospectIds).eq('is_active', true)
          .gte('detected_at', fourteenDaysAgo)
      : Promise.resolve({ data: [] }),
    prospectIds.length
      ? supabaseAdmin.from('conversation_commitments')
          .select('prospect_id, status, due_date')
          .eq('workspace_id', workspaceId).eq('user_id', userId)
          .in('prospect_id', prospectIds).in('status', ['pending', 'overdue'])
      : Promise.resolve({ data: [] }),
    prospectIds.length
      ? supabaseAdmin.from('prospects')
          .select('id, relationship_health_score, health_updated_at')
          .eq('workspace_id', workspaceId).eq('user_id', userId)
          .in('id', prospectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const signals = signalsRes.status === 'fulfilled' ? signalsRes.value.data || [] : [];
  const commitments = commitmentsRes.status === 'fulfilled' ? commitmentsRes.value.data || [] : [];
  const prospects = prospectsRes.status === 'fulfilled' ? prospectsRes.value.data || [] : [];

  const negativeSignalTypes = new Set(['objection', 'hesitation', 'negative_sentiment', 'stall']);
  const prospectsById = {};
  prospects.forEach(p => { prospectsById[p.id] = p; });

  const silentRisks = [];
  for (const opp of activeOpps) {
    if (!opp.prospect_id) continue;
    const riskFactors = [];

    const negSignals = signals.filter(s => s.prospect_id === opp.prospect_id && negativeSignalTypes.has(s.signal_type));
    if (negSignals.length) riskFactors.push(`${negSignals.length} negative/hesitation signal(s) detected in the last 14 days`);

    const overdueCommitments = commitments.filter(c => c.prospect_id === opp.prospect_id && (c.status === 'overdue' || (c.due_date && c.due_date < today)));
    if (overdueCommitments.length) riskFactors.push(`${overdueCommitments.length} overdue founder commitment(s) tied to this prospect`);

    const prospect = prospectsById[opp.prospect_id];
    if (prospect?.relationship_health_score != null && prospect.relationship_health_score < 40) {
      riskFactors.push(`Relationship health score is low (${prospect.relationship_health_score}/100)`);
    }

    if (riskFactors.length >= 2) {
      silentRisks.push({
        opportunity_id: opp.id,
        target_name: opp.target_name || 'Unnamed prospect',
        stage: opp.stage,
        looks_healthy_because: `Stage last changed ${Math.round((Date.now() - new Date(opp.last_stage_changed_at).getTime()) / 86400000)} day(s) ago`,
        risk_factors: riskFactors,
        risk_score: riskFactors.length,
      });
    }
  }

  silentRisks.sort((a, b) => b.risk_score - a.risk_score);
  res.json({ has_data: true, silent_risks: silentRisks, total_flagged: silentRisks.length });
}));

// GET /api/insights/workspace/objection-divergence (manager+)
router.get('/workspace/objection-divergence', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;

  const [membersRes, objectionsRes] = await Promise.allSettled([
    supabaseAdmin.from('workspace_members').select('user_id, users(name, email)').eq('workspace_id', workspaceId).eq('status', 'active'),
    supabaseAdmin.from('objection_tracker').select('user_id, objection_type, occurrence_count').eq('workspace_id', workspaceId),
  ]);

  const members = membersRes.status === 'fulfilled' ? membersRes.value.data || [] : [];
  const objections = objectionsRes.status === 'fulfilled' ? objectionsRes.value.data || [] : [];

  if (!objections.length) {
    return res.json({ has_data: false, message: 'No objection data logged for this workspace yet.' });
  }

  const totalReps = members.length || 1;
  const nameByUserId = {};
  members.forEach(m => { nameByUserId[m.user_id] = m.users?.name || m.users?.email || 'Unknown'; });

  const byType = {};
  objections.forEach(o => {
    if (!byType[o.objection_type]) byType[o.objection_type] = new Map();
    byType[o.objection_type].set(o.user_id, (byType[o.objection_type].get(o.user_id) || 0) + o.occurrence_count);
  });

  const teamWide = [];
  const individual = [];

  for (const [type, repMap] of Object.entries(byType)) {
    const affectedReps = repMap.size;
    const pct = affectedReps / totalReps;

    if (pct >= 0.7) {
      teamWide.push({
        type, affected_reps: affectedReps, total_reps: totalReps,
        insight: `${affectedReps} of ${totalReps} reps are hitting ${type} objections — this is likely a positioning or product problem, not an individual skill gap.`,
      });
    } else if (affectedReps === 1) {
      const [[soloUserId, count]] = repMap.entries();
      individual.push({
        type, affected_reps: 1, rep_name: nameByUserId[soloUserId] || 'Unknown', occurrence_count: count,
        insight: `Only ${nameByUserId[soloUserId] || 'this rep'} is hitting ${type} objections repeatedly — worth a 1:1 on how they're handling it.`,
      });
    }
  }

  res.json({ has_data: true, team_wide: teamWide, individual });
}));

// GET /api/insights/workspace/executive-report (owner/admin only)
router.get('/workspace/executive-report', requirePermission('owner'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const cacheKey = `insights:executive-report:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ ...cached, cached: true });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [pipelineRes, skillRes, patternsRes, objectionsRes, membersRes] = await Promise.allSettled([
    supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId),
    supabaseAdmin.from('skill_progression').select('user_id, composite_score_avg, composite_delta, top_weakness, week_start').eq('workspace_id', workspaceId).order('week_start', { ascending: false }).limit(50),
    supabaseAdmin.from('communication_patterns').select('pattern_label, pattern_detail, affected_outcome').eq('workspace_id', workspaceId).eq('is_active', true).order('confidence_score', { ascending: false }).limit(5),
    supabaseAdmin.from('objection_tracker').select('objection_type, occurrence_count').eq('workspace_id', workspaceId).order('occurrence_count', { ascending: false }).limit(5),
    supabaseAdmin.from('workspace_members').select('user_id, users(name)').eq('workspace_id', workspaceId).eq('status', 'active'),
  ]);

  const pipelineRows = pipelineRes.status === 'fulfilled' ? pipelineRes.value.data || [] : [];
  const skillRows = skillRes.status === 'fulfilled' ? skillRes.value.data || [] : [];
  const patterns = patternsRes.status === 'fulfilled' ? patternsRes.value.data || [] : [];
  const objections = objectionsRes.status === 'fulfilled' ? objectionsRes.value.data || [] : [];
  const members = membersRes.status === 'fulfilled' ? membersRes.value.data || [] : [];

  const totalRevenue = pipelineRows.reduce((s, r) => s + (r.total_revenue || 0), 0);
  const pipelineValue = pipelineRows.reduce((s, r) => s + (r.pipeline_value || 0), 0);
  const totalWon = pipelineRows.reduce((s, r) => s + (r.closed_won_count || 0), 0);
  const totalLost = pipelineRows.reduce((s, r) => s + (r.closed_lost_count || 0), 0);
  const winRate = (totalWon + totalLost) > 0 ? Math.round((totalWon * 100) / (totalWon + totalLost)) : 0;

  const weeks = [...new Set(skillRows.map(r => r.week_start))].sort().reverse();
  const currentWeekRows = skillRows.filter(r => r.week_start === weeks[0]);
  const prevWeekRows = skillRows.filter(r => r.week_start === weeks[1]);
  const avgComposite = (rows) => rows.length ? rows.reduce((s, r) => s + (r.composite_score_avg || 0), 0) / rows.length : null;
  const currentAvg = avgComposite(currentWeekRows);
  const prevAvg = avgComposite(prevWeekRows);

  const weaknessCounts = {};
  currentWeekRows.forEach(r => { if (r.top_weakness) weaknessCounts[r.top_weakness] = (weaknessCounts[r.top_weakness] || 0) + 1; });
  const sharedWeakness = Object.entries(weaknessCounts).sort((a, b) => b[1] - a[1])[0];

  if (!pipelineRows.length && !skillRows.length) {
    return res.json({ has_data: false, message: 'Not enough workspace data yet to generate an executive report.' });
  }

  const userCtx = buildUserContext(req);
  const prompt = `Generate a monthly executive business review for this sales team workspace.

TEAM SIZE: ${members.length}
PIPELINE: Won ${totalWon} | Lost ${totalLost} | Win rate ${winRate}% | Total revenue $${totalRevenue} | Pipeline value $${pipelineValue}
TEAM SKILL: Current composite avg ${currentAvg?.toFixed(1) ?? 'N/A'}/10 ${prevAvg != null ? `(prev week: ${prevAvg.toFixed(1)})` : ''}
SHARED WEAKNESS: ${sharedWeakness ? `${sharedWeakness[0]} (${sharedWeakness[1]} of ${currentWeekRows.length} reps)` : 'none dominant'}
TOP TEAM PATTERNS: ${patterns.map(p => `${p.pattern_label} (${p.affected_outcome})`).join(', ') || 'none detected'}
TOP OBJECTIONS: ${objections.map(o => `${o.objection_type} (${o.occurrence_count}x)`).join(', ') || 'none logged'}

Return ONLY this JSON:
{"headline":"1 sentence","pipeline_summary":"2-3 sentences","coaching_summary":"2-3 sentences","risk_areas":"1-2 sentences","recommendations":["...","...","..."]}`;

  const { content } = await callWithFallbackGroq({
    systemPrompt: 'You write concise, data-driven executive business reviews for sales team leaders. Return only valid JSON.',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3, maxTokens: 800,
    tier: 'quality', workspaceId, userId: req.user.id, sourceJob: 'executive_report',
  });

  let report;
  try {
    report = parseAIJson(content);
  } catch (err) {
    logError('workspace/executive-report parse', err, { workspaceId });
    return res.status(500).json({ error: 'GENERATION_FAILED' });
  }

  const result = {
    has_data: true,
    report,
    generated_at: new Date().toISOString(),
    period: new Date().toISOString().slice(0, 7),
  };
  await setCache(cacheKey, result, 24 * 60 * 60).catch(() => {});
  res.json({ ...result, cached: false });
}));

// Helper: turn a snake_case axis name into a readable label
const humanizeAxis = (axis) => {
  if (!axis) return 'This skill';
  return axis.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// GET /api/insights/workspace/skill-matrix (manager+)
router.get('/workspace/skill-matrix', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, role, users(id, name, email)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  if (!members?.length) return res.json({ members: [] });

  const memberIds = members.map(m => m.user_id);

  const { data: progressRows } = await supabaseAdmin
    .from('skill_progression')
    .select('user_id, week_start, composite_score_avg, top_weakness, top_strength, messages_analyzed')
    .eq('workspace_id', workspaceId)
    .in('user_id', memberIds)
    .order('week_start', { ascending: false });

  const latestByMember = {};
  for (const row of (progressRows || [])) {
    if (!latestByMember[row.user_id]) latestByMember[row.user_id] = row;
  }

  const matrix = members.map(m => ({
    user_id:        m.user_id,
    role:           m.role,
    name:           m.users?.name || m.users?.email || 'Unknown',
    email:          m.users?.email,
    skill_snapshot: latestByMember[m.user_id] || null,
    has_data:       !!latestByMember[m.user_id] && (latestByMember[m.user_id].messages_analyzed || 0) >= 3,
  }));

  res.json({ members: matrix, workspace_id: workspaceId });
}));

// ── Helpers ───────────────────────────────────────────────────
const computeTrend = (deltas) => {
  const vals = Object.values(deltas).filter(d => d !== null).map(d => d.delta);
  const pos = vals.filter(d => d > 0.05).length;
  const neg = vals.filter(d => d < -0.05).length;
  if (pos >= 4) return 'improving';
  if (neg >= 4) return 'declining';
  if (pos > neg) return 'mixed_positive';
  if (neg > pos) return 'mixed_negative';
  return 'stable';
};

const buildWhyLosingPrompt = (user, patterns, negativeAnalyses, positiveAnalyses, currentWeek, objections) => {
  const avgScore = (arr, field) => {
    const vals = arr.filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : 'N/A';
  };
  const failureFreq = {};
  negativeAnalyses.forEach(a => { (a.failure_categories || []).forEach(cat => { failureFreq[cat] = (failureFreq[cat] || 0) + 1; }); });
  const topFailures = Object.entries(failureFreq).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return `Generate a "Why You're Losing Sales" intelligence report for this seller.
SELLER:
Product/Service: ${user.product_description || 'not specified'}
Target customers: ${user.target_audience || 'not specified'}
DATA SUMMARY:
Total messages analyzed: ${negativeAnalyses.length + positiveAnalyses.length}
Positive: ${positiveAnalyses.length} | Negative: ${negativeAnalyses.length}
LOSING MESSAGE SCORES:
Hook: ${avgScore(negativeAnalyses, 'hook_score')}/10 | Clarity: ${avgScore(negativeAnalyses, 'clarity_score')}/10
Value Prop: ${avgScore(negativeAnalyses, 'value_prop_score')}/10 | Personalization: ${avgScore(negativeAnalyses, 'personalization_score')}/10
CTA: ${avgScore(negativeAnalyses, 'cta_score')}/10 | Tone: ${avgScore(negativeAnalyses, 'tone_score')}/10
WINNING MESSAGE SCORES:
Hook: ${avgScore(positiveAnalyses, 'hook_score')}/10 | Clarity: ${avgScore(positiveAnalyses, 'clarity_score')}/10
Value Prop: ${avgScore(positiveAnalyses, 'value_prop_score')}/10 | Personalization: ${avgScore(positiveAnalyses, 'personalization_score')}/10
TOP FAILURE PATTERNS: ${topFailures.map(([cat, count]) => `${cat}: ${count}x`).join(', ') || 'none'}
TOP OBJECTIONS: ${objections.slice(0, 3).map(o => `${o.objection_type}: ${o.occurrence_count}x`).join(', ') || 'none logged'}
DETECTED PATTERNS: ${patterns.slice(0, 3).map(p => `• ${p.pattern_label}: ${p.pattern_detail}`).join('\n') || 'none yet'}
${currentWeek ? `CURRENT SKILL: Composite: ${currentWeek.composite_score_avg}/10 | Weakness: ${currentWeek.top_weakness}` : ''}
Return ONLY this JSON:
{"primary_diagnosis":"...","evidence_summary":"...","immediate_fix":"...","skill_to_focus":"hook|clarity|value_prop|personalization|cta|tone","encouraging_note":"...","data_status":"sufficient"}`;
};

export default router;
