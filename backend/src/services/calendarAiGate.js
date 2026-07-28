// src/services/calendarAiGate.js
// ============================================================
// AI COST-OPTIMIZATION GATE
//
// Every AI-triggering code path in the Calendar feature routes through
// this module BEFORE spending a Groq or Exa call. This is the single
// rule-engine for "is this call worth making" and "can we reuse something
// we already have instead."
//
// Every gate decision is logged to calendar_ai_events (migration 015) so
// cost-reduction impact is queryable, not just asserted.
// ============================================================

import supabaseAdmin from '../config/supabase.js';
import { checkWorkspaceExaUsage } from './tokenTracker.js';

const RESEARCH_COOLDOWN_DAYS = 14;
const LOW_STAKES_EVENT_TYPES = ['other'];

const logGateDecision = async ({ workspaceId, userId, eventId, aiFunction, decision, reason, modelTier }) => {
  try {
    await supabaseAdmin.from('calendar_ai_events').insert({
      workspace_id: workspaceId,
      user_id: userId || null,
      event_id: eventId || null,
      ai_function: aiFunction,
      gate_decision: decision,
      gate_reason: reason,
      model_tier: modelTier || null,
    });
  } catch (err) {
    // Audit logging must never block the actual AI flow.
    console.warn('[calendarAiGate] failed to log gate decision (non-fatal):', err.message);
  }
};

/**
 * Decides whether prep generation is worth a Groq call, and which tier.
 */
export function shouldGeneratePrep(event, userCtx) {
  const hasAttendeeContext = !!(event.attendee_name?.trim() || event.attendee_context?.trim());
  if (!hasAttendeeContext) {
    return { proceed: false, reason: 'no_attendee_context', tier: null };
  }

  if (LOW_STAKES_EVENT_TYPES.includes(event.event_type) && !event.opportunity_id) {
    return { proceed: false, reason: 'low_stakes_event_type', tier: null };
  }

  const tiedToOpportunity = !!event.opportunity_id;
  const tier = tiedToOpportunity || event.event_type === 'demo' ? 'quality' : 'fast';

  return { proceed: true, reason: 'ok', tier };
}

/**
 * Non-AI placeholder prep for events the gate skips — still flips
 * prep_generated so the UI doesn't show an infinite loading state.
 */
export function buildTrivialEventPrep(event) {
  return {
    opening_line: `No specific prep was generated for "${event.title}" — no attendee context was provided.`,
    talking_points: [],
    key_question_to_ask: '',
    anticipate_objection: '',
    intelligence_brief: '',
    commitment_check: null,
    pre_outreach: '',
    follow_up_template: '',
    generated_at: new Date().toISOString(),
    model_tier: null,
  };
}

/**
 * Decides whether research is worth an Exa call, including cooldown-based
 * reuse of recent research for the same prospect across different events.
 */
export async function shouldRunResearch(event, userCtx, workspaceId) {
  if (!event.attendee_name?.trim() && !event.attendee_context?.trim()) {
    return { proceed: false, reason: 'no_attendee_context' };
  }
  if (event.research_generated_at) {
    return { proceed: false, reason: 'already_researched' };
  }

  if (event.prospect_id) {
    const { data: recentResearch } = await supabaseAdmin
      .from('user_events')
      .select('perplexity_research, research_generated_at')
      .eq('prospect_id', event.prospect_id)
      .eq('workspace_id', workspaceId)
      .not('research_generated_at', 'is', null)
      .order('research_generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentResearch?.research_generated_at) {
      const daysSince = (Date.now() - new Date(recentResearch.research_generated_at)) / 86400000;
      if (daysSince < RESEARCH_COOLDOWN_DAYS) {
        return { proceed: false, reason: 'reused_recent_research', reuse: recentResearch.perplexity_research };
      }
    }
  }

  const usageCheck = await checkWorkspaceExaUsage(workspaceId, userCtx.tier || 'free');
  if (!usageCheck.allowed) {
    return { proceed: false, reason: usageCheck.reason };
  }

  // Quota-aware degradation signal: caller can use this to force a
  // Groq-only prep (skip research enrichment) rather than consuming the
  // last available credits on a single meeting.
  const nearLimit = usageCheck.limit > 0 && usageCheck.used / usageCheck.limit >= 0.9;

  return { proceed: true, reason: 'ok', nearLimit };
}

/**
 * Length-threshold gate for commitment/signal extraction — centralizes
 * a check that previously existed ad hoc, independently, in two places.
 */
export function shouldExtractCommitmentsSignals(rawNotes) {
  const trimmed = rawNotes?.trim() || '';
  if (trimmed.length < 20) return { proceed: false, reason: 'too_short' };
  return { proceed: true, reason: 'ok' };
}

/**
 * Skip follow-up generation for meetings with nothing to follow up on.
 */
export function shouldGenerateFollowUp(event) {
  if (event.outcome === 'dead' && !event.debrief_content?.next_step_recommendation) {
    return { proceed: false, reason: 'dead_outcome_no_next_step' };
  }
  return { proceed: true, reason: 'ok' };
}

/**
 * Wraps any of the above gate checks with audit logging. Call sites pass
 * the already-computed gate result through this to record it, rather than
 * duplicating the logGateDecision call at every site.
 */
export async function recordGateDecision({ workspaceId, userId, eventId, aiFunction, gateResult }) {
  await logGateDecision({
    workspaceId,
    userId,
    eventId,
    aiFunction,
    decision: gateResult.proceed ? 'proceed' : (gateResult.reason?.startsWith('reused') ? 'reused_cache' : 'skipped'),
    reason: gateResult.reason,
    modelTier: gateResult.tier,
  });
}

export default {
  shouldGeneratePrep,
  buildTrivialEventPrep,
  shouldRunResearch,
  shouldExtractCommitmentsSignals,
  shouldGenerateFollowUp,
  recordGateDecision,
};
