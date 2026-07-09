// src/jobs/backgroundWorker.js — IMP-02
//
// FIXES APPLIED (refinement plan, kept from prior revision):
//  Issue 14: CALENDAR_PREP_GENERATE and CALENDAR_RESEARCH_PROSPECT handlers
//            added. Previously calendar.js called generateAndSaveEnrichedPrep
//            and researchProspectForMeeting as fire-and-forget inline calls —
//            no retry, no observability, silently lost on Groq errors.
//            These are now proper BullMQ jobs: retryable and visible in Bull Board.
//            The job constants are defined in BACKGROUND_JOB_TYPES (constants.js).
//            calendar.js enqueues them via backgroundQueue.add().
//
// NEW (chat audit §11 / task instruction #8):
//  CHAT_SUMMARIZE — rolling conversation summarization. Triggered by
//  chat.js's maybeEnqueueSummarization() once a chat accumulates
//  CHAT_SUMMARIZE_EVERY_N_MESSAGES new non-system messages since the last
//  summary run. Folds everything OLDER than the live history window
//  (CHAT_HISTORY_WINDOW, replayed verbatim on every turn — see chat.js)
//  into chats.summary, which buildSystemPromptForChat then prepends to the
//  system prompt. This keeps effective conversation memory extending
//  indefinitely without resending the entire raw transcript every turn.
//  Idempotent per chat/message-count via the jobId passed at enqueue time.
import { Worker }             from 'bullmq';
import { bullmqConnection }   from '../config/bullmq.js';
import { BACKGROUND_JOB_TYPES, CHAT_HISTORY_WINDOW } from '../config/constants.js';
import { createLogger }       from '../utils/logger.js';
import supabaseAdmin          from '../config/supabase.js';
import { callWithFallbackGroq } from '../services/multiProvider.js';
import groqService            from '../services/groq.js';
import { detectAndSaveArchetype } from './growthIntelligenceScheduler.js';
import { processUserOpportunities as runOpportunitiesRefreshForUser } from './coreJobs.js';

// Issue 14: imports for calendar prep/research handlers
import { generateEnrichedEventPrep } from '../services/groqCalendarIntelligence.js';
import { researchProspectForMeeting } from '../services/exaCalendar.js';

const { log, logError, logJob } = createLogger('BackgroundWorker');

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
    if (todayCards > 0) return;
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

  // Issue 14: CALENDAR_PREP_GENERATE handler
  async [BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE](data) {
    const { userId, workspaceId, eventId, userCtx } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin
      .from('user_events').select('*').eq('id', eventId).single();
    if (!event) {
      log('calendar_prep_generate skipped — event not found', { eventId });
      return;
    }

    const context = {};
    if (event.prospect_id) {
      const [eventsRes, signalsRes, commitmentsRes] = await Promise.all([
        supabaseAdmin.from('user_events')
          .select('title, event_type, outcome, event_date, debrief_content')
          .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
          .neq('id', eventId).order('event_date', { ascending: false }).limit(5),
        supabaseAdmin.from('conversation_signals')
          .select('signal_type, signal_text, detected_at')
          .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
          .eq('is_active', true).order('detected_at', { ascending: false }).limit(10),
        supabaseAdmin.from('conversation_commitments')
          .select('commitment_text, owner, status, due_date')
          .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
          .in('status', ['pending', 'overdue']).eq('owner', 'founder'),
      ]);
      if (eventsRes.data?.length) {
        context.prospectTimeline = eventsRes.data
          .map(e => `${e.event_date}: ${e.event_type} — ${e.outcome || 'no debrief'}. ${e.debrief_content?.summary || ''}`)
          .join('\n');
      }
      context.previousSignals        = signalsRes.data    || [];
      context.outstandingCommitments = commitmentsRes.data || [];
    }
    if (event.perplexity_research) context.perplexityResearch = event.perplexity_research;

    const prep = await generateEnrichedEventPrep(userCtx, event, context);
    await supabaseAdmin.from('user_events').update({
      prep_content:      prep,
      prep_generated:    true,
      prep_generated_at: new Date().toISOString(),
    }).eq('id', eventId).eq('workspace_id', workspaceId);

    log('calendar_prep_generate DONE', { userId, workspaceId, eventId });
  },

  // Issue 14: CALENDAR_RESEARCH_PROSPECT handler
  async [BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT](data) {
    const { userId, workspaceId, eventId, userCtx } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_RESEARCH_PROSPECT, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin
      .from('user_events').select('*').eq('id', eventId).single();
    if (!event) {
      log('calendar_research_prospect skipped — event not found', { eventId });
      return;
    }

    await researchProspectForMeeting(userId, workspaceId, eventId, event, userCtx);
    log('calendar_research_prospect DONE', { userId, workspaceId, eventId });
  },

  // ── NEW: CHAT_SUMMARIZE ─────────────────────────────────────
  // Folds everything older than the live CHAT_HISTORY_WINDOW into a
  // rolling chats.summary field. Re-fetches all non-system messages for
  // the chat (ordered by the stable `seq` column, not created_at — see
  // migration_001), keeps the newest CHAT_HISTORY_WINDOW as "live" and
  // summarizes only what falls before that boundary, merging with any
  // existing summary so nothing already condensed is lost.
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

    // Only summarize what's genuinely new since the last run — if a
    // duplicate/late job fires for a chat that's already been summarized
    // up to this point, this keeps it a safe no-op.
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

export const startBackgroundWorker = () => {
  const worker = new Worker('background', async (job) => {
    const handler = handlers[job.name];
    if (!handler) { logError('dispatch', new Error(`Unknown job: ${job.name}`)); return; }
    await handler(job.data);
  }, { connection: bullmqConnection, concurrency: 5 });

  worker.on('failed', (job, err) => logError(`job[${job?.name}]`, err, { jobId: job?.id }));
  log('Background worker started', { concurrency: 5 });
  return worker;
};
