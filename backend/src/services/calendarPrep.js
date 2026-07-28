// src/services/calendarPrep.js
// ============================================================
// SHARED PREP-GENERATION SERVICE
//
// Single source of truth for buildPrepContext + "generate and persist prep."
// Previously this logic existed independently in THREE places:
//   1. calendar.js's buildPrepContext (used by POST /:id/prep)
//   2. backgroundWorker.js's CALENDAR_PREP_GENERATE handler (re-implemented
//      the same context-building inline)
//   3. calendar.js's generateAndSaveEnrichedPrep helper (dead code — never
//      actually called by the worker despite the comment claiming it was)
//
// All three converge on this module now. runCalendarPrepJob (coreJobs.js)
// no longer generates prep directly at all — it only enqueues the same
// CALENDAR_PREP_GENERATE job that the on-creation path uses, closing the
// duplicate-execution problem (see jobs/backgroundWorker.js for the full
// idempotency + notification consolidation).
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { generateEnrichedEventPrep } from './groqCalendarIntelligence.js';
import { MeetingPrepSchema, validateOrFallback } from '../schemas/calendarAiSchemas.js';
import { shouldGeneratePrep, buildTrivialEventPrep, recordGateDecision } from './calendarAiGate.js';
import { createLogger } from '../utils/logger.js';

const { logError } = createLogger('CalendarPrep');

const FALLBACK_PREP = {
  opening_line: 'Review the attendee context before joining — no AI prep could be generated this time.',
  talking_points: [],
  key_question_to_ask: 'What would need to be true for this to be worth a follow-up?',
  anticipate_objection: '',
  intelligence_brief: '',
  commitment_check: null,
  pre_outreach: '',
  follow_up_template: '',
};

/**
 * Builds the full context object passed into generateEnrichedEventPrep:
 * prospect timeline, prior signals, outstanding commitments, live research,
 * linked opportunity stake, and the founder's own learned patterns.
 */
export async function buildPrepContext(userId, workspaceId, event) {
  const context = {};

  if (event.prospect_id) {
    const [eventsRes, signalsRes, commitmentsRes, prospectRes] = await Promise.all([
      supabaseAdmin.from('user_events')
        .select('title, event_type, outcome, event_date, debrief_content')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .neq('id', event.id).order('event_date', { ascending: false }).limit(5),
      supabaseAdmin.from('conversation_signals')
        .select('signal_type, signal_text, detected_at')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .eq('is_active', true).order('detected_at', { ascending: false }).limit(10),
      supabaseAdmin.from('conversation_commitments')
        .select('commitment_text, owner, status, due_date')
        .eq('prospect_id', event.prospect_id).eq('workspace_id', workspaceId).eq('user_id', userId)
        .in('status', ['pending', 'overdue']).eq('owner', 'founder'),
      supabaseAdmin.from('prospects')
        .select('relationship_health_score, health_updated_at')
        .eq('id', event.prospect_id).eq('workspace_id', workspaceId).maybeSingle(),
    ]);

    if (eventsRes.data?.length) {
      context.prospectTimeline = eventsRes.data
        .map(e => `${e.event_date}: ${e.event_type} — ${e.outcome || 'no debrief'}. ${e.debrief_content?.summary || ''}`)
        .join('\n');
    }
    context.previousSignals = signalsRes.data || [];
    context.outstandingCommitments = commitmentsRes.data || [];
    if (prospectRes.data) {
      context.healthTrend = {
        current: prospectRes.data.relationship_health_score,
        updatedAt: prospectRes.data.health_updated_at,
      };
    }
  }

  if (event.perplexity_research) context.perplexityResearch = event.perplexity_research;

  if (event.opportunity_id) {
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('stage, composite_score, feedback(deal_value_usd)')
      .eq('id', event.opportunity_id).eq('workspace_id', workspaceId).maybeSingle();
    if (opp) {
      context.opportunity = {
        stage: opp.stage,
        composite_score: opp.composite_score,
        deal_value_usd: Array.isArray(opp.feedback) ? opp.feedback[0]?.deal_value_usd : opp.feedback?.deal_value_usd,
      };
    }
  }

  return context;
}

/**
 * Generates prep via the AI cost gate, validates the model output against
 * the canonical schema, persists it, and clears any prior failure flag.
 * Returns the persisted prep_content (real or gated-skip placeholder).
 */
export async function generateAndPersistPrep(userCtx, event, workspaceId) {
  const gate = shouldGeneratePrep(event, userCtx);
  await recordGateDecision({
    workspaceId, userId: userCtx.id, eventId: event.id, aiFunction: 'prep', gateResult: gate,
  });

  if (!gate.proceed) {
    const trivialPrep = buildTrivialEventPrep(event);
    await supabaseAdmin.from('user_events').update({
      prep_content: trivialPrep,
      prep_generated: true,
      prep_generated_at: new Date().toISOString(),
      prep_failed: false,
    }).eq('id', event.id).eq('workspace_id', workspaceId);
    return trivialPrep;
  }

  const context = await buildPrepContext(userCtx.id, workspaceId, event);
  const rawPrep = await generateEnrichedEventPrep(userCtx, event, context);
  const validated = validateOrFallback(MeetingPrepSchema, rawPrep, FALLBACK_PREP, { context: `prep:${event.id}` });

  const toStore = { ...validated, generated_at: new Date().toISOString(), model_tier: gate.tier };

  const { error } = await supabaseAdmin.from('user_events').update({
    prep_content: toStore,
    prep_generated: true,
    prep_generated_at: new Date().toISOString(),
    prep_failed: false,
    prep_failure_reason: null,
  }).eq('id', event.id).eq('workspace_id', workspaceId);

  if (error) {
    logError('generateAndPersistPrep persist', error, { eventId: event.id });
    throw error;
  }

  return toStore;
}

export default { buildPrepContext, generateAndPersistPrep };
