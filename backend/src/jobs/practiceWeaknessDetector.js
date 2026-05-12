// src/jobs/practiceWeaknessDetector.js
// ============================================================
// PRACTICE WEAKNESS DETECTOR — WORKSPACE REFACTOR
//
// CHANGES:
//  - growth_cards insert now includes workspace_id
//  - communication_patterns upsert now includes workspace_id
//    (unique constraint changed to workspace_id,user_id,pattern_label)
//  - User context fetched from workspace_profiles
//  - conversation_analyses query workspace-scoped
//  - Resolves workspaceId via users.active_workspace_id
//
// PRESERVED:
//  - All detection logic (5+ sessions threshold)
//  - 14-day cooldown on card regeneration
//  - Groq card content generation
//  - Push notification
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { notifyUser } from '../services/notifications.js';
import { createLogger } from '../utils/logger.js';

const AXIS_LABEL = {
  clarity:            'Clarity',
  value_delivery:     'Value Delivery',
  discovery:          'Discovery Questions',
  objection_handling: 'Objection Handling',
  brevity:            'Brevity',
  cta:                'CTA',
};
const LOW_SCORE_THRESHOLD = 55;
const SESSIONS_REQUIRED   = 5;
const CARD_COOLDOWN_DAYS  = 14;

const { log } = createLogger('WeaknessDetector');

export const checkAndGenerateWeaknessCard = async ({ user_id, session_id, skillScores }) => {
  if (!skillScores?.axes) return;

  // Resolve workspace for this user
  const { data: userRow } = await supabaseAdmin
    .from('users').select('active_workspace_id').eq('id', user_id).single();
  const workspaceId = userRow?.active_workspace_id;
  if (!workspaceId) return;

  // 1. Load last 10 completed sessions (user-scoped — practice is personal)
  const { data: recentSessions } = await supabaseAdmin
    .from('practice_sessions')
    .select('id, scenario_type, skill_scores, created_at')
    .eq('user_id', user_id).eq('completed', true)
    .not('skill_scores', 'is', null)
    .order('created_at', { ascending: false }).limit(10);

  if (!recentSessions || recentSessions.length < SESSIONS_REQUIRED) return;

  // 2. Compute per-axis averages
  const axisAccum = {};
  let sessionsCounted = 0;
  for (const s of recentSessions) {
    const axes = s.skill_scores?.axes;
    if (!axes || typeof axes !== 'object') continue;
    sessionsCounted++;
    for (const [axis, score] of Object.entries(axes)) {
      if (typeof score !== 'number') continue;
      if (!axisAccum[axis]) axisAccum[axis] = [];
      axisAccum[axis].push(score);
    }
  }
  if (sessionsCounted < SESSIONS_REQUIRED) return;

  const axisAvgs = Object.entries(axisAccum)
    .filter(([, scores]) => scores.length >= SESSIONS_REQUIRED)
    .map(([axis, scores]) => ({
      axis,
      avg:      parseFloat((scores.reduce((s,v) => s+v, 0) / scores.length).toFixed(1)),
      sessions: scores.length,
    }))
    .sort((a, b) => a.avg - b.avg);

  const persistentWeakness = axisAvgs.find(a => a.avg < LOW_SCORE_THRESHOLD);
  if (!persistentWeakness) return;

  // 3. Cooldown check — workspace-scoped
  const cooldownSince = new Date(Date.now() - CARD_COOLDOWN_DAYS * 86400000).toISOString();
  const { data: recentCard } = await supabaseAdmin
    .from('growth_cards').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', user_id)
    .eq('generated_by', 'practice_weakness_detector')
    .ilike('title', `%${persistentWeakness.axis}%`)
    .gte('created_at', cooldownSince).limit(1).maybeSingle();
  if (recentCard) {
    log('Weakness Card Skipped — Cooldown Active', { userId: user_id, axis: persistentWeakness.axis });
    return;
  }

  log('Persistent Weakness Detected', { userId: user_id, workspaceId, axis: persistentWeakness.axis, avg: persistentWeakness.avg });

  // 4. Load context from workspace_profiles
  const { data: wp } = await supabaseAdmin.from('workspace_profiles')
    .select('product_description, target_audience, archetype').eq('workspace_id', workspaceId).eq('user_id', user_id).single();

  // 5. Load workspace-scoped conversation analyses for cross-reference
  const { data: realWorldAnalyses } = await supabaseAdmin
    .from('conversation_analyses').select('composite_score, failure_categories, outcome, created_at')
    .eq('workspace_id', workspaceId).eq('user_id', user_id)
    .order('created_at', { ascending: false }).limit(10);

  const negativeRealWorld = (realWorldAnalyses || []).filter(a => a.outcome === 'negative').length;
  const totalRealWorld    = (realWorldAnalyses || []).length;
  const realWorldContext  = totalRealWorld > 0
    ? `They also have ${negativeRealWorld}/${totalRealWorld} negative real-world outreach outcomes in recent conversations.` : '';

  // 6. Generate card content with Groq
  const axisLabel = AXIS_LABEL[persistentWeakness.axis] || persistentWeakness.axis;
  const prompt = `A seller practicing outreach has a persistent weakness in "${axisLabel}".
Practice data (last ${persistentWeakness.sessions} sessions):
- Average ${axisLabel} score: ${persistentWeakness.avg}/100
- All recent axis averages: ${axisAvgs.map(a => `${AXIS_LABEL[a.axis] || a.axis}: ${a.avg}`).join(', ')}
${realWorldContext}
Seller context:
- Product: ${wp?.product_description?.slice(0, 120) || 'not specified'}
- Target: ${wp?.target_audience?.slice(0, 80) || 'not specified'}
Write a Growth Card that:
1. Names the specific weakness in plain language
2. Explains WHY this axis kills deals (be specific, not generic)
3. Gives ONE concrete drill for the next practice session
4. States the expected impact if they fix it
Return ONLY JSON:
{"title":"...","body":"2-3 sentences","action_label":"Practice This Now","action_scenario":"${persistentWeakness.axis === 'objection_handling' ? 'price_objection' : persistentWeakness.axis === 'discovery' ? 'not_right_time' : 'skeptical'}","tip":"one-sentence drill","evidence":"one specific data point"}`;

  let cardContent = null;
  try {
    const { callWithFallback } = await import('../services/multiProvider.js');
    const { content } = await callWithFallback({
      systemPrompt: 'You write focused, evidence-based coaching cards. Return only valid JSON.',
      messages:     [{ role: 'user', content: prompt }],
      temperature:  0.3, maxTokens: 400,
    });
    cardContent = JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch {
    cardContent = {
      title:           `Your ${axisLabel} score is your biggest gap (${persistentWeakness.avg}/100)`,
      body:            `Across your last ${persistentWeakness.sessions} practice sessions, ${axisLabel} is consistently below ${LOW_SCORE_THRESHOLD}/100. This directly affects how prospects perceive your outreach.`,
      action_label:    'Practice This Now',
      action_scenario: null,
      tip:             `In your next session, focus exclusively on ${axisLabel} — let everything else be imperfect.`,
      evidence:        `${persistentWeakness.sessions} sessions at ${persistentWeakness.avg}/100 average`,
    };
  }

  // 7. Insert growth card — WORKSPACE SCOPED
  const { error: insertErr } = await supabaseAdmin.from('growth_cards').insert({
    workspace_id:  workspaceId,    // WORKSPACE SCOPING
    user_id:       user_id,
    card_type:     'practice_weakness',
    generated_by:  'practice_weakness_detector',
    title:         cardContent.title,
    body:          cardContent.body,
    priority:      9,
    expires_at:    new Date(Date.now() + 30 * 86400000).toISOString(),
    metadata: {
      axis:              persistentWeakness.axis,
      avg_score:         persistentWeakness.avg,
      sessions_count:    persistentWeakness.sessions,
      action_label:      cardContent.action_label,
      action_scenario:   cardContent.action_scenario,
      evidence:          cardContent.evidence,
      triggered_by_session: session_id,
    },
  });

  if (insertErr) {
    log('Weakness Card Insert Failed', { userId: user_id, axis: persistentWeakness.axis, error: insertErr.message });
    return;
  }

  // 8. Upsert communication_patterns — WORKSPACE SCOPED
  await supabaseAdmin.from('communication_patterns').upsert({
    workspace_id:       workspaceId,    // WORKSPACE SCOPING
    user_id:            user_id,
    pattern_type:       'weakness',
    pattern_label:      `Low ${axisLabel} in practice (${persistentWeakness.avg}/100 avg)`,
    pattern_detail:     `Across ${persistentWeakness.sessions} practice sessions, ${axisLabel} is consistently below ${LOW_SCORE_THRESHOLD}/100. This is your most actionable practice gap.`,
    confidence_score:   Math.min(10, parseFloat((persistentWeakness.sessions / 10 * 10).toFixed(1))),
    evidence_count:     persistentWeakness.sessions,
    affected_outcome:   'negative',
    recommendation:     cardContent.tip,
    is_active:          true,
    last_reinforced_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,user_id,pattern_label' }).catch(() => {});

  // 9. Push notification
  await notifyUser(user_id, {
    title: `Practice insight: your ${axisLabel} gap 📊`,
    body:  `Scoring ${persistentWeakness.avg}/100 across ${persistentWeakness.sessions} sessions — here's one drill to fix it.`,
    data:  { type: 'practice_weakness_card', axis: persistentWeakness.axis },
  }).catch(() => {});

  log('Weakness Growth Card Created', { userId: user_id, workspaceId, axis: persistentWeakness.axis, avg: persistentWeakness.avg });
};




