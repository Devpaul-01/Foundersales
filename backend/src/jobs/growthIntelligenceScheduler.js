// src/jobs/growthIntelligenceScheduler.js — WORKSPACE REFACTOR
//
// FIXES APPLIED:
//  CRIT-04 (same root cause): workspace_profiles!inner join returns an ARRAY.
//           getUsersWithWorkspaceContext now finds the profile matching
//           active_workspace_id before filtering. buildCtx spreads the single
//           matched profile object, not the array.
//  HIGH-06: daily_check_ins insert includes workspace_id. Existence check
//           also filters by workspace_id so each workspace gets its own
//           check-in per day.
//  HIGH-07: user_skill_profile insert includes workspace_id (via
//           runSkillProfileAggregationJob).
//  HIGH-08: practice_curriculum upsert includes workspace_id with
//           onConflict: 'user_id,workspace_id'.
//  WORKSPACE WEEKLY PLAN: generateWeeklyPlanForUser now fetches
//           user_performance_profiles filtered by workspace_id.
//           Previously the query had no workspace_id filter, meaning
//           the metrics passed to generateWeeklyPlan could belong to
//           a different workspace.
//  Token tracking: recordTokenUsage uses workspaceId throughout.
//
// IMPL-ARCHETYPE-01 (Phase 2 refactor): detectAndSaveArchetype previously
// wrote the detected archetype to BOTH workspace_profiles (workspace-scoped,
// correct) AND users (global, unscoped) in the same call. The global write
// was the actual source of cross-workspace data pollution — see that
// function's own comment below for the full explanation. It has been
// removed; workspace_profiles is now the sole persistence point.

import supabaseAdmin from '../config/supabase.js';
import groqService from '../services/groq.js';
import { notifyUser } from '../services/notifications.js';
import { sleep } from '../utils/jobHelpers.js';

const chunk = (arr, size) => Array.from(
  { length: Math.ceil(arr.length / size) },
  (_, i) => arr.slice(i * size, i * size + size)
);

// ── Helper: fetch users with their workspace context ──────────
const getUsersWithWorkspaceContext = async () => {
  const { data: users } = await supabaseAdmin
    .from('users')
    .select(`
      id, fcm_token, tier, active_workspace_id,
      notification_preferences, memory_enabled,
      workspace_profiles(
        workspace_id, product_description, target_audience, voice_profile,
        business_name, archetype, industry, role, preferred_platforms,
        onboarding_completed, primary_goal
      )
    `)
    .eq('is_deleted', false)
    .not('active_workspace_id', 'is', null);

  return (users || [])
    .map(u => {
      const profiles = Array.isArray(u.workspace_profiles) ? u.workspace_profiles : [u.workspace_profiles];
      const wp = profiles.find(p => p?.workspace_id === u.active_workspace_id);
      if (!wp?.onboarding_completed || !wp?.product_description) return null;
      return { ...u, _wp: wp };
    })
    .filter(Boolean);
};

const buildCtx = (user) => ({
  ...user,
  ...(user._wp || {}),
  workspace_id: user.active_workspace_id,
});

// ─────────────────────────────────────────────────────────────
// DAILY TIP GENERATION (7am)
// ─────────────────────────────────────────────────────────────
export const runDailyTipGeneration = async () => {
  console.log('[GrowthScheduler] Daily tip generation starting...');
  const cutoff   = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const users    = await getUsersWithWorkspaceContext();
  const needsTip = users.filter(u => !u.last_tip_generated_at || u.last_tip_generated_at < cutoff);

  if (!needsTip.length) { console.log('[GrowthScheduler] No users need tip generation'); return; }
  console.log(`[GrowthScheduler] Generating tips for ${needsTip.length} users`);

  for (const batch of chunk(needsTip, 5)) {
    await Promise.allSettled(batch.map(user => generateAndStoreTip(user)));
    await sleep(2000);
  }
  console.log(`[GrowthScheduler] Daily tips generated for ${needsTip.length} users`);
};

const generateAndStoreTip = async (user) => {
  try {
    const userId      = user.id;
    const workspaceId = user.active_workspace_id;
    const userCtx     = buildCtx(user);

    const { data: goals } = await supabaseAdmin
      .from('user_goals')
      .select('goal_text, target_value, target_unit, current_value')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(2);

    const { data: recentCheckIns } = await supabaseAdmin
      .from('daily_check_ins')
      .select('answers, mood_score, ai_response')
      .eq('user_id', userId)
      .not('answers', 'eq', '{}')
      .order('date', { ascending: false })
      .limit(2);

    const [sentResult, practiceResult, analysisResult] = await Promise.allSettled([
      supabaseAdmin.from('opportunities').select('platform, target_context, marked_sent_at').eq('workspace_id', workspaceId).eq('user_id', userId).not('marked_sent_at', 'is', null).order('marked_sent_at', { ascending: false }).limit(3),
      supabaseAdmin.from('practice_sessions').select('scenario_type, skill_scores, session_debrief, created_at').eq('user_id', userId).eq('completed', true).order('created_at', { ascending: false }).limit(3),
      supabaseAdmin.from('conversation_analyses').select('composite_score, top_weakness, top_strength').eq('workspace_id', workspaceId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
    ]);

    const tips = await groqService.generateDailyTips(
      userCtx,
      userCtx.archetype || 'seller',
      {
        recentSent:     sentResult.status     === 'fulfilled' ? sentResult.value.data     || [] : [],
        recentPractice: practiceResult.status === 'fulfilled' ? practiceResult.value.data || [] : [],
        recentAnalysis: analysisResult.status === 'fulfilled' ? analysisResult.value.data || [] : [],
        goals:          goals || [],
        recentCheckIns: recentCheckIns || [],
      }
    );

    if (!tips?.length) return;
    const tip = tips[0];

    await supabaseAdmin.from('growth_cards').insert({
      workspace_id: workspaceId,
      user_id:      userId,
      card_type:    tip.card_type || 'tip',
      title:        tip.title,
      body:         tip.body,
      action_label: tip.action_label || null,
      action_type:  tip.action_type  || null,
      priority:     tip.priority     || 5,
      expires_at:   new Date(Date.now() + 24 * 3600000).toISOString(),
      generated_by: 'ai_daily',
      metadata:     tip.metadata || {},
    });

    await supabaseAdmin.from('users')
      .update({ last_tip_generated_at: new Date().toISOString() })
      .eq('id', userId);

    if (user.fcm_token && user.notification_preferences?.daily_tip !== false) {
      await notifyUser(userId, {
        title: tip.title,
        body:  tip.body?.slice(0, 100),
        data:  { type: 'daily_tip' },
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`[GrowthScheduler] Tip generation failed for user ${user.id}:`, err.message);
  }
};

// ─────────────────────────────────────────────────────────────
// CHECK-IN SCHEDULER (2pm)
// FIX HIGH-06: daily_check_ins insert and existence check now
//              include workspace_id — each workspace gets its own
//              check-in per day.
// ─────────────────────────────────────────────────────────────
export const runCheckInScheduler = async () => {
  console.log('[GrowthScheduler] Check-in scheduler starting...');
  const today = new Date().toISOString().split('T')[0];
  const users = await getUsersWithWorkspaceContext();
  let scheduled = 0;

  for (const user of users) {
    try {
      if (user.notification_preferences?.check_in_prompt === false) continue;

      // FIX HIGH-06: check per (user, workspace, date) so a user in multiple
      // workspaces gets a separate check-in for each workspace.
      const { data: existing } = await supabaseAdmin
        .from('daily_check_ins')
        .select('id')
        .eq('user_id', user.id)
        .eq('workspace_id', user.active_workspace_id)  // FIX HIGH-06
        .eq('date', today)
        .maybeSingle();

      if (existing) continue;

      await scheduleCheckIn(user, today);
      scheduled++;
    } catch (err) {
      console.error(`[GrowthScheduler] Check-in failed for user ${user.id}:`, err.message);
    }
    await sleep(500);
  }
  console.log(`[GrowthScheduler] ${scheduled} check-ins scheduled`);
};

const scheduleCheckIn = async (user, today) => {
  const userId      = user.id;
  const workspaceId = user.active_workspace_id;
  const userCtx     = buildCtx(user);

  const { data: recentChat } = await supabaseAdmin
    .from('chats')
    .select('title, last_message_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single();

  const chatContext = recentChat?.title || null;

  const { data: goals } = await supabaseAdmin
    .from('user_goals')
    .select('goal_text, target_value, target_unit, current_value')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(2);

  const questions = await groqService.generateCheckInQuestions(
    userCtx, userCtx.archetype || 'seller', chatContext, goals || []
  );

  // FIX HIGH-06: insert includes workspace_id
  await supabaseAdmin.from('daily_check_ins').insert({
    user_id:      userId,
    workspace_id: workspaceId,  // FIX HIGH-06
    date:         today,
    questions,
    chat_context: chatContext,
  });
};

// ─────────────────────────────────────────────────────────────
// WEEKLY PLAN GENERATION (Sunday 6pm)
// ─────────────────────────────────────────────────────────────
export const runWeeklyPlanGeneration = async () => {
  console.log('[GrowthScheduler] Weekly plan generation starting...');
  const users = await getUsersWithWorkspaceContext();

  for (const batch of chunk(users, 3)) {
    await Promise.allSettled(batch.map(user => generateWeeklyPlanForUser(user)));
    await sleep(3000);
  }
  console.log('[GrowthScheduler] Weekly plans generated');
};

const generateWeeklyPlanForUser = async (user) => {
  try {
    const userId      = user.id;
    const workspaceId = user.active_workspace_id;
    const userCtx     = buildCtx(user);

    // FIX: user_performance_profiles was fetched without workspace_id filter.
    // For multi-workspace users the wrong workspace's performance data
    // (different products, different audiences) could drive the plan.
    const [{ data: goals }, { data: metrics }, { data: recentCheckIns }] = await Promise.all([
      supabaseAdmin.from('user_goals').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(3),
      supabaseAdmin.from('user_performance_profiles').select('*').eq('user_id', userId).eq('workspace_id', workspaceId).maybeSingle(),  // FIX: added workspace_id filter
      supabaseAdmin.from('daily_check_ins').select('answers, mood_score, date').eq('user_id', userId).not('processed_at', 'is', null).order('date', { ascending: false }).limit(3),
    ]);

    const plan = await groqService.generateWeeklyPlan(
      userCtx, userCtx.archetype || 'seller', metrics, goals || [], recentCheckIns || []
    );

    const nextWeekExpiry = new Date();
    nextWeekExpiry.setDate(nextWeekExpiry.getDate() + 7);

    await supabaseAdmin.from('growth_cards').insert({
      workspace_id: workspaceId,
      user_id:      userId,
      card_type:    'strategy',
      title:        plan.title,
      body:         plan.body,
      action_label: 'See full plan',
      action_type:  'internal_chat',
      priority:     10,
      expires_at:   nextWeekExpiry.toISOString(),
      generated_by: 'ai_weekly',
      metadata:     { daily_actions: plan.daily_actions, focus_area: plan.focus_area },
    });

    if (user.fcm_token && user.notification_preferences?.weekly_plan !== false) {
      await notifyUser(userId, {
        title: 'Your weekly growth plan is ready 📋',
        body:  plan.focus_area ? `This week: ${plan.focus_area}` : 'Tap to see your personalized plan',
        data:  { type: 'weekly_plan' },
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`[GrowthScheduler] Weekly plan failed for user ${user.id}:`, err.message);
  }
};

// ─────────────────────────────────────────────────────────────
// GOAL NUDGE JOB (9:05am daily)
// ─────────────────────────────────────────────────────────────
export const runGoalNudgeJob = async () => {
  console.log('[GoalNudge] Starting...');
  const now            = Date.now();
  const nudgeCutoff    = new Date(now - 3 * 86400000).toISOString();
  const staleCutoff    = new Date(now - 5 * 86400000).toISOString();
  const deadlineCutoff = new Date(now + 7 * 86400000).toISOString();

  try {
    const { data: goals } = await supabaseAdmin
      .from('user_goals')
      .select(`
        id, user_id, workspace_id, goal_text, target_date, last_goal_nudge_at,
        users!inner(id, fcm_token, is_deleted)
      `)
      .eq('status', 'active')
      .eq('users.is_deleted', false)
      .or(`last_goal_nudge_at.is.null,last_goal_nudge_at.lt.${nudgeCutoff}`)
      .limit(200);

    if (!goals?.length) { console.log('[GoalNudge] No goals need nudging'); return; }

    const goalIds = goals.map(g => g.id);
    const { data: recentNotes } = await supabaseAdmin
      .from('goal_notes')
      .select('goal_id, created_at')
      .in('goal_id', goalIds)
      .gte('created_at', staleCutoff);

    const recentNoteGoalIds = new Set((recentNotes || []).map(n => n.goal_id));
    let nudged = 0;

    for (const goal of goals) {
      const user = goal.users;
      if (!user?.fcm_token) continue;

      const deadlineSoon = goal.target_date && new Date(goal.target_date) <= new Date(deadlineCutoff);
      const noteStale    = !recentNoteGoalIds.has(goal.id);
      if (!deadlineSoon && !noteStale) continue;

      const mostRecentNote = (recentNotes || [])
        .filter(n => n.goal_id === goal.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      const daysSinceNote = mostRecentNote
        ? Math.round((now - new Date(mostRecentNote.created_at).getTime()) / 86400000)
        : null;

      const body = deadlineSoon
        ? `Your goal "${goal.goal_text.slice(0, 50)}" is coming up soon — want to log progress?`
        : `You haven't logged progress on "${goal.goal_text.slice(0, 40)}" in ${daysSinceNote ?? '5+'} days — want to talk it through with Clutch?`;

      await notifyUser(user.id, {
        title: 'Goal check-in 🎯',
        body,
        data:  { type: 'goal_nudge', goal_id: goal.id },
      }).catch(() => {});

      await supabaseAdmin.from('user_goals')
        .update({ last_goal_nudge_at: new Date().toISOString() })
        .eq('id', goal.id);

      nudged++;
      await sleep(200);
    }

    console.log(`[GoalNudge] Done — ${nudged} nudges sent`);
  } catch (err) {
    console.error('[GoalNudge] Fatal:', err.message);
  }
};

// ─────────────────────────────────────────────────────────────
// ADAPTIVE CURRICULUM JOB (Sunday 11pm)
// FIX HIGH-08: practice_curriculum upsert includes workspace_id
//              with onConflict: 'user_id,workspace_id'
// ─────────────────────────────────────────────────────────────
export const runAdaptiveCurriculumJob = async () => {
  console.log('[CurriculumJob] Starting...');
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id')
    .eq('status', 'active');

  if (!members?.length) return;

  const { data: activeUsers } = await supabaseAdmin
    .from('practice_sessions')
    .select('user_id, workspace_id')
    .eq('completed', true)
    .gte('created_at', sevenDaysAgo);

  if (!activeUsers?.length) return;

  const activeSet = new Set(activeUsers.map(u => `${u.user_id}|${u.workspace_id}`));
  const eligibleMembers = members.filter(m => activeSet.has(`${m.user_id}|${m.workspace_id}`));

  console.log(`[CurriculumJob] Generating curricula for ${eligibleMembers.length} user-workspace pairs`);

  for (const { user_id: userId, workspace_id: workspaceId } of eligibleMembers) {
    try {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('id, fcm_token')
        .eq('id', userId)
        .single();

      const { data: wp } = await supabaseAdmin
        .from('workspace_profiles')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .single();

      const [{ data: skillRows }, { data: recentSessions }] = await Promise.all([
        supabaseAdmin.from('user_skill_profile')
          .select('*')
          .eq('user_id', userId)
          .eq('workspace_id', workspaceId)
          .order('period_start', { ascending: false })
          .limit(4),
        supabaseAdmin.from('practice_sessions')
          .select('scenario_type')
          .eq('user_id', userId)
          .eq('workspace_id', workspaceId)
          .eq('completed', true)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const userCtx = { ...userRow, ...(wp || {}), workspace_id: workspaceId };
      const curriculum = await groqService.generateAdaptiveCurriculum(userCtx, skillRows || [], recentSessions || []);
      if (!curriculum) continue;

      // FIX HIGH-08: workspace_id included, onConflict uses composite key
      await supabaseAdmin.from('practice_curriculum').upsert({
        user_id:      userId,
        workspace_id: workspaceId,  // FIX HIGH-08
        curriculum,
        expires_at:   new Date(Date.now() + 7 * 86400000).toISOString(),
        created_at:   new Date().toISOString(),
      }, { onConflict: 'user_id,workspace_id' });  // FIX HIGH-08

      if (userRow?.fcm_token) {
        await notifyUser(userId, {
          title: 'Your practice plan for this week is ready 🎯',
          body:  'Clutch analyzed your skill scores and has a personalized plan for you.',
          data:  { type: 'curriculum_ready', workspace_id: workspaceId },
        }).catch(() => {});
      }
      await sleep(500);
    } catch (err) {
      console.error(`[CurriculumJob] Failed for user ${userId} workspace ${workspaceId}:`, err.message);
    }
  }
  console.log('[CurriculumJob] Done');
};

// ─────────────────────────────────────────────────────────────
// SKILL PROFILE AGGREGATION (Sunday 10pm)
// FIX HIGH-07: user_skill_profile insert includes workspace_id
// ─────────────────────────────────────────────────────────────
export const runSkillProfileAggregationJob = async () => {
  console.log('[SkillProfileJob] Starting...');
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const periodStart  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const periodEnd    = new Date().toISOString().split('T')[0];

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id')
    .eq('status', 'active');

  if (!members?.length) return;

  console.log(`[SkillProfileJob] Processing ${members.length} user-workspace pairs`);
  let processed = 0;
  const BATCH = 10;

  for (let i = 0; i < members.length; i += BATCH) {
    const batch = members.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async ({ user_id: userId, workspace_id: workspaceId }) => {
      try {
        const { data: sessions } = await supabaseAdmin
          .from('practice_sessions')
          .select('skill_scores')
          .eq('user_id', userId)
          .eq('workspace_id', workspaceId)
          .eq('completed', true)
          .gte('created_at', sevenDaysAgo)
          .not('skill_scores', 'is', null);

        if (!sessions?.length) return;

        const axes = ['clarity', 'value', 'discovery', 'objection_handling', 'brevity', 'cta_strength'];
        const avgs = {};
        for (const axis of axes) {
          const vals = sessions.filter(s => s.skill_scores?.axes?.[axis] != null).map(s => s.skill_scores.axes[axis]);
          avgs[axis] = vals.length > 0 ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
        }

        const overallVals = sessions.filter(s => s.skill_scores?.session_score != null).map(s => s.skill_scores.session_score);
        const overallAvg  = overallVals.length > 0 ? +(overallVals.reduce((a, b) => a + b, 0) / overallVals.length).toFixed(2) : null;
        const axisEntries = Object.entries(avgs).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);

        // FIX HIGH-07: workspace_id included on insert
        await supabaseAdmin.from('user_skill_profile').insert({
          user_id:        userId,
          workspace_id:   workspaceId,  // FIX HIGH-07
          period_start:   periodStart,
          period_end:     periodEnd,
          clarity_avg:    avgs.clarity,
          value_avg:      avgs.value,
          discovery_avg:  avgs.discovery,
          objection_avg:  avgs.objection_handling,
          brevity_avg:    avgs.brevity,
          cta_avg:        avgs.cta_strength,
          overall_avg:    overallAvg,
          sessions_count: sessions.length,
          weakest_axis:   axisEntries[0]?.[0] || null,
          strongest_axis: axisEntries[axisEntries.length - 1]?.[0] || null,
        });
        processed++;
      } catch (err) {
        console.error(`[SkillProfileJob] Failed for user ${userId} workspace ${workspaceId}:`, err.message);
      }
    }));
    if (i + BATCH < members.length) await sleep(1000);
  }
  console.log(`[SkillProfileJob] Done — ${processed} profiles updated`);
};

// ─────────────────────────────────────────────────────────────
// ARCHETYPE DETECTION — writes to workspace_profiles
//
// IMPL-ARCHETYPE-01 (Phase 2 refactor): this function previously ALSO
// wrote the detected archetype to the global `users` table ("save to
// users table (global/fallback)") in addition to workspace_profiles.
// That second write was the actual source of the cross-workspace data
// pollution the Phase 2 refactor set out to eliminate: for any user who
// is a member of more than one workspace, whichever workspace's
// detection happened to run most recently would silently overwrite a
// single shared "global" value on `users.archetype` — a value that was
// only ever correct for the one workspace that produced it, and that
// workspace.js's buildUserContext used to (incorrectly, per its own
// IMPL-ARCHETYPE-01 comment) prefer over the correct workspace-scoped
// value. Per the explicit instruction to remove archetype as a
// user-entity concept entirely, the write to `users` is removed here.
// workspace_profiles is now the only place a detected archetype is ever
// persisted, for any user, in any workspace.
// ─────────────────────────────────────────────────────────────
export const detectAndSaveArchetype = async (userId, workspaceId, userCtx) => {
  try {
    const result = await groqService.detectUserArchetype(userCtx, userCtx.onboarding_answers || {});
    const detectedArchetype = result.archetype || 'seller';
    const detectedAt = new Date().toISOString();

    // ── Save to workspace_profiles (workspace-specific) ──
    const { error: profileError } = await supabaseAdmin
      .from('workspace_profiles')
      .update({ 
        archetype: detectedArchetype, 
        archetype_detected_at: detectedAt 
      })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

    if (profileError) {
      console.error(`[GrowthScheduler] workspace_profiles update failed:`, profileError.message);
    } else {
      console.log(`[GrowthScheduler] ✅ workspace_profiles: ${detectedArchetype}`);
    }

    return detectedArchetype;

  } catch (err) {
    console.error(`[GrowthScheduler] Archetype detection failed for ${userId}:`, err.message);
    return 'seller';
  }
};
export default {
  runDailyTipGeneration, runCheckInScheduler, runWeeklyPlanGeneration,
  detectAndSaveArchetype, runGoalNudgeJob, runAdaptiveCurriculumJob, runSkillProfileAggregationJob,
};
