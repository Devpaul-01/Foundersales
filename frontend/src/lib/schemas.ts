// ============================================================
// FILE: src/lib/schemas.ts
// All Zod validation schemas — one source of truth for forms.
// ============================================================
import { z } from 'zod';

// ── Auth ─────────────────────────────────────────────────────
export const loginSchema = z.object({
  email:    z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginSchema = z.infer<typeof loginSchema>;
export const rescheduleEventSchema = z.object({
  event_date: z.string().min(1, 'Date is required'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time').optional().nullable().or(z.literal('')),
  end_time:   z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time').optional().nullable().or(z.literal('')),
});
export type RescheduleEventSchema = z.infer<typeof rescheduleEventSchema>;


export const registerSchema = z.object({
  name:     z.string().max(100).optional(),
  email:    z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string()
    .min(8,  'Password must be at least 8 characters')
    .max(128,'Password must be under 128 characters'),
});
export type RegisterSchema = z.infer<typeof registerSchema>;

// ── Onboarding ───────────────────────────────────────────────
export const onboardingBasicSchema = z.object({
  name:                z.string().min(1, 'Your name is required').max(100),
  business_name:       z.string().max(200).optional(),
  product_description: z.string().max(2000).optional(),
  target_audience:     z.string().max(1000).optional(),
  role:                z.enum(['founder','sales','freelancer','marketer','developer','other']).optional(),
  industry:            z.enum(['saas','ecommerce','services','fintech','health','education','other']).optional(),
  experience_level:    z.string().max(50).optional(),
  business_stage:      z.string().max(50).optional(),
  preferred_platforms: z.array(z.string()).max(10).optional(),
  primary_goal:        z.string().max(200).optional(),
  country:             z.string().max(100).optional(),
  state:               z.string().max(100).optional(),
  website:             z.string().url('Enter a valid URL').max(500).optional().or(z.literal('')),
  bio:                 z.string().max(2000).optional(),
});
export type OnboardingBasicSchema = z.infer<typeof onboardingBasicSchema>;

export const onboardingAnswersSchema = z.object({
  answers: z.record(z.string().min(1, 'Please answer this question')),
  burst:   z.number().int().min(1).max(5),
});
export type OnboardingAnswersSchema = z.infer<typeof onboardingAnswersSchema>;

// ── Profile / Settings ───────────────────────────────────────
export const updateProfileSchema = z.object({
  name:                z.string().max(100).optional(),
  business_name:       z.string().max(200).optional(),
  product_description: z.string().max(2000).optional(),
  target_audience:     z.string().max(1000).optional(),
  website:             z.string().url().optional().or(z.literal('')),
  role:                z.enum(['founder','sales','freelancer','marketer','developer','other']).optional(),
  industry:            z.enum(['saas','ecommerce','services','fintech','health','education','other']).optional(),
  experience_level:    z.string().max(50).optional(),
  bio:                 z.string().max(2000).optional(),
  preferred_platforms: z.array(z.string()).max(10).optional(),
});
export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;

export const voiceProfileSchema = z.object({
  unique_value_prop:           z.string().min(1,'Required'),
  icp_trigger:                 z.string().min(1,'Required'),
  target_customer_description: z.string().min(1,'Required'),
  main_objection:              z.string().min(1,'Required'),
  objection_reframe:           z.string().min(1,'Required'),
  best_proof_point:            z.string().min(1,'Required'),
  voice_style:                 z.string().min(1,'Required'),
  outreach_persona:            z.string().min(1,'Required'),
  avoid_phrases:               z.array(z.string()),
});
export type VoiceProfileSchema = z.infer<typeof voiceProfileSchema>;

// ── Workspace ────────────────────────────────────────────────
export const createWorkspaceSchema = z.object({
  name: z.string().min(1,'Workspace name is required').max(100),
});
export type CreateWorkspaceSchema = z.infer<typeof createWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role:  z.enum(['admin','manager','member'], { errorMap: () => ({ message: 'Select a role' }) }),
});
export type InviteMemberSchema = z.infer<typeof inviteMemberSchema>;

export const nudgeMemberSchema = z.object({
  message: z.string().min(1,'Message is required').max(500),
});
export type NudgeMemberSchema = z.infer<typeof nudgeMemberSchema>;

export const updateRoleSchema = z.object({
  role: z.enum(['admin','manager','member']),
});

// ── Goals ────────────────────────────────────────────────────
export const createGoalSchema = z.object({
  goal_text:    z.string().min(1,'Goal text is required').max(500),
  goal_type:    z.string().optional(),
  target_value: z.number().positive('Must be positive').optional().nullable(),
  target_unit:  z.string().max(50).optional().nullable(),
  target_date:  z.string().optional().nullable(),
});
export type CreateGoalSchema = z.infer<typeof createGoalSchema>;

export const goalNoteSchema = z.object({
  note_text:      z.string().min(1,'Note is required').max(2000),
  explicit_delta: z.number().optional().nullable(),
});
export type GoalNoteSchema = z.infer<typeof goalNoteSchema>;

// ── Feedback ─────────────────────────────────────────────────

export const feedbackSchema = z.object({

  outcome: z.enum(['positive', 'negative', 'pending'], {
    errorMap: () => ({ message: 'Select an outcome' }),
  }),

  outcome_note: z
    .string()
    .max(500, 'Note must be 500 characters or fewer')
    .transform((s) => s?.trim() || null)
    .optional()
    .nullable(),

  is_final: z.boolean().default(true),

  // valueAsNumber returns NaN for empty inputs — preprocess coerces that to null
  // so Zod sees null instead of an invalid number type error.
  deal_value_usd: z.preprocess(
    (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v)),
    z
      .number()
      .int('Enter a whole number')
      .min(0, 'Must be 0 or more')
      .nullable()
      .optional(),
  ),

  scheduled_call: z.boolean().default(false),

  // datetime-local inputs produce "YYYY-MM-DDTHH:mm" (no seconds, no timezone).
  // Zod's .datetime() requires full ISO 8601, so we validate the shape with a
  // regex instead and let the backend store it as-is.
  scheduled_call_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Enter a valid date and time')
    .optional()
    .nullable(),

  scheduled_call_notes: z
    .string()
    .max(500, 'Notes must be 500 characters or fewer')
    .transform((s) => s?.trim() || null)
    .optional()
    .nullable(),

}).refine(
  (d) => !d.scheduled_call || !!d.scheduled_call_date,
  { message: 'Select a date and time for the call', path: ['scheduled_call_date'] },
);

export type FeedbackSchema = z.infer<typeof feedbackSchema>;





export const createCalendarEventSchema = z.object({
  title:            z.string().min(1,'Title is required').max(200),
  event_date:        z.string().min(1,'Date is required'),
  start_time:       z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time').optional().nullable().or(z.literal('')),
  end_time:         z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time').optional().nullable().or(z.literal('')),
  event_type:       z.enum(['meeting','call','demo','followup','other']).default('meeting'),
  notes:            z.string().max(2000).optional().nullable(),
  attendee_name:    z.string().max(200).optional().nullable(),
  attendee_context: z.string().max(2000).optional().nullable(),
  opportunity_id:   z.string().uuid().optional().nullable(),
  prospect_id:      z.string().uuid().optional().nullable(),
  create_prospect:  z.boolean().optional(), // explicit opt-in/out, see api/calendar.ts
});
export type CreateCalendarEventSchema = z.infer<typeof createCalendarEventSchema>;


export const debriefSchema = z.object({
  outcome:   z.enum(['hot','positive','neutral','cold','dead'], {
    errorMap: () => ({ message: 'Select a meeting outcome' }),
  }),
  raw_notes: z.string().max(5000).optional().nullable(),
});
export type DebriefSchema = z.infer<typeof debriefSchema>;


// ── Prospects ────────────────────────────────────────────────
export const createProspectSchema = z.object({
  name:         z.string().min(1,'Name is required').max(200),
  company:      z.string().max(200).optional().nullable(),
  title:        z.string().max(200).optional().nullable(),
  email:        z.string().email().optional().nullable().or(z.literal('')),
  linkedin_url: z.string().url().optional().nullable().or(z.literal('')),
  platform:     z.string().max(50).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  stage:        z.enum(['prospect','engaged','negotiating','closed_won','closed_lost','dormant']).default('prospect'),
});
export type CreateProspectSchema = z.infer<typeof createProspectSchema>;

export const updateProspectSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  company:      z.string().max(200).optional().nullable(),
  title:        z.string().max(200).optional().nullable(),
  email:        z.string().email().optional().nullable().or(z.literal('')),
  linkedin_url: z.string().url().optional().nullable().or(z.literal('')),
  platform:     z.string().max(50).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  status:       z.enum(['active', 'stale', 'converted', 'lost']).optional(),
  stage:        z.enum(['prospect','engaged','negotiating','closed_won','closed_lost','dormant']).optional(),
}).strict();
export type UpdateProspectSchema = z.infer<typeof updateProspectSchema>;

// ── Practice ─────────────────────────────────────────────────
export const practiceSetupSchema = z.object({
  scenario_type:     z.enum(['interested','polite_decline','ghost','skeptical','price_objection','not_right_time']).optional(),
  session_goal:      z.string().max(200).optional(),
  pressure_modifier: z.enum(['decision_maker_watching','aggressive_buyer','competitor_mentioned','compliance_concern']).optional(),
  drill_type:        z.string().optional().nullable(),
  bio_note:          z.string().max(500).optional(),
});
export type PracticeSetupSchema = z.infer<typeof practiceSetupSchema>;

// ── Check-In ─────────────────────────────────────────────────
export const checkInSchema = z.object({
  answers:    z.record(z.string().min(1,'Please answer all questions')),
  mood_score: z.number().int().min(1).max(10).optional().nullable(),
  date:       z.string().optional(),
});
export type CheckInSchema = z.infer<typeof checkInSchema>;

// ── Chat ─────────────────────────────────────────────────────
export const sendMessageSchema = z.object({
  message:      z.string().min(1,'Message cannot be empty').max(5000,'Max 5000 characters'),
  force_search: z.boolean().default(false),
});
export type SendMessageSchema = z.infer<typeof sendMessageSchema>;

// ── Goal check-in ─────────────────────────────────────────────
export const goalCheckInSchema = z.object({
  value: z.number({ required_error: 'Current value is required' }),
  note:  z.string().max(500).optional(),
});
export type GoalCheckInSchema = z.infer<typeof goalCheckInSchema>;

// ── Weekly growth check-in ────────────────────────────────────
export const growthCheckInSchema = z.object({
  wins:       z.string().min(1, 'Required').max(1000),
  challenges: z.string().min(1, 'Required').max(1000),
  focus:      z.string().max(500).optional(),
});
export type GrowthCheckInSchema = z.infer<typeof growthCheckInSchema>;
