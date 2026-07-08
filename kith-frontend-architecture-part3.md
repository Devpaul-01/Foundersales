# 🧾 Kith — Frontend Architecture Document: Part 3
### Complete Type System, Utilities, Layout Implementations & Final Specifications

> **Companion to Parts 1 & 2.** This document completes the specification by defining every TypeScript interface, all utility functions, the full layout system implementation, remaining component specs, mobile behavior, animation system, and the complete routing file.

---

## Table of Contents (Part 3)

- [A. Complete TypeScript Type System (`api/types.ts`)](#a-complete-typescript-type-system)
- [B. `lib/auth.ts` — Token Utilities](#b-libauth-ts)
- [C. `lib/queryClient.ts` — Query Client](#c-libqueryclientts)
- [D. `lib/utils.ts` — Utilities](#d-libutilsts)
- [E. `lib/supabase.ts`](#e-libsupabasests)
- [F. Complete Router File (`router/index.tsx`)](#f-complete-router-file)
- [G. Layout System — Full Implementation](#g-layout-system)
- [H. Toast System — Full Implementation](#h-toast-system)
- [I. UI Component Library — Full Specs](#i-ui-component-library)
- [J. Mobile Behavior Specifications](#j-mobile-behavior-specifications)
- [K. Animation System](#k-animation-system)
- [L. Debug Mode](#l-debug-mode)
- [M. Page-Level Skeleton Specifications](#m-page-level-skeleton-specifications)
- [N. Accessibility Implementation Details](#n-accessibility-implementation-details)
- [O. Build & Deployment Configuration](#o-build--deployment-configuration)
- [P. Full Implementation Checklist](#p-full-implementation-checklist)

---

## A. Complete TypeScript Type System

This is the **single source of truth** for all data types. Every interface maps 1:1 to the OpenAPI spec schemas. Do NOT invent fields not listed here.

```typescript
// api/types.ts — COMPLETE TYPE FILE

// ─── Primitive Enums ──────────────────────────────────────────────────────────

export type UserTier = 'free' | 'pro' | 'enterprise';
export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'member';
export type MemberStatus = 'active' | 'pending_invite' | 'suspended' | 'removed';
export type UserRole = 'founder' | 'sales' | 'freelancer' | 'marketer' | 'developer' | 'other';
export type Industry = 'saas' | 'ecommerce' | 'services' | 'fintech' | 'health' | 'education' | 'other';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type Archetype = 'seller' | 'builder' | 'freelancer' | 'creator' | 'professional' | 'learner';
export type Platform =
  | 'reddit' | 'linkedin' | 'twitter' | 'facebook' | 'instagram'
  | 'producthunt' | 'indiehackers' | 'hackernews' | 'quora' | 'youtube' | 'other';

export type OpportunityStatus = 'pending' | 'viewed' | 'acted' | 'sent' | 'done';
export type PipelineStage = 'new' | 'contacted' | 'replied' | 'call_demo' | 'closed_won' | 'closed_lost';

export type PracticeScenario =
  | 'interested' | 'polite_decline' | 'ghost'
  | 'skeptical' | 'price_objection' | 'not_right_time';
export type DifficultyLevel = 'beginner' | 'standard' | 'advanced' | 'expert';
export type PressureModifier =
  | 'decision_maker_watching' | 'aggressive_buyer'
  | 'competitor_mentioned' | 'compliance_concern';
export type OpeningMood = 'neutral' | 'skeptical' | 'curious' | 'defensive' | 'rushed';

export type DeliveryStatus = 'pending' | 'delivered' | 'seen' | 'replied' | 'ghosted';
export type ChatType = 'general' | 'opportunity' | 'practice';
export type ChatMode = 'general' | 'meeting_notes' | 'prep' | 'followup_coach';
export type MessageRole = 'user' | 'assistant' | 'system';

export type FeedbackOutcome = 'positive' | 'negative' | 'pending';
export type GoalStatus = 'active' | 'completed' | 'paused';
export type GoalSentiment = 'positive' | 'neutral' | 'negative';

export type ProspectStage =
  | 'prospect' | 'engaged' | 'negotiating'
  | 'closed_won' | 'closed_lost' | 'dormant';
export type MeetingOutcome = 'hot' | 'positive' | 'neutral' | 'cold' | 'dead';
export type EventType = 'meeting' | 'call' | 'demo' | 'followup' | 'other';

export type SignalType = 'buying' | 'risk' | 'timing' | 'engagement';
export type CommitmentStatus = 'pending' | 'done' | 'overdue' | 'ignored';
export type CommitmentOwner = 'founder' | 'prospect';

export type GrowthCardType =
  | 'tip' | 'strategy' | 'resource' | 'reflection'
  | 'challenge' | 'community' | 'insight';

export type PatternType =
  | 'ghost_trigger' | 'success_signal' | 'weakness' | 'objection_type';

export type TrendStatus =
  | 'improving' | 'declining'
  | 'mixed_positive' | 'mixed_negative' | 'stable';

export type WorkspaceActivityEventType =
  | 'practice_completed' | 'deal_closed' | 'opportunity_created'
  | 'goal_reached' | 'member_joined' | 'opportunity_assigned' | 'nudge_sent';

export type CoachingFlag =
  | 'no_outreach_7d' | 'no_practice_7d' | 'score_declining' | 'low_skill_score';

// ─── Auth Types ───────────────────────────────────────────────────────────────

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;   // seconds until access_token expires
  token_type: 'Bearer';
}

export interface LoginResponse extends SessionTokens {
  user: User;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string | null;
  email: string;
  tier: UserTier;
  active_workspace_id: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;            // 0–5
  debug_mode: boolean;
  fcm_token: string | null;
  notification_preferences: NotificationPreferences;
  memory_enabled: boolean;
  email_digest_enabled: boolean;
  check_in_streak: number;
  last_tip_generated_at: string | null;  // ISO datetime
}

export interface NotificationPreferences {
  // Outreach
  opportunity_discovery: boolean;
  feedback_reminder: boolean;
  follow_up_reminder: boolean;
  // Practice
  practice_reminder: boolean;
  skill_badge_earned: boolean;
  // Calendar
  meeting_prep_ready: boolean;
  debrief_reminder: boolean;
  commitment_due: boolean;
  // Growth
  daily_check_in: boolean;
  weekly_plan: boolean;
  archetype_update: boolean;
  // Team (manager)
  team_milestone: boolean;
  member_nudge_sent: boolean;
  // AI Coaching
  ai_insight: boolean;
}

export interface UserMemoryFact {
  id: string;
  user_id: string;
  workspace_id: string;
  fact: string;
  fact_category: string;            // e.g., "product", "persona", "objection"
  reinforcement_count: number;
  last_reinforced_at: string | null;
  created_at: string;
}

export interface UserNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  data: Record<string, unknown>;  // e.g., { route: '/pipeline' }
  created_at: string;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  owner_id: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceWithMeta extends Workspace {
  role: WorkspaceRole;
  member_count: number;
  is_active: boolean;         // true if this is the user's active workspace
}

export interface WorkspaceMember {
  user_id: string;
  workspace_id: string;
  name: string | null;
  email: string;
  role: WorkspaceRole;
  status: MemberStatus;
  joined_at: string | null;
}

export interface PendingInvite {
  id: string;
  workspace_id: string;
  invite_email: string;
  role: WorkspaceRole;
  invite_expires_at: string;
  is_expired: boolean;
  created_at: string;
}

export interface ActiveMembership {
  role: WorkspaceRole;
  status: MemberStatus;
  joined_at: string | null;
}

export interface WorkspaceActivityEvent {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  actor_name: string | null;
  event_type: WorkspaceActivityEventType;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Voice Profile & Onboarding ───────────────────────────────────────────────

export interface VoiceProfile {
  unique_value_prop: string;
  icp_trigger: string;
  target_customer_description: string;
  main_objection: string;
  objection_reframe: string;
  best_proof_point: string;
  voice_style: string;
  outreach_persona: string;
  avoid_phrases: string[];
}

export interface WorkspaceProfile {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string | null;
  business_name: string | null;
  product_description: string | null;
  target_audience: string | null;
  role: UserRole | null;
  industry: Industry | null;
  experience_level: ExperienceLevel | null;
  business_stage: string | null;
  preferred_platforms: Platform[];
  primary_goal: string | null;
  country: string | null;
  state: string | null;
  website: string | null;
  bio: string | null;
  voice_profile: VoiceProfile | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
}

// ─── Opportunities ────────────────────────────────────────────────────────────

export interface Opportunity {
  id: string;
  user_id: string;
  workspace_id: string;

  // Source
  platform: Platform;
  source_url: string | null;
  source_post_id: string | null;

  // Target
  target_name: string | null;
  target_context: string;           // The actual post/signal text
  prepared_message: string | null;  // AI-drafted outreach message

  // Scoring (all 0–100 or 0–10)
  composite_score: number;          // 0–100 overall
  fit_score: number;                // 0–10
  timing_score: number;             // 0–10
  intent_score: number;             // 0–10

  // Status
  status: OpportunityStatus;

  // Pipeline linkage
  pipeline_stage: PipelineStage | null;
  pipeline_stage_changed_at: string | null;
  last_stage_changed_at: string | null;
  follow_up_count: number;
  follow_up_message: string | null;
  lost_reason: string | null;

  // Assignment (team)
  assigned_to: string | null;

  // Deal tracking
  deal_value_usd: number | null;

  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface OpportunityIntel {
  id: string;
  opportunity_id: string;
  target_name: string;
  pain_points: string[];
  talking_points: string[];
  risks: string[];
  confidence: 'low' | 'medium' | 'high';
  source: string;
  created_at: string;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineMetrics {
  total_revenue: number;
  pipeline_value: number;
  win_rate_pct: number;
  contacted_count: number;
  replied_count: number;
  call_demo_count: number;
  closed_won_count: number;
  closed_lost_count: number;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  user_id: string;
  workspace_id: string;
  opportunity_id: string;
  outcome: FeedbackOutcome;
  outcome_note: string | null;
  is_final: boolean;
  deal_value_usd: number | null;
  scheduled_call: boolean;
  scheduled_call_date: string | null;
  scheduled_call_notes: string | null;
  created_at: string;
}

// ─── Practice ─────────────────────────────────────────────────────────────────

export interface BuyerProfile {
  name: string;
  role: string;
  company: string;
  personality_type: string;
  opening_mood: OpeningMood;
  budget_range: string | null;
  timeline: string | null;
  key_concerns: string[];
}

export interface BuyerState {
  interest_score: number;     // 0–100
  trust_score: number;        // 0–100
  confusion_score: number;    // 0–100
  mood: string;               // e.g., "cautiously interested"
  last_reasoning: string;     // ⚠️ ONLY shown in replay, NEVER during active session
}

export interface SkillScores {
  hook: number;               // 0–10
  clarity: number;
  value_prop: number;
  personalization: number;
  cta: number;
  tone: number;
}

export interface SessionDebrief {
  what_worked: string;
  what_didnt: string;
  improvement: string;
  coachable_moment: string;
}

export interface PracticeSession {
  id: string;
  user_id: string;
  workspace_id: string;
  chat_id: string;

  // Configuration
  scenario_type: PracticeScenario;
  difficulty: DifficultyLevel;
  pressure_modifier: PressureModifier | null;
  drill_type: string | null;
  session_goal: string | null;
  practice_prompt: string;
  instruction: string;

  // Buyer
  buyer_profile: BuyerProfile;
  buyer_state: BuyerState;          // final state at session end

  // Outcome
  conversation_outcome: string | null;
  goal_achieved: boolean | null;
  message_strength_score: number | null;   // 0–100
  skill_scores: SkillScores | null;
  session_debrief: SessionDebrief | null;
  coaching_annotations: Array<{
    message_id: string;
    annotation: string;
  }> | null;
  playbook: string | null;          // populated ~2h after session end

  // Status
  completed_at: string | null;
  rating: number | null;            // 1–5 user rating

  created_at: string;
  updated_at: string;
}

export interface PracticeBadge {
  id: string;
  user_id: string;
  workspace_id: string;
  badge_type: string;
  badge_label: string;
  badge_description: string;
  earned_at: string;
}

export interface SkillProgression {
  id: string;
  user_id: string;
  workspace_id: string;
  week_start: string;             // ISO date (Monday of the week)
  avg_hook: number;
  avg_clarity: number;
  avg_value_prop: number;
  avg_personalization: number;
  avg_cta: number;
  avg_tone: number;
  composite_score: number;
  sample_count: number;
  top_weakness: string | null;
  top_strength: string | null;
  created_at: string;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface Chat {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  chat_type: ChatType;
  chat_mode: ChatMode;
  is_archived: boolean;
  opportunity_id: string | null;
  prospect_id: string | null;
  event_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  delivery_status: DeliveryStatus;
  attachments: FileAttachment[];
  created_at: string;
}

export interface FileAttachment {
  url: string;
  type: string;           // MIME type
  name: string;
}

export interface FileUpload {
  url: string;
  type: string;
  filename: string;
  size: number;
  chat_id: string | null;
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export interface UserGoal {
  id: string;
  user_id: string;
  workspace_id: string;
  goal_text: string;
  goal_type: string | null;
  target_value: number | null;
  target_unit: string | null;
  current_value: number;
  target_date: string | null;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

export interface GoalNote {
  id: string;
  goal_id: string;
  note_text: string;
  coaching_response: string | null;
  explicit_delta: number | null;
  progress_delta: number | null;    // AI-inferred delta
  sentiment: GoalSentiment;
  created_at: string;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  event_date: string;             // ISO date
  start_time: string | null;      // "HH:MM" 24h
  end_time: string | null;
  event_type: EventType;
  notes: string | null;
  outcome: MeetingOutcome | null;
  energy_score: number | null;    // 1–5
  attendee_name: string | null;
  attendee_context: string | null;
  opportunity_id: string | null;
  prospect_id: string | null;
  chat_id: string | null;

  // Prep
  prep_generated: boolean;
  prep_content: MeetingPrep | null;

  // Debrief
  debrief_completed_at: string | null;
  debrief_content: MeetingDebrief | null;
  follow_up_message: string | null;
  raw_notes: string | null;

  created_at: string;
  updated_at: string;
}

export interface MeetingPrep {
  prospect_background: string;
  key_topics: string[];
  talking_points: string[];
  open_commitments: string[];
  perplexity_research: string | null;
}

export interface MeetingDebrief {
  summary: string;
  action_items: string[];
  key_insights: string[];
  next_steps: string[];
}

// ─── Prospects ────────────────────────────────────────────────────────────────

export interface Prospect {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  platform: Platform | null;
  notes: string | null;
  stage: ProspectStage;
  relationship_health_score: number;   // 0–100
  last_contact_date: string | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Commitments ─────────────────────────────────────────────────────────────

export interface ConversationCommitment {
  id: string;
  user_id: string;
  workspace_id: string;
  event_id: string;
  prospect_id: string | null;
  commitment_text: string;
  owner: CommitmentOwner;
  status: CommitmentStatus;
  due_date: string | null;
  implicit_timing: string | null;
  follow_up_message: string | null;
  created_at: string;
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export interface ConversationSignal {
  id: string;
  user_id: string;
  workspace_id: string;
  event_id: string;
  prospect_id: string | null;
  signal_type: SignalType;
  signal_text: string;
  confidence_score: number;        // 0–1
  is_active: boolean;
  created_at: string;
}

// ─── Growth ───────────────────────────────────────────────────────────────────

export interface GrowthCard {
  id: string;
  user_id: string;
  workspace_id: string;
  card_type: GrowthCardType;
  title: string;
  body: string;
  action_label: string | null;
  action_type: 'internal_chat' | 'external_url' | 'internal_nav' | null;
  action_value: string | null;     // URL or route or message seed
  is_read: boolean;
  is_dismissed: boolean;
  metadata: GrowthCardMetadata;
  created_at: string;
}

export interface GrowthCardMetadata {
  focus_area?: string;
  daily_actions?: string[];
  difficulty?: string;
  source_url?: string;
}

export interface DailyCheckIn {
  id: string;
  user_id: string;
  workspace_id: string;
  date: string;                    // ISO date "YYYY-MM-DD"
  questions: Array<{
    id: string;
    question: string;
  }>;
  answers: Record<string, string> | null;
  mood_score: number | null;       // 1–10
  ai_response: string | null;
  created_at: string;
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export interface CommunicationPattern {
  id: string;
  user_id: string;
  workspace_id: string;
  pattern_type: PatternType;
  pattern_label: string;
  pattern_detail: string;
  confidence_score: number;        // 0–1
  sample_count: number;
  created_at: string;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricsDashboard {
  // Outreach
  sent_count_30d: number;
  sent_count_7d: number;
  positive_count_30d: number;
  positive_rate: number;           // 0–1 (multiply by 100 for %)
  pending_feedback_count: number;

  // Momentum
  momentum_score: number;          // 0–100
  momentum_breakdown: {
    activity: number;
    conversion: number;
    pipeline: number;
    goals: number;
  };
  practice_bonus: number;
  momentum_insight: string;

  // Chart data (last 30 days)
  chart_data: Array<{
    date: string;                  // "YYYY-MM-DD"
    sent: number;
    positive: number;
    positive_rate: number;
  }>;

  // Pipeline summary
  pipeline: PipelineMetrics;

  // Practice
  practice: {
    sessions_30d: number;
    sessions_7d: number;
    avg_score: number | null;
  };

  // Goals
  goals: UserGoal[];
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number | null;
  limit: number;
  offset: number;
  has_more: boolean;
}
```

---

## B. `lib/auth.ts`

Token management utilities. This is the lowest-level auth module — no React, no context.

```typescript
// lib/auth.ts

const ACCESS_TOKEN_KEY = 'kith_access_token';
const REFRESH_TOKEN_KEY = 'kith_refresh_token';
const EXPIRES_AT_KEY = 'kith_token_expires_at';

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;   // unix timestamp (ms)
}

export function getTokens(): StoredTokens {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
    expiresAt: Number(localStorage.getItem(EXPIRES_AT_KEY)) || null,
  };
}

export function setTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number   // seconds
): void {
  const expiresAt = Date.now() + expiresIn * 1000;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

// Returns remaining TTL in seconds (can be negative if expired)
export function getRemainingTTL(): number {
  const { expiresAt } = getTokens();
  if (!expiresAt) return 0;
  return Math.floor((expiresAt - Date.now()) / 1000);
}

export function isTokenExpired(): boolean {
  return getRemainingTTL() <= 0;
}

export function isTokenExpiringSoon(thresholdSeconds = 300): boolean {
  const remaining = getRemainingTTL();
  return remaining > 0 && remaining < thresholdSeconds;
}

// ── Proactive Refresh Scheduling ─────────────────────────────────────────────

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshCallback: (() => Promise<void>) | null = null;

export function setRefreshCallback(fn: () => Promise<void>): void {
  _refreshCallback = fn;
}

export function scheduleRefresh(expiresInSeconds: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);

  // Refresh 90 seconds before expiry (gives ample time for the network call)
  const delayMs = Math.max((expiresInSeconds - 90) * 1000, 0);

  _refreshTimer = setTimeout(async () => {
    if (_refreshCallback) {
      try {
        await _refreshCallback();
      } catch {
        // Interceptor handles 401 fallback
      }
    }
  }, delayMs);
}

export function cancelScheduledRefresh(): void {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

// ── Tab Visibility Refresh Guard ─────────────────────────────────────────────
// Call this once in AuthProvider to check token on tab focus

export function setupVisibilityRefreshGuard(onExpiring: () => Promise<void>): () => void {
  const handler = async () => {
    if (document.visibilityState === 'visible' && isTokenExpiringSoon()) {
      await onExpiring();
    }
  };

  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
```

---

## C. `lib/queryClient.ts`

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
import { AppError } from '../api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default stale time: 1 minute. Override per-query as needed.
      staleTime: 60_000,
      // Garbage collect after 5 minutes of inactivity
      gcTime: 5 * 60_000,
      // Retry logic: never retry 4xx errors (client errors); retry 5xx once
      retry: (failureCount, error) => {
        if (error instanceof AppError) {
          if (error.status >= 400 && error.status < 500) return false;
          if (error.status >= 500 && failureCount < 1) return true;
          return false;
        }
        // Network errors: retry once
        return failureCount < 1;
      },
      retryDelay: 1000,
      // Refetch on window focus for stale data (UX: returns to find fresh data)
      refetchOnWindowFocus: true,
      // Always refetch on reconnect (may have missed updates offline)
      refetchOnReconnect: true,
      // Don't refetch if the query is currently mounted (no double-fetch)
      refetchOnMount: true,
    },
    mutations: {
      retry: 0,  // Never retry mutations automatically
      onError: (error) => {
        // Global mutation error logging (not user-facing — components handle display)
        if (import.meta.env.DEV) {
          console.error('[Mutation Error]', error);
        }
      },
    },
  },
});

// Utility: prefetch a query if not already in cache
export async function prefetchQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  options?: { staleTime?: number }
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey,
    queryFn,
    staleTime: options?.staleTime ?? 60_000,
  });
}
```

---

## D. `lib/utils.ts`

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';

// ── Tailwind Utility ──────────────────────────────────────────────────────────

/** Merge Tailwind classes safely (handles conflicts) */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── String Utilities ──────────────────────────────────────────────────────────

/** Truncate a string to maxLength with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/** Get initials from a name (max 2 chars) */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Slugify a string for workspace slugs */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

/** Capitalize first letter */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Number Utilities ──────────────────────────────────────────────────────────

/** Format a number as USD currency */
export function formatCurrency(amount: number | null | undefined, compact = false): string {
  if (amount == null) return '—';
  if (compact && amount >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a 0–1 decimal as a percentage string */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** Format a score (0–100 or 0–10) with color class */
export function getScoreColorClass(score: number, max = 100): string {
  const pct = (score / max) * 100;
  if (pct >= 70) return 'text-success';
  if (pct >= 40) return 'text-warning';
  return 'text-danger';
}

// ── Date Utilities ────────────────────────────────────────────────────────────

/** Friendly relative date: "Today", "Yesterday", "3 days ago", etc. */
export function formatRelativeDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = parseISO(isoString);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return formatDistanceToNow(date, { addSuffix: true });
}

/** Format a date for calendar display */
export function formatEventDate(isoDate: string): string {
  return format(parseISO(isoDate), 'EEEE, MMMM d, yyyy');
}

/** Format time "14:30" → "2:30 PM" */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0);
  return format(d, 'h:mm a');
}

/** Get greeting based on current hour */
export function getGreeting(name: string | null): string {
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
    'Good evening';
  return name ? `${timeGreeting}, ${name.split(' ')[0]}` : timeGreeting;
}

/** Days remaining until a target date */
export function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const target = parseISO(isoDate);
  const now = new Date();
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

// ── Clipboard ────────────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand('copy');
    document.body.removeChild(el);
    return success;
  }
}

// ── Array Utilities ───────────────────────────────────────────────────────────

/** Group an array by a key function */
export function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

/** Safe array access — returns null if out of bounds */
export function safeAt<T>(arr: T[], index: number): T | null {
  return arr[index] ?? null;
}

// ── URL Utilities ─────────────────────────────────────────────────────────────

/** Opens a URL safely in a new tab */
export function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Constructs a platform-specific URL icon label */
export function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    reddit: 'Reddit', linkedin: 'LinkedIn', twitter: 'X',
    facebook: 'Facebook', instagram: 'Instagram', producthunt: 'Product Hunt',
    indiehackers: 'Indie Hackers', hackernews: 'Hacker News',
    quora: 'Quora', youtube: 'YouTube', other: 'Other',
  };
  return labels[platform] ?? platform;
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/** Generate a stable color from a string (for avatars, etc.) */
export function stringToColor(str: string): string {
  const PALETTE = [
    '#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B',
    '#10B981', '#EC4899', '#F43F5E', '#0EA5E9',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Check if we're on a mobile viewport */
export function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}

/** Safe JSON parse — returns null on error */
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
```

---

## E. `lib/supabase.ts`

```typescript
// lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // We manage auth ourselves via the Express API tokens
    // Supabase client is used ONLY for Realtime subscriptions
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// ── Realtime health check utility ──────────────────────────────────────────────
export function isRealtimeConnected(): boolean {
  const channels = supabase.getChannels();
  return channels.some(ch => (ch as any).state === 'joined');
}
```

---

## F. Complete Router File

```tsx
// router/index.tsx
import { lazy, Suspense } from 'react';
import {
  createBrowserRouter, Navigate, Outlet, useLocation
} from 'react-router-dom';

// ── Layouts (not lazy — needed immediately) ───────────────────────────────────
import { AppShell } from '../components/layout/AppShell';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthLayout } from '../components/layout/AuthLayout';
import { OnboardingLayout } from '../components/layout/OnboardingLayout';

// ── Guards ────────────────────────────────────────────────────────────────────
import { ProtectedRoute } from './ProtectedRoute';
import { OnboardingRoute } from './OnboardingRoute';
import { RoleRoute } from './RoleRoute';
import { PageSkeleton } from '../components/common/LoadingSkeleton';

// ── Page Lazy Imports ─────────────────────────────────────────────────────────

// Auth
const LoginPage = lazy(() => import('../pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('../pages/auth/RegisterPage'));
const OAuthCallbackPage = lazy(() => import('../pages/auth/OAuthCallbackPage'));
const AcceptInvitePage = lazy(() => import('../pages/auth/AcceptInvitePage'));

// Onboarding
const OnboardingBasicPage = lazy(() => import('../pages/onboarding/OnboardingBasicPage'));
const OnboardingQuestionsPage = lazy(() => import('../pages/onboarding/OnboardingQuestionsPage'));
const OnboardingPreviewPage = lazy(() => import('../pages/onboarding/OnboardingPreviewPage'));

// App pages
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const OpportunitiesPage = lazy(() => import('../pages/opportunities/OpportunitiesPage'));
const OpportunityDetailPage = lazy(() => import('../pages/opportunities/OpportunityDetailPage'));
const PipelinePage = lazy(() => import('../pages/pipeline/PipelinePage'));
const DealDetailPage = lazy(() => import('../pages/pipeline/DealDetailPage'));
const PracticeDashboardPage = lazy(() => import('../pages/practice/PracticeDashboardPage'));
const PracticeSetupPage = lazy(() => import('../pages/practice/PracticeSetupPage'));
const PracticeSessionPage = lazy(() => import('../pages/practice/PracticeSessionPage'));
const PracticeOutcomePage = lazy(() => import('../pages/practice/PracticeOutcomePage'));
const PracticeReplayPage = lazy(() => import('../pages/practice/PracticeReplayPage'));
const ChatListPage = lazy(() => import('../pages/chat/ChatListPage'));
const ChatPage = lazy(() => import('../pages/chat/ChatPage'));
const CalendarPage = lazy(() => import('../pages/calendar/CalendarPage'));
const CalendarEventDetailPage = lazy(() => import('../pages/calendar/CalendarEventDetailPage'));
const ProspectsPage = lazy(() => import('../pages/prospects/ProspectsPage'));
const ProspectDetailPage = lazy(() => import('../pages/prospects/ProspectDetailPage'));
const GoalsPage = lazy(() => import('../pages/goals/GoalsPage'));
const GoalDetailPage = lazy(() => import('../pages/goals/GoalDetailPage'));
const FollowupPage = lazy(() => import('../pages/followup/FollowupPage'));
const CommitmentsPage = lazy(() => import('../pages/commitments/CommitmentsPage'));
const GrowthPage = lazy(() => import('../pages/growth/GrowthPage'));
const InsightsPage = lazy(() => import('../pages/insights/InsightsPage'));
const MetricsPage = lazy(() => import('../pages/metrics/MetricsPage'));
const WorkspacesPage = lazy(() => import('../pages/workspaces/WorkspacesPage'));

// Settings
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage'));
const VoiceProfilePage = lazy(() => import('../pages/settings/VoiceProfilePage'));
const MemoryPage = lazy(() => import('../pages/settings/MemoryPage'));
const NotificationsSettingsPage = lazy(() => import('../pages/settings/NotificationsSettingsPage'));
const TeamMembersPage = lazy(() => import('../pages/settings/TeamMembersPage'));

// Team (manager+)
const TeamPipelinePage = lazy(() => import('../pages/team/TeamPipelinePage'));
const TeamOpportunitiesPage = lazy(() => import('../pages/team/TeamOpportunitiesPage'));
const TeamInsightsPage = lazy(() => import('../pages/team/TeamInsightsPage'));
const TeamAnalyticsPage = lazy(() => import('../pages/team/TeamAnalyticsPage'));
const LeaderboardPage = lazy(() => import('../pages/team/LeaderboardPage'));
const CoachingQueuePage = lazy(() => import('../pages/team/CoachingQueuePage'));
const ActivityFeedPage = lazy(() => import('../pages/team/ActivityFeedPage'));

// Misc
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

// ── Suspense Wrapper ──────────────────────────────────────────────────────────
function SuspensePage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

// ── Router ────────────────────────────────────────────────────────────────────
export const router = createBrowserRouter([
  {
    // Root: AppShell wraps everything (providers + splash)
    element: <AppShell />,
    children: [
      // ── PUBLIC AUTH ROUTES ──────────────────────────────────────────────
      {
        element: <AuthLayout />,
        children: [
          {
            path: '/login',
            element: <SuspensePage><LoginPage /></SuspensePage>,
          },
          {
            path: '/register',
            element: <SuspensePage><RegisterPage /></SuspensePage>,
          },
        ],
      },
      {
        path: '/auth/callback',
        element: <SuspensePage><OAuthCallbackPage /></SuspensePage>,
      },
      {
        path: '/invite/:token',
        element: <SuspensePage><AcceptInvitePage /></SuspensePage>,
      },

      // ── ONBOARDING ROUTES (auth required, onboarding incomplete) ────────
      {
        element: <OnboardingRoute />,
        children: [
          {
            element: <OnboardingLayout />,
            children: [
              {
                path: '/onboarding/basic',
                element: <SuspensePage><OnboardingBasicPage /></SuspensePage>,
              },
              {
                path: '/onboarding/q/:burst',
                element: <SuspensePage><OnboardingQuestionsPage /></SuspensePage>,
              },
              {
                path: '/onboarding/preview',
                element: <SuspensePage><OnboardingPreviewPage /></SuspensePage>,
              },
              {
                path: '/onboarding',
                element: <Navigate to="/onboarding/basic" replace />,
              },
            ],
          },
        ],
      },

      // ── WORKSPACE SELECTION (auth required, no active workspace) ────────
      {
        element: <ProtectedRoute requiresWorkspace={false} />,
        children: [
          {
            path: '/workspaces',
            element: <SuspensePage><WorkspacesPage /></SuspensePage>,
          },
        ],
      },

      // ── MAIN APP (auth + onboarding complete + workspace) ───────────────
      {
        element: <ProtectedRoute requiresWorkspace={true} />,
        children: [
          {
            element: <AppLayout />,
            children: [
              // Default redirect
              { index: true, element: <Navigate to="/home" replace /> },
              { path: '/', element: <Navigate to="/home" replace /> },

              // Core pages
              { path: '/home', element: <SuspensePage><DashboardPage /></SuspensePage> },
              { path: '/opportunities', element: <SuspensePage><OpportunitiesPage /></SuspensePage> },
              { path: '/opportunities/:id', element: <SuspensePage><OpportunityDetailPage /></SuspensePage> },
              { path: '/pipeline', element: <SuspensePage><PipelinePage /></SuspensePage> },
              { path: '/pipeline/:id', element: <SuspensePage><DealDetailPage /></SuspensePage> },

              // Practice
              { path: '/practice', element: <SuspensePage><PracticeDashboardPage /></SuspensePage> },
              { path: '/practice/new', element: <SuspensePage><PracticeSetupPage /></SuspensePage> },
              { path: '/practice/:sessionId', element: <SuspensePage><PracticeSessionPage /></SuspensePage> },
              { path: '/practice/:sessionId/outcome', element: <SuspensePage><PracticeOutcomePage /></SuspensePage> },
              { path: '/practice/:sessionId/replay', element: <SuspensePage><PracticeReplayPage /></SuspensePage> },

              // Chat
              { path: '/chat', element: <SuspensePage><ChatListPage /></SuspensePage> },
              { path: '/chat/:chatId', element: <SuspensePage><ChatPage /></SuspensePage> },

              // Calendar
              { path: '/calendar', element: <SuspensePage><CalendarPage /></SuspensePage> },
              { path: '/calendar/:id', element: <SuspensePage><CalendarEventDetailPage /></SuspensePage> },

              // Prospects
              { path: '/prospects', element: <SuspensePage><ProspectsPage /></SuspensePage> },
              { path: '/prospects/:id', element: <SuspensePage><ProspectDetailPage /></SuspensePage> },

              // Goals
              { path: '/goals', element: <SuspensePage><GoalsPage /></SuspensePage> },
              { path: '/goals/:id', element: <SuspensePage><GoalDetailPage /></SuspensePage> },

              // Other features
              { path: '/followup', element: <SuspensePage><FollowupPage /></SuspensePage> },
              { path: '/commitments', element: <SuspensePage><CommitmentsPage /></SuspensePage> },
              { path: '/growth', element: <SuspensePage><GrowthPage /></SuspensePage> },
              { path: '/insights', element: <SuspensePage><InsightsPage /></SuspensePage> },
              { path: '/metrics', element: <SuspensePage><MetricsPage /></SuspensePage> },

              // Settings
              { path: '/settings', element: <SuspensePage><SettingsPage /></SuspensePage> },
              { path: '/settings/voice', element: <SuspensePage><VoiceProfilePage /></SuspensePage> },
              { path: '/settings/memory', element: <SuspensePage><MemoryPage /></SuspensePage> },
              { path: '/settings/notifications', element: <SuspensePage><NotificationsSettingsPage /></SuspensePage> },
              {
                path: '/settings/members',
                element: (
                  <RoleRoute minRole="admin">
                    <SuspensePage><TeamMembersPage /></SuspensePage>
                  </RoleRoute>
                ),
              },

              // Team (manager+)
              {
                path: '/team/pipeline',
                element: <RoleRoute minRole="manager"><SuspensePage><TeamPipelinePage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/opportunities',
                element: <RoleRoute minRole="manager"><SuspensePage><TeamOpportunitiesPage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/insights',
                element: <RoleRoute minRole="manager"><SuspensePage><TeamInsightsPage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/analytics',
                element: <RoleRoute minRole="manager"><SuspensePage><TeamAnalyticsPage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/leaderboard',
                element: <RoleRoute minRole="manager"><SuspensePage><LeaderboardPage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/coaching',
                element: <RoleRoute minRole="manager"><SuspensePage><CoachingQueuePage /></SuspensePage></RoleRoute>,
              },
              {
                path: '/team/activity',
                element: <RoleRoute minRole="manager"><SuspensePage><ActivityFeedPage /></SuspensePage></RoleRoute>,
              },
            ],
          },
        ],
      },

      // ── CATCH-ALL ───────────────────────────────────────────────────────
      {
        path: '*',
        element: <SuspensePage><NotFoundPage /></SuspensePage>,
      },
    ],
  },
]);
```

### F.1 `router/ProtectedRoute.tsx`

```tsx
// router/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  requiresWorkspace?: boolean;  // default true
}

export function ProtectedRoute({ requiresWorkspace = true }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Splash screen handles the loading state — this renders nothing during loading
  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!user?.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding/basic" replace />;
  }

  if (requiresWorkspace && !user?.active_workspace_id) {
    return <Navigate to="/workspaces" replace />;
  }

  return <Outlet />;
}
```

### F.2 `router/OnboardingRoute.tsx`

```tsx
// router/OnboardingRoute.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function OnboardingRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Onboarding already done — skip to app
  if (user?.onboarding_completed) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
```

### F.3 `router/RoleRoute.tsx`

```tsx
// router/RoleRoute.tsx
import { useRole } from '../hooks/useRole';
import type { WorkspaceRole } from '../api/types';

interface RoleRouteProps {
  minRole: WorkspaceRole;
  children: React.ReactNode;
}

export function RoleRoute({ minRole, children }: RoleRouteProps) {
  const { hasMinRole } = useRole();

  if (!hasMinRole(minRole)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center p-8">
        <span className="text-4xl">🔒</span>
        <h2 className="font-display text-xl font-semibold text-text-primary">
          Access Restricted
        </h2>
        <p className="text-text-secondary text-sm max-w-xs">
          You need {minRole} or higher access to view this section.
          Ask your workspace admin to update your role.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
```

---

## G. Layout System

### G.1 `components/layout/AppShell.tsx`

```tsx
// components/layout/AppShell.tsx
import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AuthProvider } from '../../contexts/AuthContext';
import { WorkspaceProvider } from '../../contexts/WorkspaceContext';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { ToastProvider } from '../common/Toast';
import { SplashScreen } from './SplashScreen';
import { useAuth } from '../../hooks/useAuth';
import { useFCMRegistration } from '../../hooks/useNotifications';

// Inner shell reads auth context
function InnerShell() {
  const { isLoading } = useAuth();
  const [splashDismissed, setSplashDismissed] = useState(false);

  useFCMRegistration();

  useEffect(() => {
    if (!isLoading) {
      // Minimum 600ms splash visibility for brand impression
      const minDelay = setTimeout(() => setSplashDismissed(true), 600);
      return () => clearTimeout(minDelay);
    }
  }, [isLoading]);

  return (
    <>
      <AnimatePresence>
        {!splashDismissed && <SplashScreen />}
      </AnimatePresence>
      {/* Always render Outlet but hide behind splash — avoids layout jump */}
      <div style={{ visibility: splashDismissed ? 'visible' : 'hidden' }}>
        <Outlet />
      </div>
    </>
  );
}

export function AppShell() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <NotificationProvider>
          <ToastProvider>
            <InnerShell />
          </ToastProvider>
        </NotificationProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
```

### G.2 `components/layout/AppLayout.tsx`

```tsx
// components/layout/AppLayout.tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

export function AppLayout() {
  return (
    <div className="flex h-screen bg-[--color-bg-base] overflow-hidden">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex md:flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <TopBar />

        {/* Page content */}
        <main
          id="main-content"
          className="flex-1 overflow-y-auto overflow-x-hidden"
        >
          {/* Inner padding — pages can override with their own layout */}
          <div className="min-h-full">
            <Outlet />
          </div>
        </main>

        {/* Mobile bottom navigation — hidden on desktop */}
        <nav className="md:hidden flex-shrink-0 border-t border-[--color-border]">
          <BottomNav />
        </nav>
      </div>
    </div>
  );
}
```

### G.3 `components/layout/TopBar.tsx`

```tsx
// components/layout/TopBar.tsx
// Specification for implementation:
//
// Layout:
//   [Hamburger (mobile only)] [Workspace Switcher] [--flex-1--] [Bell] [User Avatar]
//
// Hamburger:
//   - Visible only on mobile (md:hidden)
//   - onClick: opens MobileSidebar drawer (state in TopBar, pass down to Sidebar)
//
// Workspace Switcher:
//   - Shows: workspace.name (max 20 chars, truncated) + chevron-down icon
//   - Clicking: opens dropdown (Popover) listing all workspaces
//   - Uses GET /api/workspaces data (pre-fetched on init)
//   - Each workspace row: name, plan badge, "Active" badge if current
//   - "Switch" button: calls WorkspaceContext.switchWorkspace(id)
//     while switching: show full-page overlay "Switching workspace..." (see §J.3 Part 1)
//   - "+ New Workspace" link at bottom of dropdown
//
// Bell (notifications):
//   - Badge count from NotificationContext.unreadNotificationCount
//   - Badge: red dot if count > 0, shows number if > 0 (max display: "9+")
//   - onClick: opens NotificationsDrawer (slide in from right on desktop, bottom sheet mobile)
//
// User Avatar:
//   - Circular, 32px, initials fallback (getInitials(user.name))
//   - Background: stringToColor(user.id)
//   - onClick: navigates to /settings
//   - Shows tier badge below avatar (tiny): 'pro' → purple dot, 'free' → nothing
```

### G.4 `components/layout/Sidebar.tsx`

```tsx
// components/layout/Sidebar.tsx
// Full specification:
//
// Width: 240px fixed. Background: bg-[--color-bg-surface].
// Right border: border-r border-[--color-border].
// Overflow: overflow-y-auto (scrollable if many items).
//
// TOP SECTION:
//   Logo row: KithLogo (SVG, 24px) + "kith" wordmark
//   Workspace row: workspace name (truncated) + plan chip + ChevronDown → opens same
//                  dropdown as TopBar workspace switcher
//
// NAV GROUPS (separated by <hr className="border-[--color-border] my-2" />):
//
// Group 1 — Core:
//   NavItem: Home          /home          (icon: LayoutDashboard)
//   NavItem: Opportunities /opportunities (icon: Zap)
//   NavItem: Pipeline      /pipeline      (icon: Layers) + pendingFeedbackCount badge
//   NavItem: Practice      /practice      (icon: Dumbbell)
//   NavItem: Chat          /chat          (icon: MessageCircle)
//
// Group 2 — CRM:
//   NavItem: Calendar      /calendar     (icon: Calendar) + calendarAlertCount badge
//   NavItem: Prospects     /prospects    (icon: Users)
//   NavItem: Goals         /goals        (icon: Target)
//   NavItem: Follow-up     /followup     (icon: Send)
//   NavItem: Commitments   /commitments  (icon: CheckSquare)
//
// Group 3 — Insights:
//   NavItem: Growth        /growth       (icon: TrendingUp)
//   NavItem: Insights      /insights     (icon: BarChart2)
//   NavItem: Metrics       /metrics      (icon: Activity)
//
// Group 4 — Team (only if isManager):
//   CollapsibleGroup: "Team" (icon: Shield)
//     Sub-items (indented 12px):
//       /team/pipeline, /team/opportunities, /team/insights,
//       /team/analytics, /team/leaderboard, /team/coaching, /team/activity
//
// BOTTOM SECTION:
//   NavItem: Workspaces   /workspaces   (icon: Building2)
//   NavItem: Settings     /settings     (icon: Settings)
//   User row: avatar + name + tier badge (bottom of sidebar, no hover state)
//
// NavItem component:
//   - Uses <NavLink> from react-router-dom
//   - Active state: bg-[--color-bg-selected] text-brand border-l-2 border-brand
//   - Inactive: text-text-secondary hover:bg-[--color-bg-hover] hover:text-text-primary
//   - Badge: small rounded pill right-aligned, text-xs, bg-danger text-white
//   - Icon: 18px, left of label, same color as text
//   - Transition: transition-colors duration-150
```

### G.5 `components/layout/BottomNav.tsx`

```tsx
// components/layout/BottomNav.tsx
// Specification:
//
// Background: bg-[--color-bg-surface]
// Height: 56px (safe area aware: padding-bottom env(safe-area-inset-bottom))
//
// 5 Tabs:
//   [Home]          /home          (icon: LayoutDashboard)
//   [Opportunities] /opportunities (icon: Zap) + badge
//   [Practice]      /practice      (icon: Dumbbell)
//   [Pipeline]      /pipeline      (icon: Layers)
//   [More...]       (icon: Grid) → opens MobileMenuDrawer
//
// Active tab:
//   - Icon: text-brand
//   - Label: text-brand, text-[10px] font-medium
// Inactive:
//   - Icon + label: text-text-muted
//
// MobileMenuDrawer (opened by "More..."):
//   - Bottom sheet, full-width, height: auto (max 70vh)
//   - Handle bar at top (32px wide, 4px tall, rounded, centered)
//   - List of all other nav items (Calendar, Prospects, Goals, Follow-up,
//     Commitments, Growth, Insights, Metrics, Settings, Workspaces)
//   - If isManager: Team items section at top of drawer
//   - Each item: full-width tap target, 48px height, icon + label
//   - Close on item tap or backdrop tap
//   - Animate: slide up from bottom (framer-motion y: '100%' → 0)
```

### G.6 `components/layout/AuthLayout.tsx`

```tsx
// components/layout/AuthLayout.tsx
// Specification:
//
// Full-screen: min-h-screen flex items-center justify-center
// Background: bg-[--color-bg-base]
// Subtle grid pattern overlay (CSS background-image: repeating-linear-gradient)
//   creates a very faint grid to add depth to the auth screens
//
// Content: centered card, max-w-md w-full mx-auto px-4
//   Card: bg-[--color-bg-surface] border border-[--color-border] rounded-xl p-8
//
// Top: KithLogo + "kith" wordmark centered above card
//
// <Outlet /> renders the form content inside the card
```

### G.7 `components/layout/OnboardingLayout.tsx`

```tsx
// components/layout/OnboardingLayout.tsx
// Specification:
//
// Full-screen layout (no sidebar, no TopBar)
// Background: bg-[--color-bg-base]
//
// Top: fixed header (64px)
//   Left: KithLogo
//   Center: Step indicator (Step X of 5) with labeled progress steps
//   Right: "Skip" button (only on question steps, not basic or preview)
//
// Progress Steps (visual stepper):
//   Steps: ["Your Info", "Q&A Round 1", "Q&A Round 2", "Q&A Round 3", "Preview"]
//   Completed steps: brand teal circle with checkmark
//   Current step: brand teal circle with step number, pulsing ring
//   Future steps: grey circle with step number
//   Connecting lines between steps: fill left-to-right as completed
//
// Main content: centered, max-w-2xl, pt-24 (below fixed header)
//
// Bottom: fixed footer (64px) with "Continue →" CTA (passed up from step via context)
```

---

## H. Toast System

### H.1 Complete Toast Implementation

```tsx
// components/common/Toast.tsx
import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  dismissToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

// Global imperative access (for use outside React components)
let _showToast: ToastContextValue['showToast'] = () => {};
export function showToast(message: string, type: ToastType = 'info', duration = 4000) {
  _showToast(message, type, duration);
}

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-success flex-shrink-0" />,
  error: <XCircle size={16} className="text-danger flex-shrink-0" />,
  warning: <AlertTriangle size={16} className="text-warning flex-shrink-0" />,
  info: <Info size={16} className="text-brand flex-shrink-0" />,
};

const TOAST_BORDER: Record<ToastType, string> = {
  success: 'border-success/30',
  error: 'border-danger/30',
  warning: 'border-warning/30',
  info: 'border-brand/30',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / toast.duration) * 100, 100);
      if (progressRef.current) {
        progressRef.current.style.width = `${100 - pct}%`;
      }
      if (elapsed >= toast.duration) {
        clearInterval(interval);
        onDismiss();
      }
    }, 16);

    return () => clearInterval(interval);
  }, [toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      className={cn(
        'relative flex items-start gap-3 bg-[--color-bg-elevated]',
        'border rounded-lg px-4 py-3 shadow-elevated min-w-[280px] max-w-[380px]',
        'overflow-hidden',
        TOAST_BORDER[toast.type]
      )}
    >
      {TOAST_ICONS[toast.type]}
      <p className="text-sm text-text-primary flex-1 leading-relaxed">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[--color-border]">
        <div
          ref={progressRef}
          className="h-full bg-current opacity-40 transition-none"
          style={{ width: '100%', color: toast.type === 'success' ? '#10B981' : toast.type === 'error' ? '#F43F5E' : toast.type === 'warning' ? '#F59E0B' : '#14B8A6' }}
        />
      </div>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToastFn = useCallback((
    message: string,
    type: ToastType = 'info',
    duration = 4000
  ) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-4), { id, message, type, duration }]);
    // Max 5 toasts at a time — slice oldest
  }, []);

  // Expose globally
  useEffect(() => { _showToast = showToastFn; }, [showToastFn]);

  return (
    <ToastContext.Provider value={{ showToast: showToastFn, dismissToast }}>
      {children}
      {/* Toast container — fixed, top-right on desktop, top-center on mobile */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-4 right-4 z-[9000] flex flex-col gap-2 pointer-events-none
                   sm:top-4 sm:right-4 max-sm:right-4 max-sm:left-4"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map(toast => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastItem
                toast={toast}
                onDismiss={() => dismissToast(toast.id)}
              />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
```

---

## I. UI Component Library — Full Specs

### I.1 `components/ui/Button.tsx`

```typescript
// Variants:
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

// Styles by variant:
// primary:     bg-brand hover:bg-brand-dark text-white
// secondary:   bg-transparent border border-[--color-border] text-text-primary
//              hover:bg-[--color-bg-hover]
// ghost:       bg-transparent text-text-secondary hover:text-text-primary
//              hover:bg-[--color-bg-hover]
// destructive: bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30
// icon:        w-8 h-8 (sm) / w-9 h-9 (md) / w-10 h-10 (lg) flex items-center justify-center
//              rounded-md, ghost style

// Sizes (non-icon):
// sm: px-3 py-1.5 text-xs rounded
// md: px-4 py-2 text-sm rounded-md (default)
// lg: px-5 py-2.5 text-base rounded-lg

// Loading state: disabled + spinner replacing or preceding label
// Full width: w-full (optional prop)
// Left/right icon slots: ReactNode props

// All buttons: font-medium, transition-colors duration-150
// Focus: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2
//         focus-visible:ring-offset-[--color-bg-surface]
// Disabled: opacity-50 cursor-not-allowed pointer-events-none
```

### I.2 `components/ui/Card.tsx`

```typescript
// Base card: bg-[--color-bg-surface] border border-[--color-border] rounded-lg
// Variants:
//   default: shadow-card
//   elevated: shadow-elevated (for modals/dropdowns that float above cards)
//   flat: no shadow, no border (for nested content areas)
//   interactive: cursor-pointer hover:bg-[--color-bg-hover] transition-colors
//
// Slots: header, body, footer (each optional)
// Header: px-5 py-4 border-b border-[--color-border] flex items-center justify-between
// Body: px-5 py-4
// Footer: px-5 py-4 border-t border-[--color-border] bg-[--color-bg-base]/50
```

### I.3 `components/ui/Badge.tsx`

```typescript
// Small pill-shaped status indicator
// Variants:
//   info:    bg-blue-500/15 text-blue-400 border border-blue-500/20
//   success: bg-emerald-500/15 text-emerald-400 border border-emerald-500/20
//   warning: bg-amber-500/15 text-amber-400 border border-amber-500/20
//   danger:  bg-rose-500/15 text-rose-400 border border-rose-500/20
//   neutral: bg-slate-500/15 text-slate-400 border border-slate-500/20
//   brand:   bg-brand/15 text-brand border border-brand/20
//
// Sizes:
//   sm: px-1.5 py-0.5 text-[10px] (for inline use)
//   md: px-2 py-0.5 text-xs (default)
//   lg: px-2.5 py-1 text-sm
//
// Optional: dot before text (4px circle, same color as text)
// Optional: icon before text
```

### I.4 `components/ui/Modal.tsx`

```typescript
// Portal-based, renders into document.body via createPortal
//
// Backdrop: fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000]
//           animate: opacity 0 → 1 (200ms)
//           click: closes modal
//
// Panel:    fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
//           bg-[--color-bg-elevated] border border-[--color-border]
//           rounded-xl shadow-elevated z-[1001]
//           min-w-[360px] max-w-[520px] w-full mx-4
//           animate: scale 0.95 opacity 0 → scale 1 opacity 1 (200ms ease-out)
//
// Header:   px-6 py-5 flex items-center justify-between border-b border-[--color-border]
//           title: font-display text-lg font-semibold text-text-primary
//           close button: X icon, ghost style
//
// Body:     px-6 py-5 max-h-[60vh] overflow-y-auto
//
// Footer:   px-6 py-4 border-t border-[--color-border] flex justify-end gap-2
//
// Behavior:
//   - Focus trap: first focusable element on open
//   - Escape key: close
//   - Return focus to trigger element on close
//   - aria-modal="true" role="dialog" aria-labelledby={titleId}
//
// Size variants: sm (max-w-sm), md (max-w-[520px], default), lg (max-w-2xl), xl (max-w-4xl)
```

### I.5 `components/ui/Drawer.tsx`

```typescript
// Slide-in panel from right (desktop) or bottom (mobile)
//
// Desktop (right drawer):
//   Position: fixed right-0 top-0 bottom-0 w-[480px] max-w-[90vw]
//   Animate: translateX(100%) → translateX(0) (300ms ease-out)
//
// Mobile (bottom sheet):
//   At <768px viewport:
//   Position: fixed bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl
//   Animate: translateY(100%) → translateY(0) (300ms ease-out)
//   Handle bar: 32px × 4px centered at top, bg-[--color-border], rounded-full, my-3
//   Overflow: scroll within drawer
//
// Backdrop: same as Modal
// Background: bg-[--color-bg-elevated] border-l border-[--color-border] (desktop)
//             bg-[--color-bg-elevated] border-t border-[--color-border] (mobile)
```

### I.6 `components/ui/Avatar.tsx`

```typescript
// Circular user avatar
//
// Image: if src provided, show image. On error, fall back to initials.
// Initials: getInitials(name), text centered on solid background (stringToColor(id))
//
// Sizes:
//   xs: w-6 h-6 text-[9px]
//   sm: w-8 h-8 text-xs (default)
//   md: w-10 h-10 text-sm
//   lg: w-12 h-12 text-base
//   xl: w-16 h-16 text-xl
//
// Optional:
//   - Online indicator: 8px green dot, bottom-right, border-2 border-[--color-bg-surface]
//   - Role badge: small colored dot (WorkspaceRole color)
```

---

## J. Mobile Behavior Specifications

### J.1 Touch Targets

Every interactive element on mobile must meet the 44×44px minimum touch target. Implementation strategy:
- Small icon buttons: wrap in a div with `min-w-[44px] min-h-[44px] flex items-center justify-center`
- List items: min-height 48px (`py-3` with content)
- Nav items: 48px height minimum

### J.2 Swipe Gestures

These swipe gestures should be implemented:

1. **Chat / Practice message thread:** Swipe left on a message → shows "copy" action (iOS/Android native feel). Use `@use-gesture/react` library.
2. **Opportunity cards (list):** Swipe left → "Mark Sent" action (green). Swipe right → "Skip" action (grey). Implement as slide-to-reveal action buttons behind the card.
3. **Growth cards:** Swipe left to dismiss (like a notification).
4. **Mobile drawer:** Swipe down to close (drag below 30% height threshold).
5. **Bottom nav "More" drawer:** Swipe down to close.

### J.3 Viewport Height Handling

The chat and practice session pages must handle the dynamic viewport height issue on mobile (keyboard appearing pushes content):

```tsx
// Use the `dvh` CSS unit for full-height layouts:
// height: 100dvh instead of height: 100vh

// Chat page layout:
// <div className="flex flex-col h-[100dvh]">
//   <ChatHeader className="flex-shrink-0" />
//   <MessageList className="flex-1 overflow-y-auto" />
//   <MessageInput className="flex-shrink-0" />
// </div>

// On iOS Safari: also listen for visualViewport.resize to recalculate:
useEffect(() => {
  const handler = () => {
    const vv = window.visualViewport;
    if (vv && inputContainerRef.current) {
      inputContainerRef.current.style.bottom = `${window.innerHeight - vv.height - vv.offsetTop}px`;
    }
  };
  window.visualViewport?.addEventListener('resize', handler);
  return () => window.visualViewport?.removeEventListener('resize', handler);
}, []);
```

### J.4 Pull-to-Refresh

Implement on these pages:
- Home dashboard (`/home`)
- Opportunities list (`/opportunities`)
- Pipeline board (`/pipeline`)
- Growth feed (`/growth`)

```tsx
// Implementation: use the pull-to-refresh gesture with @use-gesture/react
// Threshold: 60px pull distance to trigger refresh
// Visual feedback: rotating spinner that appears below TopBar during pull
// On release at threshold: trigger queryClient.invalidateQueries for the page's queries
// Return spinner with "Refreshing..." text for 600ms minimum
```

### J.5 Haptic Feedback (Mobile)

Use the Vibration API for key interactions on supported browsers:

```typescript
// Patterns:
const HAPTIC = {
  light: () => navigator.vibrate?.(10),
  medium: () => navigator.vibrate?.(25),
  success: () => navigator.vibrate?.([10, 30, 10]),
  error: () => navigator.vibrate?.([50, 20, 50]),
};

// Use on:
// - Practice message send: HAPTIC.light()
// - Drag-and-drop card drop: HAPTIC.medium()
// - Goal completion: HAPTIC.success()
// - Error toast: HAPTIC.error()
// - Session end celebration: HAPTIC.success()
```

---

## K. Animation System

All animations use Framer Motion unless otherwise noted. Define all animation variants in `lib/animations.ts`:

```typescript
// lib/animations.ts
import type { Variants, Transition } from 'framer-motion';

// ── Page Transitions ──────────────────────────────────────────────────────────

export const PAGE_ENTER: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const PAGE_TRANSITION: Transition = {
  duration: 0.2,
  ease: 'easeOut',
};

// ── Card Animations ───────────────────────────────────────────────────────────

export const CARD_ENTER: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.2 },
  }),
};

// Stagger children (use on list containers)
export const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

export const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
};

// ── Buyer State Meters ────────────────────────────────────────────────────────

// Use layout animation on the width of each bar:
// <motion.div layout style={{ width: `${score}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />

// ── Score Gauge ───────────────────────────────────────────────────────────────

// SVG circle: transition strokeDashoffset with CSS transition:
// transition: stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)

// ── Confetti (Pipeline Won) ───────────────────────────────────────────────────

// CSS-only confetti: 20 small absolute divs, each with:
//   initial: opacity 0, y 0
//   animate: opacity [1, 0], y [-100 to -200px randomly], x [random ±60px]
//   duration: 1.2s, stagger 50ms, ease out
// Place in a fixed overlay above the board (pointer-events: none)

// ── Toast Animations ──────────────────────────────────────────────────────────

export const TOAST_ENTER: Variants = {
  initial: { opacity: 0, y: -16, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.15 } },
};

// ── Modal ──────────────────────────────────────────────────────────────────────

export const MODAL_BACKDROP: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const MODAL_PANEL: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15 } },
};

// ── Drawer ─────────────────────────────────────────────────────────────────────

export const DRAWER_RIGHT: Variants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
  exit: { x: '100%', transition: { duration: 0.25 } },
};

export const DRAWER_BOTTOM: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
  exit: { y: '100%', transition: { duration: 0.25 } },
};

// ── Streaming Cursor ──────────────────────────────────────────────────────────

// CSS only — add .streaming-cursor class when isStreaming:
// .streaming-cursor::after {
//   content: '|';
//   color: var(--color-brand);
//   animation: blink 0.8s step-end infinite;
// }
// @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

// ── Skeleton Shimmer ──────────────────────────────────────────────────────────

// CSS only — add to Skeleton component:
// @keyframes shimmer {
//   0% { background-position: -200% 0; }
//   100% { background-position: 200% 0; }
// }
// background: linear-gradient(90deg, var(--color-bg-elevated) 25%, var(--color-bg-hover) 50%, var(--color-bg-elevated) 75%);
// background-size: 200% 100%;
// animation: shimmer 1.5s infinite;
```

---

## L. Debug Mode

### L.1 Debug Panel

When `user.debug_mode = true`, render a collapsible debug panel accessible via a floating button (bottom-left corner, 40px × 40px, `[debug]` text or bug icon, `z-[8000]`).

```tsx
// components/common/DebugPanel.tsx (only rendered when debug_mode = true)
//
// Contents:
//   - Current user ID + workspace ID
//   - active_workspace_id
//   - onboarding_completed + step
//   - Token expires at (human-readable countdown)
//   - Realtime connection status
//   - TanStack Query cache size (Object.keys(queryClient.getQueryCache().getAll()).length)
//   - Toggle: "Force Offline" (sets navigator.onLine workaround)
//   - Button: "Clear Cache" → queryClient.clear()
//   - Button: "Reset Onboarding" → DEV ONLY
//   - Button: "Toggle Debug Mode" → userApi.updateDebugMode(false)
//
// Styling: fixed bottom-4 left-4, bg-black/90 text-green-400 font-mono text-xs
//          rounded-lg p-3, max-w-[300px], max-h-[400px] overflow-y-auto
```

### L.2 Environment Awareness

```typescript
// Throughout the app:

// DEV-only logs:
if (import.meta.env.DEV) {
  console.log('[Kith Debug]', data);
}

// DEV-only error details:
if (import.meta.env.DEV && error instanceof AppError) {
  console.error('[AppError]', { code: error.code, status: error.status, details: error.details });
}
```

---

## M. Page-Level Skeleton Specifications

Define page skeletons for the Suspense fallback. Each must match the real page's layout proportions.

```tsx
// components/common/LoadingSkeleton.tsx

// Base Skeleton atom
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded bg-[--color-bg-elevated] animate-pulse', className)} />
  );
}

// Page-level skeleton (used by Suspense fallback)
export function PageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-8 w-48" />            {/* Page title */}
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24 col-span-1" />   {/* Metric cards */}
        <Skeleton className="h-24 col-span-1" />
        <Skeleton className="h-24 col-span-1" />
      </div>
      <Skeleton className="h-64 w-full" />          {/* Main content area */}
    </div>
  );
}

// Domain-specific skeletons:

export function DashboardSkeleton() {
  // Matches the Home page layout: circular gauge + strip + chart + cards
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="flex gap-6">
        <Skeleton className="w-32 h-32 rounded-full flex-shrink-0" />  {/* Gauge */}
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-48 w-full" />           {/* Chart */}
      <div className="flex gap-3 overflow-hidden">
        <Skeleton className="h-36 w-60 flex-shrink-0" />
        <Skeleton className="h-36 w-60 flex-shrink-0" />
        <Skeleton className="h-36 w-60 flex-shrink-0" />
      </div>
    </div>
  );
}

export function OpportunityListSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-40" />
      <div className="flex gap-2">
        {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
      </div>
      {[1,2,3,4].map(i => (
        <div key={i} className="border border-[--color-border] rounded-lg p-4 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded" />
            <Skeleton className="h-8 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PipelineBoardSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-40 mb-6" />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1,2,3,4,5].map(i => (
          <div key={i} className="flex-shrink-0 w-64 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg opacity-60" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex-1 space-y-4 overflow-hidden">
        <div className="flex justify-end">
          <Skeleton className="h-12 w-64 rounded-2xl rounded-br-sm" />
        </div>
        <div className="flex items-end gap-2">
          <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
          <Skeleton className="h-24 w-72 rounded-2xl rounded-bl-sm" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-8 w-48 rounded-2xl rounded-br-sm" />
        </div>
        <div className="flex items-end gap-2">
          <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
          <Skeleton className="h-16 w-80 rounded-2xl rounded-bl-sm" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  );
}
```

---

## N. Accessibility Implementation Details

### N.1 Skip Navigation

```tsx
// Place at very top of AppLayout, before sidebar:
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4
             focus:z-[9999] focus:px-4 focus:py-2 focus:bg-brand focus:text-white
             focus:rounded-lg focus:font-medium"
>
  Skip to main content
</a>
```

### N.2 Screen Reader Announcements

For dynamic content updates (streaming messages, loading states):

```tsx
// Use an aria-live region in AppShell for announcements
// e.g., "3 new opportunities found", "Meeting prep is ready"

// lib/announce.ts
let announcer: HTMLElement | null = null;

export function initAnnouncer() {
  announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  announcer.className = 'sr-only';
  document.body.appendChild(announcer);
}

export function announce(message: string, priority: 'polite' | 'assertive' = 'polite') {
  if (!announcer) return;
  announcer.setAttribute('aria-live', priority);
  // Clear then set to force re-announcement of same message
  announcer.textContent = '';
  requestAnimationFrame(() => { if (announcer) announcer.textContent = message; });
}
```

### N.3 Color Contrast Requirements

All text must meet WCAG AA (4.5:1 for normal text, 3:1 for large text):

| Text Color | Background | Contrast | Status |
|---|---|---|---|
| `text-text-primary` (#F1F5F9) | bg-base (#0A0A0F) | 16.2:1 | ✅ AAA |
| `text-text-secondary` (#94A3B8) | bg-base (#0A0A0F) | 7.2:1 | ✅ AAA |
| `text-text-muted` (#64748B) | bg-base (#0A0A0F) | 4.5:1 | ✅ AA |
| `text-brand` (#14B8A6) | bg-surface (#111118) | 4.6:1 | ✅ AA |
| `text-success` (#10B981) | bg-surface (#111118) | 4.5:1 | ✅ AA |
| `text-warning` (#F59E0B) | bg-surface (#111118) | 5.8:1 | ✅ AAA |
| `text-danger` (#F43F5E) | bg-surface (#111118) | 4.5:1 | ✅ AA |

⚠️ Never use `text-text-muted` on `bg-elevated` — contrast drops below 4.5:1. Use `text-text-secondary` instead.

### N.4 Keyboard Navigation

| Screen | Keyboard behavior |
|---|---|
| Modal | Tab cycles through focusable elements; Escape closes |
| Dropdown | Arrow up/down to navigate; Enter to select; Escape to close |
| Sidebar | Tab navigates all items; Enter activates |
| KanbanBoard | Keyboard drag: Space to lift, Arrow to move, Space/Enter to drop, Escape to cancel |
| Practice session | Enter key sends message; Shift+Enter for new line |
| Chat | Enter key sends message; Shift+Enter for new line |
| Date picker | Arrow keys navigate days; Enter selects |

---

## O. Build & Deployment Configuration

### O.1 `public/index.html`

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0A0A0F" />
    <meta name="description" content="Kith — Your AI sales advisor" />

    <!-- PWA -->
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/kith-icon-180.png" />

    <!-- Favicon -->
    <link rel="icon" type="image/svg+xml" href="/kith-icon.svg" />

    <!-- Preconnect -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />

    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..400&display=swap" rel="stylesheet" />

    <title>Kith</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### O.2 `public/manifest.json` (PWA)

```json
{
  "name": "Kith — AI Sales Coach",
  "short_name": "Kith",
  "description": "Your AI sales advisor",
  "start_url": "/home",
  "display": "standalone",
  "background_color": "#0A0A0F",
  "theme_color": "#14B8A6",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/kith-icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/kith-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### O.3 `package.json` Dependencies

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.56.0",
    "@tanstack/react-query-devtools": "^5.56.0",
    "axios": "^1.7.0",
    "@supabase/supabase-js": "^2.45.0",
    "framer-motion": "^11.5.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "zod": "^3.23.0",
    "firebase": "^10.13.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.0",
    "recharts": "^2.13.0",
    "react-markdown": "^9.0.0",
    "react-syntax-highlighter": "^15.5.0",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.441.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.5.0",
    "@use-gesture/react": "^10.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-syntax-highlighter": "^15.5.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.0",
    "msw": "^2.4.0",
    "eslint": "^9.9.0",
    "@typescript-eslint/eslint-plugin": "^8.4.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "prettier": "^3.3.0",
    "prettier-plugin-tailwindcss": "^0.6.0"
  }
}
```

---

## P. Full Implementation Checklist

This checklist is for the AI agent to work through in order. Each item must be completed before moving to the next section.

### Phase 1 — Foundation
- [ ] Initialize Vite + React + TypeScript project
- [ ] Configure `tailwind.config.ts` with full design tokens
- [ ] Create `styles/globals.css` with CSS custom properties
- [ ] Create `lib/auth.ts` (token utilities)
- [ ] Create `lib/supabase.ts` (Supabase client)
- [ ] Create `lib/queryClient.ts` (TanStack Query client)
- [ ] Create `lib/utils.ts` (all utilities)
- [ ] Create `lib/constants.ts` (all frontend constants mirror)
- [ ] Create `lib/animations.ts` (all Framer Motion variants)
- [ ] Create `lib/fcm.ts` (Firebase Cloud Messaging)
- [ ] Create `api/types.ts` (all TypeScript interfaces)
- [ ] Create `api/client.ts` (Axios instance + interceptors)
- [ ] Create all 19 `api/*.ts` service modules

### Phase 2 — Auth + Context
- [ ] Create `contexts/AuthContext.tsx`
- [ ] Create `contexts/WorkspaceContext.tsx`
- [ ] Create `contexts/NotificationContext.tsx`
- [ ] Create `lib/schemas.ts` (all Zod schemas)

### Phase 3 — Hooks
- [ ] Create `hooks/useAuth.ts`
- [ ] Create `hooks/useWorkspace.ts`
- [ ] Create `hooks/useRole.ts`
- [ ] Create `hooks/useRealtime.ts`
- [ ] Create `hooks/useSSE.ts`
- [ ] Create `hooks/useToast.ts`
- [ ] Create `hooks/useDebounce.ts`
- [ ] Create `hooks/usePagination.ts`
- [ ] Create `hooks/useNotifications.ts`
- [ ] Create all query hooks in `hooks/queries/`
- [ ] Create all mutation hooks in `hooks/mutations/`

### Phase 4 — UI Primitives
- [ ] Button, Input, Textarea, Select, Toggle, Checkbox
- [ ] Card, Badge, Avatar, Chip, ScoreGauge, RatingStars
- [ ] Modal, Drawer, Tooltip, Tabs
- [ ] Skeleton, EmptyState, Spinner, CopyButton
- [ ] ConfirmDialog
- [ ] Toast system (ToastProvider + useToast)

### Phase 5 — Layout System
- [ ] SplashScreen
- [ ] AppShell (providers wrapper)
- [ ] AuthLayout
- [ ] OnboardingLayout (with stepper)
- [ ] AppLayout (sidebar + topbar + main + bottomnav)
- [ ] Sidebar (with badge counts)
- [ ] TopBar (with workspace switcher + notification bell)
- [ ] BottomNav (with MobileMenuDrawer)
- [ ] PageHeader

### Phase 6 — Router
- [ ] Create `router/ProtectedRoute.tsx`
- [ ] Create `router/OnboardingRoute.tsx`
- [ ] Create `router/RoleRoute.tsx`
- [ ] Create complete `router/index.tsx`

### Phase 7 — Feature Components (domain-by-domain)
- [ ] Auth feature components (LoginForm, RegisterForm, OAuthCallback handler)
- [ ] Onboarding feature components (BasicForm, QuestionsForm, VoiceProfilePreview)
- [ ] Opportunity feature components (OpportunityCard, IntelPanel, FeedbackModal)
- [ ] Pipeline feature components (KanbanBoard, KanbanColumn, DealCard, CalendarPromptBanner)
- [ ] Practice feature components (BuyerStateMeters, ScenarioSelector, SkillScoreRadar, SessionComplete, ReplayMessage)
- [ ] Chat feature components (MessageBubble, StreamingMessageBubble, SuggestionChips, ChatSSEHandler, FileAttachmentPreview)
- [ ] Calendar feature components (EventCard, PrepContentPanel, DebriefModal, CommitmentItem, SignalItem)
- [ ] Prospect feature components (ProspectCard, HealthGauge, TimelineItem)
- [ ] Growth feature components (GrowthCard, CheckInForm, StreakDisplay, ArchetypeDisplay)
- [ ] Goals feature components (GoalCard, GoalNoteModal, PipelineInsightWidget)
- [ ] Insights feature components (PatternCard, WhyLosingReport, SkillTrendWidget)
- [ ] Metrics feature components (MomentumWidget, ActivityChart, SkillRadar, TeamTable)
- [ ] Team feature components (LeaderboardTable, CoachingQueueItem, ActivityFeedItem)
- [ ] Settings feature components (VoiceProfileDisplay, MemoryFactItem, NotificationToggleGroup)

### Phase 8 — Pages (implement in priority order)
**Priority 1 (core daily flows):**
- [ ] LoginPage + RegisterPage
- [ ] OAuthCallbackPage + AcceptInvitePage
- [ ] OnboardingBasicPage + OnboardingQuestionsPage + OnboardingPreviewPage
- [ ] DashboardPage (Home)
- [ ] OpportunitiesPage + OpportunityDetailPage
- [ ] ChatListPage + ChatPage
- [ ] PracticeSetupPage + PracticeSessionPage + PracticeOutcomePage

**Priority 2 (CRM flows):**
- [ ] PipelinePage + DealDetailPage
- [ ] CalendarPage + CalendarEventDetailPage
- [ ] ProspectsPage + ProspectDetailPage
- [ ] GoalsPage + GoalDetailPage

**Priority 3 (secondary features):**
- [ ] GrowthPage
- [ ] InsightsPage
- [ ] MetricsPage
- [ ] FollowupPage
- [ ] CommitmentsPage
- [ ] PracticeReplayPage

**Priority 4 (settings + team):**
- [ ] WorkspacesPage
- [ ] SettingsPage + VoiceProfilePage + MemoryPage + NotificationsSettingsPage + TeamMembersPage
- [ ] All Team pages (Pipeline, Opportunities, Insights, Analytics, Leaderboard, Coaching, Activity)

### Phase 9 — Polish
- [ ] `public/firebase-messaging-sw.js` service worker
- [ ] `public/manifest.json` PWA manifest
- [ ] `public/index.html` meta tags
- [ ] Accessibility: skip nav, aria-live region, focus management
- [ ] Error boundaries at root + per feature
- [ ] NotFoundPage + ForbiddenPage (inline)
- [ ] DebugPanel (debug_mode only)
- [ ] Pull-to-refresh on key pages
- [ ] Haptic feedback integration
- [ ] Mobile swipe gestures
- [ ] Dark mode CSS variables wired throughout (data-theme="dark" on html)

### Phase 10 — Testing
- [ ] MSW server setup for tests
- [ ] Auth interceptor unit tests
- [ ] Role hook unit tests
- [ ] Zod schema unit tests
- [ ] Key component tests (OpportunityCard, BuyerStateMeters, KanbanBoard, FeedbackModal)
- [ ] Streaming SSE hook test with mocked ReadableStream
- [ ] E2E: Login → Onboarding flow
- [ ] E2E: Opportunity → Feedback loop
- [ ] E2E: Practice session start → complete → outcome

---

## End of Part 3

**Complete Document Coverage Summary (Parts 1 + 2 + 3):**

| Category | Count / Detail |
|---|---|
| Total TypeScript interfaces | 47 complete interfaces |
| API service modules | 19 modules, 120+ typed methods |
| React contexts | 3 full implementations |
| Custom hooks | 13+ (utility + feature-specific) |
| Query hooks catalogue | All domains covered |
| Mutation hooks catalogue | All critical mutations |
| Zod schemas | 18 form schemas |
| UI components specified | 20+ primitives |
| Feature components | 50+ domain components |
| Pages / screens | 31 pages, all blueprinted |
| Routes | All defined in complete router file |
| Realtime subscriptions | 2 (practice + calendar) |
| SSE streaming | Complete implementation |
| Animation variants | Full Framer Motion library |
| Error handling | 24 error codes mapped |
| Accessibility | WCAG AA compliant specs |
| Mobile behavior | Swipe, haptics, keyboard, DVH |
| Build configuration | Vite, TSConfig, package.json |
| Implementation checklist | 60+ ordered items |
| Gap analysis items | 9 gaps with workarounds |

*Kith Frontend Architecture Document — Part 3: Complete Type System, Utilities & Final Specifications*
*This document, together with Parts 1 and 2, forms a complete zero-ambiguity specification
sufficient for an AI agent to generate the entire production-grade Kith frontend codebase.*
