// src/schemas/calendarAiSchemas.js
// ============================================================
// CANONICAL AI OUTPUT SCHEMAS — single source of truth for prep_content
// and debrief_content shapes.
//
// This resolves the three-way mismatch that previously existed between:
//   - what generateEnrichedEventPrep / generateMeetingDebrief actually
//     returned,
//   - what the frontend rendered,
//   - what types.ts declared.
//
// The decision: keep the RICHER AI-generated shape (strictly more useful)
// and make the frontend + types conform to it, rather than the reverse.
//
// Frontend TypeScript types should be hand-mirrored from these shapes
// (see frontend/src/lib/schemas.ts's MeetingPrep/MeetingDebrief comment
// block) since this is a JS backend without a shared-types build step.
// ============================================================

import { z } from 'zod';

export const MeetingPrepSchema = z.object({
  opening_line: z.string(),
  talking_points: z.array(z.string()),
  key_question_to_ask: z.string(),
  anticipate_objection: z.string(),
  intelligence_brief: z.string(),
  commitment_check: z.string().nullable(),
  pre_outreach: z.string(),
  follow_up_template: z.string(),
});

// Provenance fields added by the persistence layer (calendarPrep.js),
// not by the model itself — kept separate so the AI-facing schema above
// stays exactly what we validate the raw model output against.
export const PersistedMeetingPrepSchema = MeetingPrepSchema.extend({
  generated_at: z.string(),
  model_tier: z.enum(['fast', 'quality']).nullable(),
});

export const MeetingDebriefSchema = z.object({
  summary: z.string(),
  what_worked: z.string(),
  what_to_improve: z.string(),
  coachable_moment: z.string(),
  next_step_recommendation: z.string(),
});

export const PersistedMeetingDebriefSchema = MeetingDebriefSchema.extend({
  generated_at: z.string(),
});

export const FollowUpOptionsSchema = z.object({
  brief: z.string(),
  substantive: z.string(),
  re_engagement: z.string(),
});

/**
 * Validates a raw model response against a schema; returns the fallback
 * object (with provenance stamped) on any validation failure, and logs the
 * raw output so prompt drift is observable rather than silently swallowed.
 */
export const validateOrFallback = (schema, raw, fallback, { context = 'unknown' } = {}) => {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  console.warn(`[calendarAiSchemas] Validation failed for ${context} — falling back to default. Raw output:`, JSON.stringify(raw)?.slice(0, 500));
  return fallback;
};

export default {
  MeetingPrepSchema,
  PersistedMeetingPrepSchema,
  MeetingDebriefSchema,
  PersistedMeetingDebriefSchema,
  FollowUpOptionsSchema,
  validateOrFallback,
};
