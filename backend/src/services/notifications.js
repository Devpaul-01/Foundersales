// src/services/notifications.js
// Firebase Cloud Messaging push notification service.

import { getMessaging } from '../config/firebase.js';
import supabaseAdmin from '../config/supabase.js';

/**
 * Send a push notification to a specific device token.
 * Silently handles failed/expired tokens.
 */
export const sendPushNotification = async (fcmToken, { title, body, data = {} }) => {
  if (!fcmToken) return { sent: false, reason: 'no_token' };

  const messaging = getMessaging();
  if (!messaging) return { sent: false, reason: 'firebase_not_initialized' };

  const message = {
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    token: fcmToken,
    android: { priority: 'high', notification: { sound: 'default' } },
    apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
  };

  try {
    await messaging.send(message);
    return { sent: true };
  } catch (err) {
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      await supabaseAdmin
        .from('users')
        .update({ fcm_token: null })
        .eq('fcm_token', fcmToken)
        .catch(() => {});
    }
    console.warn('[Notifications] Push failed:', err.code || err.message);
    return { sent: false, reason: err.code };
  }
};

/**
 * Send a push notification to a user.
 *
 * @param {string} userId - The user's ID.
 * @param {object} notification - { title, body, data }
 * @param {string|null} [knownFcmToken] - Optional. Pass the user's FCM token
 *   if it's already available (e.g. from an upstream query). Skips a DB lookup.
 *   In batch jobs processing hundreds of users this halves notification-related
 *   DB round-trips. If omitted, the token is fetched from the database.
 */
export const notifyUser = async (userId, notification, knownFcmToken = null) => {
  let fcmToken = knownFcmToken;

  if (!fcmToken) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('fcm_token')
      .eq('id', userId)
      .single();
    fcmToken = user?.fcm_token;
  }

  if (!fcmToken) return { sent: false, reason: 'no_token' };

  return sendPushNotification(fcmToken, notification);
};

export const Notifications = {
  newOpportunities: (count, workspaceId) => ({
    title: `${count} new ${count === 1 ? 'opportunity' : 'opportunities'} ready 🎯`,
    body:  'Clutch found people who need what you offer. Tap to review.',
    data:  {
      type:         'new_opportunities',
      count:        String(count),
      workspace_id: String(workspaceId || ''),
      redirect_url: '/opportunities',
    },
  }),

  feedbackPrompt: ({ opportunityId, workspaceId }) => ({
    title: 'How did it go?',
    body:  'Share feedback on your recent outreach to improve future recommendations.',
    data:  {
      type:           'feedback_prompt',
      opportunity_id: String(opportunityId),
      workspace_id:   String(workspaceId),
      redirect_url:   `/opportunities/${opportunityId}`,
    },
  }),

  practiceReminder: (sessionId) => ({
    title: '3-minute practice 💪',
    body:  'Build confidence before your next outreach. Quick scenario waiting.',
    data:  {
      type:         'practice_reminder',
      redirect_url: sessionId ? `/practice/${sessionId}` : '/practice',
    },
  }),

  streakAlert: (days) => ({
    title: `${days}-day streak! 🔥`,
    body:  "You're on a roll. Keep the momentum going.",
    data:  {
      type:         'streak',
      days:         String(days),
      redirect_url: '/practice',
    },
  }),

  fallbackSearchNotice: () => ({
    title: 'Search limit reached',
    body:  "Today's live search is done. Practice opportunities are ready instead.",
    data:  {
      type:         'search_limit',
      redirect_url: '/opportunities',
    },
  }),

  dailyTip: (tipTitle) => ({
    title: 'Your growth tip for today 🌱',
    body:  tipTitle || 'A personalized tip is ready for you',
    data:  {
      type:         'daily_tip',
      redirect_url: '/growth',
    },
  }),

  checkInPrompt: (firstName, question) => ({
    title: `Check in, ${firstName || 'there'} 👋`,
    body:  question || 'Quick daily reflection — takes 2 minutes',
    data:  {
      type:         'check_in_prompt',
      redirect_url: '/growth',
    },
  }),

  weeklyPlan: (focusArea) => ({
    title: 'Your weekly growth plan is ready 📋',
    body:  focusArea ? `This week: ${focusArea}` : 'Tap to see your personalized plan',
    data:  {
      type:         'weekly_plan',
      redirect_url: '/growth',
    },
  }),

  goalMilestone: (pct, goalText) => ({
    title: `${pct}% toward your goal! 🎯`,
    body:  goalText?.slice(0, 60) || "Keep pushing — you're making real progress",
    data:  {
      type:         'goal_milestone',
      redirect_url: '/goals',
    },
  }),
};

export default { sendPushNotification, notifyUser, Notifications };
