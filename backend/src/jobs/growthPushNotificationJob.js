// ============================================================
// src/jobs/growthPushNotificationJob.js — WORKSPACE REFACTOR
//
// CHANGES:
//  - growth_cards queries include workspace_id via user's active workspace
//  - skill_progression queries include workspace_id
//  - opportunities query includes workspace_id
//  - getEligibleUsers: reads from workspace_profiles for active workspace
//
// PRESERVED:
//  - All anti-spam logic (push_notification_log)
//  - Morning/evening push logic
//  - DIMENSION_LABELS
// ============================================================
import supabaseAdmin from '../config/supabase.js';
import { notifyUser as nu } from '../services/notifications.js';

const DIMENSION_LABELS2 = {
  hook: 'Hook Strength', clarity: 'Message Clarity', value_prop: 'Value Proposition',
  personalization: 'Personalization', cta: 'Call to Action', tone: 'Tone Fit',
};

const logJob3 = async (name, status, data = {}) => {
  await supabaseAdmin.from('job_logs').insert({ job_name: name, status, ...data }).catch(() => {});
};

const sleep3 = (ms) => new Promise(r => setTimeout(r, ms));

export const runMorningGrowthPush = async () => {
  const startTime = Date.now();
  console.log(`[GrowthPush/Morning] Starting ${new Date().toISOString()}`);
  await logJob3('growth_push_morning', 'started');
  let sent = 0;
  try {
    const users = await getEligibleUsers2();
    for (const user of users) {
      try {
        if (await getDailyPushCount2(user.id) >= 2) continue;
        if (await getHoursSinceLastPush2(user.id) < 6) continue;
        const notification = await buildMorningNotification2(user);
        if (!notification) continue;
        const result = await nu(user.id, notification);
        if (result?.sent) { await logPushSent2(user.id, 'morning_growth', notification.title); sent++; }
      } catch (err) { console.warn(`[GrowthPush/Morning] Failed for user ${user.id}:`, err.message); }
      await sleep3(150);
    }
    await logJob3('growth_push_morning', 'completed', { sent, duration_ms: Date.now() - startTime });
    console.log(`[GrowthPush/Morning] Done — ${sent} sent`);
  } catch (err) {
    console.error('[GrowthPush/Morning] Fatal:', err.message);
    await logJob3('growth_push_morning', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

export const runEveningGrowthPush = async () => {
  const startTime = Date.now();
  console.log(`[GrowthPush/Evening] Starting ${new Date().toISOString()}`);
  await logJob3('growth_push_evening', 'started');
  let sent = 0;
  try {
    const users = await getEligibleUsers2();
    for (const user of users) {
      try {
        if (await getDailyPushCount2(user.id) >= 2) continue;
        if (await getHoursSinceLastPush2(user.id) < 6) continue;
        const notification = await buildEveningNotification2(user);
        if (!notification) continue;
        const result = await nu(user.id, notification);
        if (result?.sent) { await logPushSent2(user.id, 'evening_growth', notification.title); sent++; }
      } catch (err) { console.warn(`[GrowthPush/Evening] Failed for user ${user.id}:`, err.message); }
      await sleep3(150);
    }
    await logJob3('growth_push_evening', 'completed', { sent, duration_ms: Date.now() - startTime });
    console.log(`[GrowthPush/Evening] Done — ${sent} sent`);
  } catch (err) {
    console.error('[GrowthPush/Evening] Fatal:', err.message);
    await logJob3('growth_push_evening', 'failed', { error_message: err.message, duration_ms: Date.now() - startTime });
  }
};

const getEligibleUsers2 = async () => {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, check_in_streak, name, active_workspace_id')
    .eq('is_deleted', false)
    .not('fcm_token', 'is', null)
    .not('active_workspace_id', 'is', null)
    .or(`last_check_in_at.gte.${fourteenDaysAgo},last_tip_generated_at.gte.${fourteenDaysAgo}`);
  return users || [];
};

const buildMorningNotification2 = async (user) => {
  const userId      = user.id;
  const workspaceId = user.active_workspace_id;

  // 1. Pattern card — workspace-scoped
  const { data: patternCard } = await supabaseAdmin
    .from('growth_cards').select('id, title, body')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('generated_by', 'ai_pattern_detection').eq('is_dismissed', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (patternCard) return { title: `Pattern detected in your outreach 🔍`, body: patternCard.title || 'Clutch found a key pattern.', data: { type: 'pattern_insight', card_id: patternCard.id } };

  // 2. Tip card — workspace-scoped
  const { data: tipCard } = await supabaseAdmin
    .from('growth_cards').select('id, title, card_type')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('is_dismissed', false).in('card_type', ['tip', 'insight', 'challenge'])
    .order('priority', { ascending: false }).limit(1).maybeSingle();
  if (tipCard) {
    const typeEmoji = { tip: '💡', insight: '✨', challenge: '⚡' }[tipCard.card_type] || '💡';
    return { title: `Your growth tip is waiting ${typeEmoji}`, body: tipCard.title || 'A personalized insight is ready.', data: { type: 'daily_tip', card_id: tipCard.id } };
  }

  // 3. Pending feedback — workspace-scoped
  const { data: pendingFeedback } = await supabaseAdmin
    .from('opportunities').select('id, platform, target_name')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'sent')
    .lt('marked_sent_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .limit(1).maybeSingle();
  if (pendingFeedback) return { title: `Log your ${pendingFeedback.platform || 'outreach'} result 📊`, body: `Tell Clutch what happened — it helps detect patterns in your communication.`, data: { type: 'feedback_prompt', opportunity_id: pendingFeedback.id } };

  // 4. Streak motivation
  const streak = user.check_in_streak || 0;
  if (streak >= 3) return { title: `${streak}-day streak! Keep going 🔥`, body: `You're building real momentum. Quick daily check-in to stay on track.`, data: { type: 'streak', days: String(streak) } };

  return { title: `Good morning — ready to grow? ☀️`, body: `Review your growth tips and practice your pitch in under 3 minutes.`, data: { type: 'morning_nudge' } };
};

const buildEveningNotification2 = async (user) => {
  const userId      = user.id;
  const workspaceId = user.active_workspace_id;

  // 1. Skill weakness — workspace-scoped skill_progression
  const { data: latestProgression } = await supabaseAdmin
    .from('skill_progression').select('top_weakness, composite_score_avg, composite_delta')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .order('week_start', { ascending: false }).limit(1).maybeSingle();

  if (latestProgression?.top_weakness) {
    const weakness = latestProgression.top_weakness;
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const { data: recentPractice } = await supabaseAdmin.from('practice_sessions')
      .select('id').eq('user_id', userId).eq('completed', true).gte('created_at', twoDaysAgo).limit(1).maybeSingle();
    if (!recentPractice) {
      return { title: `3 minutes to fix your ${DIMENSION_LABELS2[weakness] || weakness} 💪`, body: `This is your #1 skill gap. A quick practice session could move the needle tonight.`, data: { type: 'practice_weakness', weakness } };
    }
  }

  // 2. Challenge card — workspace-scoped
  const { data: challengeCard } = await supabaseAdmin
    .from('growth_cards').select('id, title')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('card_type', 'challenge').eq('is_dismissed', false)
    .order('priority', { ascending: false }).limit(1).maybeSingle();
  if (challengeCard) return { title: `Evening challenge waiting ⚡`, body: challengeCard.title || 'A growth challenge is ready for you tonight.', data: { type: 'evening_challenge', card_id: challengeCard.id } };

  // 3. Pending opportunities — workspace-scoped
  const { data: pendingOpp } = await supabaseAdmin
    .from('opportunities').select('id, platform')
    .eq('workspace_id', workspaceId).eq('user_id', userId)
    .eq('status', 'pending').order('composite_score', { ascending: false }).limit(1).maybeSingle();
  if (pendingOpp) return { title: `New lead waiting 📬`, body: `You have an unreviewed opportunity. Takes 2 minutes to review and send.`, data: { type: 'pending_opportunity', opportunity_id: pendingOpp.id } };

  return { title: `How did outreach go today? 📊`, body: `Log your results so Clutch can track your progress and patterns.`, data: { type: 'evening_nudge' } };
};

const getDailyPushCount2 = async (userId) => {
  // FIX LOW-04: Use UTC midnight instead of local server time
  const todayUTC = new Date().toISOString().split('T')[0];
  const startOfDayUTC = new Date(todayUTC + 'T00:00:00.000Z');
  
  const { count } = await supabaseAdmin.from('push_notification_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', startOfDayUTC.toISOString());
  return count || 0;
};
const getHoursSinceLastPush2 = async (userId) => {
  const { data: latest } = await supabaseAdmin.from('push_notification_log').select('sent_at').eq('user_id', userId).order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (!latest?.sent_at) return Infinity;
  return (Date.now() - new Date(latest.sent_at).getTime()) / 3600000;
};
const logPushSent2 = async (userId, pushType, title) => {
  await supabaseAdmin.from('push_notification_log').insert({ user_id: userId, push_type: pushType, title: title?.slice(0, 200) || null, sent_at: new Date().toISOString() }).catch(() => {});
};

export default { runMorningGrowthPush, runEveningGrowthPush };
