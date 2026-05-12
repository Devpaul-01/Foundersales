// src/jobs/skillProgressionJob.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  HIGH-12: All practice axes now blended into composite score with
//           correct /10 normalization (0-100 → 0-10 scale).
//           discovery, objection_handling, brevity were previously
//           omitted — the composite score and top_weakness were
//           calculated without them.
//  WORKSPACE (read): user_skill_profile query now filtered by
//           workspace_id. Previously practice profile was fetched
//           with only user_id, meaning a user in two workspaces
//           could get the wrong workspace's skill data merged into
//           their skill_progression snapshot.

import supabaseAdmin from '../config/supabase.js';
import { sleep, logJob } from '../utils/jobHelpers.js';

export const runSkillProgressionJob = async () => {
  const startTime = Date.now();
  console.log(`[SkillProgressionJob] Starting ${new Date().toISOString()}`);
  await logJob('skill_progression', 'started');

  let processed = 0;
  const weekStart = getWeekStart();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [{ data: convUsers }, { data: practiceUsers }] = await Promise.all([
      supabaseAdmin.from('conversation_analyses').select('user_id, workspace_id').gte('created_at', sevenDaysAgo),
      supabaseAdmin.from('practice_sessions').select('user_id').eq('completed', true).gte('created_at', sevenDaysAgo),
    ]);

    const practiceUserIds = [...new Set((practiceUsers || []).map(u => u.user_id))];
    let practiceWsPairs   = [];
    if (practiceUserIds.length) {
      const { data: userRows } = await supabaseAdmin
        .from('users')
        .select('id, active_workspace_id')
        .in('id', practiceUserIds)
        .not('active_workspace_id', 'is', null);
      practiceWsPairs = (userRows || []).map(u => ({ user_id: u.id, workspace_id: u.active_workspace_id }));
    }

    const pairSet  = new Set();
    const allPairs = [];
    for (const r of [...(convUsers || []), ...practiceWsPairs]) {
      if (!r.workspace_id) continue;
      const key = `${r.user_id}:${r.workspace_id}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        allPairs.push({ userId: r.user_id, workspaceId: r.workspace_id });
      }
    }

    if (!allPairs.length) {
      await logJob('skill_progression', 'completed', { processed: 0, duration_ms: Date.now() - startTime });
      return;
    }

    for (const { userId, workspaceId } of allPairs) {
      try {
        await snapshotSkillsForUser(userId, workspaceId, weekStart, sevenDaysAgo);
        processed++;
      } catch (err) {
        console.error(`[SkillProgressionJob] Failed for ${userId}:`, err.message);
      }
      await sleep(500);
    }

    await logJob('skill_progression', 'completed', { processed, duration_ms: Date.now() - startTime });
    console.log(`[SkillProgressionJob] Done — ${processed} snapshots`);
  } catch (err) {
    console.error('[SkillProgressionJob] Fatal:', err.message);
    await logJob('skill_progression', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

const snapshotSkillsForUser = async (userId, workspaceId, weekStart, sevenDaysAgo) => {
  const { data: analyses } = await supabaseAdmin
    .from('conversation_analyses')
    .select('hook_score, clarity_score, value_prop_score, personalization_score, cta_score, tone_score, outcome, word_count')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo);

  // FIX: user_skill_profile query now includes workspace_id filter.
  // Previously this fetched any skill profile for the user regardless
  // of workspace, meaning workspace A's practice data could contaminate
  // workspace B's skill_progression snapshot.
  const { data: practiceProfile } = await supabaseAdmin
    .from('user_skill_profile')
    .select('clarity_avg, value_avg, discovery_avg, objection_avg, brevity_avg, cta_avg, overall_avg, weakest_axis, strongest_axis, sessions_count')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)          // FIX: scoped to workspace
    .gte('period_start', sevenDaysAgo)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  const convAnalysisCount = analyses?.length || 0;
  const avgFld = (field) => {
    if (!convAnalysisCount) return null;
    const vals = (analyses || []).filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : null;
  };

  const hookAvg            = avgFld('hook_score');
  const clarityConvAvg     = avgFld('clarity_score');
  const valuePropAvg       = avgFld('value_prop_score');
  const personalizationAvg = avgFld('personalization_score');
  const ctaConvAvg         = avgFld('cta_score');
  const toneAvg            = avgFld('tone_score');

  // FIX HIGH-12: Normalize ALL practice axes (0-100 → 0-10) and blend
  // them into the composite. Previously only clarity and cta were blended;
  // discovery, objection_handling, and brevity were never used.
  const blend = (a, b) => {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return parseFloat(((a + b) / 2).toFixed(2));
  };

  const clarityBlended   = blend(clarityConvAvg,  practiceProfile?.clarity_avg   != null ? practiceProfile.clarity_avg / 10   : null);
  const ctaBlended       = blend(ctaConvAvg,       practiceProfile?.cta_avg       != null ? practiceProfile.cta_avg / 10       : null);
  const valueBlended     = blend(valuePropAvg,     practiceProfile?.value_avg     != null ? practiceProfile.value_avg / 10     : null);
  const discoveryBlended = blend(null,             practiceProfile?.discovery_avg != null ? practiceProfile.discovery_avg / 10 : null);
  const objectionBlended = blend(null,             practiceProfile?.objection_avg != null ? practiceProfile.objection_avg / 10 : null);
  const brevityBlended   = blend(null,             practiceProfile?.brevity_avg   != null ? practiceProfile.brevity_avg / 10   : null);

  // FIX HIGH-12: All axes contribute to the composite score
  const allScores = [
    hookAvg,
    clarityBlended,
    valueBlended,
    discoveryBlended,
    objectionBlended,
    brevityBlended,
    personalizationAvg,
    ctaBlended,
    toneAvg,
  ].filter(v => v != null);

  const compositeAvg = allScores.length
    ? parseFloat((allScores.reduce((s, v) => s + v, 0) / allScores.length).toFixed(2))
    : null;

  const positiveCount = (analyses || []).filter(a => a.outcome === 'positive').length;
  const positiveRate  = convAnalysisCount > 0
    ? parseFloat((positiveCount / convAnalysisCount).toFixed(3))
    : null;

  // All dimensions used for strength/weakness detection
  const scoreDimensions = [
    { name: 'hook',               score: hookAvg },
    { name: 'clarity',            score: clarityBlended },
    { name: 'value_prop',         score: valueBlended },
    { name: 'discovery',          score: discoveryBlended },
    { name: 'objection_handling', score: objectionBlended },
    { name: 'brevity',            score: brevityBlended },
    { name: 'personalization',    score: personalizationAvg },
    { name: 'cta',                score: ctaBlended },
    { name: 'tone',               score: toneAvg },
  ].filter(d => d.score != null).sort((a, b) => a.score - b.score);

  const topWeakness = scoreDimensions[0]?.name                          || practiceProfile?.weakest_axis   || null;
  const topStrength = scoreDimensions[scoreDimensions.length - 1]?.name || practiceProfile?.strongest_axis || null;

  const hasAnyData = compositeAvg != null || (practiceProfile?.sessions_count || 0) > 0;
  if (!hasAnyData) {
    console.log(`[SkillProgressionJob] ⚠ Skipping all-null upsert for user ${userId}`);
    return;
  }

  const { data: prevWeek } = await supabaseAdmin
    .from('skill_progression')
    .select('composite_score_avg')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .lt('week_start', weekStart)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  const compositeDelta = compositeAvg != null && prevWeek?.composite_score_avg != null
    ? parseFloat((compositeAvg - prevWeek.composite_score_avg).toFixed(2))
    : null;

  await supabaseAdmin.from('skill_progression').upsert({
    workspace_id:              workspaceId,
    user_id:                   userId,
    week_start:                weekStart,
    hook_score_avg:            hookAvg,
    clarity_score_avg:         clarityBlended,
    value_prop_score_avg:      valueBlended,
    discovery_score_avg:       discoveryBlended,
    objection_score_avg:       objectionBlended,
    brevity_score_avg:         brevityBlended,
    personalization_score_avg: personalizationAvg,
    cta_score_avg:             ctaBlended,
    tone_score_avg:            toneAvg,
    composite_score_avg:       compositeAvg,
    positive_outcome_rate:     positiveRate,
    messages_analyzed:         convAnalysisCount,
    practice_sessions:         practiceProfile?.sessions_count || 0,
    top_weakness:              topWeakness,
    top_strength:              topStrength,
    composite_delta:           compositeDelta,
  }, { onConflict: 'workspace_id,user_id,week_start' });

  console.log(`[SkillProgressionJob] ✓ Snapshot for user ${userId} workspace ${workspaceId} | composite: ${compositeAvg ?? 'N/A'}/10 (${allScores.length} dimensions)`);
};

const getWeekStart = () => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
};

export default { runSkillProgressionJob };
