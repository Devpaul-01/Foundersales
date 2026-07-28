// ─────────────────────────────────────────────────────────────
// FOUNDERSALES — Complete Type System
// Maps 1:1 to OpenAPI v4.2.0 schemas + backend route responses.
// owner_user_id used (matches routes), not owner_id (Part 3 typo).
// stage used for Opportunity pipeline (matches routes/OpenAPI).
//
// CHAT AUDIT CHANGES:
//   - Chat: added growth_card_id (was already read/written by chat.js
//     but missing from this type — see migration_001), summary + 
//     summary_updated_at (rolling conversation summary, task #8), and
//     seq (stable ordering column used for chat-list pagination).
//   - ChatMessage: added citations (audit §5.6/§7.1 — web-search sources,
//     now persisted instead of discarded) and seq (stable keyset cursor
//     for message pagination, audit §4.1, replacing created_at-based
//     paging).
// ─────────────────────────────────────────────────────────────

// ── Primitive Enums ───────────────────────────────────────────
export type UserTier       = 'free' | 'pro' | 'enterprise';
export type WorkspaceRole  = 'owner' | 'admin' | 'manager' | 'member';
export type MemberStatus   = 'active' | 'pending_invite' | 'suspended' | 'removed';
export type UserRole       = 'founder' | 'sales' | 'freelancer' | 'marketer' | 'developer' | 'other';
export type Industry       = 'saas' | 'ecommerce' | 'services' | 'fintech' | 'health' | 'education' | 'other';
export type Archetype      = 'seller' | 'builder' | 'freelancer' | 'creator' | 'professional' | 'learner';
export type Platform       = 'reddit' | 'linkedin' | 'twitter' | 'facebook' | 'instagram' | 'producthunt' | 'indiehackers' | 'hackernews' | 'quora' | 'youtube' | 'other';

export type OpportunityStatus = 'pending' | 'viewed' | 'acted' | 'sent' | 'done';
export type PipelineStage     = 'new' | 'contacted' | 'replied' | 'call_demo' | 'closed_won' | 'closed_lost';

export type PracticeScenario  = 'interested' | 'polite_decline' | 'ghost' | 'skeptical' | 'price_objection' | 'not_right_time';
export type DifficultyLevel   = 'beginner' | 'standard' | 'advanced' | 'expert';
export type PressureModifier  = 'decision_maker_watching' | 'aggressive_buyer' | 'competitor_mentioned' | 'compliance_concern';
export type OpeningMood       = 'neutral' | 'skeptical' | 'curious' | 'defensive' | 'rushed';

export type DeliveryStatus = 'pending' | 'delivered' | 'seen' | 'replied' | 'ghosted' | 'failed';
export type ChatType       = 'general' | 'opportunity' | 'practice';
export type ChatMode       = 'general' | 'meeting_notes' | 'prep' | 'followup_coach';
export type MessageRole    = 'user' | 'assistant' | 'system';

export type FeedbackOutcome   = 'positive' | 'negative' | 'pending';
export type GoalStatus        = 'active' | 'completed' | 'paused';
export type GoalSentiment     = 'positive' | 'neutral' | 'negative';
export type ProspectStage     = 'prospect' | 'engaged' | 'negotiating' | 'closed_won' | 'closed_lost' | 'dormant';
export type MeetingOutcome    = 'hot' | 'positive' | 'neutral' | 'cold' | 'dead';
export type EventType         = 'meeting' | 'call' | 'demo' | 'followup' | 'other';
export type SignalType        = 'buying' | 'risk' | 'timing' | 'engagement';
export type CommitmentStatus  = 'pending' | 'done' | 'overdue' | 'ignored';
export type CommitmentOwner   = 'founder' | 'prospect';
export type GrowthCardType    = 'tip' | 'strategy' | 'resource' | 'reflection' | 'challenge' | 'community' | 'insight';
export type PatternType       = 'ghost_trigger' | 'success_signal' | 'weakness' | 'objection_type';
export type TrendStatus       = 'improving' | 'declining' | 'mixed_positive' | 'mixed_negative' | 'stable';

export type WorkspaceActivityEventType =
  | 'practice_completed' | 'deal_closed' | 'opportunity_created'
  | 'goal_reached' | 'member_joined' | 'opportunity_assigned' | 'nudge_sent';

export type CoachingFlag = 'no_outreach_7d' | 'no_practice_7d' | 'score_declining' | 'low_skill_score';

// ── Pagination ────────────────────────────────────────────────
export interface PaginationMeta {
  total:    number | null;
  limit:    number;
  offset:   number;
  has_more: boolean;
}

// ── Auth ──────────────────────────────────────────────────────
export type OpportunityOutreach = {
  opening_line: string;
  message_suggestion: string;
  follow_up_hook: string;
  tone: string;
  personalization_angle: string;
};

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LoginResponse extends SessionTokens {
  user: { id: string; email: string };
}

// ── User ──────────────────────────────────────────────────────
export interface NotificationPreferences {
  new_opportunities:    boolean;
  feedback_reminders:   boolean;
  practice_replies:     boolean;
  calendar_prep_ready:  boolean;
  daily_tip:            boolean;
  check_in_prompt:      boolean;
  debrief_reminder:     boolean;
  commitment_reminder:  boolean;
  weekly_insights:      boolean;
  weekly_plan:          boolean;
  pattern_insights:     boolean;
  skill_progression:    boolean;
  morning_growth_push:  boolean;
  evening_growth_push:  boolean;
}

export interface User {
  id:                      string;
  name:                    string | null;
  email:                   string;
  tier:                    UserTier;
  active_workspace_id:     string | null;
  onboarding_completed:    boolean;
  onboarding_step:         number;
  debug_mode:              boolean;
  fcm_token:               string | null;
  notification_preferences: NotificationPreferences;
  memory_enabled:          boolean;
  email_digest_enabled:    boolean;
  check_in_streak?:        number;
  last_check_in_at?:       string | null;
}

export interface UserMemoryFact {
  id:                   string;
  user_id:              string;
  workspace_id:         string;
  fact:                 string;
  fact_category:        string | null;
  reinforcement_count:  number;
  last_reinforced_at:   string | null;
  created_at:           string;
}

export interface UserNotification {
  id:         string;
  title:      string;
  body:       string;
  data:       Record<string, unknown> | null;
  is_read:    boolean;
  created_at: string;
}

// ── Workspace ─────────────────────────────────────────────────
export interface Workspace {
  id:             string;
  name:           string;
  slug:           string;
  plan:           'free' | 'pro' | 'enterprise';
  owner_user_id:  string;
  settings:       Record<string, unknown> | null;
  created_at:     string;
}

export interface WorkspaceWithMeta extends Workspace {
  role:       WorkspaceRole;
  joined_at:  string | null;
  is_active:  boolean;
  member_count?: number;
}

export interface WorkspaceMember {
  id:           string;
  user_id:      string;
  workspace_id: string;
  role:         WorkspaceRole;
  status:       MemberStatus;
  joined_at:    string | null;
  invite_email: string | null;
  invited_by:   string | null;
  created_at:   string;
  users?: {
    id:    string;
    name:  string | null;
    email: string;
  } | null;
}

export interface PendingInvite {
  id:                string;
  invite_email:      string;
  role:              WorkspaceRole;
  invite_expires_at: string;
  invited_by:        string;
  created_at:        string;
  is_expired:        boolean;
}

export interface ActiveMembership {
  role:      WorkspaceRole;
  status:    MemberStatus;
  joined_at: string | null;
}

export interface WorkspaceActivityEvent {
  id:         string;
  event_type: WorkspaceActivityEventType;
  metadata:   Record<string, unknown>;
  created_at: string;
  users?: {
    id:    string;
    name:  string | null;
    email: string;
  } | null;
}

// ── Voice Profile & Onboarding ────────────────────────────────
export interface VoiceProfile {
  unique_value_prop:           string;
  icp_trigger:                 string;
  target_customer_description: string;
  main_objection:              string;
  objection_reframe:           string;
  best_proof_point:            string;
  voice_style:                 string;
  outreach_persona:            string;
  avoid_phrases:               string[];
}

export interface WorkspaceProfile {
  id?:                   string;
  user_id?:              string;
  workspace_id?:         string;
  business_name:         string | null;
  product_description:   string | null;
  target_audience:       string | null;
  role:                  UserRole | null;
  industry:              Industry | null;
  experience_level:      string | null;
  business_stage:        string | null;
  preferred_platforms:   Platform[];
  primary_goal:          string | null;
  country:               string | null;
  state:                 string | null;
  website:               string | null;
  bio:                   string | null;
  voice_profile:         VoiceProfile | null;
  onboarding_completed:  boolean;
  onboarding_step:       number;
  archetype:             Archetype | null;
  archetype_detected_at: string | null;
}
// ============================================================
// ADDITIONS TO frontend/src/api/types.ts
//
// NOT a standalone file — merge into your existing types.ts. It's a
// ~700-line file covering far more than Calendar (practice, pipeline,
// growth, etc.); reproducing it whole here risks silently dropping
// something during copy-paste. These are the only real changes.
// ============================================================

// 1. REPLACE the existing MeetingPrep interface with this — matches the
//    canonical schema in backend/src/schemas/calendarAiSchemas.js exactly.
//    (Previously declared prospect_background/key_topics/open_commitments/
//    perplexity_research, none of which the AI service actually returns.)
export interface MeetingPrep {
  opening_line: string;
  talking_points: string[];
  key_question_to_ask: string;
  anticipate_objection: string;
  intelligence_brief: string;
  commitment_check: string | null;
  pre_outreach: string;
  follow_up_template: string;
  generated_at: string;
  model_tier: 'fast' | 'quality' | null;
}

// 2. REPLACE the existing MeetingDebrief interface with this — matches
//    generateMeetingDebrief's actual output shape.
//    (Previously declared action_items/key_insights/next_steps, none of
//    which the AI service returns — next_step_recommendation is a single
//    string, not an array to .map() over.)
export interface MeetingDebrief {
  summary: string;
  what_worked: string;
  what_to_improve: string;
  coachable_moment: string;
  next_step_recommendation: string;
  generated_at: string;
}

// 3. ADD — follow-up drafts (Doc 2 §4 / this pass's POST /:id/follow-up)
export interface FollowUpOptions {
  brief: string;
  substantive: string;
  re_engagement: string;
}

// 4. ADD — cursor pagination envelope, used by GET /api/calendar and
//    GET /api/calendar/search
export interface CursorPagination {
  next_cursor: string | null;
  has_more: boolean;
}

// 5. EXTEND the existing CalendarEvent interface — ADD these fields
//    (all additive; nothing existing is removed):
export interface CalendarEventAdditions {
  timezone: string | null;
  recurrence_rule: string | null;
  reschedule_count: number;
  prep_failed: boolean;
  prep_failed_at: string | null;
  prep_failure_reason: string | null;
  follow_up_options: FollowUpOptions | null;
  follow_up_generated_at: string | null;
  follow_up_variant_sent: 'brief' | 'substantive' | 're_engagement' | null;
  prospect_auto_created: boolean;
}
// Merge these fields directly into the existing CalendarEvent interface
// rather than using this as a separate type — it's split out here only
// for additions-file clarity.

// 6. ADD — event attendees (multi-attendee support)
export interface EventAttendee {
  id: string;
  event_id: string;
  workspace_id: string;
  prospect_id: string | null;
  name: string;
  email: string | null;
  role: 'organizer' | 'attendee' | 'optional';
  is_primary: boolean;
  created_at: string;
}

// 7. ADD — voice memos
export interface VoiceMemo {
  id: string;
  workspace_id: string;
  user_id: string;
  event_id: string;
  source: 'recorded' | 'uploaded';
  original_filename: string | null;
  mime_type: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  transcription_status: 'pending' | 'processing' | 'completed' | 'failed';
  transcription_error: string | null;
  transcript_text: string | null;
  ai_summary: MeetingDebrief | null;
  debrief_generated: boolean;
  created_at: string;
  transcribed_at: string | null;
  summarized_at: string | null;
  playback_url: string;
}

// 8. ADD — prospect merge candidates (dedup engine review queue)
export interface ProspectMergeCandidate {
  id: string;
  workspace_id: string;
  prospect_id_a: string;
  prospect_id_b: string;
  similarity_score: number | null;
  match_reason: 'name_similarity' | 'email_match' | 'linkedin_match';
  status: 'pending' | 'merged' | 'dismissed';
  created_at: string;
  prospect_a?: { id: string; name: string; company: string | null };
  prospect_b?: { id: string; name: string; company: string | null };
}

// ── Opportunities ─────────────────────────────────────────────
export interface Opportunity {
  id:                    string;
  user_id:               string;
  workspace_id:          string;
  platform:              Platform;
  source_url:            string | null;
  target_name:           string | null;
  target_context:        string;
  prepared_message:      string | null;
  composite_score:       number;
  fit_score:             number | null;
  timing_score:          number | null;
  intent_score:          number | null;
  status:                OpportunityStatus;
  stage:                 PipelineStage;
  assigned_to:           string | null;
  marked_sent_at:        string | null;
  last_stage_changed_at: string | null;
  follow_up_message:     string | null;
  follow_up_count:       number;
  lost_reason:           string | null;
  created_at:            string;
  updated_at?:           string;
  feedback?:             Feedback[];
}

export interface OpportunityIntel {
  pain_points:    string[];
  talking_points: string[];
  risks:          string[];
  confidence:     'low' | 'medium' | 'high';
}

// ── Pipeline ──────────────────────────────────────────────────
export interface PipelineMetrics {
  total_revenue:      number;
  pipeline_value:     number;
  win_rate_pct:       number;
  contacted_count:    number;
  replied_count:      number;
  call_demo_count:    number;
  closed_won_count:   number;
  closed_lost_count:  number;
}

export interface PipelineBoardOpportunity extends Opportunity {
  deal_value_usd?:      number | null;
  scheduled_call_date?: string | null;
}

export interface PipelineBoardResponse {
  pipeline: {
    contacted:   Opportunity[];
    replied:     Opportunity[];
    call_demo:   Opportunity[];
    closed_won:  Opportunity[];
    closed_lost: Opportunity[];
  };
  view:    'individual' | 'team';
  metrics: PipelineMetrics;
}

export interface DealDetailResponse {
  deal: Opportunity;
}

export interface CalendarPrompt {
  show:              boolean;
  suggested_title:   string;
  opportunity_id:    string;
  suggested_type:    string;
  message:           string;
}

// ── Feedback ──────────────────────────────────────────────────
export interface Feedback {
  id:                     string;
  user_id?:               string;
  workspace_id?:          string;
  opportunity_id?:        string;
  outcome:                FeedbackOutcome;
  outcome_note:           string | null;
  is_final?:              boolean;
  deal_value_usd:         number | null;
  scheduled_call:         boolean;
  scheduled_call_date:    string | null;
  scheduled_call_notes?:  string | null;
  created_at:             string;
  updated_at?:            string;
}

// ── Chat ──────────────────────────────────────────────────────
export interface Chat {
  id:              string;
  user_id:         string;
  workspace_id:    string;
  title:           string;
  chat_type:       ChatType;
  chat_mode:       ChatMode;
  is_archived:     boolean;
  opportunity_id:  string | null;
  prospect_id:     string | null;
  event_id:        string | null;
  growth_card_id?: string | null;
  message_count:   number;
  last_message_at: string | null;
  created_at:      string;
  updated_at?:     string;
  /** Rolling AI-generated summary of everything older than the live
   *  history window (chat audit task #8). Not present until a chat has
   *  run long enough to trigger background summarization. */
  summary?:               string | null;
  summary_updated_at?:    string | null;
  /** Stable monotonic ordering column, used as a pagination tiebreaker
   *  alongside last_message_at in the chat list (chat audit §6). */
  seq?:            number;
}

export interface ChatMessage {
  id:              string;
  chat_id:         string;
  workspace_id?:   string;
  user_id?:        string;
  role:            MessageRole;
  content:         string;
  delivery_status: DeliveryStatus | null;
  delivered_at?:   string | null;
  seen_at?:        string | null;
  scenario_type?:  string | null;
  chunk_index?:    number | null;
  is_final_chunk?: boolean | null;
  attachments?: { name: string; type: string; url?: string }[] | null;
  /** Sources returned by a web search that informed this reply (chat
   *  audit §5.6/§7.1) — previously computed by searchForChat and
   *  discarded; now persisted and rendered under the message. */
  citations?:      string[] | null;
  coaching_tip?:   Record<string, unknown> | null;
  created_at:      string;
  /** Stable monotonic ordering column — the pagination cursor for
   *  "load earlier messages" (chat audit §4.1). Always present on rows
   *  returned from the backend; optional here only so client-only
   *  optimistic messages (which don't have one yet) still type-check. */
  seq?:            number;
}

export interface FileAttachment {
  url:  string;
  type: string;
  name: string;
}

export interface FileUpload {
  id:          string;
  url:         string;
  filename:    string;
  type:        string;
  size_bytes:  number;
  chat_id:     string | null;
  created_at?: string;
}

// ── Practice ──────────────────────────────────────────────────
export interface BuyerProfile {
  name:          string;
  role:          string;
  company:       string;
  interest_score:  number;
  trust_score:     number;
  confusion_score: number;
  opening_mood:    OpeningMood;
}

export interface BuyerState {
  interest_score:  number;
  trust_score:     number;
  confusion_score: number;
  mood:            string;
  last_reasoning:  string;
}

export interface SkillScores {
  hook:            number;
  clarity:         number;
  value_prop:      number;
  personalization: number;
  cta:             number;
  tone:            number;
  session_score?:  number;
}

export interface SessionDebrief {
  what_worked:      string;
  what_didnt:       string;
  improvement:      string;
  coachable_moment: string;
  coaching_summary?: string;
}

export interface PracticeSession {
  id:                    string;
  user_id:               string;
  chat_id:               string;
  scenario_type:         PracticeScenario;
  practice_prompt:       string;
  difficulty_level:      DifficultyLevel;
  completed:             boolean;
  reply_received:        boolean;
  message_strength_score: number | null;
  session_goal:          string | null;
  drill_type:            string | null;
  pressure_modifier:     PressureModifier | null;
  buyer_profile:         BuyerProfile;
  buyer_state:           BuyerState;
  goal_achieved:         boolean | null;
  ai_ended_session:      boolean;
  conversation_outcome:  string | null;
  session_debrief:       SessionDebrief | null;
  skill_scores:          SkillScores | null;
  coaching_annotations:  Array<{ message_id: string; annotation: string }> | null;
  playbook:              string | null;
  retry_of_session_id:   string | null;
  rating:                number | null;
  completed_at:          string | null;
  created_at:            string;
}

export interface PracticeBadge {
  id:                string;
  badge_type:        string;
  badge_label:       string;
  badge_description: string;
  earned_at:         string;
}

export interface SkillProgression {
  week_start:           string;
  composite_score_avg:  number | null;
  composite_delta:      number | null;
  top_weakness:         string | null;
  top_strength:         string | null;
  hook_avg:             number | null;
  clarity_avg:          number | null;
  value_prop_avg:       number | null;
  personalization_avg:  number | null;
  cta_avg:              number | null;
  tone_avg:             number | null;
  messages_analyzed:    number;
  positive_outcome_rate: number | null;
}

// ── Goals ─────────────────────────────────────────────────────
export interface UserGoal {
  id:           string;
  user_id:      string;
  workspace_id: string;
  goal_text:    string;
  goal_type:    string | null;
  target_value: number | null;
  current_value: number;
  target_unit:  string | null;
  target_date:  string | null;
  status:       GoalStatus;
  completed_at: string | null;
  created_at:   string;
  updated_at?:  string;
}

export interface GoalNote {
  id:               string;
  goal_id:          string;
  user_id:          string;
  note_text:        string;
  ai_response:      string | null;
  progress_delta:   number | null;
  sentiment:        GoalSentiment;
  created_at:       string;
}

// ── Calendar ──────────────────────────────────────────────────


export interface MeetingDebrief {
  summary:     string;
  action_items: string[];
  key_insights: string[];
  next_steps:   string[];
}

export interface CalendarEvent {
  id:                   string;
  user_id:              string;
  workspace_id:         string;
  title:                string;
  event_date:           string;
  start_time:           string | null;
  end_time:             string | null;
  event_type:           EventType;
  notes:                string | null;
  outcome:              MeetingOutcome | null;
  energy_score:         number | null;
  attendee_name:        string | null;
  attendee_context:     string | null;
  opportunity_id:       string | null;
  prospect_id:          string | null;
  prep_generated:       boolean;
  prep_content:         MeetingPrep | null;
  prep_generated_at:    string | null;
  debrief_completed_at: string | null;
  debrief_content:      MeetingDebrief | null;
  meeting_notes:        string | null;
  perplexity_research:  Record<string, unknown> | null;
  debrief_needed?:      boolean;
  health_score?:        number | null;
  created_at:           string;
}

export interface ConversationCommitment {
  id:               string;
  user_id:          string;
  workspace_id:     string;
  prospect_id:      string | null;
  event_id:         string | null;
  commitment_text:  string;
  owner:            CommitmentOwner;
  status:           CommitmentStatus;
  due_date:         string | null;
  implicit_timing:  string | null;
  completed_at:     string | null;
  follow_up_message: string | null;
  created_at:       string;
  prospects?: { id: string; name: string; company?: string | null } | null;
  is_overdue?: boolean;
}

export interface ConversationSignal {
  id:           string;
  user_id:      string;
  workspace_id: string;
  prospect_id:  string | null;
  event_id:     string | null;
  signal_type:  SignalType;
  signal_text:  string;
  confidence:   number | null;
  is_active:    boolean;
  detected_at:  string;
}

// ── Prospects ─────────────────────────────────────────────────
export interface Prospect {
  id:                        string;
  user_id:                   string;
  workspace_id:              string;
  name:                      string;
  company:                   string | null;
  title:                     string | null;
  email:                     string | null;
  linkedin_url:              string | null;
  platform:                  Platform | null;
  notes:                     string | null;
  stage:                     ProspectStage;
  relationship_health_score: number | null;
  health_updated_at:         string | null;
  first_contact_at:          string | null;
  last_contact_at:           string | null;
  ai_summary:                string | null;
  ai_summary_updated_at:     string | null;
  created_at:                string;
  updated_at?:               string;
  pending_commitments?:      number;
}

export interface ProspectTimeline {
  type:        'event' | 'chat' | 'signal';
  id:          string;
  date:        string;
  title:       string;
  subtype?:    string;
  outcome?:    string | null;
  energy?:     number | null;
  has_debrief?: boolean;
  signal_type?: SignalType;
  signal_text?: string;
  message_count?: number;
}

// ── Growth ────────────────────────────────────────────────────
export interface GrowthCard {
  id:           string;
  user_id:      string;
  workspace_id: string;
  card_type:    GrowthCardType;
  title:        string;
  body:         string;
  action_label: string | null;
  action_type:  'internal_chat' | 'external_url' | 'internal_nav' | null;
  priority:     number;
  metadata:     {
    focus_area?:    string;
    daily_actions?: string[];
    difficulty?:    string;
    source_url?:    string;
  } | null;
  is_read:      boolean;
  is_dismissed: boolean;
  expires_at:   string | null;
  generated_by: string | null;
  created_at:   string;
}

export interface DailyCheckIn {
  id:           string;
  user_id:      string;
  workspace_id: string;
  date:         string;
  questions:    Array<{ id: string; question: string }>;
  answers:      Record<string, string> | null;
  mood_score:   number | null;
  ai_response:  string | null;
  processed_at: string | null;
  created_at:   string;
}

// ── Insights ──────────────────────────────────────────────────
export interface CommunicationPattern {
  id:                 string;
  user_id:            string;
  workspace_id:       string;
  pattern_label:      string;
  pattern_type:       PatternType;
  pattern_detail:     string | null;
  confidence_score:   number;
  affected_outcome:   string | null;
  sample_count:       number;
  first_detected_at:  string;
  last_detected_at:   string;
  is_active:          boolean;
  dismissed_at?:      string | null;
}

// ── Metrics ───────────────────────────────────────────────────
export interface MetricsDashboard {
  dashboard: {
    outreach_streak:    number;
    sent_count_30d:     number;
    positive_rate:      number;
    momentum_score:     number;
    momentum_breakdown: {
      activity:   number;
      conversion: number;
      pipeline:   number;
      goals:      number;
      practice?:  number;
    };
    momentum_insight: string;
    average_mood:     number | null;
  };
  pipeline:    PipelineMetrics;
  chart_data:  Array<{
    date:          string;
    sent:          number;
    discovered:    number;
    positive:      number;
    positive_rate: number;
  }>;
  goals:    UserGoal[];
  practice: { sessions_30d: number; sessions_7d: number };
  workspace_id: string;
}

// ── Followup ──────────────────────────────────────────────────
export interface Followup {
  id:           string;
  title:        string;
  note:         string | null;
  context_id:   string | null;
  context_type: 'opportunity' | 'prospect' | 'general';
  context_name: string | null;
  due_date:     string | null;
  urgency:      'overdue' | 'today' | 'upcoming' | 'someday';
  status:       'pending' | 'done' | 'snoozed';
  created_at:   string;
}

// ── Commitment ──────────────────────────────────────────────
export interface Commitment {
  id:              string;
  workspace_id:    string;
  user_id:         string;
  event_id:        string | null;
  event_title:     string | null;
  prospect_id:     string | null;
  prospect_name:   string | null;
  commitment_text: string;
  owner:           'me' | 'them';
  status:          'pending' | 'done' | 'overdue' | 'ignored';
  due_date:        string | null;
  completion_note: string | null;
  is_overdue:      boolean;
  created_at:      string;
}

// ── WorkspaceActivity ──────────────────────────────────────────
export interface WorkspaceActivity {
  id:           string;
  workspace_id: string;
  actor_id:     string;
  actor_name:   string | null;
  event_type:   string;
  description:  string;
  metadata:     Record<string, any>;
  created_at:   string;
}

// ── MemoryFact ─────────────────────────────────────────────────
export interface MemoryFact {
  id:         string;
  user_id:    string;
  content:    string;
  category:   string | null;
  source:     string | null;
  created_at: string;
}

// ── Goal ────────────────────────────────────────────────────────
export interface Goal {
  id:              string;
  workspace_id:    string;
  user_id:         string;
  title:           string;
  period:          'weekly' | 'monthly' | 'quarterly' | 'annual';
  metric_type:     'count' | 'revenue' | 'rate' | 'score' | 'other';
  target_value:    number;
  current_value:   number;
  status:          'active' | 'archived' | 'completed';
  check_in_streak: number;
  why:             string | null;
  created_at:      string;
  updated_at:      string;
}

// ── Workspace Analytics ───────────────────────────────────────
export interface WorkspaceAnalytics {
  totals: {
    sent:             number;
    positive_replies: number;
    response_rate:    number;
    demos_booked:     number;
  };
  members: Array<{
    user_id:       string;
    name:          string;
    role:          string;
    sent:          number;
    responses:     number;
    response_rate: number;
    demos:         number;
  }>;
}

// ── Intelligence & Chart ─────────────────────────────────────
export interface IntelligenceCard {
  type:         'win' | 'tip' | 'warning';
  title:        string;
  description:  string;
  action_label: string | null;
  action_url:   string | null;
}

export interface ChartDataPoint {
  date:      string;
  sent:      number;
  responses: number;
}

// ── Leaderboard ───────────────────────────────────────────────
export interface LeaderboardEntry {
  user_id:       string;
  name:          string;
  role:          string;
  sent_30d:      number;
  response_rate: number;
  closed_won:    number;
  total_revenue: number;
}

// ── Coaching Queue ────────────────────────────────────────────
export interface CoachingQueueEntry {
  user_id: string;
  name:    string;
  flags:   CoachingFlag[];
}

// ── Insight shapes ────────────────────────────────────────────
export interface InsightPattern {
  title:          string;
  description:    string;
  trend:          'up' | 'down' | 'flat';
  recommendation: string | null;
}

export interface WhyLosingData {
  reasons: { reason: string; count: number }[];
  total:   number;
  summary: string | null;
}

export interface SkillTrendData {
  labels: string[];
  series: { skill: string; data: (number | null)[] }[];
  deltas: { skill: string; delta: number }[];
}

// ── AppError (client-side) ────────────────────────────────────
export class AppError extends Error {
  constructor(
    message:        string,
    public code:    string,
    public status:  number,
    public details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
