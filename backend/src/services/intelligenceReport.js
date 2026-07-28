// src/services/intelligenceReport.js
// ============================================================
// INTELLIGENCE REPORT — Phase 2 refactor (M11)
//
// Extracted from routes/insights.js's GET /intelligence, which
// previously did all data-gathering, derived-metric computation,
// prompt-building, and fallback logic inline inside one long route
// handler. Follows the same shape already used well elsewhere in this
// codebase (metrics.js's exported pure functions —
// calculateOutreachStreakFromOpps, computeMomentumScore, buildChartData)
// as the template: separate I/O from pure computation so each piece is
// independently testable.
//
// IMPL-M11-01 — TWO real bugs were found tracing through the original
// handler while doing this extraction, both now fixed:
//
//   1. `INTELLIGENCE_TTL_S` was referenced but never defined or imported
//      in insights.js. This threw a ReferenceError on the line that
//      caches a successful AI result — inside the handler's own
//      try/catch, so it was silently treated as an AI-call failure
//      every single time.
//   2. `generateRuleBasedInsights` — the catch block's fallback — was
//      called but NEVER DEFINED ANYWHERE in the codebase, and never
//      imported. This is a second ReferenceError, thrown INSIDE the
//      catch block itself, with no enclosing try/catch to absorb it —
//      it escaped as an unhandled rejection straight to Express's error
//      handler. Combined with bug #1, this endpoint's real, actual
//      behavior — as originally written — was to return an uncaught
//      500 error on every single request, regardless of whether the AI
//      call succeeded or failed. It is unlikely this endpoint has ever
//      returned a successful response.
//
// generateRuleBasedInsights below is therefore a NEW implementation,
// not a relocation of pre-existing logic (there was nothing to
// relocate) — a small set of deterministic, non-AI insight rules over
// the same gathered context, used only when the AI call itself fails
// (a real, working fallback, replacing the broken reference).
// ============================================================

import supabaseAdmin from '../config/supabase.js';

// ──────────────────────────────────────────────────────────────
// 1. DATA GATHERING — I/O only, no derived computation, no prompt text.
// ──────────────────────────────────────────────────────────────
export const gatherIntelligenceContext = async (userId, workspaceId) => {
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

  return {
    profile, pipeline, goals: goals || [], checkIns: checkIns || [],
    signals: signals || [], patterns: patterns || [], objections: objections || [],
    commitments: commitments || [], practice: practice || [], skillTrends: skillTrends || [],
    recentOpps: recentOpps || [], unreadTips: unreadTips || [],
  };
};

// ──────────────────────────────────────────────────────────────
// 2. DERIVED METRICS — pure function, no I/O. Directly unit-testable by
// passing in a plain object matching gatherIntelligenceContext's shape.
// This is exactly the shape of function where this file's earlier,
// already-fixed `.data`-access bug lived (see git history / preserved
// comments below) — kept small and pure specifically so that class of
// bug is cheap to catch with a test going forward.
// ──────────────────────────────────────────────────────────────
export const deriveIntelligenceMetrics = (context) => {
  const { profile, checkIns, recentOpps, skillTrends, practice } = context;

  const positiveRatePct   = Math.round((profile?.positive_rate || 0) * 100);
  const recentCheckInMood = checkIns?.length
    ? Math.round(checkIns.reduce((s, c) => s + (c.mood_score || 5), 0) / checkIns.length)
    : null;

  const stalledDeals = (recentOpps || []).filter(o =>
    o.marked_sent_at && !o.feedback_prompted_at &&
    new Date(o.marked_sent_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  const skillTrend  = skillTrends?.[0] || null;
  const isImproving = skillTrend?.composite_delta > 0;

  const weakSkills = (practice || [])
    .filter(p => p.skill_scores)
    .flatMap(p => Object.entries(p.skill_scores || {})
      .filter(([, score]) => score < 60)
      .map(([skill]) => skill)
    );
  const topWeakness = [...new Set(weakSkills)].slice(0, 3);

  return { positiveRatePct, recentCheckInMood, stalledDeals, skillTrend, isImproving, topWeakness };
};

// ──────────────────────────────────────────────────────────────
// 3. PROMPT BUILDING — pure function, extracted essentially as-is from
// the original inline array-join, just given a name and signature.
// ──────────────────────────────────────────────────────────────
export const buildIntelligencePrompt = (userCtx, context, metrics) => {
  const { profile, pipeline, goals, signals, patterns, objections, commitments, practice, unreadTips, recentOpps } = context;
  const { positiveRatePct, recentCheckInMood, stalledDeals, skillTrend, isImproving, topWeakness } = metrics;

  return [
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
    '[{"type":"pattern|opportunity|warning|coaching","icon":"emoji","title":"short, punchy title","body":"2-3 sentences with specific data","action":"one specific action or null"}]',
  ].filter(Boolean).join('\n');
};

// ──────────────────────────────────────────────────────────────
// 4. RULE-BASED FALLBACK — NEW implementation (see file header: the
// original reference to this function name had nothing behind it
// anywhere in the codebase). Used only when the AI call itself fails.
// Deterministic, no I/O, no external calls — a handful of simple rules
// over the same gathered context/metrics, guaranteed to always return
// at least one insight so the response shape is never an empty array.
// ──────────────────────────────────────────────────────────────
export const generateRuleBasedInsights = (context, metrics) => {
  const { pipeline, profile, objections, patterns } = context;
  const { positiveRatePct, stalledDeals } = metrics;
  const insights = [];

  if (stalledDeals.length > 0) {
    insights.push({
      type: 'warning',
      icon: '⏳',
      title: `${stalledDeals.length} stalled deal${stalledDeals.length > 1 ? 's' : ''} need attention`,
      body: `You have ${stalledDeals.length} opportunit${stalledDeals.length > 1 ? 'ies' : 'y'} marked sent over a week ago with no feedback logged yet. Following up now keeps them from going cold.`,
      action: 'Review your stalled opportunities and log feedback.',
    });
  }

  if (objections?.length) {
    const top = objections[0];
    insights.push({
      type: 'coaching',
      icon: '🎯',
      title: `"${top.objection_type}" is your most common objection`,
      body: `You've logged this objection ${top.occurrence_count} time${top.occurrence_count > 1 ? 's' : ''}.${top.best_response ? ` Your best recorded response: ${top.best_response}` : ' Consider drafting a go-to response for it.'}`,
      action: top.best_response ? 'Reuse your best response next time this comes up.' : 'Practice handling this objection.',
    });
  }

  if (patterns?.length) {
    const top = patterns[0];
    insights.push({
      type: 'pattern',
      icon: top.affected_outcome === 'positive' ? '✅' : '⚠️',
      title: top.pattern_label,
      body: `This pattern has been detected with ${Math.round((top.confidence_score || 0) * 100)}% confidence and is associated with ${top.affected_outcome} outcomes.`,
      action: null,
    });
  }

  if (pipeline?.win_rate_pct != null && pipeline.win_rate_pct < 20 && (pipeline.contacted_count || 0) >= 5) {
    insights.push({
      type: 'warning',
      icon: '📉',
      title: 'Win rate is below 20%',
      body: `Out of ${pipeline.contacted_count} contacted, your win rate is ${pipeline.win_rate_pct}%. Worth reviewing what's happening at the objection or follow-up stage.`,
      action: 'Review recent lost deals for a common thread.',
    });
  }

  if (profile?.total_sent >= 5 && positiveRatePct != null) {
    insights.push({
      type: 'opportunity',
      icon: '📊',
      title: `${positiveRatePct}% positive reply rate`,
      body: profile?.best_platform
        ? `Your best-performing platform so far is ${profile.best_platform}${profile.best_message_style ? `, with a ${profile.best_message_style} message style` : ''}.`
        : `Across ${profile.total_sent} messages sent, ${profile.total_positive || 0} got a positive reply.`,
      action: profile?.best_platform ? `Lean into ${profile.best_platform} for your next batch.` : null,
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'coaching',
      icon: '👋',
      title: 'Keep building your data',
      body: "You don't have enough activity yet for a detailed breakdown — send a few more messages, log some feedback, or complete a practice session, and check back here soon.",
      action: null,
    });
  }

  return insights.slice(0, 5);
};

export default {
  gatherIntelligenceContext, deriveIntelligenceMetrics,
  buildIntelligencePrompt, generateRuleBasedInsights,
};
