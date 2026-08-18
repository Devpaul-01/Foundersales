// src/jobs/backgroundWorker.js — IMPLEMENTATION PASS (merged)
//
// CHANGES IN THIS REVISION:
//
//  CALENDAR_PREP_GENERATE — fully consolidated. Previously this handler
//  re-implemented buildPrepContext inline (duplicating calendar.js's copy),
//  and a SEPARATE code path (coreJobs.js's runCalendarPrepJob) generated
//  prep via a DIFFERENT function entirely (groqService.generateEventPrep)
//  on its own daily sweep — meaning which prep schema a user got depended
//  on pure timing luck of which path ran first, and NEITHER path was aware
//  of the other. Both now converge on services/calendarPrep.js's
//  generateAndPersistPrep, with a DB-state re-check at the top of this
//  handler as a second, queue-independent idempotency layer (BullMQ's
//  jobId dedup alone only protects against duplicates under the SAME
//  jobId while a job is still queued — it does not protect against two
//  DIFFERENT jobIds racing to generate prep for the same event, which is
//  exactly what could happen between the sweep and the on-creation path).
//
//  Notification is now sent from EXACTLY ONE place — inside this handler,
//  gated on the user's actual notification_preferences — closing the
//  previous inconsistency where only the old sweep path notified.
//
//  NEW HANDLERS: CALENDAR_EXTRACT_COMMITMENTS_SIGNALS,
//  CALENDAR_UPDATE_PROSPECT_HEALTH, CALENDAR_GENERATE_FOLLOWUP,
//  VOICE_MEMO_TRANSCRIBE, VOICE_MEMO_ENRICH, PROSPECT_DEDUP_SCAN.
//  (Integrations/calendar-sync jobs are explicitly out of scope for this
//  pass — no CALENDAR_SYNC_PULL handler exists.)
//
//  worker.on('failed') now flips prep_failed/prep_failed_at/
//  prep_failure_reason on final CALENDAR_PREP_GENERATE failure, giving the
//  frontend a real failure state instead of an infinite "Preparing..."
//  pulse, and giving the daily sweep a signal to stop re-enqueueing a
//  permanently-broken event forever.
//
//  IMPL-SENTRY-01 (Phase 2 refactor / L4, carried forward from the prior
//  revision): the 'failed' handler's logError call is paired with a
//  Sentry.captureException call, tagged with the job name/id, matching
//  scheduledWorker.js and practiceWorker.js — see scheduledWorker.js's
//  file header for the full reasoning. No-ops safely if Sentry was never
//  initialized (SENTRY_DSN unset).
import { Worker }             from 'bullmq';
import { bullmqConnection }   from '../config/bullmq.js';
import { BACKGROUND_JOB_TYPES, CHAT_HISTORY_WINDOW } from '../config/constants.js';
import { createLogger }       from '../utils/logger.js';
import supabaseAdmin          from '../config/supabase.js';
import { callWithFallbackGroq } from '../services/multiProvider.js';
import groqService            from '../services/groq.js';
import { detectAndSaveArchetype } from './growthIntelligenceScheduler.js';
import { processUserOpportunities as runOpportunitiesRefreshForUser } from './coreJobs.js';
import { notifyUser } from '../services/notifications.js';
import * as Sentry from '@sentry/node';

// Calendar imports
import { generateAndPersistPrep } from '../services/calendarPrep.js';
import { researchProspectForMeeting } from '../services/exaCalendar.js';
import { generatePostMeetingFollowUp } from '../services/groqCalendarIntelligence.js';
import { extractCommitmentsAndSignals } from '../services/calendarCommitmentsSignals.js';
import { shouldGenerateFollowUp, recordGateDecision } from '../services/calendarAiGate.js';
import { FollowUpOptionsSchema, validateOrFallback } from '../schemas/calendarAiSchemas.js';
import { runProspectDedupScanForWorkspace } from '../services/prospectDedup.js';
import * as voiceMemoService from '../services/voiceMemoService.js';

const { log, logError, logJob } = createLogger('BackgroundWorker');

const loadUserCtx = async (userId, workspaceId) => {
  const [{ data: userRow }, { data: wp }] = await Promise.all([
    supabaseAdmin.from('users').select('*').eq('id', userId).single(),
    supabaseAdmin.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
  ]);
  return { ...userRow, ...wp, workspace_id: workspaceId, id: userId };
};

// Small, safe subset of job.data worth attaching to dispatch/failure logs so
// a log line can be traced back to a record without risking a dump of large
// free-text payloads (rawNotes, tip_context, debrief_content, ...) into logs.
const JOB_ID_FIELDS = ['memoId', 'eventId', 'chatId', 'goalId', 'prospectId', 'userId', 'workspaceId'];
const pickIds = (data = {}) =>
  Object.fromEntries(JOB_ID_FIELDS.filter(k => data?.[k] !== undefined).map(k => [k, data[k]]));

const handlers = {

  async [BACKGROUND_JOB_TYPES.TIP_CARD_GENERATE](data) {
    const { userId, workspaceId, goalId, tip_context, goal_text, product_description } = data;
    logJob(BACKGROUND_JOB_TYPES.TIP_CARD_GENERATE, { userId, goalId });
    const { content: tc } = await callWithFallbackGroq({
      systemPrompt: `Generate a growth tip. Context: ${tip_context}. Goal: ${goal_text}. Product: ${product_description ?? ''}. Respond ONLY as JSON: { "title": "<10 words max>", "body": "<2-3 sentences actionable advice>" }`,
      messages: [{ role: 'user', content: 'Generate the tip.' }],
      temperature: 0.5, maxTokens: 150,
      tier: 'fast', workspaceId, userId, sourceJob: 'tip_card_generate',
    });
    let tip;
    try {
      tip = JSON.parse(tc.replace(/```json|```/g, '').trim());
    } catch (err) {
      logError('tip_card_generate_parse', err, { userId, goalId, raw: tc?.slice(0, 200) });
      return;
    }
    await supabaseAdmin.from('growth_cards').insert({
      workspace_id: workspaceId, user_id: userId, card_type: 'tip',
      title: tip.title, body: tip.body, action_label: 'Log more progress',
      action_type: 'internal_chat', priority: 7,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      generated_by: 'goal_note_ai', metadata: { goal_id: goalId },
    });
    log('tip_card_generate DONE', { userId, goalId });
  },

  async [BACKGROUND_JOB_TYPES.FIRST_TIME_CARDS_GENERATE](data) {
    const { userId, workspaceId, userCtx } = data;
    logJob(BACKGROUND_JOB_TYPES.FIRST_TIME_CARDS_GENERATE, { userId });
    const today = new Date().toISOString().split('T')[0];
    const { count: todayCards } = await supabaseAdmin.from('growth_cards')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('generated_by', 'ai_daily')
      .gte('created_at', today + 'T00:00:00');
    if (todayCards > 0) {
      log('first_time_cards_generate skipped — already generated today', { userId, workspaceId });
      return;
    }
    const archetype = userCtx.archetype || 'seller';
    const { data: goals } = await supabaseAdmin.from('user_goals')
      .select('goal_text, target_value, target_unit, current_value')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').limit(2);
    const { data: memoryFacts } = await supabaseAdmin.from('user_memory')
      .select('fact').eq('user_id', userId).eq('workspace_id', workspaceId)
      .eq('is_active', true).order('reinforcement_count', { ascending: false }).limit(5);
    const enrichedCtx = { ...userCtx, _memoryFacts: memoryFacts || [] };
    const tips = await groqService.generateDailyTips(enrichedCtx, archetype, goals || [], []);
    const priorities = [8, 6, 4];
    const expiresAt  = new Date(Date.now() + 86400000).toISOString();
    await supabaseAdmin.from('growth_cards').insert(
      tips.map((tip, i) => ({
        workspace_id: workspaceId, user_id: userId, card_type: tip.card_type || 'tip',
        title: tip.title, body: tip.body,
        action_label: tip.action_label || 'Explore with Clutch AI', action_type: 'internal_chat',
        priority: priorities[i] ?? 4, expires_at: expiresAt, generated_by: 'ai_daily', metadata: tip.metadata || {},
      }))
    );
    await supabaseAdmin.from('users').update({ last_tip_generated_at: new Date().toISOString() }).eq('id', userId);
    log('first_time_cards_generate DONE', { userId, count: tips.length });
  },

  async [BACKGROUND_JOB_TYPES.OPPORTUNITIES_REFRESH](data) {
    const { userId, workspaceId, userContext } = data;
    logJob(BACKGROUND_JOB_TYPES.OPPORTUNITIES_REFRESH, { userId });
    await runOpportunitiesRefreshForUser(userId, workspaceId, userContext);
    log('opportunities_refresh DONE', { userId });
  },

  async [BACKGROUND_JOB_TYPES.ARCHETYPE_DETECT](data) {
    const { userId, workspaceId, userContext } = data;
    logJob(BACKGROUND_JOB_TYPES.ARCHETYPE_DETECT, { userId });
    await detectAndSaveArchetype(userId, workspaceId, userContext);
    log('archetype_detect DONE', { userId });
  },

  async [BACKGROUND_JOB_TYPES.SEED_MEMORY](data) {
    const { userId, workspaceId, context, answers, voiceProfile, isRebuild } = data;
    logJob(BACKGROUND_JOB_TYPES.SEED_MEMORY, { userId, workspaceId, isRebuild });
    await groqService.seedMemoryFromOnboarding(userId, workspaceId, context, answers, voiceProfile, isRebuild);
    log('seed_memory DONE', { userId, workspaceId });
  },

  async [BACKGROUND_JOB_TYPES.CHECKIN_TIP_GENERATE](data) {
    const { userId, workspaceId, userCtx, answers, next_tip_seed, goals, moodScore, archetype } = data;
    logJob(BACKGROUND_JOB_TYPES.CHECKIN_TIP_GENERATE, { userId, workspaceId });

    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabaseAdmin.from('growth_cards')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('generated_by', 'ai_checkin').gte('created_at', today + 'T00:00:00');
    if (count > 0) {
      log('checkin_tip_generate skipped — already generated today', { userId, workspaceId });
      return;
    }

    const tip = await groqService.generateDailyTip(
      userCtx, archetype || 'seller', goals,
      [{ answers, seed: next_tip_seed, mood_score: moodScore }]
    );

    await supabaseAdmin.from('growth_cards').insert({
      workspace_id:  workspaceId, user_id: userId,
      card_type:     tip.card_type || 'tip',
      title:         tip.title, body: tip.body,
      action_label:  tip.action_label || 'Explore with Clutch AI',
      action_type:   'internal_chat', priority: 9,
      expires_at:    new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      generated_by:  'ai_checkin', metadata: tip.metadata || {},
    });
    await supabaseAdmin.from('users')
      .update({ last_tip_generated_at: new Date().toISOString() })
      .eq('id', userId);

    log('checkin_tip_generate DONE', { userId, workspaceId });
  },

  // ── CALENDAR_PREP_GENERATE — consolidated, single implementation ──────
  async [BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE](data) {
    const { userId, workspaceId, eventId, source } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE, { userId, workspaceId, eventId, source });

    // Layer 1 idempotency: re-check DB state, not just enqueue-time jobId
    // dedup. This is what actually prevents duplicate generation between
    // the on-creation path and the daily sweep.
    const { data: event } = await supabaseAdmin
      .from('user_events').select('*')
      .eq('id', eventId).eq('workspace_id', workspaceId).single(); // workspace-scoped now

    if (!event) { log('calendar_prep_generate skipped — event not found', { eventId }); return; }
    if (event.prep_generated) {
      log('calendar_prep_generate skipped — already generated', { eventId, source });
      return; // expected outcome of a race, not a failure
    }

    const userCtx = await loadUserCtx(userId, workspaceId);
    await generateAndPersistPrep(userCtx, event, workspaceId);

    // Notification sent from exactly here, exactly once.
    if (userCtx.fcm_token && userCtx.notification_preferences?.calendar_prep_ready !== false) {
      await notifyUser(userId, {
        title: `Prep ready for "${event.title}" 📋`,
        body:  'Talking points and follow-up templates are ready. Tap to review.',
        data:  { type: 'event_prep', event_id: event.id },
      }, userCtx.fcm_token).catch(err => logError('calendar_prep_notify', err, { eventId }));
    }

    log('calendar_prep_generate DONE', { userId, workspaceId, eventId, source });
  },

  // ── CALENDAR_RESEARCH_PROSPECT — workspace-scoped fetch (was missing) ──
  async [BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT](data) {
    const { userId, workspaceId, eventId } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin
      .from('user_events').select('*').eq('id', eventId).eq('workspace_id', workspaceId).single();
    if (!event) {
      log('calendar_research_prospect skipped — event not found', { eventId });
      return;
    }

    const userCtx = await loadUserCtx(userId, workspaceId);
    await researchProspectForMeeting(userId, workspaceId, eventId, event, userCtx);
    log('calendar_research_prospect DONE', { userId, workspaceId, eventId });
  },

  // ── NEW: CALENDAR_EXTRACT_COMMITMENTS_SIGNALS ──────────────────────────
  async [BACKGROUND_JOB_TYPES.CALENDAR_EXTRACT_COMMITMENTS_SIGNALS](data) {
    const { userId, workspaceId, eventId, rawNotes } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_EXTRACT_COMMITMENTS_SIGNALS, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin.from('user_events').select('*')
      .eq('id', eventId).eq('workspace_id', workspaceId).single();
    if (!event) return;
    if (event.signals_extracted) {
      log('extract_commitments_signals skipped — already extracted', { eventId });
      return;
    }

    const { data: existingOpenCommitments } = event.prospect_id
      ? await supabaseAdmin.from('conversation_commitments').select('commitment_text')
          .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId)
          .in('status', ['pending', 'overdue']).eq('owner', 'founder')
      : { data: [] };

    const { commitments, signals } = await extractCommitmentsAndSignals(
      rawNotes, event.attendee_name, event.outcome, existingOpenCommitments || [],
      { workspaceId, userId, eventId }
    );

    if (commitments.length) {

      console.log(`commitmets found : ${commitments}`);
      const { error } = await supabaseAdmin.from('conversation_commitments').insert(
        commitments.map(c => ({
          workspace_id: workspaceId, user_id: userId, prospect_id: event.prospect_id || null,
          source_type: 'meeting_debrief', source_id: event.id, event_id: event.id,
          commitment_text: c.commitment_text, owner: c.owner || 'founder', status: 'pending', due_date: c.due_date || null,
        }))
      );
      if (error) logError('extract_commitments_signals/commitments insert', error, { eventId });
    }

    if (signals.length) {
      console.log(`signals found : ${signals}`);

      const { error } = await supabaseAdmin.from('conversation_signals').insert(
        signals.map(s => ({
          workspace_id: workspaceId, user_id: userId, prospect_id: event.prospect_id || null,
          source_type: 'meeting_debrief', source_id: event.id, detected_at: new Date(), event_id: event.id,
          signal_type: s.signal_type, signal_text: s.signal_text, confidence: s.confidence || null,
        }))
      );
      if (error) logError('extract_commitments_signals/signals insert', error, { eventId });
    }

    await supabaseAdmin.from('user_events').update({ signals_extracted: true }).eq('id', eventId).eq('workspace_id', workspaceId);
    log('extract_commitments_signals DONE', { eventId, commitmentCount: commitments.length, signalCount: signals.length });
  },

  // ── NEW: CALENDAR_UPDATE_PROSPECT_HEALTH ───────────────────────────────
  // No idempotency guard needed — recomputes from source data each time
  // rather than accumulating, so re-execution is naturally safe.
  async [BACKGROUND_JOB_TYPES.CALENDAR_UPDATE_PROSPECT_HEALTH](data) {
    const { userId, workspaceId, prospectId } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_UPDATE_PROSPECT_HEALTH, { userId, workspaceId, prospectId });
    await updateProspectHealth(userId, workspaceId, prospectId);
    log('calendar_update_prospect_health DONE', { userId, workspaceId, prospectId });
  },

  // ── NEW: CALENDAR_GENERATE_FOLLOWUP ─────────────────────────────────────
  async [BACKGROUND_JOB_TYPES.CALENDAR_GENERATE_FOLLOWUP](data) {
    const { userId, workspaceId, eventId } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_GENERATE_FOLLOWUP, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin.from('user_events').select('*')
      .eq('id', eventId).eq('workspace_id', workspaceId).single();
    if (!event || event.follow_up_generated_at) return;

    const gate = shouldGenerateFollowUp(event);
    await recordGateDecision({ workspaceId, userId, eventId, aiFunction: 'follow_up', gateResult: gate });
    if (!gate.proceed) {
      log('calendar_generate_followup skipped by gate', { eventId, reason: gate.reason });
      return;
    }

    const [{ data: commitments }, { data: signals }] = await Promise.all([
      supabaseAdmin.from('conversation_commitments').select('*').eq('event_id', eventId).eq('workspace_id', workspaceId),
      supabaseAdmin.from('conversation_signals').select('*').eq('event_id', eventId).eq('workspace_id', workspaceId),
    ]);

    const userCtx = await loadUserCtx(userId, workspaceId);
    const rawFollowUp = await generatePostMeetingFollowUp(userCtx, event, event.debrief_content, commitments || [], signals || []);
    const followUp = validateOrFallback(FollowUpOptionsSchema, rawFollowUp, {
      brief: `Hey ${event.attendee_name || 'there'} — great talking today.`,
      substantive: `Hey ${event.attendee_name || 'there'} — appreciated our conversation. What's the best next step from your side?`,
      re_engagement: `Hey ${event.attendee_name || 'there'} — checking back in after our chat.`,
    }, { context: `followup-job:${eventId}` });

    await supabaseAdmin.from('user_events').update({
      follow_up_options: followUp, follow_up_generated_at: new Date().toISOString(),
    }).eq('id', eventId).eq('workspace_id', workspaceId);

    if (userCtx.fcm_token && userCtx.notification_preferences?.calendar_prep_ready !== false) {
      await notifyUser(userId, {
        title: '✉️ Follow-up drafts ready',
        body: `Three follow-up options are ready for "${event.title}".`,
        data: { type: 'follow_up_ready', event_id: eventId },
      }, userCtx.fcm_token).catch(err => logError('calendar_generate_followup_notify', err, { eventId }));
    }
    log('calendar_generate_followup DONE', { eventId });
  },

  // ── NEW: VOICE_MEMO_TRANSCRIBE ──────────────────────────────────────────
  async [BACKGROUND_JOB_TYPES.VOICE_MEMO_TRANSCRIBE](data) {
    const { memoId, workspaceId, userId } = data;
    logJob(BACKGROUND_JOB_TYPES.VOICE_MEMO_TRANSCRIBE, { memoId, workspaceId });
    await voiceMemoService.transcribeMemo({ memoId, workspaceId, userId });
    log('voice_memo_transcribe DONE', { memoId });
  },

  // ── NEW: VOICE_MEMO_ENRICH ───────────────────────────────────────────────
  async [BACKGROUND_JOB_TYPES.VOICE_MEMO_ENRICH](data) {
    const { memoId, workspaceId, userId } = data;
    logJob(BACKGROUND_JOB_TYPES.VOICE_MEMO_ENRICH, { memoId, workspaceId });
    await voiceMemoService.enrichMemo({ memoId, workspaceId, userId });
    log('voice_memo_enrich DONE', { memoId });
  },

  // ── NEW: PROSPECT_DEDUP_SCAN ─────────────────────────────────────────────
  async [BACKGROUND_JOB_TYPES.PROSPECT_DEDUP_SCAN](data) {
    const { workspaceId } = data;
    logJob(BACKGROUND_JOB_TYPES.PROSPECT_DEDUP_SCAN, { workspaceId });
    await runProspectDedupScanForWorkspace(workspaceId);
    log('prospect_dedup_scan DONE', { workspaceId });
  },

  // ── NEW: CHAT_SUMMARIZE (unchanged from prior revision) ─────────────────
  async [BACKGROUND_JOB_TYPES.CHAT_SUMMARIZE](data) {
    const { chatId, workspaceId, userId } = data;
    logJob(BACKGROUND_JOB_TYPES.CHAT_SUMMARIZE, { chatId, workspaceId });

    const { data: chat, error: chatError } = await supabaseAdmin
      .from('chats')
      .select('id, summary, last_summarized_message_count')
      .eq('id', chatId)
      .eq('workspace_id', workspaceId)
      .single();

    if (chatError || !chat) {
      log('chat_summarize skipped — chat not found', { chatId, workspaceId, error: chatError?.message });
      return;
    }

    const { data: allMsgs, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, seq')
      .eq('chat_id', chatId)
      .neq('role', 'system')
      .order('seq', { ascending: true });

    if (msgError) {
      logError('chat_summarize_fetch_messages', msgError, { chatId, workspaceId });
      return;
    }

    if (!allMsgs?.length) {
      log('chat_summarize skipped — no messages', { chatId });
      return;
    }

    const toSummarize = allMsgs.slice(0, Math.max(0, allMsgs.length - CHAT_HISTORY_WINDOW));
    if (toSummarize.length === 0) {
      log('chat_summarize skipped — nothing older than the live window yet', { chatId, totalMessages: allMsgs.length });
      return;
    }

    if (toSummarize.length <= (chat.last_summarized_message_count || 0)) {
      log('chat_summarize skipped — already summarized up to this point', {
        chatId, toSummarizeCount: toSummarize.length, alreadyDone: chat.last_summarized_message_count,
      });
      return;
    }

    const transcript = toSummarize
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n')
      .slice(0, 12000);

    const prompt = `Summarize the conversation so far into a compact briefing an AI sales-coaching assistant can use as its memory when continuing this conversation later. Preserve names, specific numbers, commitments, decisions, and anything the user would be annoyed to have to repeat. Be concise — under 300 words, plain prose, no headers or bullet lists.

${chat.summary ? `EXISTING SUMMARY (carry forward anything still relevant):\n${chat.summary}\n\n` : ''}NEW MESSAGES TO FOLD IN:\n${transcript}`;

    try {
      const { content: summary } = await callWithFallbackGroq({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, maxTokens: 400, tier: 'fast',
        workspaceId, userId, sourceJob: 'chat_summarize',
      });

      if (!summary?.trim()) {
        logError('chat_summarize', new Error('Empty summary returned'), { chatId, workspaceId });
        return;
      }

      const { error: updateError } = await supabaseAdmin.from('chats').update({
        summary:                        summary.trim(),
        last_summarized_message_count:  toSummarize.length,
        summary_updated_at:             new Date().toISOString(),
      }).eq('id', chatId).eq('workspace_id', workspaceId);

      if (updateError) {
        logError('chat_summarize_save', updateError, { chatId, workspaceId });
        return;
      }

      log('chat_summarize DONE', { chatId, foldedIn: toSummarize.length });
    } catch (err) {
      logError('chat_summarize', err, { chatId, workspaceId });
    }
  },

};

// ── Shared helper: recompute prospect health from source data ───────────
// (moved here from calendar.js — used only by the CALENDAR_UPDATE_PROSPECT_HEALTH
// handler now that the debrief route enqueues a job instead of calling this
// directly; logic is byte-for-byte unchanged from the prior implementation.)
async function updateProspectHealth(userId, workspaceId, prospectId) {
  const now = new Date();
  const [eventsRes, signalsRes, commitmentsRes] = await Promise.all([
    supabaseAdmin.from('user_events').select('outcome, energy_score, event_date')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId)
      .order('event_date', { ascending: false }).limit(10),
    supabaseAdmin.from('conversation_signals').select('signal_type, detected_at')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true),
    supabaseAdmin.from('conversation_commitments').select('owner, status, due_date')
      .eq('prospect_id', prospectId).eq('workspace_id', workspaceId).eq('user_id', userId),
  ]);

  let score = 50;
  const lastEvent = eventsRes.data?.[0];
  if (lastEvent) {
    const daysSince = (now - new Date(lastEvent.event_date)) / 86400000;
    if (daysSince < 3)       score += 20;
    else if (daysSince < 7)  score += 10;
    else if (daysSince >= 30) score -= 30;
    else if (daysSince >= 14) score -= 15;
    const outcomeBonus = { hot: 20, positive: 10, neutral: 0, cold: -10, dead: -30 };
    score += outcomeBonus[lastEvent.outcome] || 0;
  }
  const recentSignals = (signalsRes.data || []).filter(s => (now - new Date(s.detected_at)) / 86400000 < 14);
  score += recentSignals.filter(s => s.signal_type === 'buying').length * 8;
  score -= recentSignals.filter(s => s.signal_type === 'risk').length   * 10;
  const overdueCount = (commitmentsRes.data || []).filter(c => c.owner === 'founder' && c.status === 'overdue').length;
  score -= overdueCount * 12;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  log('prospect_health computed', {
    prospectId, workspaceId, finalScore,
    lastEventOutcome: lastEvent?.outcome ?? null,
    recentSignalCount: recentSignals.length,
    overdueCommitmentCount: overdueCount,
  });

  const { error: updateError } = await supabaseAdmin.from('prospects').update({
    relationship_health_score: finalScore,
    health_updated_at:         now.toISOString(),
    last_contact_at:           now.toISOString(),
  }).eq('id', prospectId).eq('workspace_id', workspaceId);

  if (updateError) {
    // Previously discarded entirely — a failed write here left the score
    // silently stale with nothing in the logs to explain why.
    logError('update_prospect_health/write', updateError, { prospectId, workspaceId, finalScore });
  }
}



export const startBackgroundWorker = () => {
  const worker = new Worker('background', async (job) => {
    const handler = handlers[job.name];

    if (!handler) {
      // NOTE ON BEHAVIOR: this still `return`s rather than `throw`s, matching
      // the prior implementation exactly — but that means BullMQ marks an
      // unrecognized job.name as *completed* (see worker.on('completed')
      // below) even though no handler ever ran. Tagged distinctly
      // ('dispatch/unknown_job') so this is easy to grep/alert on. Left
      // unchanged rather than switched to throw, since that would change
      // retry/failure behavior, which is outside the scope of a logging pass.
      logError('dispatch/unknown_job', new Error(`Unknown job: ${job.name}`), {
        jobId: job.id, jobName: job.name, dataKeys: Object.keys(job.data || {}),
      });
      return;
    }

    const startedAt = Date.now();
    log('job picked up', {
      jobName: job.name,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 1,
      ...pickIds(job.data),
    });

    try {
      await handler(job.data);
      log('job handler resolved', {
        jobName: job.name,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      // Logged here in addition to worker.on('failed') below because this is
      // the only place with the precise duration and in-flight attempt
      // number available synchronously at the throw site. Always rethrown —
      // never swallowed — so BullMQ's own retry/backoff and 'failed' event
      // continue to fire exactly as before.
      logError('job handler threw', err, {
        jobName: job.name,
        jobId: job.id,
        durationMs: Date.now() - startedAt,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts || 1,
        ...pickIds(job.data),
      });
      throw err;
    }
  }, { connection: bullmqConnection, concurrency: 5 });

  worker.on('completed', (job) => {
    const durationMs = (job.finishedOn && job.processedOn) ? job.finishedOn - job.processedOn : undefined;
    log(`job[${job.name}] completed`, {
      jobId: job.id,
      durationMs,
      attemptsMade: job.attemptsMade,
      ...pickIds(job.data),
    });
  });

  worker.on('failed', async (job, err) => {
    const maxAttempts = job?.opts?.attempts || 1;
    const willRetry    = job?.attemptsMade != null && job.attemptsMade < maxAttempts;

    logError(`job[${job?.name}]`, err, {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      maxAttempts,
      willRetry,
      ...pickIds(job?.data),
    });

    // IMPL-SENTRY-01: external visibility for job failures
    try {
      Sentry.captureException(err, { tags: { source: 'backgroundWorker', jobName: job?.name, jobId: job?.id } });
    } catch { /* Sentry itself must never be able to break a job */ }

    // Final-failure handling for prep generation: gives the frontend a real
    // failure branch instead of an infinite "Preparing..." pulse, and stops
    // the daily sweep from re-enqueueing a permanently-broken event forever
    // (see coreJobs.js's runCalendarPrepJob — it filters on prep_failed = false).
    // Condition left byte-for-byte identical to the prior implementation —
    // `willRetry` above is a separately-computed logging field only, not
    // wired into this decision, so this branch's behavior is unchanged.
    if (job?.name === BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE && job.attemptsMade >= (job.opts?.attempts || 1)) {
      const { eventId, workspaceId } = job.data;
      try {
        await supabaseAdmin
          .from('user_events')
          .update({
            prep_failed: true,
            prep_failed_at: new Date().toISOString(),
            prep_failure_reason: err.message?.slice(0, 500),
          })
          .eq('id', eventId)
          .eq('workspace_id', workspaceId);
        log('prep_failed status persisted', { eventId, workspaceId });
      } catch (updateError) {
        logError('prep_failed_status_update', updateError, { eventId, workspaceId });
      }
    }
  });

  worker.on('stalled', (jobId) => {
    // Lock expired mid-processing — usually a crashed worker process, an
    // overwhelmed event loop, or a handler that hung past the lock duration.
    // BullMQ only passes the raw jobId here, not the full job object.
    logError('job stalled', new Error('Job stalled'), { jobId });
  });

  worker.on('error', (err) => {
    // Worker-level errors not tied to any specific job — e.g. a dropped
    // Redis connection. There was previously no listener at all for this,
    // so these were only visible as an unhandled 'error' event.
    logError('worker_error', err, {});
  });

  log('Background worker started', { concurrency: 5 });
  return worker;
};