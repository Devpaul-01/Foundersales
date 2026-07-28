// src/routes/metrics.js
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { buildUserContext, requirePermission } from '../middleware/workspace.js';
import { createLogger }    from '../utils/logger.js';
import supabaseAdmin       from '../config/supabase.js';

import { getCache, setCache } from '../services/redis.js';
import { parseAIJson }     from '../utils/parseAIJson.js';

const router = Router();
const { log, logError } = createLogger('Metrics');

// Removed _localIntelCache (in-process Map).
// A double-layer Map-on-top-of-Redis creates split-brain in multi-process deployments
// (PM2 cluster, Docker containers). Each worker keeps its own Map; a Redis bust is
// invisible to workers still holding the old Map entry for up to 4h.
// Redis is the single authoritative cache layer.
// IMPL-M11-01 (Phase 2 refactor): removed a locally-scoped
// INTELLIGENCE_TTL_S constant that was defined here but never actually
// referenced anywhere in this file — dead code, discovered while fixing
// the SAME constant name's genuine bug in routes/insights.js (that file
// referenced this exact name without ever importing or defining it,
// which threw on every request — see services/intelligenceReport.js).
// The real, live constant now lives in config/constants.js as the single
// canonical source, imported by insights.js where it's actually used.

// GET /api/metrics/dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const today          = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo  = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const sevenDaysOut   = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  log('Dashboard Request', { userId, workspaceId });

  const [
    { data: dailyData,       error: dailyErr },
    { data: profile },
    { data: pipelineMetrics, error: pipelineErr },
    { data: recentOpps },
    { data: goals },
    { data: practices },
    { data: checkIns },
    { data: recentSignals },
    { data: objectionSummary },
    { data: patterns },
    pendingCommitmentsResult,
    unreadTipsResult,
    { data: prospectHealth },
    { data: upcomingEvents },
  ] = await Promise.all([
    // Fix: scope to workspace. daily_metrics has a workspace_id column and a
    // user can belong to more than one workspace — without this filter, a
    // multi-workspace user's stats bleed across workspaces.
    supabaseAdmin.from('daily_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: true }),

    // Fix 3: scope to workspace so multi-workspace users get the right profile
    supabaseAdmin.from('user_performance_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle(),

    supabaseAdmin.from('pipeline_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle(),

    // Trimmed 'status' (it was fetched but never used downstream). Kept
    // 'platform' and now actually use it to build channel_breakdown below.
    supabaseAdmin.from('opportunities')
      .select('marked_sent_at, created_at, platform')
      .eq('workspace_id', workspaceId)
      .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
      .gte('created_at', `${thirtyDaysAgo}T00:00:00`),

    supabaseAdmin.from('user_goals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active'),

    // Fix 2: workspace_id now exists on practice_sessions after migration
    supabaseAdmin.from('practice_sessions')
      .select('id, scenario_type, message_strength_score, rating, completed, created_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .gte('created_at', `${thirtyDaysAgo}T00:00:00`)
      .eq('completed', true),

    supabaseAdmin.from('daily_check_ins')
      .select('mood_score, date')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: false }),

    // Recent active conversation signals
    supabaseAdmin.from('conversation_signals')
      .select('signal_type, detected_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .gte('detected_at', `${thirtyDaysAgo}T00:00:00`)
      .order('detected_at', { ascending: false })
      .limit(5),

    // Top objections by frequency
    supabaseAdmin.from('objection_tracker')
      .select('objection_type, occurrence_count')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('occurrence_count', { ascending: false })
      .limit(3),

    // Top communication pattern
    supabaseAdmin.from('communication_patterns')
      .select('pattern_label, affected_outcome, confidence_score')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(1),

    // Count pending + overdue commitments
    supabaseAdmin.from('conversation_commitments')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .in('status', ['pending', 'overdue']),

    // Count unread, undismissed growth tips
    supabaseAdmin.from('growth_cards')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('is_dismissed', false),

    // NEW: relationship health summary — `prospects` was untouched anywhere
    // in this file despite being central CRM data.
    supabaseAdmin.from('prospects')
      .select('relationship_health_score')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId),

    // NEW: events in the next 7 days, to flag meetings that still need prep
    supabaseAdmin.from('user_events')
      .select('id, prep_generated')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .gte('event_date', today)
      .lte('event_date', sevenDaysOut),
  ]);

  if (dailyErr)    logError('dashboard/daily_metrics',    dailyErr,    { userId });
  if (pipelineErr) logError('dashboard/pipeline_metrics', pipelineErr, { userId });

  const sentOpps        = (recentOpps || []).filter(o => o.marked_sent_at);
  const outreachStreak  = calculateOutreachStreakFromOpps(sentOpps);
  const sentCount30d    = sentOpps.length;
  const positiveRate    = Math.min(1, Math.max(0, profile?.positive_rate || 0));
  const practiceCount7d = (practices || []).filter(p => new Date(p.created_at) > new Date(Date.now() - 7 * 86400000)).length;
  const { score: momentumScore, breakdown: momentumBreakdown } = computeMomentumScore({
    outreachStreak, sentCount30d, positiveRate, pipelineMetrics, goals: goals || [], practiceCount: practiceCount7d,
  });
  const chartData = buildChartData(dailyData || [], recentOpps || []);

  // Fix: trend used to be hardcoded to 0 when calling generateMomentumInsight,
  // which made its "momentum is building" branch unreachable. Derive a real
  // week-over-week comparison from the chart data we already built.
  const last7Sent = chartData.slice(-7).reduce((s, d) => s + d.sent, 0);
  const prev7Sent = chartData.slice(-14, -7).reduce((s, d) => s + d.sent, 0);
  const sentTrend = last7Sent - prev7Sent;

  const avgMood   = checkIns?.length
    ? Math.round(checkIns.reduce((s, c) => s + (c.mood_score || 5), 0) / checkIns.length)
    : null;
  const checkedInToday = (checkIns || []).some(c => c.date === today);

  // NEW: channel breakdown using the 'platform' field already fetched above
  const channelBreakdown = {};
  for (const o of (recentOpps || [])) {
    const platform = o.platform || 'unknown';
    if (!channelBreakdown[platform]) channelBreakdown[platform] = { discovered: 0, sent: 0 };
    channelBreakdown[platform].discovered++;
    if (o.marked_sent_at) channelBreakdown[platform].sent++;
  }

  const healthScores = (prospectHealth || []).filter(p => p.relationship_health_score != null);
  const avgRelationshipHealth = healthScores.length
    ? Math.round(healthScores.reduce((s, p) => s + p.relationship_health_score, 0) / healthScores.length)
    : null;
  const atRiskProspectCount = healthScores.filter(p => p.relationship_health_score < 40).length;
  const eventsNeedingPrep   = (upcomingEvents || []).filter(e => !e.prep_generated).length;

  res.json({
    dashboard: {
      outreach_streak:     outreachStreak,
      sent_count_30d:      sentCount30d,
      positive_rate:       positiveRate,
      momentum_score:      momentumScore,
      momentum_breakdown:  momentumBreakdown,
      momentum_insight:    generateMomentumInsight(momentumScore, sentTrend, outreachStreak, profile),
      average_mood:        avgMood,
      checked_in_today:    checkedInToday,
      recent_signals:      recentSignals || [],
      top_objections:      objectionSummary || [],
      top_pattern:         patterns?.[0] || null,
      pending_commitments: pendingCommitmentsResult?.count || 0,
      unread_tips:         unreadTipsResult?.count || 0,
      practice_nudge:      practiceCount7d < 3 ? 'Practice more this week — aim for at least 3 sessions.' : null,
      channel_breakdown:   channelBreakdown,
      relationship_health: { avg_score: avgRelationshipHealth, at_risk_count: atRiskProspectCount },
      upcoming_events:     { next_7d: upcomingEvents?.length || 0, needs_prep: eventsNeedingPrep },
    },
    pipeline:     pipelineMetrics || {},
    chart_data:   chartData,
    goals:        goals || [],
    practice:     { sessions_30d: practices?.length || 0, sessions_7d: practiceCount7d },
    workspace_id: workspaceId,
  });
}));

// GET /api/metrics/skill-breakdown
router.get('/skill-breakdown', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: analyses } = await supabaseAdmin.from('conversation_analyses')
    .select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo);
  if (!analyses?.length) return res.json({ has_data: false });
  const avg = (field) => {
    const vals = analyses.filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };
  const scores = {
    hook:            avg('hook_score'),
    clarity:         avg('clarity_score'),
    value_prop:      avg('value_prop_score'),
    personalization: avg('personalization_score'),
    cta:             avg('cta_score'),
    tone:            avg('tone_score'),
  };
  const validScores = Object.values(scores).filter(v => v != null);
  const composite   = validScores.length ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)) : null;
  const sorted      = Object.entries(scores).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
  res.json({
    has_data:       true,
    scores,
    composite,
    weakest:        sorted[0]?.[0] || null,
    strongest:      sorted[sorted.length - 1]?.[0] || null,
    analyzed_count: analyses.length,
  });
}));





// GET /api/metrics/conversation-analyses
router.get('/conversation-analyses', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: analyses, error } = await supabaseAdmin
    .from('conversation_analyses')
    .select([
      'id', 'outcome', 'platform', 'created_at', 'analysis_text',
      'hook_score', 'clarity_score', 'value_prop_score', 'personalization_score',
      'cta_score', 'tone_score', 'composite_score',
      'word_count', 'self_referential_ratio',
      'has_social_proof', 'has_specific_ask',
      'failure_categories', 'success_signals',
      'improvement_suggestions', 'rewritten_message', 'line_annotations',
    ].join(', '))
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) { logError('conversation-analyses', error, { userId }); return res.json({ has_data: false, analyses: [] }); }
  if (!analyses?.length) return res.json({ has_data: false, analyses: [] });

  // Aggregate failure / success counts
  const failureCounts = {}, successCounts = {};
  for (const a of analyses) {
    for (const f of (a.failure_categories || [])) failureCounts[f] = (failureCounts[f] || 0) + 1;
    for (const s of (a.success_signals    || [])) successCounts[s] = (successCounts[s] || 0) + 1;
  }
  const topFailures  = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));
  const topSuccesses = Object.entries(successCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));

  // NEW: per-platform performance — `platform` was already selected but never aggregated
  const platformStats = {};
  for (const a of analyses) {
    if (!a.platform) continue;
    if (!platformStats[a.platform]) platformStats[a.platform] = { count: 0, scoreSum: 0, scoreCount: 0 };
    platformStats[a.platform].count++;
    if (a.composite_score != null) {
      platformStats[a.platform].scoreSum += Number(a.composite_score);
      platformStats[a.platform].scoreCount++;
    }
  }
  const by_platform = Object.entries(platformStats).map(([platform, v]) => ({
    platform,
    count: v.count,
    avg_composite: v.scoreCount ? parseFloat((v.scoreSum / v.scoreCount).toFixed(2)) : null,
  })).sort((a, b) => b.count - a.count);

  // Flatten improvement suggestions from most recent analyses, deduplicated by dimension
  const seenDimensions = new Set();
  const improvements = analyses
    .flatMap(a => (a.improvement_suggestions || []).map(s => ({
      ...s, outcome: a.outcome, date: a.created_at?.split('T')[0],
    })))
    .filter(s => s.dimension && !seenDimensions.has(s.dimension) && seenDimensions.add(s.dimension))
    .slice(0, 8);

  const avgField = (field) => {
    const vals = analyses.filter(a => a[field] != null).map(a => Number(a[field]));
    return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };

  const avg_scores = {
    hook:            avgField('hook_score'),
    clarity:         avgField('clarity_score'),
    value_prop:      avgField('value_prop_score'),
    personalization: avgField('personalization_score'),
    cta:             avgField('cta_score'),
    tone:            avgField('tone_score'),
    composite:       avgField('composite_score'),
  };

  // Trend: split into two 15-day halves
  const midpoint = new Date(Date.now() - 15 * 86400000).toISOString();
  const recentHalf  = analyses.filter(a => a.created_at >= midpoint);
  const earlierHalf = analyses.filter(a => a.created_at < midpoint);
  const halfAvg = (arr) => {
    const vals = arr.filter(a => a.composite_score != null).map(a => Number(a.composite_score));
    return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };
  const trend_delta = (halfAvg(recentHalf) != null && halfAvg(earlierHalf) != null)
    ? parseFloat((halfAvg(recentHalf) - halfAvg(earlierHalf)).toFixed(2))
    : null;

  res.json({
    has_data:     true,
    total:        analyses.length,
    avg_scores,
    trend_delta,
    top_failures:  topFailures,
    top_successes: topSuccesses,
    by_platform,
    improvements,
    recent: analyses.slice(0, 10).map(a => ({
      id:                   a.id,
      outcome:              a.outcome,
      platform:             a.platform,
      composite_score:      a.composite_score,
      analysis_text:        a.analysis_text,
      failure_categories:   a.failure_categories,
      success_signals:      a.success_signals,
      improvement_suggestions: a.improvement_suggestions,
      rewritten_message:    a.rewritten_message,
      has_social_proof:     a.has_social_proof,
      has_specific_ask:     a.has_specific_ask,
      self_referential_ratio: a.self_referential_ratio,
      word_count:           a.word_count,
      created_at:           a.created_at,
    })),
  });
}));

// GET /api/metrics/workspace/leaderboard (manager+)
router.get('/workspace/leaderboard', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId   = req.workspace.id;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, role, users(id, name, email)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (!members?.length) return res.json({ leaderboard: [] });

  const memberIds = members.map(m => m.user_id);
  const [
    { data: perfProfiles },
    { data: pipelineRows },
    { data: opps },
    { data: skillRows },
    { data: goalRows },
  ] = await Promise.all([
    // Fix 3: scope to workspace so each member's profile is workspace-specific
    supabaseAdmin.from('user_performance_profiles')
      .select('user_id, total_sent, total_positive, positive_rate')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds),

    supabaseAdmin.from('pipeline_metrics')
      .select('user_id, closed_won_count, total_revenue')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds),

    supabaseAdmin.from('opportunities')
      .select('user_id, marked_sent_at, created_at')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .gte('created_at', `${thirtyDaysAgo}T00:00:00`)
      .not('marked_sent_at', 'is', null),

    // NEW: latest skill score per member. The old score formula maxed out at
    // 65/100 with no skill or goal component at all — this fills the gap.
    supabaseAdmin.from('skill_progression')
      .select('user_id, composite_score_avg, week_start')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .order('week_start', { ascending: false }),

    // NEW: active goal completion %, also feeding the leaderboard score
    supabaseAdmin.from('user_goals')
      .select('user_id, current_value, target_value, status')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .eq('status', 'active'),
  ]);

  const perfMap     = Object.fromEntries((perfProfiles || []).map(p => [p.user_id, p]));
  const pipelineMap = Object.fromEntries((pipelineRows  || []).map(p => [p.user_id, p]));
  const sentCount   = (opps || []).reduce((acc, o) => { acc[o.user_id] = (acc[o.user_id] || 0) + 1; return acc; }, {});

  const latestSkillMap = {};
  for (const row of (skillRows || [])) { if (!latestSkillMap[row.user_id]) latestSkillMap[row.user_id] = row; }

  const goalStatsMap = {};
  for (const g of (goalRows || [])) {
    if (!goalStatsMap[g.user_id]) goalStatsMap[g.user_id] = { total: 0, pctSum: 0 };
    goalStatsMap[g.user_id].total++;
    const pct = g.target_value ? Math.min(100, ((g.current_value || 0) / g.target_value) * 100) : 0;
    goalStatsMap[g.user_id].pctSum += pct;
  }

  const leaderboard = members.map(m => {
    const perf     = perfMap[m.user_id] || {}, pl = pipelineMap[m.user_id] || {}, sent30d = sentCount[m.user_id] || 0;
    const skill    = latestSkillMap[m.user_id]?.composite_score_avg ?? null;
    const goalStat = goalStatsMap[m.user_id];
    const goalPct  = goalStat?.total ? goalStat.pctSum / goalStat.total : 0;

    return {
      user_id:             m.user_id,
      role:                m.role,
      name:                m.users?.name || m.users?.email || 'Unknown',
      sent_30d:            sent30d,
      positive_rate:       Math.min(1, Math.max(0, perf.positive_rate || 0)),
      closed_won:          pl.closed_won_count || 0,
      total_revenue:       pl.total_revenue || 0,
      skill_score:         skill,
      goal_completion_pct: Math.round(goalPct),
      // Weights: outreach volume 15, reply quality 30, deals closed 20,
      // current skill level 20, active goal progress 15 — sums to 100.
      // NOTE: skill_score is assumed to be on a 0–10 scale (consistent with
      // the other AI-scored numeric(4,2) fields in conversation_analyses) —
      // worth double-checking against how skill_progression is actually
      // populated.
      score: Math.round(
        Math.min(15, sent30d * 0.5) +
        Math.min(30, Math.round((perf.positive_rate || 0) * 100)) +
        Math.min(20, (pl.closed_won_count || 0) * 5) +
        Math.min(20, Math.round((skill || 0) * 2)) +
        Math.min(15, Math.round(goalPct * 0.15))
      ),
    };
  }).sort((a, b) => b.score - a.score);

  res.json({ leaderboard, workspace_id: workspaceId });
}));

// GET /api/metrics/workspace/coaching-queue (manager+)
router.get('/workspace/coaching-queue', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, users(id, name, email)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (!members?.length) return res.json({ queue: [] });

  const memberIds = members.map(m => m.user_id);
  const [
    { data: progressRows },
    { data: recentSent },
    { data: practiceRows },
    { data: prospectRows },
  ] = await Promise.all([
    supabaseAdmin.from('skill_progression')
      .select('user_id, composite_score_avg, composite_delta, top_weakness')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .order('week_start', { ascending: false }),

    supabaseAdmin.from('opportunities')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .not('marked_sent_at', 'is', null)
      .gte('marked_sent_at', sevenDaysAgo),

    // Fix 2: workspace_id filter now available after migration
    supabaseAdmin.from('practice_sessions')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .eq('completed', true)
      .gte('created_at', sevenDaysAgo),

    // NEW: relationship health, to flag reps whose pipeline is going cold
    supabaseAdmin.from('prospects')
      .select('user_id, relationship_health_score')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds),
  ]);

  const latestProgress = (progressRows || []).reduce((acc, r) => { if (!acc[r.user_id]) acc[r.user_id] = r; return acc; }, {});
  const sentSet     = new Set((recentSent   || []).map(o => o.user_id));
  const practiceSet = new Set((practiceRows || []).map(p => p.user_id));

  const healthStats = {};
  for (const p of (prospectRows || [])) {
    if (p.relationship_health_score == null) continue;
    if (!healthStats[p.user_id]) healthStats[p.user_id] = { sum: 0, count: 0 };
    healthStats[p.user_id].sum += p.relationship_health_score;
    healthStats[p.user_id].count++;
  }

  const queue = members.map(m => {
    const progress  = latestProgress[m.user_id];
    const health    = healthStats[m.user_id];
    const avgHealth = health?.count ? health.sum / health.count : null;
    const flags = [];
    if (!sentSet.has(m.user_id))                                               flags.push('no_outreach_7d');
    if (!practiceSet.has(m.user_id))                                           flags.push('no_practice_7d');
    if (progress?.composite_delta != null && progress.composite_delta < -0.5)  flags.push('score_declining');
    if (progress?.composite_score_avg != null && progress.composite_score_avg < 5) flags.push('low_skill_score');
    if (avgHealth != null && avgHealth < 40)                                   flags.push('low_relationship_health');
    return {
      user_id:                 m.user_id,
      name:                    m.users?.name || m.users?.email || 'Unknown',
      flags,
      skill_score:             progress?.composite_score_avg || null,
      score_delta:             progress?.composite_delta || null,
      top_weakness:            progress?.top_weakness || null,
      avg_relationship_health: avgHealth != null ? Math.round(avgHealth) : null,
      needs_coaching:          flags.length >= 2,
    };
  }).filter(m => m.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length);

  res.json({ queue, workspace_id: workspaceId });
}));

// GET /api/metrics/workspace/team-velocity (manager+)
router.get('/workspace/team-velocity', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const twoWeeksAgo  = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const { data: progressRows } = await supabaseAdmin.from('skill_progression')
    .select('user_id, week_start, composite_score_avg, messages_analyzed')
    .eq('workspace_id', workspaceId)
    .gte('week_start', twoWeeksAgo)
    .order('week_start', { ascending: false });

  if (!progressRows?.length) return res.json({ has_data: false });
  const weeks = [...new Set(progressRows.map(r => r.week_start))].sort().reverse();
  if (weeks.length < 2) return res.json({ has_data: false, message: 'Not enough weekly data.' });

  const current  = progressRows.filter(r => r.week_start === weeks[0]);
  const previous = progressRows.filter(r => r.week_start === weeks[1]);
  const avgComposite = (rows) => {
    const vals = rows.filter(r => r.composite_score_avg != null).map(r => r.composite_score_avg);
    return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };
  const currentAvg  = avgComposite(current), previousAvg = avgComposite(previous);
  const delta = currentAvg != null && previousAvg != null ? parseFloat((currentAvg - previousAvg).toFixed(2)) : null;

  res.json({
    has_data:                  true,
    current_week:              weeks[0],
    previous_week:             weeks[1],
    team_composite_current:    currentAvg,
    team_composite_previous:   previousAvg,
    team_composite_delta:      delta,
    active_members_current:    current.length,
    active_members_previous:   previous.length,
    trend: delta != null ? (delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'stable') : 'no_data',
  });
}));

// GET /api/metrics/alerts
router.get('/alerts', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const today        = new Date().toISOString().split('T')[0];

  const [
    { data: stalled },
    { data: overdue },
    { data: skillTrend },
    { data: topObjection },
    { data: buyingSignals },
    { data: atRiskProspects },
  ] = await Promise.all([
    // Stalled deals: contacted/replied, sent >7d ago, no feedback yet
    supabaseAdmin.from('opportunities')
      .select('id, stage, target_name, marked_sent_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .in('stage', ['contacted', 'replied'])
      .lt('marked_sent_at', sevenDaysAgo)
      .is('feedback_prompted_at', null),

    // Overdue commitments
    supabaseAdmin.from('conversation_commitments')
      .select('id, commitment_text, due_date')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .lt('due_date', today),

    // Last two weeks of skill progression to detect decline
    supabaseAdmin.from('skill_progression')
      .select('composite_delta, week_start')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
      .limit(2),

    // Top objection missing a best_response
    supabaseAdmin.from('objection_tracker')
      .select('objection_type, objection_phrase, occurrence_count')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .is('best_response', null)
      .order('occurrence_count', { ascending: false })
      .limit(1),

    // Recent strong buying signals
    supabaseAdmin.from('conversation_signals')
      .select('signal_type, signal_text')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('signal_type', ['buying_signal', 'strong_interest'])
      .gte('detected_at', sevenDaysAgo),

    // NEW: prospects whose relationship is going cold
    supabaseAdmin.from('prospects')
      .select('id, name, relationship_health_score')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .lt('relationship_health_score', 30),
  ]);

  const alerts = [];
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  if (stalled?.length) {
    alerts.push({
      type: 'warning', icon: '⚠️', priority: 'high',
      title: `${stalled.length} deal${stalled.length > 1 ? 's' : ''} stalled`,
      body: `No activity on ${stalled.length} opportunit${stalled.length > 1 ? 'ies' : 'y'} for >7 days.`,
      action: 'View stalled deals',
    });
  }

  if (overdue?.length) {
    alerts.push({
      type: 'warning', icon: '📋', priority: 'high',
      title: `${overdue.length} overdue commitment${overdue.length > 1 ? 's' : ''}`,
      body: overdue.slice(0, 2).map(c => `"${c.commitment_text}" (due ${c.due_date})`).join('; '),
      action: 'Review commitments',
    });
  }

  if (skillTrend?.length === 2 && skillTrend[0].composite_delta < -0.5) {
    alerts.push({
      type: 'coaching', icon: '📉', priority: 'medium',
      title: 'Skills declining',
      body: `Skill score dropped ${Math.abs(skillTrend[0].composite_delta).toFixed(1)} points this week. Practice recommended.`,
      action: 'Start practice session',
    });
  }

  if (topObjection?.length && topObjection[0].occurrence_count > 3) {
    alerts.push({
      type: 'opportunity', icon: '💪', priority: 'medium',
      title: 'Top objection needs a response',
      body: `"${topObjection[0].objection_phrase}" has come up ${topObjection[0].occurrence_count} times without a saved best response.`,
      action: 'Generate response',
    });
  }

  if (buyingSignals?.length > 3) {
    alerts.push({
      type: 'opportunity', icon: '🚀', priority: 'high',
      title: `${buyingSignals.length} buying signals this week`,
      body: `Strong interest detected across ${buyingSignals.length} conversations. Follow up now.`,
      action: 'View signals',
    });
  }

  if (atRiskProspects?.length) {
    alerts.push({
      type: 'warning', icon: '🧊', priority: 'medium',
      title: `${atRiskProspects.length} relationship${atRiskProspects.length > 1 ? 's' : ''} going cold`,
      body: `${atRiskProspects.slice(0, 2).map(p => p.name).join(', ')}${atRiskProspects.length > 2 ? ' and others' : ''} have low relationship health scores.`,
      action: 'Reconnect with at-risk prospects',
    });
  }

  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  res.json({ alerts, count: alerts.length });
}));

// GET /api/metrics/practice-recommendations
router.get('/practice-recommendations', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;

  const [
    { data: skillTrend },
    { data: negativePatterns },
    { data: topObjections },
    { data: recentPractice },
  ] = await Promise.all([
    supabaseAdmin.from('skill_progression')
      .select('top_weakness, top_strength, composite_score_avg')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
      .limit(1),

    supabaseAdmin.from('communication_patterns')
      .select('pattern_type, pattern_label, affected_outcome, confidence_score')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('affected_outcome', 'negative')
      .eq('is_active', true)
      .order('confidence_score', { ascending: false })
      .limit(2),

    supabaseAdmin.from('objection_tracker')
      .select('objection_type, objection_phrase')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('occurrence_count', { ascending: false })
      .limit(2),

    supabaseAdmin.from('practice_sessions')
      .select('scenario_type')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('completed', true)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const recommendations = [];
  const practicedTypes = new Set((recentPractice || []).map(p => p.scenario_type));

  if (skillTrend?.[0]?.top_weakness) {
    const weakness = skillTrend[0].top_weakness;
    recommendations.push({
      priority: 'high',
      scenario: `${weakness}_practice`,
      title: `Strengthen your ${weakness}`,
      description: `Your ${weakness} score is below average. A focused 10-minute session can move it meaningfully.`,
    });
  }

  if (negativePatterns?.[0]) {
    const p = negativePatterns[0];
    recommendations.push({
      priority: 'high',
      scenario: p.pattern_type,
      title: `Address "${p.pattern_label}"`,
      description: `This pattern correlates with negative outcomes at ${Math.round(p.confidence_score * 100)}% confidence.`,
    });
  }

  if (topObjections?.[0] && !practicedTypes.has('objection_handling')) {
    recommendations.push({
      priority: 'medium',
      scenario: 'objection_handling',
      title: `Handle "${topObjections[0].objection_phrase}"`,
      description: 'This is your most common objection — practice a confident, concise response.',
    });
  }

  res.json({ recommendations });
}));

// GET /api/metrics/objection-trends
router.get('/objection-trends', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: objections, error } = await supabaseAdmin
    .from('objection_tracker')
    .select('objection_type, objection_phrase, occurrence_count, first_seen_at, last_seen_at, best_response')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('occurrence_count', { ascending: false });

  if (error) { logError('objection-trends', error, { userId }); return res.json({ has_data: false }); }
  if (!objections?.length) return res.json({ has_data: false });

  const trendingUp    = objections.filter(o => new Date(o.last_seen_at) > new Date(sevenDaysAgo) && o.occurrence_count > 3);
  const needsResponse = objections.filter(o => !o.best_response && o.occurrence_count > 2);
  const totalOccurrences = objections.reduce((sum, o) => sum + (o.occurrence_count || 0), 0);

  res.json({
    has_data:          true,
    top_objections:    objections.slice(0, 5),
    trending_up:       trendingUp,
    needs_best_response: needsResponse,
    total_unique:      objections.length,
    total_occurrences: totalOccurrences,
  });
}));

// GET /api/metrics/workspace/team-overview (manager+)
router.get('/workspace/team-overview', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, users(id, name, email)')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (!members?.length) return res.json({ members: [], team_avg_score: null, workspace_id: workspaceId });

  const memberIds = members.map(m => m.user_id);
  const [
    { data: progressRows },
    { data: outreachRows },
    { data: sessionRows },
    { data: goalRows },
    { data: teamObjections },
    { data: teamSignals },
  ] = await Promise.all([
    supabaseAdmin.from('skill_progression')
      .select('user_id, composite_score_avg, top_weakness, week_start')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .order('week_start', { ascending: false }),

    supabaseAdmin.from('opportunities')
      .select('user_id, marked_sent_at')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .not('marked_sent_at', 'is', null)
      .gte('marked_sent_at', sevenDaysAgo),

    // Fix 2: workspace_id filter now available after migration
    supabaseAdmin.from('practice_sessions')
      .select('user_id, skill_scores, created_at')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .eq('completed', true)
      .gte('created_at', sevenDaysAgo),

    supabaseAdmin.from('user_goals')
      .select('user_id, current_value, target_value, status')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .eq('status', 'active'),

    // Team-level objection patterns
    supabaseAdmin.from('objection_tracker')
      .select('user_id, objection_type, occurrence_count')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .order('occurrence_count', { ascending: false })
      .limit(20),

    // Team-level buying signals (last 7d)
    supabaseAdmin.from('conversation_signals')
      .select('user_id, signal_type, confidence')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .eq('is_active', true)
      .gte('detected_at', sevenDaysAgo),
  ]);

  const latestProgress   = {};
  for (const row of (progressRows || [])) { if (!latestProgress[row.user_id]) latestProgress[row.user_id] = row; }
  const outreachCountMap = (outreachRows || []).reduce((acc, o) => { acc[o.user_id] = (acc[o.user_id] || 0) + 1; return acc; }, {});
  const sessionCountMap  = (sessionRows  || []).reduce((acc, s) => { acc[s.user_id] = (acc[s.user_id] || 0) + 1; return acc; }, {});
  const lastActiveMap    = (sessionRows  || []).reduce((acc, s) => { if (!acc[s.user_id] || s.created_at > acc[s.user_id]) acc[s.user_id] = s.created_at; return acc; }, {});
  const goalCompletionMap = {};
  for (const g of (goalRows || [])) {
    if (!goalCompletionMap[g.user_id]) goalCompletionMap[g.user_id] = { total: 0, completed: 0 };
    goalCompletionMap[g.user_id].total++;
    if (g.target_value && (g.current_value || 0) >= g.target_value) goalCompletionMap[g.user_id].completed++;
  }

  const membersNotPracticed = [], teamScores = [];
  const memberDetails = members.map(m => {
    const progress  = latestProgress[m.user_id];
    const sessions7d = sessionCountMap[m.user_id] || 0;
    const avgScore   = progress?.composite_score_avg ?? null;
    const goalData   = goalCompletionMap[m.user_id];
    const goalPct    = goalData?.total ? Math.round((goalData.completed / goalData.total) * 100) : 0;
    if (sessions7d === 0) membersNotPracticed.push(m.user_id);
    if (avgScore != null) teamScores.push(avgScore);
    return {
      user_id:                  m.user_id,
      name:                     m.users?.name || m.users?.email || 'Unknown',
      sessions_this_week:       sessions7d,
      avg_skill_score:          avgScore,
      weakest_axis:             progress?.top_weakness ?? null,
      last_active:              (lastActiveMap[m.user_id] || '').split('T')[0] || null,
      outreach_sent_this_week:  outreachCountMap[m.user_id] || 0,
      goal_completion_pct:      goalPct,
    };
  });

  const teamAvgScore    = teamScores.length ? parseFloat((teamScores.reduce((a, b) => a + b, 0) / teamScores.length).toFixed(2)) : null;
  const axisCounts      = {};
  for (const m of memberDetails) { if (m.weakest_axis) axisCounts[m.weakest_axis] = (axisCounts[m.weakest_axis] || 0) + 1; }
  const teamWeakestAxis = Object.entries(axisCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Aggregate team objection patterns
  const teamObjectionTypes = Object.entries(
    (teamObjections || []).reduce((acc, o) => {
      acc[o.objection_type] = (acc[o.objection_type] || 0) + (o.occurrence_count || 0);
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => ({ type, count }));

  // Aggregate team signal types
  const teamSignalTypes = Object.entries(
    (teamSignals || []).reduce((acc, s) => {
      acc[s.signal_type] = (acc[s.signal_type] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type, count]) => ({ type, count }));

  res.json({
    members:                          memberDetails,
    team_avg_score:                   teamAvgScore,
    team_weakest_axis:                teamWeakestAxis,
    members_not_practiced_this_week:  membersNotPracticed,
    workspace_id:                     workspaceId,
    team_objections: {
      top:             (teamObjections || []).slice(0, 5),
      common_patterns: teamObjectionTypes,
    },
    team_signals: {
      top_signals: teamSignalTypes,
    },
  });
}));

// ── NEW endpoints leveraging tables that had zero usage in this file ──────
// prospects, user_events, user_skill_profile, practice_badges, practice_drills,
// and workspace_activity all exist in the schema but nothing here ever
// queried them. They're genuinely rich data sources for a sales tool, so
// each gets a focused endpoint below rather than being bolted onto an
// unrelated one.

// GET /api/metrics/prospects-health
router.get('/prospects-health', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: prospects, error } = await supabaseAdmin.from('prospects')
    .select('id, name, company, stage, relationship_health_score, last_contact_at, total_interactions')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) { logError('prospects-health', error, { userId }); return res.json({ has_data: false }); }
  if (!prospects?.length) return res.json({ has_data: false });

  const withScore = prospects.filter(p => p.relationship_health_score != null);
  const avgHealth = withScore.length
    ? Math.round(withScore.reduce((s, p) => s + p.relationship_health_score, 0) / withScore.length)
    : null;

  const atRisk = prospects
    .filter(p => (p.relationship_health_score ?? 100) < 40)
    .sort((a, b) => (a.relationship_health_score ?? 0) - (b.relationship_health_score ?? 0))
    .slice(0, 5);

  const topHealth = prospects
    .filter(p => (p.relationship_health_score ?? 0) >= 80)
    .sort((a, b) => (b.relationship_health_score ?? 0) - (a.relationship_health_score ?? 0))
    .slice(0, 5);

  const stale = prospects.filter(p => p.last_contact_at && p.last_contact_at < fourteenDaysAgo);

  const stageCounts = {};
  for (const p of prospects) stageCounts[p.stage || 'unknown'] = (stageCounts[p.stage || 'unknown'] || 0) + 1;

  res.json({
    has_data:           true,
    total_prospects:    prospects.length,
    avg_health_score:   avgHealth,
    at_risk:            atRisk,
    top_relationships:  topHealth,
    stale_count:        stale.length,
    stage_distribution: stageCounts,
  });
}));

// GET /api/metrics/calendar-prep
router.get('/calendar-prep', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const today           = new Date().toISOString().split('T')[0];
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const sevenDaysOut    = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const { data: events, error } = await supabaseAdmin.from('user_events')
    .select('id, title, event_date, event_type, prep_generated, debrief_completed_at, outcome, energy_score, attendee_name')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('event_date', fourteenDaysAgo)
    .lte('event_date', sevenDaysOut)
    .order('event_date', { ascending: true });

  if (error) { logError('calendar-prep', error, { userId }); return res.json({ has_data: false }); }
  if (!events?.length) return res.json({ has_data: false, needs_prep: [], needs_debrief: [] });

  const needsPrep    = events.filter(e => e.event_date >= today && !e.prep_generated);
  const needsDebrief = events.filter(e => e.event_date < today && !e.debrief_completed_at);

  const withEnergy = events.filter(e => e.energy_score != null);
  const avgEnergy  = withEnergy.length
    ? parseFloat((withEnergy.reduce((s, e) => s + e.energy_score, 0) / withEnergy.length).toFixed(1))
    : null;

  const outcomeCounts = {};
  for (const e of events) if (e.outcome) outcomeCounts[e.outcome] = (outcomeCounts[e.outcome] || 0) + 1;

  res.json({
    has_data:             true,
    needs_prep:           needsPrep,
    needs_debrief:        needsDebrief,
    avg_energy_score:     avgEnergy,
    outcome_distribution: outcomeCounts,
  });
}));

// GET /api/metrics/practice-skill-profile
// Surfaces user_skill_profile — a richer, period-based companion to
// skill_progression with axes (discovery, brevity, objection handling),
// per-pressure-modifier scores, and outcome distribution that nothing
// else in this file exposes.
router.get('/practice-skill-profile', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: rows, error } = await supabaseAdmin.from('user_skill_profile')
    .select('period_start, period_end, clarity_avg, value_avg, discovery_avg, objection_avg, brevity_avg, cta_avg, overall_avg, weakest_axis, strongest_axis, sessions_count, weekly_monologue_score, outcome_distribution, pressure_scores')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('period_end', { ascending: false })
    .limit(2);

  if (error) { logError('practice-skill-profile', error, { userId }); return res.json({ has_data: false }); }
  if (!rows?.length) return res.json({ has_data: false });

  const [current, previous] = rows;
  const delta = previous?.overall_avg != null && current.overall_avg != null
    ? parseFloat((current.overall_avg - previous.overall_avg).toFixed(2))
    : null;

  res.json({
    has_data: true,
    period: { start: current.period_start, end: current.period_end },
    axes: {
      clarity:   current.clarity_avg,
      value:     current.value_avg,
      discovery: current.discovery_avg,
      objection: current.objection_avg,
      brevity:   current.brevity_avg,
      cta:       current.cta_avg,
    },
    overall_avg:            current.overall_avg,
    overall_delta:          delta,
    weakest_axis:            current.weakest_axis,
    strongest_axis:          current.strongest_axis,
    sessions_count:          current.sessions_count,
    weekly_monologue_score:  current.weekly_monologue_score,
    outcome_distribution:    current.outcome_distribution || {},
    pressure_scores:         current.pressure_scores || {},
  });
}));

// GET /api/metrics/achievements
// Surfaces practice_badges (gamification) and practice_drills (focused
// before/after drill scores) — both previously unused.
router.get('/achievements', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [{ data: badges }, { data: drills }] = await Promise.all([
    supabaseAdmin.from('practice_badges')
      .select('badge_type, badge_label, badge_description, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false })
      .limit(20),

    supabaseAdmin.from('practice_drills')
      .select('drill_type, target_axis, score_before, score_after, completed_at')
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(15),
  ]);

  const improvementsByAxis = {};
  for (const d of (drills || [])) {
    if (d.score_before == null || d.score_after == null) continue;
    const axis = d.target_axis;
    if (!improvementsByAxis[axis]) improvementsByAxis[axis] = { deltaSum: 0, count: 0 };
    improvementsByAxis[axis].deltaSum += (d.score_after - d.score_before);
    improvementsByAxis[axis].count++;
  }
  const drill_improvements = Object.entries(improvementsByAxis).map(([axis, v]) => ({
    axis,
    avg_improvement:  parseFloat((v.deltaSum / v.count).toFixed(2)),
    drills_completed: v.count,
  }));

  res.json({
    badges:        badges || [],
    recent_drills: drills || [],
    drill_improvements,
  });
}));

// GET /api/metrics/workspace/activity-feed (manager+)
router.get('/workspace/activity-feed', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;

  const { data: activity, error } = await supabaseAdmin.from('workspace_activity')
    .select('id, user_id, event_type, metadata, created_at, users(name, email)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) { logError('activity-feed', error, { workspaceId }); return res.json({ feed: [] }); }

  const feed = (activity || []).map(a => ({
    user_id:    a.user_id,
    user_name:  a.users?.name || a.users?.email || 'Unknown',
    event_type: a.event_type,
    metadata:   a.metadata,
    created_at: a.created_at,
  }));

  res.json({ feed, workspace_id: workspaceId });
}));

// ============================================================
// NET-NEW METRICS ENDPOINTS
// Added per Foundersales Insights & Metrics Refinement.
// Pure aggregation / listing — no comparative judgment layered on top
// (see /api/insights/* for the synthesis endpoints built on this data).
// ============================================================

// GET /api/metrics/practice/summary
router.get('/practice/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const period = req.query.period === '7d' ? 7 : req.query.period === '90d' ? 90 : 30;
  const cutoff = new Date(Date.now() - period * 86400000).toISOString();

  const { data: sessions, error } = await supabaseAdmin
    .from('practice_sessions')
    .select('scenario_type, completed, goal_achieved, exchanges_count, reply_received, ai_ended_session, retry_of_session_id, pressure_modifier, skill_scores')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('created_at', cutoff);

  if (error) { logError('practice/summary', error, { userId }); throw error; }

  if (!sessions?.length) {
    return res.json({ has_data: false, period: `${period}d` });
  }

  const completed = sessions.filter(s => s.completed);
  const totalSessions = sessions.length;
  const completedCount = completed.length;

  const goalAchievedRate = completedCount ? completed.filter(s => s.goal_achieved).length / completedCount : 0;
  const replyReceivedRate = completedCount ? completed.filter(s => s.reply_received).length / completedCount : 0;
  const aiEndedRate = completedCount ? completed.filter(s => s.ai_ended_session).length / completedCount : 0;
  const retryRate = totalSessions ? sessions.filter(s => s.retry_of_session_id).length / totalSessions : 0;

  const scoresWithValue = completed.filter(s => s.skill_scores?.session_score != null);
  const avgSessionScore = scoresWithValue.length
    ? parseFloat((scoresWithValue.reduce((sum, s) => sum + s.skill_scores.session_score, 0) / scoresWithValue.length).toFixed(1))
    : null;

  const exchangesWithValue = completed.filter(s => s.exchanges_count != null);
  const avgExchanges = exchangesWithValue.length
    ? parseFloat((exchangesWithValue.reduce((sum, s) => sum + s.exchanges_count, 0) / exchangesWithValue.length).toFixed(1))
    : null;

  const byScenario = {};
  for (const s of completed) {
    const scenario = s.scenario_type || 'unknown';
    if (!byScenario[scenario]) byScenario[scenario] = { count: 0, scoreSum: 0, scoreCount: 0, goalAchieved: 0 };
    byScenario[scenario].count++;
    if (s.skill_scores?.session_score != null) { byScenario[scenario].scoreSum += s.skill_scores.session_score; byScenario[scenario].scoreCount++; }
    if (s.goal_achieved) byScenario[scenario].goalAchieved++;
  }
  const byScenarioOut = Object.fromEntries(Object.entries(byScenario).map(([k, v]) => [k, {
    count: v.count,
    avg_score: v.scoreCount ? Math.round(v.scoreSum / v.scoreCount) : null,
    goal_achieved_rate: v.count ? parseFloat((v.goalAchieved / v.count).toFixed(2)) : 0,
  }]));

  const byPressure = {};
  for (const s of completed) {
    if (!s.pressure_modifier || s.skill_scores?.session_score == null) continue;
    if (!byPressure[s.pressure_modifier]) byPressure[s.pressure_modifier] = { sum: 0, count: 0 };
    byPressure[s.pressure_modifier].sum += s.skill_scores.session_score;
    byPressure[s.pressure_modifier].count++;
  }
  const pressureOut = Object.fromEntries(Object.entries(byPressure).map(([k, v]) => [k, Math.round(v.sum / v.count)]));

  const { count: badgesEarned } = await supabaseAdmin
    .from('practice_badges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('earned_at', cutoff);

  res.json({
    has_data: true,
    period: `${period}d`,
    total_sessions: totalSessions,
    completed_sessions: completedCount,
    goal_achieved_rate: parseFloat(goalAchievedRate.toFixed(2)),
    avg_session_score: avgSessionScore,
    avg_exchanges: avgExchanges,
    reply_received_rate: parseFloat(replyReceivedRate.toFixed(2)),
    ai_ended_rate: parseFloat(aiEndedRate.toFixed(2)),
    retry_rate: parseFloat(retryRate.toFixed(2)),
    by_scenario: byScenarioOut,
    pressure_modifier_performance: pressureOut,
    badges_earned: badgesEarned || 0,
    skill_axes_ref: 'See GET /api/metrics/practice-skill-profile for axis-level scores (clarity, discovery, objection_handling, etc.)',
  });
}));

// GET /api/metrics/objections
router.get('/objections', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;

  const { data: objections, error } = await supabaseAdmin
    .from('objection_tracker')
    .select('objection_type, objection_phrase, occurrence_count, best_response, response_score, practice_score, outcome_after, first_seen_at, last_seen_at, market_intel_generated_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('occurrence_count', { ascending: false });

  if (error) { logError('objections', error, { userId }); throw error; }

  if (!objections?.length) return res.json({ has_data: false, objections: [], total_unique_types: 0 });

  res.json({
    has_data: true,
    objections: objections.map(o => ({
      type: o.objection_type,
      occurrence_count: o.occurrence_count,
      first_seen_at: o.first_seen_at,
      last_seen_at: o.last_seen_at,
      best_response: o.best_response || null,
      response_score: o.response_score,
      practice_score: o.practice_score,
      outcome_after: o.outcome_after,
      has_market_intel: !!o.market_intel_generated_at,
      sample_phrase: o.objection_phrase,
    })),
    total_unique_types: objections.length,
  });
}));

// GET /api/metrics/meetings/summary
router.get('/meetings/summary', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const period = req.query.period === '90d' ? 90 : 30;
  const cutoff = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];

  const { data: events, error } = await supabaseAdmin
    .from('user_events')
    .select('outcome, energy_score, prep_generated, debrief_completed_at, follow_up_options')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('event_date', cutoff);

  if (error) { logError('meetings/summary', error, { userId }); throw error; }

  if (!events?.length) return res.json({ has_data: false, period: `${period}d` });

  const debriefed = events.filter(e => e.debrief_completed_at);
  const outcomes = { positive: 0, negative: 0, pending: 0 };
  events.forEach(e => {
    if (e.outcome === 'positive') outcomes.positive++;
    else if (e.outcome === 'negative') outcomes.negative++;
    else outcomes.pending++;
  });

  const withEnergy = events.filter(e => e.energy_score != null);
  const avgEnergy = withEnergy.length
    ? parseFloat((withEnergy.reduce((s, e) => s + e.energy_score, 0) / withEnergy.length).toFixed(1))
    : null;

  res.json({
    has_data: true,
    period: `${period}d`,
    total_meetings: events.length,
    debriefed: debriefed.length,
    debrief_completion_rate: parseFloat((debriefed.length / events.length).toFixed(2)),
    outcomes,
    avg_energy_score: avgEnergy,
    meetings_with_prep_generated: events.filter(e => e.prep_generated).length,
    follow_up_options_generated: events.filter(e => e.follow_up_options).length,
  });
}));

// GET /api/metrics/workspace/dashboard (manager+)
router.get('/workspace/dashboard', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId = req.workspace.id;
  const cacheKey = `metrics:workspace-dashboard:${workspaceId}`;

  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ ...cached, cached: true });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [membersRes, pipelineRes, skillRes, dailyRes] = await Promise.allSettled([
    supabaseAdmin.from('workspace_members').select('user_id, users(name)').eq('workspace_id', workspaceId).eq('status', 'active'),
    supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId),
    supabaseAdmin.from('skill_progression').select('user_id, composite_score_avg, top_weakness, week_start').eq('workspace_id', workspaceId).order('week_start', { ascending: false }),
    supabaseAdmin.from('daily_metrics').select('messages_sent, positive_outcomes').eq('workspace_id', workspaceId).gte('date', thirtyDaysAgo.split('T')[0]),
  ]);

  const members = membersRes.status === 'fulfilled' ? membersRes.value.data || [] : [];
  const pipelineRows = pipelineRes.status === 'fulfilled' ? pipelineRes.value.data || [] : [];
  const skillRows = skillRes.status === 'fulfilled' ? skillRes.value.data || [] : [];
  const dailyRows = dailyRes.status === 'fulfilled' ? dailyRes.value.data || [] : [];

  if (!members.length) return res.json({ has_data: false });

  const nameByUserId = {};
  members.forEach(m => { nameByUserId[m.user_id] = m.users?.name || 'Unknown'; });

  const totalRevenue = pipelineRows.reduce((s, r) => s + (r.total_revenue || 0), 0);
  const pipelineValue = pipelineRows.reduce((s, r) => s + (r.pipeline_value || 0), 0);
  const totalWon = pipelineRows.reduce((s, r) => s + (r.closed_won_count || 0), 0);
  const totalLost = pipelineRows.reduce((s, r) => s + (r.closed_lost_count || 0), 0);
  const winRatePct = (totalWon + totalLost) > 0 ? parseFloat(((totalWon * 100) / (totalWon + totalLost)).toFixed(1)) : 0;

  const totalMessagesSent = dailyRows.reduce((s, r) => s + (r.messages_sent || 0), 0);
  const totalPositive = dailyRows.reduce((s, r) => s + (r.positive_outcomes || 0), 0);
  const teamPositiveRate = totalMessagesSent > 0 ? parseFloat((totalPositive / totalMessagesSent).toFixed(2)) : 0;

  const latestWeek = skillRows[0]?.week_start;
  const currentWeekRows = skillRows.filter(r => r.week_start === latestWeek);
  const teamComposite = currentWeekRows.length
    ? parseFloat((currentWeekRows.reduce((s, r) => s + (r.composite_score_avg || 0), 0) / currentWeekRows.length).toFixed(1))
    : null;

  const sortedByComposite = [...currentWeekRows].filter(r => r.composite_score_avg != null).sort((a, b) => b.composite_score_avg - a.composite_score_avg);
  const topPerformer = sortedByComposite[0]
    ? { user_id: sortedByComposite[0].user_id, name: nameByUserId[sortedByComposite[0].user_id] || 'Unknown', composite: sortedByComposite[0].composite_score_avg }
    : null;
  const needsCoachingRow = sortedByComposite[sortedByComposite.length - 1];
  const needsCoaching = needsCoachingRow && needsCoachingRow.composite_score_avg < 6
    ? { user_id: needsCoachingRow.user_id, name: nameByUserId[needsCoachingRow.user_id] || 'Unknown', composite: needsCoachingRow.composite_score_avg, weakness: needsCoachingRow.top_weakness }
    : null;

  const result = {
    has_data: true,
    team_size: members.length,
    team_composite_score: teamComposite,
    team_positive_rate_30d: teamPositiveRate,
    total_messages_sent_30d: totalMessagesSent,
    pipeline_value: pipelineValue,
    total_revenue: totalRevenue,
    win_rate_pct: winRatePct,
    top_performer: topPerformer,
    needs_coaching: needsCoaching,
  };

  await setCache(cacheKey, result, 30 * 60).catch(() => {});
  res.json({ ...result, cached: false });
}));

// ── Pure helpers exported for testability ─────────────────────

export function calculateOutreachStreakFromOpps(sentOpps) {
  if (!sentOpps?.length) return 0;
  const byDate = {};
  for (const o of sentOpps) {
    const d = (o.marked_sent_at || o.created_at)?.split('T')[0];
    if (d) byDate[d] = true;
  }
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    if (byDate[d]) streak++; else if (i > 0) break;
  }
  return streak;
}

function computeAvgGoalPct(goals) {
  if (!goals.length) return 0;
  const wt = goals.filter(g => g.target_value && g.status === 'active');
  if (!wt.length) return 0;
  return wt.reduce((sum, g) => sum + Math.min(100, ((g.current_value || 0) / g.target_value) * 100), 0) / wt.length;
}

export function computeMomentumScore({ outreachStreak, sentCount30d, positiveRate, pipelineMetrics, goals, practiceCount }) {
  const streakPts = Math.min(15, outreachStreak * 3), volumePts = Math.min(15, Math.floor(sentCount30d / 2));
  const activity      = streakPts + volumePts;
  const conversion    = Math.min(30, Math.round(positiveRate * 100));
  const pipeline      = pipelineMetrics?.call_demo_count > 0 ? 20 : pipelineMetrics?.replied_count > 0 ? 13 : pipelineMetrics?.contacted_count > 0 ? 6 : 0;
  const goalScore     = Math.min(15, Math.round(computeAvgGoalPct(goals) / 7));
  const practiceBonus = Math.min(5, practiceCount);
  return {
    score:     Math.min(100, Math.round(activity + conversion + pipeline + goalScore + practiceBonus)),
    breakdown: { activity, conversion, pipeline, goals: goalScore, practice: practiceBonus },
  };
}

function generateMomentumInsight(score, trend, streak, profile) {
  if (score >= 70) return 'Your momentum is strong. Keep your outreach consistent.';
  if (score >= 40) return `Solid foundation. ${streak > 0 ? `Your ${streak}-day streak is working. ` : ''}Focus on following up with interested prospects.`;
  if (trend > 0)   return `Momentum is building — you sent ${trend} more message${trend > 1 ? 's' : ''} this week than last. Keep going.`;
  return 'Time to rebuild momentum. Sending one message a day for 5 days straight will move this score significantly.';
}

export function buildChartData(dailyData, opportunities) {
  const byDate = {};
  for (const d of dailyData) byDate[d.date] = { ...d };
  for (const o of opportunities) {
    const date = o.created_at?.split('T')[0];
    if (date) {
      if (!byDate[date]) byDate[date] = { date };
      byDate[date].opp_discovered = (byDate[date].opp_discovered || 0) + 1;
      if (o.marked_sent_at) byDate[date].opp_sent = (byDate[date].opp_sent || 0) + 1;
    }
  }
  return Object.values(byDate)
    .sort((a, b) => a.date > b.date ? 1 : -1)
    .slice(-30)
    .map(d => ({
      date:          d.date,
      sent:          d.opp_sent ?? d.messages_sent ?? 0,
      discovered:    d.opp_discovered || 0,
      positive:      d.positive_outcomes || 0,
      positive_rate: d.positive_rate ? Math.round(d.positive_rate * 100) : 0,
    }));
}

// Fix: previously only accepted (profile, pipeline, goals) but was called
// with 6 args from the /intelligence catch block — objections, patterns,
// and stalledDeals were fetched and then silently dropped on the floor.
// This fallback only fires when the AI call fails, but it should still use
// the data already in hand.
function generateRuleBasedInsights(profile, pipeline, goals, objections, patterns, stalledDeals) {
  const insights = [];
  const rate = Math.min(1, Math.max(0, profile?.positive_rate || 0));

  if (rate > 0.25) {
    insights.push({ type: 'pattern', icon: '📈', title: 'Strong reply rate', body: `Your ${Math.round(rate * 100)}% reply rate is above average.`, action: null });
  } else if (rate > 0) {
    insights.push({ type: 'pattern', icon: '📊', title: 'Reply rate opportunity', body: `At ${Math.round(rate * 100)}%, there's room to grow.`, action: 'Open Practice Mode and try a new opener' });
  }

  if (pipeline?.replied_count > 0 && pipeline?.call_demo_count === 0) {
    insights.push({ type: 'opportunity', icon: '💡', title: 'Move replies forward', body: `${pipeline.replied_count} interested contact${pipeline.replied_count > 1 ? 's' : ''} replied but no meetings yet.`, action: 'Follow up with interested contacts' });
  }

  const topPattern = patterns?.[0];
  if (topPattern && topPattern.affected_outcome === 'negative') {
    insights.push({
      type: 'warning', icon: '⚠️',
      title: `Watch for "${topPattern.pattern_label}"`,
      body: `This pattern is correlated with negative outcomes at ${Math.round((topPattern.confidence_score || 0) * 100)}% confidence.`,
      action: 'Review recent messages for this pattern',
    });
  }

  const topObjection = objections?.[0];
  if (topObjection && topObjection.occurrence_count > 2 && !topObjection.best_response) {
    insights.push({
      type: 'coaching', icon: '💬',
      title: `No saved response for "${topObjection.objection_phrase}"`,
      body: `This objection has come up ${topObjection.occurrence_count} times.`,
      action: 'Practice and save a response',
    });
  }

  if (stalledDeals?.length) {
    insights.push({
      type: 'warning', icon: '⏳',
      title: `${stalledDeals.length} stalled deal${stalledDeals.length > 1 ? 's' : ''}`,
      body: 'These opportunities have had no follow-up activity in over a week.',
      action: 'Review stalled deals',
    });
  }

  return insights.slice(0, 5);
}

export default router;
