// src/routes/metrics.js
import { Router }          from 'express';
import { asyncHandler }    from '../middleware/errorHandler.js';
import { buildUserContext, requirePermission } from '../middleware/workspace.js';
import { createLogger }    from '../utils/logger.js';
import supabaseAdmin       from '../config/supabase.js';
import { callWithFallback } from '../services/multiProvider.js';
import { recordTokenUsage } from '../services/tokenTracker.js';
import { getCache, setCache } from '../services/redis.js';
import { parseAIJson }     from '../utils/parseAIJson.js';

const router = Router();
const { log, logError } = createLogger('Metrics');

// Removed _localIntelCache (in-process Map).
// A double-layer Map-on-top-of-Redis creates split-brain in multi-process deployments
// (PM2 cluster, Docker containers). Each worker keeps its own Map; a Redis bust is
// invisible to workers still holding the old Map entry for up to 4h.
// Redis is the single authoritative cache layer.
const INTELLIGENCE_TTL_S = 4 * 60 * 60;

// GET /api/metrics/dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const today        = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  log('Dashboard Request', { userId, workspaceId });

  const [
    { data: dailyData,       error: dailyErr },
    { data: profile },
    { data: pipelineMetrics, error: pipelineErr },
    { data: recentOpps },
    { data: goals },
    { data: practices },
    { data: checkIns },
  ] = await Promise.all([
    supabaseAdmin.from('daily_metrics').select('*').eq('user_id', userId).gte('date', thirtyDaysAgo).order('date', { ascending: true }),
    supabaseAdmin.from('user_performance_profiles').select('*').eq('user_id', userId).single(),
    supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).single(),
    supabaseAdmin.from('opportunities').select('status, marked_sent_at, created_at, platform').eq('workspace_id', workspaceId).eq('user_id', userId).gte('created_at', `${thirtyDaysAgo}T00:00:00`),
    supabaseAdmin.from('user_goals').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active'),
    supabaseAdmin.from('practice_sessions').select('id, scenario_type, message_strength_score, rating, completed, created_at').eq('user_id', userId).gte('created_at', `${thirtyDaysAgo}T00:00:00`).eq('completed', true),
    supabaseAdmin.from('daily_check_ins').select('mood_score, date').eq('user_id', userId).eq('workspace_id', workspaceId).gte('date', thirtyDaysAgo).order('date', { ascending: false }),
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
  const avgMood   = checkIns?.length
    ? Math.round(checkIns.reduce((s, c) => s + (c.mood_score || 5), 0) / checkIns.length)
    : null;

  res.json({
    dashboard: {
      outreach_streak:    outreachStreak,
      sent_count_30d:     sentCount30d,
      positive_rate:      positiveRate,
      momentum_score:     momentumScore,
      momentum_breakdown: momentumBreakdown,
      momentum_insight:   generateMomentumInsight(momentumScore, 0, outreachStreak, profile),
      average_mood:       avgMood,
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
    .eq('workspace_id', workspaceId).eq('user_id', userId).gte('created_at', sevenDaysAgo);
  if (!analyses?.length) return res.json({ has_data: false });
  const avg = (field) => {
    const vals = analyses.filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  };
  const scores = { hook: avg('hook_score'), clarity: avg('clarity_score'), value_prop: avg('value_prop_score'), personalization: avg('personalization_score'), cta: avg('cta_score'), tone: avg('tone_score') };
  const validScores = Object.values(scores).filter(v => v != null);
  const composite   = validScores.length ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)) : null;
  const sorted      = Object.entries(scores).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
  res.json({ has_data: true, scores, composite, weakest: sorted[0]?.[0] || null, strongest: sorted[sorted.length - 1]?.[0] || null, analyzed_count: analyses.length });
}));

// GET /api/metrics/intelligence
router.get('/intelligence', asyncHandler(async (req, res) => {
  const userId = req.user.id, workspaceId = req.workspace.id;
  const cacheKey = `metrics:intelligence:${userId}:${workspaceId}`;

  // Single Redis cache layer — removed the Map double-layer
  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return res.json({ insights: cached, cached: true });

  const userCtx = buildUserContext(req);
  const [{ data: profile }, { data: pipeline }, { data: goals }, { data: checkIns }] = await Promise.all([
    supabaseAdmin.from('user_performance_profiles').select('*').eq('user_id', userId).single(),
    supabaseAdmin.from('pipeline_metrics').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).single(),
    supabaseAdmin.from('user_goals').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3),
    supabaseAdmin.from('daily_check_ins').select('mood_score, answers').eq('user_id', userId).eq('workspace_id', workspaceId).order('date', { ascending: false }).limit(5),
  ]);

  const prompt = `Generate 3 specific, actionable intelligence insights for this seller.\nProduct: ${userCtx.product_description || 'not specified'}\nPerformance: positive rate ${Math.round((profile?.positive_rate || 0) * 100)}%, ${profile?.total_sent || 0} messages sent\nPipeline: ${pipeline?.replied_count || 0} replied, ${pipeline?.call_demo_count || 0} in call/demo\nActive goals: ${(goals || []).map(g => g.goal_text).join('; ') || 'none'}\nReturn ONLY a JSON array: [{"type":"pattern|opportunity|warning","icon":"emoji","title":"short title","body":"2 sentences","action":"one action or null"}]`;

  try {
    const { content, tokens_in, tokens_out } = await callWithFallback({
      systemPrompt: 'You generate sales intelligence. Return only valid JSON arrays.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5, maxTokens: 500,
    });
    await recordTokenUsage(userId, 'groq', tokens_in, tokens_out);
    const insights = parseAIJson(content);
    await setCache(cacheKey, insights, INTELLIGENCE_TTL_S).catch(() => {});
    res.json({ insights, cached: false });
  } catch (err) {
    logError('intelligence', err, { userId, workspaceId });
    res.json({ insights: generateRuleBasedInsights(profile, pipeline, goals || []), cached: false, fallback: true });
  }
}));

// GET /api/metrics/workspace/leaderboard (manager+)
router.get('/workspace/leaderboard', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId   = req.workspace.id;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, role, users(id, name, email)').eq('workspace_id', workspaceId).eq('status', 'active');
  if (!members?.length) return res.json({ leaderboard: [] });
  const memberIds = members.map(m => m.user_id);
  const [{ data: perfProfiles }, { data: pipelineRows }, { data: opps }] = await Promise.all([
    supabaseAdmin.from('user_performance_profiles').select('user_id, total_sent, total_positive, positive_rate').in('user_id', memberIds),
    supabaseAdmin.from('pipeline_metrics').select('user_id, closed_won_count, total_revenue').eq('workspace_id', workspaceId).in('user_id', memberIds),
    supabaseAdmin.from('opportunities').select('user_id, marked_sent_at, created_at').eq('workspace_id', workspaceId).in('user_id', memberIds).gte('created_at', `${thirtyDaysAgo}T00:00:00`).not('marked_sent_at', 'is', null),
  ]);
  const perfMap     = Object.fromEntries((perfProfiles || []).map(p => [p.user_id, p]));
  const pipelineMap = Object.fromEntries((pipelineRows  || []).map(p => [p.user_id, p]));
  const sentCount   = (opps || []).reduce((acc, o) => { acc[o.user_id] = (acc[o.user_id] || 0) + 1; return acc; }, {});
  const leaderboard = members.map(m => {
    const perf = perfMap[m.user_id] || {}, pl = pipelineMap[m.user_id] || {}, sent30d = sentCount[m.user_id] || 0;
    return {
      user_id:       m.user_id, role: m.role, name: m.users?.name || m.users?.email || 'Unknown',
      sent_30d:      sent30d,
      positive_rate: Math.min(1, Math.max(0, perf.positive_rate || 0)),
      closed_won:    pl.closed_won_count || 0,
      total_revenue: pl.total_revenue || 0,
      score: Math.round(Math.min(15, sent30d * 0.5) + Math.min(30, Math.round((perf.positive_rate || 0) * 100)) + Math.min(20, (pl.closed_won_count || 0) * 5)),
    };
  }).sort((a, b) => b.score - a.score);
  res.json({ leaderboard, workspace_id: workspaceId });
}));

// GET /api/metrics/workspace/coaching-queue (manager+)
router.get('/workspace/coaching-queue', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, users(id, name, email)').eq('workspace_id', workspaceId).eq('status', 'active');
  if (!members?.length) return res.json({ queue: [] });
  const memberIds = members.map(m => m.user_id);
  const [{ data: progressRows }, { data: recentSent }, { data: practiceRows }] = await Promise.all([
    supabaseAdmin.from('skill_progression').select('user_id, composite_score_avg, composite_delta, top_weakness').eq('workspace_id', workspaceId).in('user_id', memberIds).order('week_start', { ascending: false }),
    supabaseAdmin.from('opportunities').select('user_id').eq('workspace_id', workspaceId).in('user_id', memberIds).not('marked_sent_at', 'is', null).gte('marked_sent_at', sevenDaysAgo),
    supabaseAdmin.from('practice_sessions').select('user_id').in('user_id', memberIds).eq('completed', true).gte('created_at', sevenDaysAgo),
  ]);
  const latestProgress = (progressRows || []).reduce((acc, r) => { if (!acc[r.user_id]) acc[r.user_id] = r; return acc; }, {});
  const sentSet     = new Set((recentSent    || []).map(o => o.user_id));
  const practiceSet = new Set((practiceRows  || []).map(p => p.user_id));
  const queue = members.map(m => {
    const progress = latestProgress[m.user_id];
    const flags = [];
    if (!sentSet.has(m.user_id))                                              flags.push('no_outreach_7d');
    if (!practiceSet.has(m.user_id))                                          flags.push('no_practice_7d');
    if (progress?.composite_delta != null && progress.composite_delta < -0.5) flags.push('score_declining');
    if (progress?.composite_score_avg != null && progress.composite_score_avg < 5) flags.push('low_skill_score');
    return { user_id: m.user_id, name: m.users?.name || m.users?.email || 'Unknown', flags, skill_score: progress?.composite_score_avg || null, score_delta: progress?.composite_delta || null, top_weakness: progress?.top_weakness || null, needs_coaching: flags.length >= 2 };
  }).filter(m => m.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length);
  res.json({ queue, workspace_id: workspaceId });
}));

// GET /api/metrics/workspace/team-velocity (manager+)
router.get('/workspace/team-velocity', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const twoWeeksAgo  = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const { data: progressRows } = await supabaseAdmin.from('skill_progression')
    .select('user_id, week_start, composite_score_avg, messages_analyzed')
    .eq('workspace_id', workspaceId).gte('week_start', twoWeeksAgo).order('week_start', { ascending: false });
  if (!progressRows?.length) return res.json({ has_data: false });
  const weeks = [...new Set(progressRows.map(r => r.week_start))].sort().reverse();
  if (weeks.length < 2) return res.json({ has_data: false, message: 'Not enough weekly data.' });
  const current  = progressRows.filter(r => r.week_start === weeks[0]);
  const previous = progressRows.filter(r => r.week_start === weeks[1]);
  const avgComposite = (rows) => { const vals = rows.filter(r => r.composite_score_avg != null).map(r => r.composite_score_avg); return vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null; };
  const currentAvg  = avgComposite(current), previousAvg = avgComposite(previous);
  const delta = currentAvg != null && previousAvg != null ? parseFloat((currentAvg - previousAvg).toFixed(2)) : null;
  res.json({ has_data: true, current_week: weeks[0], previous_week: weeks[1], team_composite_current: currentAvg, team_composite_previous: previousAvg, team_composite_delta: delta, active_members_current: current.length, active_members_previous: previous.length, trend: delta != null ? (delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'stable') : 'no_data' });
}));

// GET /api/metrics/workspace/team-overview (manager+)
router.get('/workspace/team-overview', requirePermission('manager'), asyncHandler(async (req, res) => {
  const workspaceId  = req.workspace.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: members } = await supabaseAdmin.from('workspace_members')
    .select('user_id, users(id, name, email)').eq('workspace_id', workspaceId).eq('status', 'active');
  if (!members?.length) return res.json({ members: [], team_avg_score: null, workspace_id: workspaceId });

  const memberIds = members.map(m => m.user_id);
  const [{ data: progressRows }, { data: outreachRows }, { data: sessionRows }, { data: goalRows }] = await Promise.all([
    supabaseAdmin.from('skill_progression').select('user_id, composite_score_avg, top_weakness, week_start').eq('workspace_id', workspaceId).in('user_id', memberIds).order('week_start', { ascending: false }),
    supabaseAdmin.from('opportunities').select('user_id, marked_sent_at').eq('workspace_id', workspaceId).in('user_id', memberIds).not('marked_sent_at', 'is', null).gte('marked_sent_at', sevenDaysAgo),
    supabaseAdmin.from('practice_sessions').select('user_id, skill_scores, created_at').in('user_id', memberIds).eq('completed', true).gte('created_at', sevenDaysAgo),
    supabaseAdmin.from('user_goals').select('user_id, current_value, target_value, status').eq('workspace_id', workspaceId).in('user_id', memberIds).eq('status', 'active'),
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
    const progress = latestProgress[m.user_id];
    const sessions7d  = sessionCountMap[m.user_id] || 0;
    const avgScore    = progress?.composite_score_avg ?? null;
    const goalData    = goalCompletionMap[m.user_id];
    const goalPct     = goalData?.total ? Math.round((goalData.completed / goalData.total) * 100) : 0;
    if (sessions7d === 0) membersNotPracticed.push(m.user_id);
    if (avgScore != null) teamScores.push(avgScore);
    return { user_id: m.user_id, name: m.users?.name || m.users?.email || 'Unknown', sessions_this_week: sessions7d, avg_skill_score: avgScore, weakest_axis: progress?.top_weakness ?? null, last_active: (lastActiveMap[m.user_id] || '').split('T')[0] || null, outreach_sent_this_week: outreachCountMap[m.user_id] || 0, goal_completion_pct: goalPct };
  });

  const teamAvgScore    = teamScores.length ? parseFloat((teamScores.reduce((a, b) => a + b, 0) / teamScores.length).toFixed(2)) : null;
  const axisCounts      = {};
  for (const m of memberDetails) { if (m.weakest_axis) axisCounts[m.weakest_axis] = (axisCounts[m.weakest_axis] || 0) + 1; }
  const teamWeakestAxis = Object.entries(axisCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  res.json({ members: memberDetails, team_avg_score: teamAvgScore, team_weakest_axis: teamWeakestAxis, members_not_practiced_this_week: membersNotPracticed, workspace_id: workspaceId });
}));

// ── Pure helpers exported for testability ─────────────────────
export function calculateOutreachStreakFromOpps(sentOpps) {
  if (!sentOpps?.length) return 0;
  const byDate = {};
  for (const o of sentOpps) { const d = (o.marked_sent_at || o.created_at)?.split('T')[0]; if (d) byDate[d] = true; }
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
  const activity   = streakPts + volumePts;
  const conversion = Math.min(30, Math.round(positiveRate * 100));
  const pipeline   = pipelineMetrics?.call_demo_count > 0 ? 20 : pipelineMetrics?.replied_count > 0 ? 13 : pipelineMetrics?.contacted_count > 0 ? 6 : 0;
  const goalScore  = Math.min(15, Math.round(computeAvgGoalPct(goals) / 7));
  const practiceBonus = Math.min(5, practiceCount);
  return { score: Math.min(100, Math.round(activity + conversion + pipeline + goalScore + practiceBonus)), breakdown: { activity, conversion, pipeline, goals: goalScore, practice: practiceBonus } };
}

function generateMomentumInsight(score, trend, streak, profile) {
  if (score >= 70) return 'Your momentum is strong. Keep your outreach consistent.';
  if (score >= 40) return `Solid foundation. ${streak > 0 ? `Your ${streak}-day streak is working. ` : ''}Focus on following up with interested prospects.`;
  if (trend > 2)   return `Momentum is building — up ${trend} points this week. Keep going.`;
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
  return Object.values(byDate).sort((a, b) => a.date > b.date ? 1 : -1).slice(-30).map(d => ({ date: d.date, sent: d.opp_sent ?? d.messages_sent ?? 0, discovered: d.opp_discovered || 0, positive: d.positive_outcomes || 0, positive_rate: d.positive_rate ? Math.round(d.positive_rate * 100) : 0 }));
}

function generateRuleBasedInsights(profile, pipeline, goals) {
  const insights = [], rate = Math.min(1, Math.max(0, profile?.positive_rate || 0));
  if (rate > 0.25) insights.push({ type: 'pattern', icon: '📈', title: 'Strong reply rate', body: `Your ${Math.round(rate * 100)}% reply rate is above average.`, action: null });
  else if (rate > 0) insights.push({ type: 'pattern', icon: '📊', title: 'Reply rate opportunity', body: `At ${Math.round(rate * 100)}%, there's room to grow.`, action: 'Open Practice Mode and try a new opener' });
  if (pipeline?.replied_count > 0 && pipeline?.call_demo_count === 0) insights.push({ type: 'opportunity', icon: '💡', title: 'Move replies forward', body: `${pipeline.replied_count} interested contact${pipeline.replied_count > 1 ? 's' : ''} replied but no meetings yet.`, action: 'Follow up with interested contacts' });
  return insights.slice(0, 3);
}

export default router;
