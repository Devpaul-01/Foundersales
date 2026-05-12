// src/jobs/patternDetectionJob.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  MED-03: Added all imports that were previously inherited from the
//           scope of conversationAnalysisJob.js when the files were
//           bundled. As a standalone file, supabaseAdmin, logJob (as
//           logJob2), sleep, PRO_MODEL must all be explicitly imported.
//  Token tracking: recordTokenUsage uses workspaceId.

import supabaseAdmin from '../config/supabase.js';
import { scheduledQueue } from './queues.js';
import { callWithFallback } from '../services/multiProvider.js';
import { recordTokenUsage } from '../services/tokenTracker.js';
import { PRO_MODEL } from '../services/groq.js';
import { sleep, logJob } from '../utils/jobHelpers.js';

const MIN_ANALYSES_REQUIRED = 5;

const clampNum = (val, min, max) => {
  if (val == null) return min;
  return Math.min(max, Math.max(min, val));
};

export const runPatternDetectionJob = async () => {
  const startTime = Date.now();
  console.log(`[PatternDetection] Starting ${new Date().toISOString()}`);
  await logJob('pattern_detection', 'started');

  let processed = 0, patternsFound = 0;

  try {
    const { data: eligibleRows } = await supabaseAdmin
      .from('conversation_analyses')
      .select('user_id, workspace_id')
      .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString());

    if (!eligibleRows?.length) {
      await logJob('pattern_detection', 'completed', {
        processed: 0, patterns_found: 0, duration_ms: Date.now() - startTime,
      });
      await scheduledQueue.add('pattern_insights', {}, { attempts: 2, removeOnComplete: { count: 50 } });
      return;
    }

    const wsUserCounts = {};
    eligibleRows.forEach(r => {
      const key = `${r.user_id}:${r.workspace_id}`;
      wsUserCounts[key] = (wsUserCounts[key] || 0) + 1;
    });

    const eligible = Object.entries(wsUserCounts)
      .filter(([, count]) => count >= MIN_ANALYSES_REQUIRED)
      .map(([key]) => {
        const [userId, workspaceId] = key.split(':');
        return { userId, workspaceId };
      });

    console.log(`[PatternDetection] ${eligible.length} user-workspace pairs eligible`);

    for (const { userId, workspaceId } of eligible) {
      try {
        const count = await detectPatternsForUser(userId, workspaceId);
        patternsFound += count;
        processed++;
      } catch (err) {
        console.error(`[PatternDetection] Failed for user ${userId} workspace ${workspaceId}:`, err.message);
      }
      await sleep(2500);
    }

    await logJob('pattern_detection', 'completed', {
      processed, patterns_found: patternsFound, duration_ms: Date.now() - startTime,
    });
    console.log(`[PatternDetection] Done — ${patternsFound} patterns detected across ${processed} pairs`);
  } catch (err) {
    console.error('[PatternDetection] Fatal:', err.message);
    await logJob('pattern_detection', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }

  await scheduledQueue.add('pattern_insights', {}, { attempts: 2, removeOnComplete: { count: 50 } });
  console.log('[PatternDetection] pattern_insights enqueued');
};

const detectPatternsForUser = async (userId, workspaceId) => {
  const { data: analyses } = await supabaseAdmin
    .from('conversation_analyses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(40);

  if (!analyses?.length || analyses.length < MIN_ANALYSES_REQUIRED) return 0;

  const { data: wp } = await supabaseAdmin
    .from('workspace_profiles')
    .select('product_description, target_audience, archetype')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  const { data: userTierRow } = await supabaseAdmin
    .from('users')
    .select('tier')
    .eq('id', userId)
    .single();

  const user = { ...wp, tier: userTierRow?.tier || 'free' };
  if (!user.product_description) return 0;

  const { data: skillRows } = await supabaseAdmin
    .from('user_skill_profile')
    .select('clarity_avg, value_avg, discovery_avg, objection_avg, brevity_avg, cta_avg, weakest_axis')
    .eq('user_id', userId)
    .order('period_start', { ascending: false })
    .limit(2);

  const practiceSkills = skillRows?.[0] || null;
  const winning  = analyses.filter(a => a.outcome === 'positive');
  const losing   = analyses.filter(a => a.outcome === 'negative');

  const avg = (arr, field) => {
    const vals = arr.filter(a => a[field] != null).map(a => a[field]);
    return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2) : null;
  };

  const buildStats = (arr) => ({
    hook:            avg(arr, 'hook_score') ?? 'N/A',
    clarity:         avg(arr, 'clarity_score') ?? 'N/A',
    value_prop:      avg(arr, 'value_prop_score') ?? 'N/A',
    personalization: avg(arr, 'personalization_score') ?? 'N/A',
    cta:             avg(arr, 'cta_score') ?? 'N/A',
    tone:            avg(arr, 'tone_score') ?? 'N/A',
    word_count:      arr.length ? Math.round(arr.reduce((s, a) => s + (a.word_count || 0), 0) / arr.length) : 0,
    social_proof_pct: arr.length ? Math.round(arr.filter(a => a.has_social_proof).length / arr.length * 100) : 0,
    self_ref:        avg(arr, 'self_referential_ratio') ?? 'N/A',
  });

  const winStats  = buildStats(winning);
  const loseStats = buildStats(losing);

  const failureCategoryFreq = {};
  losing.forEach(a => {
    (a.failure_categories || []).forEach(cat => {
      failureCategoryFreq[cat] = (failureCategoryFreq[cat] || 0) + 1;
    });
  });
  const topFailureCategories = Object.entries(failureCategoryFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, count]) => `${cat} (${count}x)`);

  const practiceSection = practiceSkills
    ? `\nPRACTICE SESSION SKILL SCORES:\nClarity: ${practiceSkills.clarity_avg ?? 'N/A'}/100 | Weakest: ${practiceSkills.weakest_axis || 'N/A'}`
    : '';

  const prompt = `Analyze this seller's outreach history and identify 2–4 specific, evidence-based communication patterns.
SELLER:
Product: ${user.product_description || 'not specified'}
Target audience: ${user.target_audience || 'not specified'}
OUTCOME SUMMARY:
Total: ${analyses.length} | Winning: ${winning.length} | Losing: ${losing.length}
WINNING STATS: Hook ${winStats.hook}/10 | Personalization ${winStats.personalization}/10 | Word count: ${winStats.word_count}
LOSING STATS:  Hook ${loseStats.hook}/10 | Personalization ${loseStats.personalization}/10 | Word count: ${loseStats.word_count}
TOP FAILURES: ${topFailureCategories.join(', ') || 'none'}
${practiceSection}
Return ONLY a JSON array:
[{"pattern_type":"ghost_trigger|success_signal|weakness|objection_type","pattern_label":"8 words max","pattern_detail":"2-3 sentences with specific numbers","affected_outcome":"negative|positive|both","confidence_score":5-10,"recommendation":"one specific actionable fix"}]`;

  const { content, tokens_in, tokens_out } = await callWithFallback({
    systemPrompt: 'You are a communication pattern analyst. Return only valid JSON arrays.',
    messages:     [{ role: 'user', content: prompt }],
    temperature:  0.2,
    maxTokens:    1000,
    modelName:    PRO_MODEL,
  });

  // Token usage tracked at workspace level
  await recordTokenUsage(workspaceId, 'groq', tokens_in, tokens_out);

  let patterns;
  try {
    const clean = content.replace(/```json|```/g, '').trim();
    patterns = JSON.parse(clean);
    if (!Array.isArray(patterns)) throw new Error('Not an array');
  } catch {
    return 0;
  }

  if (!patterns.length) return 0;

  // Perplexity enrichment for pro users
  if (user.tier === 'pro' && patterns.length > 0 && losing.length >= 5) {
    await enrichWithMarketIntelligence(userId, workspaceId, user, patterns[0]).catch(err =>
      console.warn(`[PatternDetection] Market intel enrichment failed:`, err.message)
    );
  }

  let storedCount = 0;
  for (const pattern of patterns) {
    if (!pattern.pattern_label || !pattern.pattern_detail) continue;
    try {
      const { data: upserted } = await supabaseAdmin
        .from('communication_patterns')
        .upsert({
          workspace_id:       workspaceId,
          user_id:            userId,
          pattern_type:       pattern.pattern_type || 'weakness',
          pattern_label:      pattern.pattern_label,
          pattern_detail:     pattern.pattern_detail,
          affected_outcome:   pattern.affected_outcome || 'negative',
          confidence_score:   clampNum(pattern.confidence_score, 0, 10),
          evidence_count:     analyses.length,
          recommendation:     pattern.recommendation || null,
          is_active:          true,
          last_reinforced_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,user_id,pattern_label', ignoreDuplicates: false })
        .select('id')
        .single();

      await supabaseAdmin.from('growth_cards').insert({
        workspace_id: workspaceId,
        user_id:      userId,
        card_type:    'insight',
        title:        pattern.pattern_label,
        body:         `${pattern.pattern_detail}${pattern.recommendation ? `\n\n→ ${pattern.recommendation}` : ''}`,
        action_label: 'Work on this with Clutch',
        action_type:  'internal_chat',
        priority:     10,
        expires_at:   new Date(Date.now() + 7 * 86400000).toISOString(),
        generated_by: 'ai_pattern_detection',
        metadata: {
          pattern_type:   pattern.pattern_type,
          evidence_count: analyses.length,
          confidence:     pattern.confidence_score,
          pattern_id:     upserted?.id || null,
        },
      });
      storedCount++;
    } catch (err) {
      console.warn(`[PatternDetection] Failed to store pattern:`, err.message);
    }
  }

  console.log(`[PatternDetection] ✓ ${storedCount} patterns stored for user ${userId} workspace ${workspaceId}`);
  return storedCount;
};

const enrichWithMarketIntelligence = async (userId, workspaceId, user, topPattern) => {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recentIntel } = await supabaseAdmin
    .from('growth_cards')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('generated_by', 'ai_market_intel')
    .gte('created_at', weekAgo)
    .limit(1);

  if (recentIntel?.length) return;

  // FIX HIGH-10: Check workspace quota before making Exa/Perplexity call
  const { checkWorkspacePerplexityUsage, incrementWorkspaceUsage } = await import('../services/perplexity.js');
  
  const quotaCheck = await checkWorkspacePerplexityUsage(workspaceId, user.tier);
  if (!quotaCheck.allowed) {
    console.log(`[PatternDetection] Market intel skipped for workspace ${workspaceId}: quota exhausted`);
    return;
  }

  const { searchForChat } = await import('../services/perplexity.js');
  const searchQuery = `What are the most effective cold outreach strategies for ${user.target_audience || 'B2B founders'} in ${new Date().getFullYear()}? What messaging approaches get the highest reply rates? ${topPattern.pattern_label ? `How to avoid: ${topPattern.pattern_label}` : ''}`;

  const { content: marketIntel } = await searchForChat(
    searchQuery, 'Find specific, data-backed insights about effective cold outreach.'
  );

  if (!marketIntel?.trim()) return;

  // FIX HIGH-10: Increment workspace usage after successful search
  await incrementWorkspaceUsage(workspaceId);

  await supabaseAdmin.from('growth_cards').insert({
    workspace_id: workspaceId,
    user_id:      userId,
    card_type:    'resource',
    title:        `What's working in your market right now`,
    body:         `Based on your communication patterns, here's what top performers in your space are doing:\n\n${marketIntel.slice(0, 700)}`,
    action_label: 'Apply this to my messaging',
    action_type:  'internal_chat',
    priority:     8,
    expires_at:   new Date(Date.now() + 7 * 86400000).toISOString(),
    generated_by: 'ai_market_intel',
    metadata:     { source: 'perplexity', query: searchQuery.slice(0, 200), related_pattern: topPattern.pattern_label },
  });
};

export default { runPatternDetectionJob };
