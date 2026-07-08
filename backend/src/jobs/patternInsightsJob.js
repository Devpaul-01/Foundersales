// src/jobs/patternInsightsJob.js
// ============================================================
// WEEKLY PATTERN INSIGHTS JOB — WORKSPACE REFACTOR
//
// CHANGES:
//  - processUserInsights now receives and uses workspaceId
//  - user_events, conversation_signals, conversation_commitments,
//    opportunities queries now scoped to workspace_id
//  - prospect_insights inserts include workspace_id
//  - User profile context fetched from workspace_profiles
//  - refreshStaleProspectSummaries: workspace-scoped queries
//  - markOverdueCommitments: no workspace filter (global update is fine)
//
// PRESERVED:
//  - All topic detection logic
//  - Prospect summary refresh
//  - Overdue commitment marking
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { generateWeeklyPatternInsights, generateProspectSummary } from '../services/groqCalendarIntelligence.js';
import { notifyUser } from '../services/notifications.js';
import { sleep, logJob } from '../utils/jobHelpers.js';

const BATCH_DELAY_MS = 2000;

export const runPatternInsightsJob = async () => {
  const startTime = Date.now();
  console.log(`[PatternInsightsJob] Starting ${new Date().toISOString()}`);
  await logJob('pattern_insights', 'started');

  let processed = 0;

  try {
    // Find (user_id, workspace_id) pairs with recent debriefs
    const { data: events } = await supabaseAdmin
      .from('user_events')
      .select('user_id, workspace_id')
      .not('debrief_completed_at', 'is', null)
      .gte('debrief_completed_at', new Date(Date.now() - 30 * 86400000).toISOString());

    // Deduplicate pairs
    const pairSet = new Set();
    const pairs = [];
    for (const e of (events || [])) {
      if (!e.workspace_id) continue;
      const key = `${e.user_id}:${e.workspace_id}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        pairs.push({ userId: e.user_id, workspaceId: e.workspace_id });
      }
    }

    console.log(`[PatternInsightsJob] Processing ${pairs.length} user-workspace pairs`);

    for (let i = 0; i < pairs.length; i++) {
      const { userId, workspaceId } = pairs[i];
      try {
        await processUserInsights(userId, workspaceId);
        processed++;
      } catch (err) {
        console.error(`[PatternInsightsJob] Failed for user ${userId} workspace ${workspaceId}:`, err.message);
      }
      if (i < pairs.length - 1) await sleep(BATCH_DELAY_MS);
    }

    await refreshStaleProspectSummaries();
    await markOverdueCommitments();

    await logJob('pattern_insights', 'completed', { processed, duration_ms: Date.now() - startTime });
    console.log(`[PatternInsightsJob] Done — ${processed} pairs processed`);
  } catch (err) {
    console.error('[PatternInsightsJob] Fatal:', err.message);
    await logJob('pattern_insights', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

const processUserInsights = async (userId, workspaceId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: recentDebriefs } = await supabaseAdmin
    .from('user_events')
    .select('outcome, energy_score, meeting_notes, debrief_content, event_type, attendee_name, event_date')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .not('debrief_completed_at', 'is', null)
    .gte('debrief_completed_at', thirtyDaysAgo)
    .order('event_date', { ascending: false })
    .limit(20);

  if (!recentDebriefs?.length) return;

  const { data: recentSignals } = await supabaseAdmin
    .from('conversation_signals')
    .select('signal_type, signal_text')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('detected_at', thirtyDaysAgo);

  const signalFrequency = {};
  (recentSignals || []).forEach(s => {
    signalFrequency[s.signal_type] = (signalFrequency[s.signal_type] || 0) + 1;
  });

  const { data: commitments } = await supabaseAdmin
    .from('conversation_commitments')
    .select('status, owner')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('owner', 'founder')
    .gte('created_at', thirtyDaysAgo);

  const commitmentStats = {
    total:     (commitments || []).length,
    completed: (commitments || []).filter(c => c.status === 'done').length,
    overdue:   (commitments || []).filter(c => c.status === 'overdue').length,
  };

  // FIX HIGH-09: Get stage changes with from_stage, to_stage, and count
  const { data: stageChanges } = await supabaseAdmin
    .from('opportunities')
    .select('stage, last_stage_changed_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('last_stage_changed_at', thirtyDaysAgo);

  // Aggregate stage changes into from_stage → to_stage transitions
  const stageProgressionMap = new Map();
  // Sort by time to get sequential changes per opportunity
  const sortedStages = (stageChanges || []).sort((a, b) => 
    new Date(a.last_stage_changed_at) - new Date(b.last_stage_changed_at)
  );
  
  for (let i = 1; i < sortedStages.length; i++) {
    const fromStage = sortedStages[i-1].stage;
    const toStage = sortedStages[i].stage;
    if (fromStage && toStage && fromStage !== toStage) {
      const key = `${fromStage}|${toStage}`;
      stageProgressionMap.set(key, (stageProgressionMap.get(key) || 0) + 1);
    }
  }
  
  const stageProgressions = Array.from(stageProgressionMap.entries()).map(([key, count]) => {
    const [from_stage, to_stage] = key.split('|');
    return { from_stage, to_stage, count };
  });

  const allNotes = (recentDebriefs || [])
    .map(d => d.meeting_notes || d.debrief_content?.raw_notes || '')
    .join(' ');
  const repeatQuestions = detectRepeatTopics(allNotes);

  const { data: wp } = await supabaseAdmin
    .from('workspace_profiles')
    .select('product_description, target_audience, voice_profile, business_name')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (!wp) return;

  const user = { ...wp };
  const analysisData = {
    recentDebriefs:    recentDebriefs || [],
    signalFrequency,
    commitmentStats,
    stageProgressions,  // Now has { from_stage, to_stage, count } shape
    repeatQuestions,
  };

  const insights = await generateWeeklyPatternInsights(user, analysisData);
  if (!insights?.length) return;

  await supabaseAdmin
    .from('prospect_insights')
    .update({ is_dismissed: true })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_dismissed', false)
    .lt('created_at', thirtyDaysAgo);

  const rows = insights.map(i => ({
    workspace_id:     workspaceId,
    user_id:          userId,
    insight_type:     i.type,
    title:            i.title,
    body:             i.body,
    suggested_action: i.suggested_action || null,
    affected_count:   i.affected_count   || 1,
    expires_at:       new Date(Date.now() + 14 * 86400000).toISOString(),
  }));
  const { error: insightsInsertError } = await supabaseAdmin.from('prospect_insights').insert(rows);
  if (insightsInsertError) {
    console.error(`[PatternInsightsJob] prospect_insights insert failed for user ${userId} workspace ${workspaceId}:`, insightsInsertError.message);
    return;
  }

  const highValueInsights = insights.filter(i => i.type === 'stall' || i.type === 'question_cluster');
  if (highValueInsights.length) {
    const { data: userData } = await supabaseAdmin.from('users').select('fcm_token').eq('id', userId).single();
    if (userData?.fcm_token) {
      await notifyUser(userId, {
        title: '📊 Your weekly sales insights are ready',
        body:  `${insights.length} new pattern${insights.length > 1 ? 's' : ''} found in your recent conversations.`,
        data:  { type: 'weekly_insights', workspace_id: workspaceId },
      }).catch(() => {});
    }
  }

  console.log(`[PatternInsightsJob] Generated ${insights.length} insights for user ${userId} workspace ${workspaceId}`);
};

const refreshStaleProspectSummaries = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: prospects } = await supabaseAdmin
    .from('prospects')
    .select('id, user_id, workspace_id, name, company, relationship_health_score')
    .gte('last_contact_at', sevenDaysAgo)
    .or(`ai_summary_updated_at.is.null,ai_summary_updated_at.lt.${sevenDaysAgo}`)
    .limit(20);

  if (!prospects?.length) return;

  for (const prospect of prospects) {
    try {
      const [eventsRes, signalsRes] = await Promise.all([
        supabaseAdmin.from('user_events').select('title, event_type, outcome, event_date, debrief_content')
          .eq('prospect_id', prospect.id).eq('workspace_id', prospect.workspace_id).eq('user_id', prospect.user_id)
          .order('event_date', { ascending: false }).limit(5),
        supabaseAdmin.from('conversation_signals').select('signal_type, signal_text, detected_at')
          .eq('prospect_id', prospect.id).eq('workspace_id', prospect.workspace_id).eq('user_id', prospect.user_id)
          .eq('is_active', true).limit(5),
      ]);

      const timeline = [
        ...(eventsRes.data || []).map(e => ({ type: 'event', date: e.event_date, title: e.title, outcome: e.outcome })),
        ...(signalsRes.data || []).map(s => ({ type: 'signal', date: s.detected_at, signal_type: s.signal_type, signal_text: s.signal_text })),
      ].sort((a, b) => new Date(b.date) - new Date(a.date));

      if (!timeline.length) continue;

      // Fetch workspace profile for context
      const { data: wp } = await supabaseAdmin.from('workspace_profiles')
        .select('product_description, voice_profile, target_audience')
        .eq('workspace_id', prospect.workspace_id).eq('user_id', prospect.user_id).single();

      const summary = await generateProspectSummary(wp || {}, prospect, timeline);
      await supabaseAdmin.from('prospects')
        .update({ ai_summary: summary, ai_summary_updated_at: new Date().toISOString() })
        .eq('id', prospect.id);

      await sleep(1000);
    } catch (err) {
      console.warn(`[PatternInsightsJob] Summary refresh failed for prospect ${prospect.id}:`, err.message);
    }
  }
};

const markOverdueCommitments = async () => {
  const today = new Date().toISOString().split('T')[0];
  await supabaseAdmin.from('conversation_commitments')
    .update({ status: 'overdue' })
    .eq('status', 'pending')
    .not('due_date', 'is', null)
    .lt('due_date', today);
};

const detectRepeatTopics = (notesText) => {
  if (!notesText) return [];
  const topicPatterns = [
    { topic: 'pricing / cost',        pattern: /\b(price|pricing|cost|budget|expensive|afford|how much)\b/gi },
    { topic: 'integration',           pattern: /\b(integrat|connect|api|sync|plugin|compatibility)\b/gi },
    { topic: 'timeline',              pattern: /\b(when|timeline|deadline|launch|go.?live|start date)\b/gi },
    { topic: 'competitor',            pattern: /\b(competitor|alternative|vs\.|instead|already using|switched from)\b/gi },
    { topic: 'ROI / results',         pattern: /\b(roi|return|results|outcome|impact|prove it|case study)\b/gi },
    { topic: 'security / trust',      pattern: /\b(security|compliance|gdpr|hipaa|trust|privacy|data)\b/gi },
    { topic: 'decision maker',        pattern: /\b(decision|approval|ceo|cto|board|stakeholder|my boss|my team)\b/gi },
    { topic: 'support / onboarding',  pattern: /\b(support|onboard|training|help|documentation|setup)\b/gi },
  ];
  return topicPatterns.map(({ topic, pattern }) => ({ topic, count: (notesText.match(pattern) || []).length }))
    .filter(t => t.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5);
};

export default { runPatternInsightsJob };

