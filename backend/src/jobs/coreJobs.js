// src/jobs/coreJobs.js
import {
  JOB_INTERVALS, BATCH_SIZE, BATCH_DELAY_MS,
  MIN_MESSAGES_FOR_SUMMARY, SUMMARIZE_EVERY_N_MESSAGES,
  CALENDAR_PREP_HOURS_BEFORE, MIN_COMPOSITE_SCORE,
} from '../config/constants.js';
import { discoverOpportunities }     from '../services/perplexity.js';
import { recordTokenUsage }          from '../services/tokenTracker.js';
import { notifyUser, Notifications } from '../services/notifications.js';
import groqService                   from '../services/groq.js';
import supabaseAdmin                 from '../config/supabase.js';
import { sleep, logJob }             from '../utils/jobHelpers.js';

const chunk = (arr, size) => Array.from(
  { length: Math.ceil(arr.length / size) },
  (_, i) => arr.slice(i * size, i * size + size)
);

// ──────────────────────────────────────────
// JOB: OPPORTUNITY FETCH
// ──────────────────────────────────────────
export const runOpportunityJob = async () => {
  const startTime = Date.now();
  console.log(`[OpportunityJob] Starting ${new Date().toISOString()}`);
  await logJob('opportunity_fetch', 'started');

  let processed = 0, found = 0;

  try {
    // SQL-side eligibility filtering — eliminates the JS .filter() pass that
    // previously loaded the entire users table into memory. At scale this was
    // a full-table scan + memory spike. The !inner join + .eq filters push
    // both conditions into the database query planner.
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

    // workspace_profiles is an array with !inner — find the profile matching
    // active_workspace_id (guards against multi-workspace edge cases).
    const eligible = users
      .map(u => {
        const profiles = Array.isArray(u.workspace_profiles) ? u.workspace_profiles : [u.workspace_profiles];
        const wp = profiles.find(p => p?.workspace_id === u.active_workspace_id);
        // Secondary guard: product_description length check (SQL NULL check above
        // doesn't cover empty strings).
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

// fcmToken is passed in from the upstream query to avoid a second DB lookup per user.
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
    const { message, tokens_in, tokens_out } = await groqService.generateOutreachMessage(
      userCtx, opp, perfProfile
    );

    await recordTokenUsage(workspaceId, 'groq', tokens_in || 0, tokens_out || 0);

    const compositeScore = ((opp.fit_score || 0) + (opp.timing_score || 0) + (opp.intent_score || 0)) / 3;

    // Use upsert with the same conflict key as the manual /opportunities/refresh route.
    // Plain .insert() had no onConflict clause — simultaneous job instances (possible
    // when lockDuration expires before completion) would bypass the dedup Set and
    // create duplicate rows. upsert makes the operation idempotent.
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
      composite_score:  compositeScore,
      message_style:    perfProfile?.best_message_style || 'empathetic',
      message_length:   message ? message.split(' ').length : 0,
      generated_by:     result.model_used,
      status:           'pending',
      stage:            'new',
    }, { onConflict: 'workspace_id,user_id,source_url', ignoreDuplicates: false });

    if (!error) newCount++;
    await sleep(300);
  }

  if (newCount > 0) {
    // Pass fcmToken directly — skips a second SELECT per user in the batch.
    await notifyUser(userId, Notifications.newOpportunities(newCount, workspaceId), fcmToken);
  }

  return { found: newCount };
};

// ──────────────────────────────────────────
// JOB: FEEDBACK PROMPT
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

    // fcm_token already fetched above via the !inner join — pass it directly.
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
// JOB: PERFORMANCE SUMMARY (2am daily)
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
    .select('outcome, outcome_note, opportunities(platform, target_context)')
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
    learned_patterns:         summary.learned_patterns,
    best_message_style:       summary.best_message_style,
    best_message_length:      summary.best_message_length,
    main_objection:           summary.main_objection,
    objection_reframe:        summary.objection_reframe,
    messages_at_last_summary: summary.messages_at_last_summary,
    last_summarized_at:       new Date().toISOString(),
  }, { onConflict: 'user_id,workspace_id' });
};

// ──────────────────────────────────────────
// JOB: METRICS AGGREGATION (3am daily)
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
// JOB: CALENDAR PREP (8am daily)
// ──────────────────────────────────────────
export const runCalendarPrepJob = async () => {
  const tomorrow = new Date(Date.now() + CALENDAR_PREP_HOURS_BEFORE * 3600000).toISOString().split('T')[0];
  const today    = new Date().toISOString().split('T')[0];

  const { data: events } = await supabaseAdmin
    .from('user_events')
    .select(`*, users!inner(id, fcm_token, is_deleted, active_workspace_id)`)
    .gte('event_date', today)
    .lte('event_date', tomorrow)
    .eq('prep_generated', false);

  if (!events?.length) return;

  for (const event of events) {
    if (event.users?.is_deleted) continue;

    try {
      const workspaceId = event.users?.active_workspace_id;

      let wpCtx = {};
      if (workspaceId) {
        const { data: wp } = await supabaseAdmin
          .from('workspace_profiles')
          .select('product_description, target_audience, voice_profile, business_name')
          .eq('workspace_id', workspaceId).eq('user_id', event.user_id).single();
        wpCtx = wp || {};
      }

      const userCtx = { id: event.user_id, ...event.users, ...wpCtx, workspace_id: workspaceId };
      const prep    = await groqService.generateEventPrep(userCtx, event);

      await supabaseAdmin.from('user_events').update({
        prep_content:      prep,
        prep_generated:    true,
        prep_generated_at: new Date().toISOString(),
      }).eq('id', event.id);

      // Pass fcm_token directly — already fetched via the !inner join above.
      if (event.users?.fcm_token) {
        await notifyUser(event.user_id, {
          title: `Prep ready for "${event.title}" 📋`,
          body:  'Talking points and follow-up templates are ready. Tap to review.',
          data:  { type: 'event_prep', event_id: event.id },
        }, event.users.fcm_token);
      }

      await sleep(1000);
    } catch (err) {
      console.error(`[CalendarJob] Prep failed for event ${event.id}:`, err.message);
    }
  }

  if (events.length > 0) {
    console.log(`[CalendarJob] Prepped ${events.length} events`);
  }
};
