// src/routes/insights.js
import { Router }            from 'express';
import { asyncHandler }      from '../middleware/errorHandler.js';
import { buildUserContext, requirePermission } from '../middleware/workspace.js';
import { createLogger }      from '../utils/logger.js';
import supabaseAdmin         from '../config/supabase.js';
import { callWithFallback }  from '../services/multiProvider.js';
import { recordTokenUsage }  from '../services/tokenTracker.js';
import { PRO_MODEL }         from '../services/groq.js';
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
    const { content, tokens_in, tokens_out } = await callWithFallback({
      systemPrompt: 'You generate diagnostic sales intelligence reports. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, maxTokens: 600, modelName: PRO_MODEL,
    });
    await recordTokenUsage(userId, 'groq', tokens_in, tokens_out);
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
    const { content, tokens_in, tokens_out } = await callWithFallback({
      systemPrompt: 'You generate diagnostic sales intelligence reports for teams. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, maxTokens: 600, modelName: PRO_MODEL,
    });
    await recordTokenUsage(req.user.id, 'groq', tokens_in, tokens_out);
    const report = parseAIJson(content);
    const result = { has_data: true, report, scope: 'workspace', generated_at: new Date().toISOString() };
    await setCache(cacheKey, result, 4 * 60 * 60).catch(() => {});
    res.json(result);
  } catch (err) {
    logError('workspace/why-losing', err, { workspaceId });
    res.status(500).json({ error: 'GENERATION_FAILED' });
  }
}));

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
