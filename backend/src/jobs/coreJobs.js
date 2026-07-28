// src/jobs/coreJobs.js — IMPLEMENTATION PASS
//
// CHANGES:
//  - runCalendarPrepJob no longer generates prep directly (previously
//    called groqService.generateEventPrep inline — a SECOND, different
//    prep-generation implementation from the one used on event creation).
//    It is now a thin scan-and-enqueue job using the exact same
//    CALENDAR_PREP_GENERATE job type + jobId convention as the on-creation
//    path, so there is exactly one prep-generation implementation in the
//    whole system (services/calendarPrep.js) and duplicate execution is
//    structurally impossible rather than merely unlikely.
//  - NEW: runCalendarReminderScan — pre-meeting reminder job, confirmed
//    absent previously despite user_events.reminder_sent existing for
//    exactly this purpose. Uses an atomic UPDATE...WHERE reminder_sent=false
//    RETURNING pattern as its idempotency mechanism (a database-level
//    compare-and-swap) rather than a BullMQ job per event.
//  - NEW: runCalendarDebriefDigest — combined "debriefs needed + overdue
//    commitments" daily push, replacing two previously-passive-only badges
//    with proactive notifications.
import {
  JOB_INTERVALS, BATCH_SIZE, BATCH_DELAY_MS,
  MIN_MESSAGES_FOR_SUMMARY, SUMMARIZE_EVERY_N_MESSAGES,
  CALENDAR_PREP_HOURS_BEFORE, MIN_COMPOSITE_SCORE,
  BACKGROUND_JOB_TYPES, CALENDAR_REMINDER_WINDOW_MINUTES,
} from '../config/constants.js';
import { discoverOpportunities }     from '../services/exa.js';
import { notifyUser, Notifications } from '../services/notifications.js';
import groqService                   from '../services/groq.js';
import supabaseAdmin                 from '../config/supabase.js';
import { sleep, logJob }             from '../utils/jobHelpers.js';
import { backgroundQueue }           from './queues.js';

const chunk = (arr, size) => Array.from(
  { length: Math.ceil(arr.length / size) },
  (_, i) => arr.slice(i * size, i * size + size)
);

// ──────────────────────────────────────────
// JOB: OPPORTUNITY FETCH (unchanged)
// ──────────────────────────────────────────
export const runOpportunityJob = async () => {
  const startTime = Date.now();
  console.log(`[OpportunityJob] Starting ${new Date().toISOString()}`);
  await logJob('opportunity_fetch', 'started');

  let processed = 0, found = 0;

  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select(`
        id, tier, fcm_token, active_workspace_id,
        workspace_profiles!inner(
          workspace_id, product_description, target_audience, voice_profile,
          business_name, role, industry, archetype, preferred_platforms,
          country, state, onboarding_completed
        )
      `)
      .eq('is_deleted', false)
      .not('active_workspace_id', 'is', null)
      .eq('workspace_profiles.onboarding_completed', true)
      .not('workspace_profiles.product_description', 'is', null);

    if (!users?.length) {
      await logJob('opportunity_fetch', 'completed', {
        users_processed: 0, opportunities_found: 0, duration_ms: Date.now() - startTime,
      });
      return;
    }

    const eligible = users
      .map(u => {
        const profiles = Array.isArray(u.workspace_profiles) ? u.workspace_profiles : [u.workspace_profiles];
        const wp = profiles.find(p => p?.workspace_id === u.active_workspace_id);
        if (!wp || (wp.product_description?.length ?? 0) <= 10) return null;
        return { ...u, _wp: wp };
      })
      .filter(Boolean);

    console.log(`[OpportunityJob] ${eligible.length} eligible users found`);

    for (const batch of chunk(eligible, BATCH_SIZE)) {
      const results = await Promise.allSettled(batch.map(u => {
        const workspaceId = u.active_workspace_id;
        const userCtx     = { ...u, ...u._wp, workspace_id: workspaceId };
        return processUserOpportunities(u.id, workspaceId, userCtx, u.fcm_token);
      }));

      results.forEach((r, i) => {
        if (r.status === 'fulfilled') { processed++; found += r.value?.found || 0; }
        else console.error(`[OpportunityJob] User ${batch[i].id} failed:`, r.reason?.message);
      });

      await sleep(BATCH_DELAY_MS);
    }

    await logJob('opportunity_fetch', 'completed', {
      users_processed: processed, opportunities_found: found, duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[OpportunityJob] Fatal:', err.message);
    await logJob('opportunity_fetch', 'failed', { error_message: err.message });
  }
};

export const processUserOpportunities = async (userId, workspaceId, userCtx, fcmToken = null) => {
  const result = await discoverOpportunities(userId, workspaceId, userCtx);
  if (!result.opportunities?.length) return { found: 0 };

  const { data: perfProfile } = await supabaseAdmin
    .from('user_performance_profiles')
    .select('learned_patterns, best_message_style, best_message_length')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const scored     = await groqService.scoreOpportunities(userCtx, result.opportunities);
  const qualifying = scored.filter(
    o => ((o.fit_score || 0) + (o.timing_score || 0) + (o.intent_score || 0)) / 3 >= MIN_COMPOSITE_SCORE
  );

  let newCount = 0;
  for (const opp of qualifying) {
    const { message } = await groqService.generateOutreachMessage(
      userCtx, opp, perfProfile
    );

    const { error } = await supabaseAdmin.from('opportunities').upsert({
      workspace_id:     workspaceId,
      user_id:          userId,
      platform:         opp.platform || 'reddit',
      source_url:       opp.source_url,
      target_context:   opp.target_context,
      target_name:      opp.target_name || null,
      prepared_message: message,
      fit_score:        opp.fit_score,
      timing_score:     opp.timing_score,
      intent_score:     opp.intent_score,
      message_style:    perfProfile?.best_message_style || 'empathetic',
      message_length:   message ? message.split(' ').length : 0,
      generated_by:     result.model_used,
      status:           'pending',
      stage:            'new',
    }, { onConflict: 'workspace_id,user_id,source_url', ignoreDuplicates: false });

    if (!error) newCount++;
    else console.error(`[OpportunityJob] Upsert failed for user ${userId}, source ${opp.source_url}:`, error.message);
    await sleep(300);
  }

  if (newCount > 0) {
    await notifyUser(userId, Notifications.newOpportunities(newCount, workspaceId), fcmToken);
  }

  return { found: newCount };
};

// ──────────────────────────────────────────
// JOB: FEEDBACK PROMPT (unchanged)
// ──────────────────────────────────────────
export const runFeedbackPromptJob = async () => {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: opps } = await supabaseAdmin
    .from('opportunities')
    .select(`
      id, user_id, workspace_id,
      users!inner(id, is_deleted, active_workspace_id, fcm_token)
    `)
    .eq('status', 'sent')
    .lt('marked_sent_at', cutoff)
    .eq('users.is_deleted', false);

  if (!opps?.length) return;

  const { data: activeMemberships } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, user_id')
    .eq('status', 'active');

  const activeWorkspaceSet = new Set(
    (activeMemberships || []).map(m => `${m.user_id}|${m.workspace_id}`)
  );

  const validOpps = opps.filter(opp =>
    activeWorkspaceSet.has(`${opp.user_id}|${opp.workspace_id}`)
  );

  if (!validOpps.length) return;

  const { data: feedbackExists } = await supabaseAdmin
    .from('feedback')
    .select('opportunity_id')
    .in('opportunity_id', validOpps.map(o => o.id));

  const withFeedback = new Set(feedbackExists?.map(f => f.opportunity_id) || []);
  const needPrompt   = validOpps.filter(o => !withFeedback.has(o.id));

  const userOpportunities = new Map();
  for (const opp of needPrompt) {
    if (!userOpportunities.has(opp.user_id)) {
      userOpportunities.set(opp.user_id, { opportunities: [], fcm_token: opp.users?.fcm_token });
    }
    userOpportunities.get(opp.user_id).opportunities.push(opp);
  }

  for (const [userId, { opportunities, fcm_token }] of userOpportunities) {
    if (!fcm_token) continue;

    await notifyUser(userId, {
      title: `Feedback requested for ${opportunities.length} opportunity${opportunities.length !== 1 ? 's' : ''}`,
      body:  'Your input helps improve future recommendations. Tap to share feedback.',
      data:  {
        type:            'feedback_prompt',
        count:           opportunities.length,
        opportunity_ids: opportunities.map(o => o.id),
        workspace_id:    opportunities[0]?.workspace_id,
      },
    }, fcm_token);

    await sleep(200);
  }

  if (needPrompt.length > 0) {
    console.log(`[FeedbackJob] Sent prompts to ${userOpportunities.size} users for ${needPrompt.length} opportunities`);
  }
};

// ──────────────────────────────────────────
// JOB: PERFORMANCE SUMMARY (unchanged)
// ──────────────────────────────────────────
export const runPerformanceSummaryJob = async () => {
  console.log('[SummaryJob] Starting');

  const { data: profiles } = await supabaseAdmin
    .from('user_performance_profiles')
    .select('user_id, workspace_id, total_sent, messages_at_last_summary, last_summarized_at');

  if (!profiles?.length) return;

  const needsSummary = profiles.filter(p =>
    p.total_sent >= MIN_MESSAGES_FOR_SUMMARY &&
    (p.total_sent - (p.messages_at_last_summary || 0)) >= SUMMARIZE_EVERY_N_MESSAGES
  );

  for (const profile of needsSummary) {
    await summarizeUserPerformance(profile.user_id, profile.workspace_id);
    await sleep(1500);
  }
};

export const summarizeUserPerformance = async (userId, workspaceId) => {
  const { data: recentFeedback } = await supabaseAdmin
    .from('feedback')
    .select('outcome, outcome_note, opportunities(platform, target_context, message_style, message_length)')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!recentFeedback?.length) return;

  const { data: wpCtx } = await supabaseAdmin
    .from('workspace_profiles')
    .select('product_description, target_audience, voice_profile')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  const userCtx = { id: userId, ...wpCtx, workspace_id: workspaceId };
  const summary = await groqService.summarizePerformancePatterns(userCtx, recentFeedback);
  if (!summary) return;

  await supabaseAdmin.from('user_performance_profiles').upsert({
    user_id:                  userId,
    workspace_id:             workspaceId,
    learned_patterns:         summary.learned_patterns         ?? null,
    best_message_style:       summary.best_message_style       ?? null,
    best_message_length:      summary.best_message_length      ?? null,
    best_platform:            summary.best_platform            ?? null,
    messages_at_last_summary: summary.messages_at_last_summary ?? 0,
    last_summarized_at:       new Date().toISOString(),
  }, { onConflict: 'user_id,workspace_id' });
};

// ──────────────────────────────────────────
// JOB: METRICS AGGREGATION (unchanged)
// ──────────────────────────────────────────
export const runMetricsJob = async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id')
    .eq('status', 'active');

  if (!members?.length) return;

  for (const { user_id, workspace_id } of members) {
    await aggregateUserMetrics(user_id, workspace_id, yesterday);
    await sleep(200);
  }
};

export const aggregateUserMetrics = async (userId, workspaceId, date) => {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd   = `${date}T23:59:59.999Z`;

  const { data: opps } = await supabaseAdmin
    .from('opportunities')
    .select('id, viewed_at, link_clicked_at, message_copied_at, marked_sent_at')
    .eq('user_id', userId).eq('workspace_id', workspaceId)
    .gte('created_at', dayStart).lte('created_at', dayEnd);

  const { data: feedback } = await supabaseAdmin
    .from('feedback')
    .select('outcome')
    .eq('user_id', userId).eq('workspace_id', workspaceId)
    .gte('created_at', dayStart).lte('created_at', dayEnd);

  const sent     = (opps     || []).filter(o => o.marked_sent_at).length;
  const positive = (feedback || []).filter(f => f.outcome === 'positive').length;

  await supabaseAdmin.from('daily_metrics').upsert({
    user_id:               userId,
    workspace_id:          workspaceId,
    date,
    opportunities_shown:   opps?.length || 0,
    opportunities_viewed:  (opps || []).filter(o => o.viewed_at).length,
    links_clicked:         (opps || []).filter(o => o.link_clicked_at).length,
    messages_copied:       (opps || []).filter(o => o.message_copied_at).length,
    messages_sent:         sent,
    positive_outcomes:     positive,
    negative_outcomes:     (feedback?.length || 0) - positive,
    execution_rate:        opps?.length > 0 ? sent / opps.length : 0,
    positive_rate:         sent > 0 ? positive / sent : 0,
  }, { onConflict: 'user_id,workspace_id,date' });
};

// ──────────────────────────────────────────
// JOB: CALENDAR PREP SWEEP — CONSOLIDATED
// Previously generated prep directly via groqService.generateEventPrep
// (a DIFFERENT function from the one used on event creation). Now purely
// a scan-and-enqueue job using the exact same CALENDAR_PREP_GENERATE job
// type + generateAndPersistPrep implementation as every other prep trigger
// in the system. .eq('prep_failed', false) prevents this sweep from
// re-enqueueing an event forever once it has permanently failed (see
// backgroundWorker.js's worker.on('failed') handler, which sets that flag).
// ──────────────────────────────────────────
export const runCalendarPrepJob = async () => {
  const tomorrow = new Date(Date.now() + CALENDAR_PREP_HOURS_BEFORE * 3600000).toISOString().split('T')[0];
  const today    = new Date().toISOString().split('T')[0];

  const { data: events } = await supabaseAdmin
    .from('user_events')
    .select('id, user_id, workspace_id, users!inner(id, is_deleted, active_workspace_id)')
    .gte('event_date', today)
    .lte('event_date', tomorrow)
    .eq('prep_generated', false)
    .eq('prep_failed', false);

  if (!events?.length) return;

  let enqueued = 0;
  for (const event of events) {
    if (event.users?.is_deleted) continue;
    const workspaceId = event.users?.active_workspace_id;
    if (!workspaceId) continue;

    await backgroundQueue.add(
      BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE,
      { userId: event.user_id, workspaceId, eventId: event.id, source: 'daily_sweep' },
      { jobId: `prep:${event.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    ).then(() => { enqueued++; })
     .catch(err => console.error(`[CalendarPrepSweep] enqueue failed for ${event.id}:`, err.message));
  }

  console.log(`[CalendarPrepSweep] Enqueued ${enqueued} of ${events.length} scanned events`);
};

// ──────────────────────────────────────────
// NEW JOB: PRE-MEETING REMINDER SCAN
// Repeatable scan every 5 minutes, not one delayed job per event — avoids
// scheduling/cancelling overhead as events get created/edited/deleted.
// Idempotency via an atomic UPDATE...WHERE reminder_sent=false...RETURNING
// — a database-level compare-and-swap, so no BullMQ job/jobId is needed
// per event at all.
// ──────────────────────────────────────────
export const runCalendarReminderScan = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + CALENDAR_REMINDER_WINDOW_MINUTES * 60000);

  const { data: events } = await supabaseAdmin
    .from('user_events')
    .select('id, user_id, workspace_id, title, start_time, attendee_name, users!inner(fcm_token, is_deleted, notification_preferences)')
    .eq('reminder_sent', false)
    .gte('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString());

  if (!events?.length) return;

  let sent = 0;
  for (const event of events) {
    if (event.users?.is_deleted) continue;
    if (event.users?.notification_preferences?.calendar_prep_ready === false) continue;

    const { data: claimed } = await supabaseAdmin
      .from('user_events')
      .update({ reminder_sent: true })
      .eq('id', event.id).eq('reminder_sent', false)
      .select('id')
      .maybeSingle();

    if (!claimed) continue; // another concurrent scan tick already claimed this event

    if (event.users?.fcm_token) {
      const minutesUntil = Math.max(0, Math.round((new Date(event.start_time) - now) / 60000));
      await notifyUser(event.user_id, {
        title: `📅 ${event.title} in ${minutesUntil} min`,
        body: event.attendee_name ? `With ${event.attendee_name}` : 'Meeting starting soon',
        data: { type: 'meeting_reminder', event_id: event.id },
      }, event.users.fcm_token).then(() => sent++)
        .catch(err => console.error(`[ReminderScan] notify failed for ${event.id}:`, err.message));
    }
  }

  console.log(`[ReminderScan] Processed ${events.length} events in window, sent ${sent} reminders`);
};
// ──────────────────────────────────────────
// NEW JOB: DAILY DEBRIEF/COMMITMENT DIGEST (push notification, NOT the
// Slack/Email digest-delivery feature — that was explicitly excluded
// from this implementation pass)
// ──────────────────────────────────────────
export const runCalendarDebriefDigest = async () => {
  const { data: members } = await supabaseAdmin.from('workspace_members').select('user_id, workspace_id').eq('status', 'active');

  for (const { user_id, workspace_id } of (members || [])) {
    const [{ count: debriefsNeeded }, { count: overdueCommitments }] = await Promise.all([
      supabaseAdmin.from('user_events').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id).eq('user_id', user_id)
        .lt('event_date', new Date().toISOString().split('T')[0]).is('debrief_completed_at', null),
      supabaseAdmin.from('conversation_commitments').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id).eq('user_id', user_id).eq('owner', 'founder').eq('status', 'overdue'),
    ]);
    if (!debriefsNeeded && !overdueCommitments) continue;

    const { data: userRow } = await supabaseAdmin.from('users').select('fcm_token, notification_preferences').eq('id', user_id).single();
    if (!userRow?.fcm_token) continue;

    const wantsDebrief = debriefsNeeded && userRow.notification_preferences?.debrief_reminder !== false;
    const wantsCommitment = overdueCommitments && userRow.notification_preferences?.commitment_reminder !== false;
    if (!wantsDebrief && !wantsCommitment) continue;

    const parts = [];
    if (wantsDebrief) parts.push(`${debriefsNeeded} debrief${debriefsNeeded > 1 ? 's' : ''} needed`);
    if (wantsCommitment) parts.push(`${overdueCommitments} overdue commitment${overdueCommitments > 1 ? 's' : ''}`);
    if (!parts.length) continue;

    await notifyUser(user_id, {
      title: '📋 Calendar catch-up',
      body: parts.join(' · '),
      data: { type: 'calendar_digest', workspace_id },
    }, userRow.fcm_token).catch(() => {});

    await sleep(200);
  }
};
