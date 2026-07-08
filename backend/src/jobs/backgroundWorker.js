// src/jobs/backgroundWorker.js — IMP-02
//
// FIXES APPLIED (refinement plan):
//  Issue 14: CALENDAR_PREP_GENERATE and CALENDAR_RESEARCH_PROSPECT handlers
//            added. Previously calendar.js called generateAndSaveEnrichedPrep
//            and researchProspectForMeeting as fire-and-forget inline calls —
//            no retry, no observability, silently lost on Groq errors.
//            These are now proper BullMQ jobs: retryable and visible in Bull Board.
//            The job constants are defined in BACKGROUND_JOB_TYPES (constants.js).
//            calendar.js enqueues them via backgroundQueue.add().
import { Worker }             from 'bullmq';
import { bullmqConnection }   from '../config/bullmq.js';
import { BACKGROUND_JOB_TYPES } from '../config/constants.js';
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
    const tip = JSON.parse(tc.replace(/```json|```/g, '').trim());
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
  // Re-fetches the event from DB (idempotent) then generates and saves enriched prep.
  // Previously this ran as a fire-and-forget in calendar.js POST / — any Groq failure
  // silently swallowed the error with .catch(()=>{}). Now retryable via BullMQ.
  // Job deduplication: calendar.js passes jobId: `prep:${event.id}` so a second
  // POST for the same event does not double-generate prep (BullMQ ignores duplicates).
  async [BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE](data) {
    const { userId, workspaceId, eventId, userCtx } = data;
    logJob(BACKGROUND_JOB_TYPES.CALENDAR_PREP_GENERATE, { userId, workspaceId, eventId });

    const { data: event } = await supabaseAdmin
      .from('user_events').select('*').eq('id', eventId).single();
    if (!event) {
      log('calendar_prep_generate skipped — event not found', { eventId });
      return;
    }

    // Rebuild prep context inline (buildPrepContext is a local helper in calendar.js;
    // duplicated here to avoid circular imports — calendar.js is a route file).
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
  // Re-fetches event then calls the Perplexity prospect research function.
  // Previously fire-and-forget with .catch(()=>{}) — now retryable.
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
