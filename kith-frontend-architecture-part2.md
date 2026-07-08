# 🧾 Kith — Frontend Architecture Document: Part 2
### Implementation Layer — API Services, Hooks, Schemas, Components & Configuration

> **Companion to Part 1.** This document contains all implementation-level specifications. Part 1 defines WHAT to build; Part 2 defines HOW to build every critical piece.

---

## Table of Contents (Part 2)

- [A. Complete API Service Modules](#a-complete-api-service-modules)
- [B. Zod Validation Schemas (All Forms)](#b-zod-validation-schemas-all-forms)
- [C. Custom Hook Implementations](#c-custom-hook-implementations)
- [D. Context Provider Implementations](#d-context-provider-implementations)
- [E. Notification System (FCM + In-App)](#e-notification-system-fcm--in-app)
- [F. Component Specifications (Detailed)](#f-component-specifications-detailed)
- [G. Missing Page Blueprints](#g-missing-page-blueprints)
- [H. Environment Configuration](#h-environment-configuration)
- [I. Entry Point & Provider Tree](#i-entry-point--provider-tree)
- [J. Feature-Specific Implementation Notes](#j-feature-specific-implementation-notes)
- [K. TanStack Query Hook Catalogue](#k-tanstack-query-hook-catalogue)
- [L. Mutation Hook Catalogue](#l-mutation-hook-catalogue)

---

## A. Complete API Service Modules

Every service module follows the same pattern: a const object of named async functions, each returning the axios call directly (the `data` property is extracted by callers using `.then(r => r.data)`). Do NOT return `r.data` inside the service — return the full axios promise so callers can access `headers`, `status`, etc. if needed.

### A.1 `api/auth.ts`

```typescript
import { apiClient } from './client';
import type {
  User, SessionTokens, LoginResponse, WorkspaceProfile, VoiceProfile
} from './types';

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    apiClient.post<{ success: boolean; needsVerification: boolean; email: string }>
      ('/api/auth/register', body),

  login: (body: { email: string; password: string }) =>
    apiClient.post<LoginResponse>('/api/auth/login', body),

  logout: () =>
    apiClient.post<{ success: boolean }>('/api/auth/logout'),

  refresh: (refreshToken: string) =>
    apiClient.post<SessionTokens>('/api/auth/refresh', { refresh_token: refreshToken }),

  getMe: () =>
    apiClient.get<{
      user: User;
      active_workspace: import('./types').Workspace | null;
      active_membership: { role: string; status: string; joined_at: string } | null;
    }>('/api/auth/me'),

  updateMe: (body: {
    name?: string;
    business_name?: string;
    product_description?: string;
    target_audience?: string;
    website?: string;
    role?: string;
    industry?: string;
    experience_level?: string;
    bio?: string;
    preferred_platforms?: string[];
  }) =>
    apiClient.put<{ success: boolean; message: string }>('/api/auth/me', body),

  deleteAccount: () =>
    apiClient.delete<{ success: boolean; message: string }>('/api/auth/account'),

  ensureProfile: (body: { name?: string; provider: 'email' | 'google' }) =>
    apiClient.post<{ user: User; isNewUser: boolean }>('/api/auth/profile/ensure', body),

  getGoogleOAuthUrl: () =>
    apiClient.get<{ url: string }>('/api/auth/google/url'),

  resendVerification: (email: string) =>
    apiClient.post<{ success: boolean; message: string }>(
      '/api/auth/resend-verification', { email }
    ),
};
```

### A.2 `api/user.ts`

```typescript
import { apiClient } from './client';
import type {
  NotificationPreferences, UserMemoryFact, UserNotification,
  WorkspaceWithMeta
} from './types';

export const userApi = {
  updateFcmToken: (token: string) =>
    apiClient.put<{ success: boolean }>('/api/user/fcm-token', { token }),

  updateDebugMode: (enabled: boolean) =>
    apiClient.put<{ success: boolean; debug_mode: boolean }>('/api/user/debug', { enabled }),

  updateNotificationPreferences: (prefs: Partial<NotificationPreferences> & {
    memory_enabled?: boolean;
    email_digest_enabled?: boolean;
  }) =>
    apiClient.put<{ success: boolean; notification_preferences: NotificationPreferences }>
      ('/api/user/notification-preferences', prefs),

  getMemoryFacts: () =>
    apiClient.get<{ facts: UserMemoryFact[] }>('/api/user/memory'),

  deleteMemoryFact: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/user/memory/${id}`),

  listWorkspaces: () =>
    apiClient.get<{ workspaces: WorkspaceWithMeta[] }>('/api/user/workspaces'),

  switchWorkspace: (workspaceId: string) =>
    apiClient.post<{ success: boolean; workspace: { id: string; name: string; plan: string; role: string } }>
      ('/api/user/switch-workspace', { workspace_id: workspaceId }),

  acceptInvite: (token: string) =>
    apiClient.post<{
      success: boolean;
      workspace: import('./types').Workspace;
      role: string;
      message: string;
      needs_profile_setup: boolean;
    }>(`/api/user/accept-invite/${token}`),

  listNotifications: (params: { limit?: number; offset?: number }) =>
    apiClient.get<{ notifications: UserNotification[]; unread_count: number }>
      ('/api/user/notifications', { params }),

  markNotificationRead: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/user/notifications/${id}/read`),

  markAllNotificationsRead: () =>
    apiClient.post<{ success: boolean; updated_count: number }>('/api/user/notifications/read-all'),

  trackFeatureEvent: (event: string, metadata?: Record<string, unknown>) =>
    apiClient.post<{ success: boolean }>('/api/user/feature-event', { event, metadata }),
};
```

### A.3 `api/workspaces.ts`

```typescript
import { apiClient } from './client';
import type {
  Workspace, WorkspaceWithMeta, WorkspaceMember, PendingInvite
} from './types';

export const workspacesApi = {
  list: () =>
    apiClient.get<{ workspaces: WorkspaceWithMeta[] }>('/api/workspaces'),

  create: (body: { name: string; slug?: string }) =>
    apiClient.post<{ workspace: Workspace }>('/api/workspaces', body),

  switch: (workspaceId: string) =>
    apiClient.post<{ success: boolean; workspace: Workspace }>
      ('/api/workspaces/switch', { workspace_id: workspaceId }),

  getById: (id: string) =>
    apiClient.get<{ workspace: WorkspaceWithMeta }>(`/api/workspaces/${id}`),

  update: (id: string, body: { name?: string; slug?: string; settings?: Record<string, unknown> }) =>
    apiClient.put<{ success: boolean }>(`/api/workspaces/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${id}`),

  invite: (id: string, body: { email: string; role: 'admin' | 'manager' | 'member' }) =>
    apiClient.post<{ success: boolean; expires_at: string }>(`/api/workspaces/${id}/invite`, body),

  listInvites: (id: string) =>
    apiClient.get<{ invites: PendingInvite[] }>(`/api/workspaces/${id}/invites`),

  revokeInvite: (workspaceId: string, inviteId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${workspaceId}/invites/${inviteId}`),

  listMembers: (id: string) =>
    apiClient.get<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),

  updateMemberRole: (workspaceId: string, userId: string, role: string) =>
    apiClient.put<{ success: boolean }>(
      `/api/workspaces/${workspaceId}/members/${userId}/role`, { role }
    ),

  removeMember: (workspaceId: string, userId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`),

  leave: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/workspaces/${id}/leave`),

  transferOwnership: (id: string, newOwnerId: string) =>
    apiClient.put<{ success: boolean }>(`/api/workspaces/${id}/transfer-ownership`, {
      new_owner_id: newOwnerId,
    }),

  nudgeMember: (workspaceId: string, userId: string, message: string) =>
    apiClient.post<{ success: boolean }>(`/api/workspaces/${workspaceId}/nudge`, {
      user_id: userId, message,
    }),

  getAnalytics: (id: string) =>
    apiClient.get<Record<string, unknown>>(`/api/workspaces/${id}/analytics`),
};
```

### A.4 `api/onboarding.ts`

```typescript
import { apiClient } from './client';
import type { VoiceProfile } from './types';

export const onboardingApi = {
  getStatus: () =>
    apiClient.get<{
      completed: boolean;
      step: number;
      has_voice_profile: boolean;
      has_primary_goal: boolean;
      name: string | null;
      business_name: string | null;
    }>('/api/onboarding/status'),

  submitBasic: (body: {
    name: string;
    business_name?: string;
    product_description?: string;
    target_audience?: string;
    role?: string;
    industry?: string;
    experience_level?: string;
    business_stage?: string;
    preferred_platforms?: string[];
    primary_goal?: string;
    country?: string;
    state?: string;
    website?: string;
    bio?: string;
  }) =>
    apiClient.post<{ success: boolean }>('/api/onboarding/basic', body),

  getQuestions: () =>
    apiClient.get<{
      questions: Array<{ id: string; question: string }>;
      burst: number;
      step: number;
    }>('/api/onboarding/questions'),

  submitAnswers: (body: { answers: Record<string, string>; burst: number }) =>
    apiClient.post<
      | { success: boolean; step: number; complete: false }
      | { success: boolean; voice_profile: VoiceProfile }
    >('/api/onboarding/answers', body),

  submitAbbreviated: (body: { role?: string; primary_goal?: string }) =>
    apiClient.post<{ success: boolean }>('/api/onboarding/abbreviated', body),

  generateSampleMessage: () =>
    apiClient.post<{
      success: boolean;
      sample_message: string;
      based_on_opportunity: boolean;
      opportunity_context: string | null;
      message: string;
    }>('/api/onboarding/sample-message'),

  updateVoiceProfile: (voiceProfile: VoiceProfile) =>
    apiClient.put<{ success: boolean }>('/api/onboarding/profile', { voice_profile: voiceProfile }),

  rebuildVoiceProfile: () =>
    apiClient.post<{ success: boolean; voice_profile: VoiceProfile }>
      ('/api/onboarding/rebuild-voice-profile'),
};
```

### A.5 `api/chat.ts`

```typescript
import { apiClient } from './client';
import type { Chat, ChatMessage } from './types';

// Note: streaming messages use native fetch (not axios) — see useSSE hook

export const chatApi = {
  list: () =>
    apiClient.get<{ chats: Chat[] }>('/api/chat'),

  create: (body: {
    title?: string;
    chat_type: 'general' | 'opportunity' | 'practice';
    chat_mode?: 'general' | 'meeting_notes' | 'prep' | 'followup_coach';
    opportunity_id?: string | null;
    prospect_id?: string | null;
    event_id?: string | null;
  }) =>
    apiClient.post<{ chat: Chat }>('/api/chat', body),

  getById: (chatId: string) =>
    apiClient.get<{ chat: Chat; messages: ChatMessage[] }>(`/api/chat/${chatId}`),

  // Non-streaming message send (fallback only)
  sendMessage: (chatId: string, body: {
    message: string;
    stream: false;
    force_search?: boolean;
    attachments?: Array<{ url: string; type: string; name: string }>;
  }) =>
    apiClient.post<{ message: ChatMessage }>(`/api/chat/${chatId}/message`, body),

  archive: (chatId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/chat/${chatId}`),
};
```

### A.6 `api/practice.ts`

```typescript
import { apiClient } from './client';
import type {
  PracticeSession, PracticeBadge, ChatMessage, SkillProgression
} from './types';

export const practiceApi = {
  startSession: (body: {
    scenario_type?: string;
    session_goal?: string;
    pressure_modifier?: string;
    drill_type?: string | null;
    opportunity_context?: string;
    bio_note?: string;
  }) =>
    apiClient.post<{
      session_id: string;
      chat_id: string;
      scenario_type: string;
      practice_prompt: string;
      instruction: string;
      difficulty: string;
      buyer_profile: import('./types').BuyerProfile;
      buyer_state: import('./types').BuyerState;
      realtime_channel: string;
    }>('/api/practice/start', body),

  listSessions: (params?: { limit?: number; offset?: number; type?: string }) =>
    apiClient.get<{
      sessions: PracticeSession[];
      total_completed: number;
      reply_rate: number;
      badges: PracticeBadge[];
    }>('/api/practice/sessions', { params }),

  getSkillDashboard: () =>
    apiClient.get<{
      skill_history: SkillProgression[];
      recent_sessions: PracticeSession[];
      badges: PracticeBadge[];
    }>('/api/practice/skill-dashboard'),

  listBadges: () =>
    apiClient.get<{ badges: PracticeBadge[] }>('/api/practice/badges'),

  getHistory: (params?: { limit?: number; offset?: number; type?: string }) =>
    apiClient.get<{ sessions: PracticeSession[]; total: number }>
      ('/api/practice/history', { params }),

  getSession: (sessionId: string) =>
    apiClient.get<{ session: PracticeSession }>(`/api/practice/${sessionId}`),

  deleteSession: (sessionId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/practice/${sessionId}`),

  getMessages: (sessionId: string) =>
    apiClient.get<{ messages: ChatMessage[] }>(`/api/practice/${sessionId}/messages`),

  // Non-streaming message (not recommended for production — use fetch/SSE equivalent)
  sendMessage: (sessionId: string, content: string) =>
    apiClient.post<{
      message_ids: string[];
      buyer_state: import('./types').BuyerState;
      session_ended: boolean;
      conversation_outcome: string | null;
      chunk_count_hint: number;
      ghost_broke: boolean | null;
      ghosted: boolean | null;
      quality_score: number | null;
      hint: string | null;
    }>(`/api/practice/${sessionId}/message`, { content }),

  completeSession: (sessionId: string, rating?: number) =>
    apiClient.post<{
      success: boolean;
      session_id: string;
      total_completed: number;
      already_completed: boolean;
    }>(`/api/practice/${sessionId}/complete`, rating ? { rating } : {}),

  getOutcome: (sessionId: string) =>
    apiClient.get<{ session: PracticeSession }>(`/api/practice/${sessionId}/outcome`),

  getReplay: (sessionId: string) =>
    apiClient.get<{
      session: PracticeSession;
      messages: ChatMessage[];
      internal_monologues: Array<{ message_id: string; thought: string }>;
    }>(`/api/practice/${sessionId}/replay`),

  retrySession: (sessionId: string) =>
    apiClient.post<{
      session_id: string;
      chat_id: string;
      scenario_type: string;
      practice_prompt: string;
      instruction: string;
      difficulty: string;
      buyer_profile: import('./types').BuyerProfile;
      buyer_state: import('./types').BuyerState;
      realtime_channel: string;
    }>(`/api/practice/${sessionId}/retry`),
};
```

### A.7 `api/pipeline.ts`

```typescript
import { apiClient } from './client';
import type { Opportunity, PipelineMetrics, Feedback } from './types';

export const pipelineApi = {
  getBoard: (view?: 'team') =>
    apiClient.get<{
      pipeline: {
        contacted: Opportunity[];
        replied: Opportunity[];
        call_demo: Opportunity[];
        closed_won: Opportunity[];
        closed_lost: Opportunity[];
      };
      view: 'individual' | 'team';
      metrics: PipelineMetrics;
    }>('/api/pipeline', { params: view ? { view } : {} }),

  getMetrics: () =>
    apiClient.get<PipelineMetrics>('/api/pipeline/metrics'),

  getTeam: () =>
    apiClient.get<{ deals: Opportunity[]; workspace_id: string }>('/api/pipeline/team'),

  getDeal: (id: string) =>
    apiClient.get<{ deal: Opportunity & { feedback: Feedback[] } }>(`/api/pipeline/${id}`),

  deleteDeal: (id: string) =>
    apiClient.delete<{ success: boolean; message: string }>(`/api/pipeline/${id}`),

  updateStage: (id: string, stage: string, lostReason?: string) =>
    apiClient.put<{
      success: boolean;
      previous_stage: string;
      new_stage: string;
      calendar_prompt: Record<string, unknown> | null;
    }>(`/api/pipeline/${id}/stage`, { stage, ...(lostReason ? { lost_reason: lostReason } : {}) }),

  updateDealValue: (id: string, dealValueUsd: number) =>
    apiClient.patch<{ success: boolean; deal_value_usd: number }>
      (`/api/pipeline/${id}/deal-value`, { deal_value_usd: dealValueUsd }),

  assignDeal: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>
      (`/api/pipeline/${id}/assign`, { user_id: userId }),
};
```

### A.8 `api/feedback.ts`

```typescript
import { apiClient } from './client';
import type { Feedback, Opportunity } from './types';

export const feedbackApi = {
  submit: (body: {
    opportunity_id: string;
    outcome: 'positive' | 'negative' | 'pending';
    outcome_note?: string | null;
    is_final?: boolean;
    deal_value_usd?: number | null;
    scheduled_call?: boolean;
    scheduled_call_date?: string | null;
    scheduled_call_notes?: string | null;
  }) =>
    apiClient.post<{ feedback: Feedback }>('/api/feedback', body),

  getByOpportunity: (opportunityId: string) =>
    apiClient.get<{ feedback: Feedback[] }>(`/api/feedback/${opportunityId}`),

  getPending: () =>
    apiClient.get<{ opportunities: Opportunity[]; count: number }>('/api/feedback/pending'),

  getHistory: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      feedback: Array<Feedback & { opportunity: Opportunity }>;
      has_more: boolean;
      // total: number | null — may be null, use has_more for pagination
    }>('/api/feedback/history', { params }),
};
```

### A.9 `api/goals.ts`

```typescript
import { apiClient } from './client';
import type { UserGoal, GoalNote } from './types';

export const goalsApi = {
  list: () =>
    apiClient.get<{ goals: UserGoal[] }>('/api/goals'),

  create: (body: {
    goal_text: string;
    goal_type?: string;
    target_value?: number | null;
    target_unit?: string | null;
    target_date?: string | null;
  }) =>
    apiClient.post<{ goal: UserGoal }>('/api/goals', body),

  getById: (id: string) =>
    apiClient.get<{ goal: UserGoal }>(`/api/goals/${id}`),

  update: (id: string, body: {
    goal_text?: string;
    target_value?: number | null;
    target_unit?: string | null;
    target_date?: string | null;
    status?: 'active' | 'completed' | 'paused';
  }) =>
    apiClient.put<{ success: boolean }>(`/api/goals/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/goals/${id}`),

  listNotes: (goalId: string) =>
    apiClient.get<{ notes: GoalNote[] }>(`/api/goals/${goalId}/notes`),

  addNote: (goalId: string, body: { note_text: string; explicit_delta?: number | null }) =>
    apiClient.post<{
      success: boolean;
      note: GoalNote;
      coaching_response: string;
      progress_delta: number | null;
      new_value: number;
      goal_completed: boolean;
    }>(`/api/goals/${goalId}/notes`, body),

  deleteNote: (goalId: string, noteId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/goals/${goalId}/notes/${noteId}`),

  getPipelineInsight: (goalId: string) =>
    apiClient.get<{ insight: string; cached: boolean; generated_at: string }>
      (`/api/goals/${goalId}/pipeline-insight`),
};
```

### A.10 `api/calendar.ts`

```typescript
import { apiClient } from './client';
import type {
  CalendarEvent, ConversationCommitment, ConversationSignal, Prospect
} from './types';

export const calendarApi = {
  list: (params?: { from?: string; to?: string }) =>
    apiClient.get<{ events: CalendarEvent[] }>('/api/calendar', { params }),

  create: (body: {
    title: string;
    event_date: string;
    start_time?: string | null;
    end_time?: string | null;
    event_type?: string;
    notes?: string | null;
    attendee_name?: string | null;
    attendee_context?: string | null;
    opportunity_id?: string | null;
    prospect_id?: string | null;
  }) =>
    apiClient.post<{ event: CalendarEvent }>('/api/calendar', body),

  getAlerts: () =>
    apiClient.get<{
      debriefs_needed: CalendarEvent[];
      overdue_commitments: ConversationCommitment[];
      pending_commitments: ConversationCommitment[];
    }>('/api/calendar/alerts'),

  getById: (id: string) =>
    apiClient.get<{
      event: CalendarEvent & { prospects: Prospect | null };
      commitments: ConversationCommitment[];
      signals: ConversationSignal[];
    }>(`/api/calendar/${id}`),

  update: (id: string, body: {
    title?: string;
    event_date?: string;
    start_time?: string;
    end_time?: string;
    event_type?: string;
    notes?: string;
    attendee_name?: string;
    attendee_context?: string;
    outcome?: string;
  }) =>
    apiClient.put<{ success: boolean }>(`/api/calendar/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/calendar/${id}`),

  submitDebrief: (id: string, body: { outcome: string; raw_notes?: string | null }) =>
    apiClient.post<{
      success: boolean;
      debrief: Record<string, unknown> | null;
      message: string | null;
    }>(`/api/calendar/${id}/debrief`, body),

  generatePrep: (id: string) =>
    apiClient.post<{ prep: Record<string, unknown>; cached: boolean }>
      (`/api/calendar/${id}/prep`),

  triggerResearch: (id: string) =>
    apiClient.post<{ success: boolean; message: string }>(`/api/calendar/${id}/research`),

  startMeetingNotes: (id: string) =>
    apiClient.post<{ chat_id: string; is_existing: boolean }>
      (`/api/calendar/${id}/start-meeting-notes`),
};
```

### A.11 `api/prospects.ts`

```typescript
import { apiClient } from './client';
import type {
  Prospect, ConversationSignal, ConversationCommitment, CalendarEvent, Chat
} from './types';

export const prospectsApi = {
  list: (params?: { sort?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ prospects: Array<Prospect & { pending_commitments: number }> }>
      ('/api/prospects', { params }),

  create: (body: {
    name: string;
    company?: string | null;
    title?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    platform?: string | null;
    notes?: string | null;
    stage?: string;
  }) =>
    apiClient.post<{ prospect: Prospect }>('/api/prospects', body),

  getById: (id: string) =>
    apiClient.get<{
      prospect: Prospect;
      timeline: Array<{ type: string; id: string; date: string; title: string }>;
      signals: ConversationSignal[];
      commitments: ConversationCommitment[];
      meetings: CalendarEvent[];
      chats: Chat[];
    }>(`/api/prospects/${id}`),

  update: (id: string, body: Partial<{
    name: string;
    company: string | null;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    platform: string | null;
    notes: string | null;
    stage: string;
  }>) =>
    apiClient.put<{ success: boolean }>(`/api/prospects/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/prospects/${id}`),

  refreshSummary: (id: string) =>
    apiClient.post<{ success: boolean; ai_summary: string }>
      (`/api/prospects/${id}/refresh-summary`),
};
```

### A.12 `api/commitments.ts`

```typescript
import { apiClient } from './client';
import type { ConversationCommitment } from './types';

export const commitmentsApi = {
  list: (params?: { status?: string; owner?: string; limit?: number; offset?: number }) =>
    apiClient.get<{
      commitments: ConversationCommitment[];
      overdue: ConversationCommitment[];
      due_soon: ConversationCommitment[];
      pending: ConversationCommitment[];
    }>('/api/commitments', { params }),

  update: (id: string, body: {
    status?: 'pending' | 'done' | 'overdue' | 'ignored';
    due_date?: string | null;
  }) =>
    apiClient.put<{ success: boolean }>(`/api/commitments/${id}`, body),

  generateMessage: (id: string) =>
    apiClient.post<{ success: boolean; follow_up_message: string }>
      (`/api/commitments/${id}/generate-message`),
};
```

### A.13 `api/followup.ts`

```typescript
import { apiClient } from './client';
import type { Opportunity } from './types';

export const followupApi = {
  list: () =>
    apiClient.get<{ opportunities: Opportunity[] }>('/api/followup'),

  markSent: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/followup/${id}/sent`),

  dismiss: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/followup/${id}/dismiss`),
};
```

### A.14 `api/insights.ts`

```typescript
import { apiClient } from './client';
import type { CommunicationPattern, SkillProgression } from './types';

export const insightsApi = {
  getSummary: () =>
    apiClient.get<{
      has_patterns: boolean;
      top_pattern: CommunicationPattern | null;
      patterns_count: number;
      composite_score: number;
      composite_delta: number;
      top_weakness: string | null;
      top_strength: string | null;
      positive_rate_30d: number;
      messages_analyzed: number;
      has_enough_data: boolean;
    }>('/api/insights/summary'),

  listPatterns: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{ patterns: CommunicationPattern[]; total: number }>
      ('/api/insights/patterns', { params }),

  deletePattern: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/insights/patterns/${id}`),

  getWeekly: () =>
    apiClient.get<{ insights: Array<{ id: string; text: string; prospect_id: string | null; created_at: string }> }>
      ('/api/insights/weekly'),

  getSignalsSummary: () =>
    apiClient.get<{
      buying: number;
      risk: number;
      timing: number;
      engagement: number;
      total: number;
      period_days: number;
    }>('/api/insights/signals/summary'),

  getCommitmentsSummary: () =>
    apiClient.get<{
      overdue_count: number;
      due_soon_count: number;
      completion_rate: number;
    }>('/api/insights/commitments/summary'),

  getWhyLosing: () =>
    apiClient.get<{
      has_data: boolean;
      report: {
        primary_diagnosis: string;
        evidence_summary: string;
        immediate_fix: string;
        skill_to_focus: string;
        encouraging_note: string;
      } | null;
      generated_at: string;
    }>('/api/insights/why-losing'),

  getSkillTrend: () =>
    apiClient.get<{
      previous_week: string;
      composite_delta: number | null;
      composite_current: number | null;
      trend_status: 'improving' | 'declining' | 'mixed_positive' | 'mixed_negative' | 'stable';
      summary: string;
      biggest_gain: Record<string, unknown> | null;
      biggest_drop: Record<string, unknown> | null;
      dimensions: Record<string, number>;
      top_weakness: string | null;
      top_strength: string | null;
    }>('/api/insights/skill-trend'),

  // Manager endpoints
  getWorkspaceWhyLosing: () =>
    apiClient.get<{
      has_data: boolean;
      report: Record<string, unknown> | null;
      scope: string;
      generated_at: string;
    }>('/api/insights/workspace/why-losing'),

  getWorkspaceSkillMatrix: () =>
    apiClient.get<{
      members: Array<{
        user_id: string;
        role: string;
        name: string;
        email: string;
        skill_snapshot: SkillProgression | null;
        has_data: boolean;
      }>;
      workspace_id: string;
    }>('/api/insights/workspace/skill-matrix'),
};
```

### A.15 `api/growth.ts`

```typescript
import { apiClient } from './client';
import type { GrowthCard, DailyCheckIn, UserGoal, Opportunity } from './types';

export const growthApi = {
  getFeed: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      cards: GrowthCard[];
      opportunities: Opportunity[];
      goals: UserGoal[];
      archetype: string;
      pagination: import('./types').PaginationMeta;
    }>('/api/growth/feed', { params }),

  markCardRead: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/growth/cards/${id}/read`),

  dismissCard: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/growth/cards/${id}/dismiss`),

  getTodayCheckIn: () =>
    apiClient.get<{ check_in: DailyCheckIn; is_new: boolean }>('/api/growth/checkin/today'),

  submitCheckIn: (body: {
    answers: Record<string, string>;
    mood_score?: number | null;
    date?: string;
  }) =>
    apiClient.post<{
      success: boolean;
      ai_response: string;
      check_in_streak: number;
      message: string;
    }>('/api/growth/checkin', body),

  getHistory: (params?: { limit?: number; offset?: number; type?: 'tips' | 'plans' }) =>
    apiClient.get<{ cards: GrowthCard[]; total: number }>('/api/growth/history', { params }),

  getWeeklyPlan: () =>
    apiClient.get<{ plan: GrowthCard; cached: boolean }>('/api/growth/plan'),

  detectArchetype: () =>
    apiClient.post<{
      success: boolean;
      archetype: string;
      confidence: number | null;
      cached: boolean;
    }>('/api/growth/archetype/detect'),
};
```

### A.16 `api/metrics.ts`

```typescript
import { apiClient } from './client';
import type { MetricsDashboard, SkillProgression } from './types';

export const metricsApi = {
  getDashboard: () =>
    apiClient.get<MetricsDashboard>('/api/metrics/dashboard'),

  getSkillBreakdown: () =>
    apiClient.get<{
      week_start: string;
      scores: Record<string, number>;
      sample_count: number;
    }>('/api/metrics/skill-breakdown'),

  getIntelligence: () =>
    apiClient.get<{
      insights: Array<{
        id: string;
        type: 'pattern' | 'opportunity' | 'warning';
        title: string;
        description: string;
      }>;
      cached: boolean;
    }>('/api/metrics/intelligence'),

  // Manager endpoints
  getTeamLeaderboard: () =>
    apiClient.get<{
      members: Array<{
        user_id: string;
        name: string;
        role: string;
        sent_30d: number;
        positive_rate: number;
        closed_won: number;
        total_revenue: number;
        score: number;
      }>;
      workspace_id: string;
    }>('/api/metrics/workspace/leaderboard'),

  getCoachingQueue: () =>
    apiClient.get<{
      members: Array<{
        user_id: string;
        name: string;
        flags: Array<'no_outreach_7d' | 'no_practice_7d' | 'score_declining' | 'low_skill_score'>;
        last_active: string | null;
        avg_skill_score: number | null;
      }>;
      workspace_id: string;
    }>('/api/metrics/workspace/coaching-queue'),

  getTeamVelocity: () =>
    apiClient.get<{
      has_data: boolean;
      team_composite_current: number | null;
      team_composite_previous: number | null;
      team_composite_delta: number | null;
      trend: 'improving' | 'declining' | 'stable' | 'no_data';
    }>('/api/metrics/workspace/team-velocity'),

  getTeamOverview: () =>
    apiClient.get<{
      members: Array<{
        user_id: string;
        name: string;
        sessions_this_week: number;
        avg_skill_score: number | null;
        weakest_axis: string | null;
        last_active: string | null;
        outreach_sent_this_week: number;
        goal_completion_pct: number;
      }>;
      team_avg_score: number | null;
      team_weakest_axis: string | null;
      members_not_practiced_this_week: string[];
      workspace_id: string;
    }>('/api/metrics/workspace/team-overview'),
};
```

### A.17 `api/suggestions.ts`

```typescript
import { apiClient } from './client';

export const suggestionsApi = {
  get: () =>
    apiClient.get<{ suggestions: string[] }>('/api/suggestions'),
};
```

### A.18 `api/upload.ts`

```typescript
import { apiClient } from './client';
import type { FileUpload } from './types';

export const uploadApi = {
  upload: (file: File, chatId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    
    return apiClient.post<FileUpload>(
      `/api/upload${chatId ? `?chat_id=${chatId}` : ''}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          // Expose progress: progressEvent.loaded / progressEvent.total
        },
      }
    );
  },
};
```

### A.19 `api/workspaceActivity.ts`

```typescript
import { apiClient } from './client';
import type { WorkspaceActivityEvent } from './types';

export const workspaceActivityApi = {
  list: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      events: WorkspaceActivityEvent[];
      total: number;
      workspace_id: string;
      limit: number;
      offset: number;
    }>('/api/workspace/activity', { params }),
};
```

---

## B. Zod Validation Schemas (All Forms)

```typescript
// lib/schemas.ts
import { z } from 'zod';

// ── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().max(100, 'Max 100 characters').optional(),
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be under 128 characters'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

// ── Onboarding ───────────────────────────────────────────────────────────────

export const onboardingBasicSchema = z.object({
  name: z.string().min(1, 'Your name is required').max(100),
  business_name: z.string().max(200).optional(),
  product_description: z.string().max(2000).optional(),
  target_audience: z.string().max(1000).optional(),
  role: z.enum(['founder', 'sales', 'freelancer', 'marketer', 'developer', 'other']).optional(),
  industry: z.enum(['saas', 'ecommerce', 'services', 'fintech', 'health', 'education', 'other']).optional(),
  experience_level: z.string().max(50).optional(),
  business_stage: z.string().max(50).optional(),
  preferred_platforms: z.array(z.string()).max(10).optional(),
  primary_goal: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  website: z.string().url('Enter a valid URL (https://...)').max(500).optional().or(z.literal('')),
  bio: z.string().max(2000).optional(),
});

export const onboardingAnswersSchema = z.object({
  answers: z.record(z.string().min(1, 'Please answer this question')),
  burst: z.number().int().min(1).max(5),
});

// ── Profile / Settings ───────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().max(100).optional(),
  business_name: z.string().max(200).optional(),
  product_description: z.string().max(2000).optional(),
  target_audience: z.string().max(1000).optional(),
  website: z.string().url().optional().or(z.literal('')),
  role: z.enum(['founder', 'sales', 'freelancer', 'marketer', 'developer', 'other']).optional(),
  industry: z.enum(['saas', 'ecommerce', 'services', 'fintech', 'health', 'education', 'other']).optional(),
  experience_level: z.string().max(50).optional(),
  bio: z.string().max(2000).optional(),
  preferred_platforms: z.array(z.string()).max(10).optional(),
});

export const voiceProfileSchema = z.object({
  unique_value_prop: z.string().min(1, 'Required'),
  icp_trigger: z.string().min(1, 'Required'),
  target_customer_description: z.string().min(1, 'Required'),
  main_objection: z.string().min(1, 'Required'),
  objection_reframe: z.string().min(1, 'Required'),
  best_proof_point: z.string().min(1, 'Required'),
  voice_style: z.string().min(1, 'Required'),
  outreach_persona: z.string().min(1, 'Required'),
  avoid_phrases: z.array(z.string()),
});

// ── Workspace ────────────────────────────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(100),
  slug: z.string()
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens')
    .max(50)
    .optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum(['admin', 'manager', 'member'], {
    errorMap: () => ({ message: 'Select a role' }),
  }),
});

export const nudgeMemberSchema = z.object({
  message: z.string().min(1, 'Message is required').max(500),
});

// ── Goals ────────────────────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  goal_text: z.string().min(1, 'Goal text is required').max(500),
  goal_type: z.string().optional(),
  target_value: z.number().positive('Must be a positive number').optional().nullable(),
  target_unit: z.string().max(50).optional().nullable(),
  target_date: z.string().optional().nullable(),
});

export const goalNoteSchema = z.object({
  note_text: z.string().min(1, 'Note is required').max(2000),
  explicit_delta: z.number().optional().nullable(),
});

// ── Feedback ─────────────────────────────────────────────────────────────────

export const feedbackSchema = z.object({
  outcome: z.enum(['positive', 'negative', 'pending'], {
    errorMap: () => ({ message: 'Select an outcome' }),
  }),
  outcome_note: z.string().max(500).optional().nullable(),
  is_final: z.boolean().default(true),
  deal_value_usd: z.number().min(0).optional().nullable(),
  scheduled_call: z.boolean().default(false),
  scheduled_call_date: z.string().datetime().optional().nullable(),
  scheduled_call_notes: z.string().max(500).optional().nullable(),
}).refine(
  (data) => !data.scheduled_call || (data.scheduled_call && data.scheduled_call_date),
  { message: 'Scheduled date is required when a call is scheduled', path: ['scheduled_call_date'] }
);

// ── Calendar ─────────────────────────────────────────────────────────────────

export const createCalendarEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  event_date: z.string().min(1, 'Date is required'),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  event_type: z.enum(['meeting', 'call', 'demo', 'followup', 'other']).default('meeting'),
  notes: z.string().max(2000).optional().nullable(),
  attendee_name: z.string().max(200).optional().nullable(),
  attendee_context: z.string().max(2000).optional().nullable(),
  opportunity_id: z.string().uuid().optional().nullable(),
  prospect_id: z.string().uuid().optional().nullable(),
});

export const debriefSchema = z.object({
  outcome: z.enum(['hot', 'positive', 'neutral', 'cold', 'dead'], {
    errorMap: () => ({ message: 'Select a meeting outcome' }),
  }),
  raw_notes: z.string().max(5000).optional().nullable(),
});

// ── Prospects ────────────────────────────────────────────────────────────────

export const createProspectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  company: z.string().max(200).optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  linkedin_url: z.string().url().optional().nullable().or(z.literal('')),
  platform: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  stage: z.enum(['prospect', 'engaged', 'negotiating', 'closed_won', 'closed_lost', 'dormant']).default('prospect'),
});

// ── Practice ─────────────────────────────────────────────────────────────────

export const practiceSetupSchema = z.object({
  scenario_type: z.enum([
    'interested', 'polite_decline', 'ghost', 'skeptical', 'price_objection', 'not_right_time'
  ]).optional(),
  session_goal: z.string().max(200).optional(),
  pressure_modifier: z.enum([
    'decision_maker_watching', 'aggressive_buyer', 'competitor_mentioned', 'compliance_concern'
  ]).optional(),
  drill_type: z.string().optional().nullable(),
  opportunity_context: z.string().uuid().optional(),
  bio_note: z.string().max(500).optional(),
});

export const sessionRatingSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
});

// ── Check-In ─────────────────────────────────────────────────────────────────

export const checkInSchema = z.object({
  answers: z.record(z.string().min(1, 'Please answer all questions')),
  mood_score: z.number().int().min(1).max(10).optional().nullable(),
  date: z.string().optional(),
});

// ── Chat ─────────────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(5000, 'Max 5000 characters'),
  force_search: z.boolean().default(false),
});
```

---

## C. Custom Hook Implementations

### C.1 `hooks/useAuth.ts`

```typescript
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
```

### C.2 `hooks/useWorkspace.ts`

```typescript
import { useContext } from 'react';
import { WorkspaceContext } from '../contexts/WorkspaceContext';

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return context;
}
```

### C.3 `hooks/useRole.ts`

```typescript
import { useWorkspace } from './useWorkspace';
import type { WorkspaceRole } from '../api/types';

const HIERARCHY: WorkspaceRole[] = ['member', 'manager', 'admin', 'owner'];

export function useRole() {
  const { activeMembership } = useWorkspace();
  const role = (activeMembership?.role ?? 'member') as WorkspaceRole;
  const roleIndex = HIERARCHY.indexOf(role);

  const hasMinRole = (minRole: WorkspaceRole): boolean =>
    roleIndex >= HIERARCHY.indexOf(minRole);

  return {
    role,
    isMember: true,                     // everyone is at least member
    isManager: hasMinRole('manager'),
    isAdmin: hasMinRole('admin'),
    isOwner: role === 'owner',
    hasMinRole,
  };
}
```

### C.4 `hooks/useRealtime.ts`

```typescript
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface UseRealtimeChannelOptions {
  channelName: string;
  table: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  filter?: string;
  onPayload: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
  enabled?: boolean;
}

export function useRealtimeChannel({
  channelName,
  table,
  event = 'UPDATE',
  filter,
  onPayload,
  enabled = true,
}: UseRealtimeChannelOptions) {
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        onPayload
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // onPayload intentionally excluded from deps — wrap in useCallback at call site
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, table, event, filter, enabled]);
}
```

### C.5 `hooks/useSSE.ts` (Full Implementation)

```typescript
import { useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { AppError } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface SSECallbacks {
  onChunk: (content: string) => void;
  onDone: (messageId: string) => void;
  onError: (message: string) => void;
}

export function useSSE() {
  const { accessToken } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const stream = useCallback(
    async (url: string, body: Record<string, unknown>, callbacks: SSECallbacks) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(`${API_URL}${url}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...body, stream: true }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new AppError(
            errorData.message ?? 'Request failed',
            errorData.error ?? 'UNKNOWN',
            response.status
          );
        }

        if (!response.body) {
          throw new Error('No response body available for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;

            try {
              const data = JSON.parse(raw) as {
                type: 'chunk' | 'done' | 'error';
                content?: string;
                message_id?: string;
                message?: string;
              };

              if (data.type === 'chunk' && data.content) {
                callbacks.onChunk(data.content);
              } else if (data.type === 'done' && data.message_id) {
                callbacks.onDone(data.message_id);
              } else if (data.type === 'error') {
                callbacks.onError(data.message ?? 'Stream error');
              }
            } catch {
              // Ignore malformed JSON lines
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const message = error instanceof AppError
          ? error.message
          : 'Connection failed. Please try again.';
        callbacks.onError(message);
      }
    },
    [accessToken]
  );

  return { stream, abort };
}
```

### C.6 `hooks/useToast.ts`

```typescript
import { create } from 'zustand'; // or use Context if avoiding Zustand

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, type?: ToastType, duration?: number) => void;
  dismiss: (id: string) => void;
}

// Implementation using a simple global store (no extra deps needed):
const listeners: Array<(toast: Omit<Toast, 'id'>) => void> = [];

export function showToast(message: string, type: ToastType = 'info', duration = 4000) {
  listeners.forEach(l => l({ message, type, duration }));
}

export function useToastListener(callback: (toast: Omit<Toast, 'id'>) => void) {
  // Subscribe in ToastContainer component
  // See ToastContainer implementation in F. Component Specifications
}
```

### C.7 `hooks/usePagination.ts`

```typescript
import { useState, useCallback } from 'react';

interface UsePaginationOptions {
  initialLimit?: number;
  initialOffset?: number;
}

export function usePagination({ initialLimit = 20, initialOffset = 0 }: UsePaginationOptions = {}) {
  const [offset, setOffset] = useState(initialOffset);
  const [limit] = useState(initialLimit);

  const loadMore = useCallback(() => {
    setOffset(prev => prev + limit);
  }, [limit]);

  const reset = useCallback(() => {
    setOffset(0);
  }, []);

  return { offset, limit, loadMore, reset, page: Math.floor(offset / limit) };
}
```

### C.8 `hooks/useDebounce.ts`

```typescript
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

### C.9 `hooks/useNotifications.ts`

```typescript
import { useEffect, useCallback } from 'react';
import { userApi } from '../api/user';
import { useAuth } from './useAuth';
import { initFCM, requestNotificationPermission, onForegroundMessage } from '../lib/fcm';

export function useFCMRegistration() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    async function registerToken() {
      try {
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') return;

        const token = await initFCM();
        if (!token) return;

        // Only update if token changed
        if (user?.fcm_token !== token) {
          await userApi.updateFcmToken(token);
        }
      } catch (error) {
        console.warn('FCM registration failed:', error);
      }
    }

    registerToken();
  }, [isAuthenticated, user?.id]);

  // Handle foreground messages
  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubscribe = onForegroundMessage((payload) => {
      // Show in-app toast notification for foreground messages
      const { notification } = payload;
      if (notification) {
        showToast(notification.body ?? notification.title ?? 'New notification', 'info');
      }
    });

    return unsubscribe;
  }, [isAuthenticated]);
}
```

---

## D. Context Provider Implementations

### D.1 `contexts/AuthContext.tsx`

```typescript
import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authApi } from '../api/auth';
import {
  getTokens, setTokens, clearTokens, scheduleRefresh, getRemainingTTL
} from '../lib/auth';
import type { User, Workspace } from '../api/types';

interface AuthContextValue {
  user: User | null;
  activeWorkspace: Workspace | null;
  activeMembership: { role: string; status: string; joined_at: string } | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
  setActiveWorkspace: (ws: Workspace | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [activeMembership, setActiveMembership] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { accessToken } = getTokens();

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await authApi.getMe();
      setUser(data.user);
      setActiveWorkspace(data.active_workspace);
      setActiveMembership(data.active_membership);
    } catch {
      // Handled by interceptor
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    setTokens(data.access_token, data.refresh_token, data.expires_in);
    scheduleRefresh(data.expires_in);
    await refreshUser();
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearTokens();
    setUser(null);
    setActiveWorkspace(null);
    setActiveMembership(null);
  }, []);

  // Initialize on mount
  useEffect(() => {
    const { accessToken: token, refreshToken } = getTokens();

    if (!token) {
      setIsLoading(false);
      return;
    }

    async function initialize() {
      try {
        const { data } = await authApi.getMe();
        setUser(data.user);
        setActiveWorkspace(data.active_workspace);
        setActiveMembership(data.active_membership);
        scheduleRefresh(getRemainingTTL());
      } catch (error: any) {
        if (error?.status === 401 && refreshToken) {
          try {
            const { data: refreshData } = await authApi.refresh(refreshToken);
            setTokens(refreshData.access_token, refreshData.refresh_token, refreshData.expires_in);
            const { data: meData } = await authApi.getMe();
            setUser(meData.user);
            setActiveWorkspace(meData.active_workspace);
            setActiveMembership(meData.active_membership);
            scheduleRefresh(refreshData.expires_in);
          } catch {
            clearTokens();
          }
        } else {
          clearTokens();
        }
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      activeWorkspace,
      activeMembership,
      accessToken: getTokens().accessToken,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      refreshUser,
      setUser,
      setActiveWorkspace,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, activeWorkspace, activeMembership, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

### D.2 `contexts/WorkspaceContext.tsx`

```typescript
import React, { createContext, useMemo, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { workspacesApi } from '../api/workspaces';
import { queryClient } from '../lib/queryClient';
import { useNavigate } from 'react-router-dom';
import type { Workspace, WorkspaceRole } from '../api/types';

interface WorkspaceContextValue {
  activeWorkspace: Workspace | null;
  activeMembership: { role: WorkspaceRole; status: string; joined_at: string } | null;
  role: WorkspaceRole | null;
  switchWorkspace: (workspaceId: string) => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspace, activeMembership, refreshUser, setActiveWorkspace } = useAuth();
  const navigate = useNavigate();

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    await workspacesApi.switch(workspaceId);
    // Clear ALL cached data — new workspace scope
    queryClient.clear();
    await refreshUser();
    navigate('/home');
  }, [refreshUser, navigate]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeWorkspace,
      activeMembership: activeMembership as any,
      role: (activeMembership?.role ?? null) as WorkspaceRole | null,
      switchWorkspace,
    }),
    [activeWorkspace, activeMembership, switchWorkspace]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
```

### D.3 `contexts/NotificationContext.tsx`

```typescript
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { calendarApi } from '../api/calendar';
import { feedbackApi } from '../api/feedback';
import { userApi } from '../api/user';
import { useAuth } from '../hooks/useAuth';

interface NotificationContextValue {
  calendarAlertCount: number;    // debriefs_needed + overdue_commitments
  pendingFeedbackCount: number;  // opportunities waiting for feedback
  unreadNotificationCount: number;
  refreshCounts: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  calendarAlertCount: 0,
  pendingFeedbackCount: 0,
  unreadNotificationCount: 0,
  refreshCounts: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [calendarAlertCount, setCalendarAlertCount] = useState(0);
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const refreshCounts = useCallback(async () => {
    if (!isAuthenticated || !user?.onboarding_completed) return;

    try {
      const [alertsRes, feedbackRes, notifRes] = await Promise.allSettled([
        calendarApi.getAlerts(),
        feedbackApi.getPending(),
        userApi.listNotifications({ limit: 1 }),
      ]);

      if (alertsRes.status === 'fulfilled') {
        const { data } = alertsRes.value;
        setCalendarAlertCount(
          data.debriefs_needed.length + data.overdue_commitments.length
        );
      }

      if (feedbackRes.status === 'fulfilled') {
        setPendingFeedbackCount(feedbackRes.value.data.count);
      }

      if (notifRes.status === 'fulfilled') {
        setUnreadNotificationCount(notifRes.value.data.unread_count);
      }
    } catch {
      // Silently fail — badge counts are non-critical
    }
  }, [isAuthenticated, user?.onboarding_completed]);

  // Refresh on mount + every 2 minutes
  useEffect(() => {
    if (!isAuthenticated) return;

    refreshCounts();
    const interval = setInterval(refreshCounts, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshCounts]);

  return (
    <NotificationContext.Provider
      value={{ calendarAlertCount, pendingFeedbackCount, unreadNotificationCount, refreshCounts }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
```

---

## E. Notification System (FCM + In-App)

### E.1 `lib/fcm.ts`

```typescript
import { initializeApp, getApps } from 'firebase/app';
import {
  getMessaging, getToken, onMessage,
  type MessagePayload, type Messaging
} from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let messagingInstance: Messaging | null = null;

function getFirebaseMessaging(): Messaging | null {
  // FCM requires a browser environment with service worker support
  if (typeof window === 'undefined' || !('Notification' in window)) return null;

  try {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return getMessaging(app);
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function initFCM(): Promise<string | null> {
  const messaging = getFirebaseMessaging();
  if (!messaging) return null;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    messagingInstance = messaging;
    return token;
  } catch {
    return null;
  }
}

export function onForegroundMessage(
  callback: (payload: MessagePayload) => void
): () => void {
  const messaging = messagingInstance ?? getFirebaseMessaging();
  if (!messaging) return () => {};

  const unsubscribe = onMessage(messaging, callback);
  return unsubscribe;
}
```

### E.2 Firebase Service Worker (`public/firebase-messaging-sw.js`)

```javascript
// public/firebase-messaging-sw.js
// This file MUST be in the /public directory (served at root)
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: self.FIREBASE_API_KEY,
  authDomain: self.FIREBASE_AUTH_DOMAIN,
  projectId: self.FIREBASE_PROJECT_ID,
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID,
  appId: self.FIREBASE_APP_ID,
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {};
  if (!title) return;

  self.registration.showNotification(title, {
    body,
    icon: '/kith-icon-192.png',
    badge: '/kith-badge-72.png',
    data: payload.data,
  });
});

// Handle notification click → deep link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route ?? '/home';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(route);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(route);
    })
  );
});
```

---

## F. Component Specifications (Detailed)

### F.1 `components/ui/ScoreGauge.tsx`

Circular radial progress gauge for momentum score and health scores.

```typescript
// Props:
interface ScoreGaugeProps {
  score: number;          // 0–100
  size?: 'sm' | 'md' | 'lg'; // sm=64px, md=96px, lg=128px
  label?: string;         // text displayed below the score
  showDelta?: number;     // if provided, shows +N or -N delta badge
  colorMode?: 'auto' | 'brand'; // auto uses green/amber/red; brand always uses brand teal
}

// Color logic (auto mode):
// 0–39:  text-danger, stroke-danger
// 40–69: text-warning, stroke-warning
// 70–100: text-success, stroke-success

// SVG approach: single <circle> with stroke-dasharray + stroke-dashoffset
// circumference = 2 * π * r (where r is based on size)
// offset = circumference * (1 - score/100)
// Animate offset with CSS transition: transition-all duration-700 ease-out
```

### F.2 `components/ui/EmptyState.tsx`

```typescript
interface EmptyStateProps {
  icon: React.ReactNode;
  headline: string;
  subline?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'ghost';
  };
}

// Layout: centered column, icon (48px, muted color), headline (text-text-primary),
// subline (text-text-muted text-sm), CTA button.
// Always wrapped in a min-h-[240px] container.
```

### F.3 `components/ui/LoadingSkeleton.tsx`

```typescript
// Base skeleton block with shimmer animation
// CSS: bg-surface-elevated animate-pulse rounded
// Shimmer achieved via: bg-gradient-to-r from-surface-elevated via-bg-hover to-surface-elevated
//                       background-size: 200% 100%, background-position animated

interface SkeletonProps {
  className?: string;   // width/height/rounded via Tailwind
  lines?: number;       // renders N stacked skeleton lines for text
  variant?: 'text' | 'card' | 'avatar' | 'chart';
}
```

### F.4 `features/practice/BuyerStateMeters.tsx`

```typescript
interface BuyerStateMeterProps {
  buyerState: BuyerState;  // { interest_score, trust_score, confusion_score, mood }
  isActive: boolean;       // false shows a locked/neutral state
}

// Three labeled progress bars:
// Interest:  color=brand (teal), icon=🎯
// Trust:     color=blue,         icon=💙
// Confusion: color=amber,        icon=🤔
//
// Animation: use Framer Motion layout animation on bar width
// <motion.div
//   initial={false}
//   animate={{ width: `${score}%` }}
//   transition={{ duration: 0.6, ease: 'easeOut' }}
// />
//
// Mood text: shown below bars in italics, text-sm text-text-muted
// Example: "cautiously interested"
//
// ⚠️ NEVER show buyer_state.last_reasoning during active session
```

### F.5 `features/pipeline/KanbanBoard.tsx`

```typescript
// Uses @dnd-kit/core + @dnd-kit/sortable
// Columns are DndContext droppable zones
// Cards are draggable items
//
// Key behaviors:
// 1. On drag start: dim all OTHER columns slightly (opacity-60)
// 2. On drag over: highlight target column with brand color border
// 3. On drag end:
//    a. If same column: no API call, just reorder visually (no backend sort order exists)
//    b. If different column: call pipelineApi.updateStage()
//       - Optimistic: move card immediately
//       - On success: check for calendar_prompt → show CalendarPromptBanner
//       - On error: move card back + show error toast
// 4. Overlay: show DragOverlay with a ghost card while dragging

// Column order (left to right):
// contacted → replied → call_demo → closed_won → closed_lost
```

### F.6 `features/chat/StreamingMessageBubble.tsx`

```typescript
interface StreamingMessageBubbleProps {
  content: string;       // accumulated SSE chunks
  isStreaming: boolean;  // controls cursor visibility
}

// Renders assistant message bubble with:
// - content rendered as Markdown (use 'react-markdown' with sanitized HTML)
//   Important: render markdown for AI responses only, not user messages
// - Blinking cursor at end: animated CSS |
//   Only visible when isStreaming = true
// - Smooth text append: no re-render flash (content prop grows incrementally)
//
// Markdown rendering config:
// - Allow: p, strong, em, ul, ol, li, code, pre, blockquote
// - Sanitize: no raw HTML, no script tags
// - Code blocks: syntax highlighting with react-syntax-highlighter
```

### F.7 `components/common/ConfirmDialog.tsx`

```typescript
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;   // default: "Confirm"
  cancelLabel?: string;    // default: "Cancel"
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  requiresTyping?: string; // if set, user must type this exact string to enable confirm button
  isLoading?: boolean;     // disables buttons, shows spinner on confirm
}

// Portal-based modal
// Variant affects confirm button color:
//   danger: bg-danger, warning: bg-warning, info: bg-brand
// Focus trap: first focusable element on open, return focus on close
// Escape key: closes dialog (calls onCancel)
```

### F.8 `components/layout/Sidebar.tsx`

The sidebar must read badge counts from `NotificationContext` and render them on the correct nav items.

```typescript
// Badge rules:
// Opportunities: pendingFeedbackCount DISPLAYED ON pipeline icon, NOT opportunities
//   (pipeline icon shows "X deals awaiting feedback")
//   Opportunities icon: no badge (opportunities themselves don't have a pending count exposed cleanly)
// Calendar icon: calendarAlertCount
// Pipeline icon: pendingFeedbackCount (for opportunities needing feedback)
// Notification bell (TopBar): unreadNotificationCount

// Active state: current route matching
// Use NavLink from react-router-dom with end prop for exact matching

// Desktop: fixed left sidebar, 240px wide
// Desktop collapsed mode (optional enhancement): 64px wide, icons only
// Mobile: hidden by default, opened via hamburger in TopBar → slide-in from left (Drawer)

// Workspace switcher: clicking workspace name opens a dropdown
//   - Lists WorkspaceWithMeta[] from GET /api/workspaces
//   - Each row: workspace name, plan badge, "Switch" button
//   - "New Workspace" link at bottom
//   - Calls WorkspaceContext.switchWorkspace(id) on click
```

---

## G. Missing Page Blueprints

### G.1 ACCEPT INVITE PAGE (`/invite/:token`)

**Purpose:** Handles invite token from email links. User may or may not be authenticated.

**Logic (sequential):**

```
1. Extract token from URL params
2. Check isAuthenticated:
   a. NOT authenticated:
      → Show "You need to sign in first" page
      → Two options: "Sign In" | "Create Account"
      → Store invite token in sessionStorage
      → On auth complete, redirect back to /invite/:token
   b. IS authenticated:
      → Call POST /api/user/accept-invite/:token
      → On success:
          - 409 ALREADY_A_MEMBER: "You're already a member of [workspace.name]."
            Show "Switch to workspace" button → call switch → navigate /home
          - 410 INVALID_OR_EXPIRED_TOKEN: "This invite link has expired."
            Show contact support message. No retry.
          - 200 success:
            If needs_profile_setup = true → POST /api/onboarding/abbreviated → /home
            If needs_profile_setup = false → navigate /home
```

**UI:** Centered card. Kith logo at top. Clear status message. Single primary CTA.

---

### G.2 NOT FOUND PAGE (`*`)

```
404 illustration (simple, clean — a door with no handle, or an empty horizon)
Headline: "Nothing here."
Subline: "This page doesn't exist or you don't have access."
Button: "Go Home" → /home (or /login if not authenticated)
```

---

### G.3 FORBIDDEN PAGE (inline, used by RoleRoute)

Rendered inline within the main layout (not a full page redirect) when a user navigates to a manager-only route without the required role.

```
Icon: 🔒
Headline: "Access Restricted"
Subline: "You need manager or higher access to view this section."
Contact info: "Ask your workspace admin to update your role."
```

---

### G.4 NOTIFICATIONS DRAWER / PAGE

Accessible from notification bell in `TopBar`. Can be a slide-in drawer (desktop) or full page (mobile).

**Data:** `GET /api/user/notifications?limit=30` → `{ notifications, unread_count }`

**UI:**
- "Mark all read" button (top right) → `POST /api/user/notifications/read-all` → optimistic update
- Grouped by date: "Today", "This Week", "Earlier"
- Each notification:
  - Unread: slightly brighter background (bg-bg-selected)
  - Title + body text
  - Relative timestamp
  - Tap to mark read: `POST /api/user/notifications/:id/read`
  - Deep link: if `notification.data.route` exists, navigate to that route on tap
- "Load more" for older notifications (offset-based)

**Empty state:** "No notifications yet"

---

### G.5 WORKSPACE CREATION / SELECTION PAGE (`/workspaces`)

Shown when `active_workspace_id = null`. Two scenarios:

**A. Has existing workspaces (joining team member):**
- List of `WorkspaceWithMeta[]` with "Switch to" button per workspace
- `POST /api/workspaces/switch` → navigate to `/home`

**B. No workspaces (shouldn't happen post-onboarding, but edge case):**
- "Create Your Workspace" form:
  - Name (required, max 100)
  - Slug (auto-derived: lower-case, replace spaces with hyphens)
  - `POST /api/workspaces` → on success: `POST /api/workspaces/switch` → `/home`

**C. Invited member (accept invite path):**
- If user reaches here with `needs_profile_setup = true` after accepting invite:
  - Show abbreviated onboarding form: Role (select) + Primary goal (text)
  - `POST /api/onboarding/abbreviated` → navigate to `/home`

---

## H. Environment Configuration

### H.1 `.env.example`

```bash
# API
VITE_API_URL=http://localhost:3001

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Firebase Cloud Messaging
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=

# Feature Flags (optional)
VITE_ENABLE_REPLAY_SCRUBBER=false
VITE_ENABLE_DEBUG_PANEL=false
```

### H.2 `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
          framer: ['framer-motion'],
          charts: ['recharts'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable'],
          forms: ['react-hook-form', 'zod', '@hookform/resolvers'],
          firebase: ['firebase/app', 'firebase/messaging'],
        },
      },
    },
    sourcemap: true,    // always — needed for error tracking
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

### H.3 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthrough": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

## I. Entry Point & Provider Tree

### I.1 `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>
);
```

### I.2 Provider Tree Order (within router root layout)

```tsx
// AppShell.tsx — the root element of every route
export function AppShell() {
  return (
    <AuthProvider>                      {/* Auth tokens, user, session */}
      <WorkspaceProvider>               {/* Active workspace + role */}
        <NotificationProvider>          {/* Badge counts, FCM */}
          <ToastProvider>              {/* Global toast system */}
            <SplashScreen />
            <Outlet />                 {/* All page content */}
          </ToastProvider>
        </NotificationProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
```

**Critical ordering rule:** `WorkspaceProvider` must be inside `AuthProvider` because it reads from `useAuth()`. `NotificationProvider` must be inside `WorkspaceProvider` because it reads workspace + auth state to know when to fetch badge counts.

---

## J. Feature-Specific Implementation Notes

### J.1 Opportunity Intel — Lazy Fetch Pattern

```typescript
// features/opportunities/OpportunityIntelPanel.tsx

const [intelRequested, setIntelRequested] = useState(false);

const { data: intelData, isLoading, error } = useQuery({
  queryKey: queryKeys.opportunityIntel(opportunityId),
  queryFn: () => opportunitiesApi.getIntel(opportunityId).then(r => r.data),
  enabled: intelRequested,   // Only fires when user clicks "Analyze"
  staleTime: Infinity,       // Intel doesn't change once generated
  gcTime: 10 * 60 * 1000,
});

// On "Analyze" button click:
// setIntelRequested(true) → triggers query

// Guard: only show button if opportunity.target_name !== null
// If intel.intel === null → show reason message (no_named_entity / no_results / error)
```

### J.2 Practice Session — Ghost Scenario Handling

```typescript
// In PracticeSessionPage, after sending a message:

if (messageResponse.ghosted === true) {
  // Show "no reply" state inline in message thread
  // Add a synthetic message: { role: 'system', content: '🤫 No reply received.' }
  // Show inline coaching tip from messageResponse.hint (if provided)
  setGhostedCount(prev => prev + 1);
}

if (messageResponse.ghost_broke === true) {
  // Ghost finally replied — clear the "no reply" state
  // The buyer response appears in the messages array normally
  setGhostedCount(0);
  showToast('👀 They responded!', 'success');
}

// Ghost timeout (GHOST_TIMEOUT_SECONDS = 600):
// Start a visible countdown timer when scenario_type === 'ghost'
// Display: "⏳ Waiting for response... 8:32 remaining"
// On timeout: show "Ghost timeout — session ending" → auto-trigger complete flow
```

### J.3 Pipeline Drag and Drop — Calendar Prompt

```typescript
// In KanbanBoard.tsx, after successful stage update:

const onDragEnd = async (event: DragEndEvent) => {
  const { active, over } = event;
  const newStage = over?.id as string;
  const dealId = active.id as string;

  // Optimistic move
  moveDeal(dealId, newStage);

  try {
    const { data } = await pipelineApi.updateStage(dealId, newStage);

    if (data.calendar_prompt && newStage === 'call_demo') {
      // Show CalendarPromptBanner near the moved card
      setCalendarPrompt({ dealId, prompt: data.calendar_prompt });
    }

    if (newStage === 'closed_won') {
      triggerConfetti(); // CSS-only keyframe animation, 2 seconds
    }

    if (newStage === 'closed_lost') {
      setLostReasonDeal(dealId); // Opens lost reason modal
    }
  } catch {
    // Revert the optimistic move
    moveDeal(dealId, originalStage);
    showToast('Failed to move deal. Please try again.', 'error');
  }
};
```

### J.4 Growth Check-In — Question Flow

```typescript
// In GrowthPage CheckInSection:

// Step 1: On mount, ALWAYS fetch today's check-in first
const { data: checkInData } = useQuery({
  queryKey: queryKeys.checkInToday,
  queryFn: () => growthApi.getTodayCheckIn().then(r => r.data),
});

// Step 2: If is_new = false → show existing ai_response, no form
// Step 3: If is_new = true → render form with questions from check_in.questions
// Step 4: On submit:
const submitCheckIn = useMutation({
  mutationFn: (body: { answers: Record<string, string>; mood_score: number; date: string }) =>
    growthApi.submitCheckIn(body).then(r => r.data),
  onSuccess: (data) => {
    // 1. Update user streak in AuthContext (check_in_streak from data.check_in_streak)
    // 2. Show ai_response inline (not a toast — it's a coaching message)
    // 3. Invalidate growth feed (new tip cards may have been queued)
    queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
    queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
  },
  onError: (error: AppError) => {
    if (error.code === 'ALREADY_SUBMITTED') {
      // Silently refetch — they already did it
      queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
    }
  },
});

// ⚠️ Check-in 409 handling:
// If POST /api/growth/checkin returns 409 → user already submitted today
// Do NOT show an error toast. Quietly refetch GET /api/growth/checkin/today
// to get the existing ai_response and show it instead.
```

### J.5 Calendar Prep — Polling Fallback

```typescript
// In CalendarEventDetailPage:
// Primary: Supabase Realtime subscription for prep_generated update
// Fallback: polling if Realtime fails to connect within 5 seconds

const { data: eventData, refetch } = useQuery({
  queryKey: queryKeys.calendarEvent(eventId),
  queryFn: () => calendarApi.getById(eventId).then(r => r.data),
  refetchInterval: !eventData?.event.prep_generated ? 5000 : false,
  // Stops polling once prep is generated
});

// Supabase Realtime also set up (see Part 1 §11.3)
// Whichever fires first (Realtime or poll interval) resolves the prep state
// Once prep_generated = true: cancel polling, unsubscribe Realtime
```

### J.6 Settings Notification Preferences — Debounced Saves

```typescript
// In NotificationsSettingsPage:

const [localPrefs, setLocalPrefs] = useState<NotificationPreferences>(
  user?.notification_preferences ?? DEFAULT_NOTIFICATION_PREFS
);

const debouncedPrefs = useDebounce(localPrefs, 1000);

// Watch debounced value and auto-save
useEffect(() => {
  // Don't save on first render (only save changes)
  if (JSON.stringify(debouncedPrefs) === JSON.stringify(user?.notification_preferences)) return;
  updatePreferences.mutate(debouncedPrefs);
}, [debouncedPrefs]);

// Toggle handler:
const handleToggle = (key: keyof NotificationPreferences) => {
  setLocalPrefs(prev => ({ ...prev, [key]: !prev[key] }));
};

// Show a subtle "Saving..." indicator while mutation is in-flight
// Show "✓ Saved" for 2 seconds after success
```

### J.7 Opportunities Page — Status Tab Persistence

```typescript
// In OpportunitiesPage:

// Persist active tab in URL search params so browser back/forward works
const [searchParams, setSearchParams] = useSearchParams();
const activeStatus = (searchParams.get('status') as OpportunityStatus) ?? 'pending';

const handleTabChange = (status: string) => {
  setSearchParams({ status }, { replace: true });
};

// When navigating back from detail page:
// Active tab is preserved via URL → no lost state
// This also means users can share/bookmark filtered views
```

### J.8 Practice Outcome Page — Auto-Polling for Scoring

```typescript
// In PracticeOutcomePage:

const { data: outcomeData, isLoading } = useQuery({
  queryKey: queryKeys.practiceOutcome(sessionId),
  queryFn: () => practiceApi.getOutcome(sessionId).then(r => r.data),
  // Poll until skill_scores is populated (PRACTICE_SKILL_SCORES job fires at t+2s)
  refetchInterval: (query) => {
    const session = query.state.data?.session;
    if (!session) return 3000;  // Still loading → poll every 3s
    if (!session.skill_scores) return 3000;  // Scores not ready → poll every 3s
    return false;  // Scores ready → stop polling
  },
  refetchIntervalInBackground: false, // Don't poll when tab is hidden
});

// coaching_annotations: populated at t+5s → show "loading" state separately
// playbook: populated at t+2h → show "Coming in a couple of hours" message
//   Do NOT poll for playbook — it's too long
```

### J.9 File Upload in Chat — Progress Handling

```typescript
// In ChatPage, file attachment flow:

const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

const handleFileSelect = async (files: FileList) => {
  const validFiles = Array.from(files).filter(f => {
    if (!ALLOWED_FILE_TYPES.includes(f.type)) {
      showToast(`${f.name}: Unsupported file type`, 'error');
      return false;
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      showToast(`${f.name}: File too large (max 10MB)`, 'error');
      return false;
    }
    return true;
  });

  if (attachments.length + validFiles.length > 10) {
    showToast('Maximum 10 attachments per message', 'warning');
    return;
  }

  for (const file of validFiles) {
    const tempId = crypto.randomUUID();
    setUploadProgress(prev => ({ ...prev, [tempId]: 0 }));

    try {
      // uploadApi.upload returns axios response with onUploadProgress
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await apiClient.post<FileUpload>(
        `/api/upload?chat_id=${chatId}`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const pct = Math.round((e.loaded * 100) / (e.total ?? e.loaded));
            setUploadProgress(prev => ({ ...prev, [tempId]: pct }));
          },
        }
      );

      addAttachment({ url: data.url, type: data.type, name: data.filename });
      setUploadProgress(prev => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
    } catch {
      showToast(`Failed to upload ${file.name}`, 'error');
      setUploadProgress(prev => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
    }
  }
};
```

---

## K. TanStack Query Hook Catalogue

All `useQuery` hooks follow this pattern — one file per domain in `hooks/queries/`:

```typescript
// hooks/queries/useOpportunities.ts

export function useOpportunities(params?: { status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: queryKeys.opportunities(params),
    queryFn: () => opportunitiesApi.list(params ?? {}).then(r => r.data),
    staleTime: 60_000,
  });
}

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: queryKeys.opportunity(id),
    queryFn: () => opportunitiesApi.getById(id).then(r => r.data.opportunity),
    staleTime: 30_000,
  });
}

export function useOpportunityIntel(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.opportunityIntel(id),
    queryFn: () => opportunitiesApi.getIntel(id).then(r => r.data),
    enabled,
    staleTime: Infinity,
  });
}

export function useTeamOpportunities() {
  return useQuery({
    queryKey: queryKeys.teamOpportunities,
    queryFn: () => opportunitiesApi.listTeam().then(r => r.data.opportunities),
  });
}
```

```typescript
// hooks/queries/usePipeline.ts

export function usePipeline(view?: 'team') {
  return useQuery({
    queryKey: queryKeys.pipeline(view),
    queryFn: () => pipelineApi.getBoard(view).then(r => r.data),
    staleTime: 30_000,
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: queryKeys.deal(id),
    queryFn: () => pipelineApi.getDeal(id).then(r => r.data.deal),
  });
}
```

```typescript
// hooks/queries/useGrowth.ts

export function useGrowthFeed(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: queryKeys.growthFeed(params),
    queryFn: () => growthApi.getFeed(params).then(r => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useTodayCheckIn() {
  return useQuery({
    queryKey: queryKeys.checkInToday,
    queryFn: () => growthApi.getTodayCheckIn().then(r => r.data),
    staleTime: Infinity,   // Once per day
    refetchOnWindowFocus: false,
  });
}

export function useWeeklyPlan() {
  return useQuery({
    queryKey: queryKeys.weeklyPlan,
    queryFn: () => growthApi.getWeeklyPlan().then(r => r.data),
    staleTime: 6 * 60 * 60_000,  // 6 hours (weekly plans don't change often)
  });
}
```

---

## L. Mutation Hook Catalogue

Each mutation hook manages its own loading state, error handling, cache invalidation, and optimistic updates. Place in `hooks/mutations/` one file per domain.

```typescript
// hooks/mutations/useOpportunityMutations.ts

export function useRefreshOpportunities() {
  const { showToast } = useToast();

  return useMutation({
    mutationFn: () => opportunitiesApi.refresh().then(r => r.data),
    onSuccess: (data) => {
      // Refresh returns IDs only — must refetch the full list
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      showToast(`Found ${data.count} new opportunities!`, 'success');
      if (data.notice) showToast(data.notice, 'info');
    },
    onError: (error: AppError) => {
      if (error.status === 429) {
        showToast('Discovery limit reached. Try again later.', 'warning');
      } else {
        showToast('Failed to discover opportunities.', 'error');
      }
    },
  });
}

export function useUpdateOpportunityStatus() {
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      opportunitiesApi.updateStatus(id, status).then(r => r.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunity(id) });
    },
  });
}
```

```typescript
// hooks/mutations/useFeedbackMutations.ts

export function useSubmitFeedback() {
  const { showToast } = useToast();
  const notifications = useNotifications();

  return useMutation({
    mutationFn: (body: Parameters<typeof feedbackApi.submit>[0]) =>
      feedbackApi.submit(body).then(r => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feedbackPending });
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      notifications.refreshCounts();
      showToast('Feedback recorded!', 'success');
    },
    onError: () => showToast('Failed to save feedback.', 'error'),
  });
}
```

```typescript
// hooks/mutations/useCalendarMutations.ts

export function useCreateCalendarEvent() {
  const { showToast } = useToast();
  const notifications = useNotifications();

  return useMutation({
    mutationFn: (body: Parameters<typeof calendarApi.create>[0]) =>
      calendarApi.create(body).then(r => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar() });
      notifications.refreshCounts();
      showToast('Event created! AI is preparing your meeting brief.', 'success');
      return data.event; // Return event so caller can subscribe to realtime
    },
  });
}

export function useSubmitDebrief(eventId: string) {
  const { showToast } = useToast();
  const notifications = useNotifications();

  return useMutation({
    mutationFn: (body: { outcome: string; raw_notes?: string | null }) =>
      calendarApi.submitDebrief(eventId, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent(eventId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAlerts });
      queryClient.invalidateQueries({ queryKey: queryKeys.commitments() });
      notifications.refreshCounts();
    },
    onError: (error: AppError) => {
      if (error.status === 429) {
        showToast('Too many requests. Wait a moment.', 'warning');
      } else {
        showToast('Failed to save debrief.', 'error');
      }
    },
  });
}
```

```typescript
// hooks/mutations/useGrowthMutations.ts

export function useDismissGrowthCard() {
  return useMutation({
    mutationFn: (id: string) => growthApi.dismissCard(id).then(r => r.data),
    // Optimistic update
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.growthFeed() });
      const previous = queryClient.getQueryData(queryKeys.growthFeed());
      queryClient.setQueryData(queryKeys.growthFeed(), (old: any) => {
        if (!old) return old;
        return { ...old, cards: old.cards.filter((c: GrowthCard) => c.id !== id) };
      });
      return { previous };
    },
    onError: (_, __, context) => {
      queryClient.setQueryData(queryKeys.growthFeed(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
    },
  });
}

export function useSubmitCheckIn() {
  const { showToast } = useToast();
  const { refreshUser } = useAuth();

  return useMutation({
    mutationFn: (body: Parameters<typeof growthApi.submitCheckIn>[0]) =>
      growthApi.submitCheckIn(body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
      queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
      // Refresh user to update check_in_streak
      refreshUser();
    },
    onError: (error: AppError) => {
      if (error.status !== 409) {
        // 409 = already submitted → handled silently in component
        showToast('Failed to save check-in.', 'error');
      }
    },
  });
}
```

```typescript
// hooks/mutations/usePracticeMutations.ts

export function useStartPracticeSession() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (body: Parameters<typeof practiceApi.startSession>[0]) =>
      practiceApi.startSession(body).then(r => r.data),
    onSuccess: (data) => {
      // Navigate to session page with session data in state (avoids extra fetch)
      navigate(`/practice/${data.session_id}`, {
        state: {
          chatId: data.chat_id,
          buyerProfile: data.buyer_profile,
          buyerState: data.buyer_state,
          realtimeChannel: data.realtime_channel,
          practicePrompt: data.practice_prompt,
          scenarioType: data.scenario_type,
          difficulty: data.difficulty,
        },
      });
    },
    onError: (error: AppError) => {
      if (error.code === 'VOICE_PROFILE_MISSING') {
        showToast('Complete onboarding to start practice.', 'warning');
      } else {
        showToast('Failed to start session. Please try again.', 'error');
      }
    },
  });
}

export function useCompleteSession(sessionId: string) {
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (rating?: number) =>
      practiceApi.completeSession(sessionId, rating).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceSkillDashboard });
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceSessions() });
      // Navigate to outcome page
    },
    onError: () => showToast('Failed to complete session.', 'error'),
  });
}
```

---

## End of Part 2

**Full coverage summary across both documents:**

| Area | Coverage |
|---|---|
| Screens blueprinted | 31 screens (all routes) |
| API endpoints mapped | 120+ endpoints across 19 domains |
| API service modules | 19 complete modules with full TypeScript signatures |
| Zod schemas | 18 form schemas covering every user-input form |
| Custom hooks | 12 utility hooks + complete implementations |
| Query hooks | All domains covered (catalogue in §K) |
| Mutation hooks | All critical mutations with optimistic update patterns |
| Context providers | 3 providers with full implementations |
| Realtime subscriptions | 2 (practice delivery, calendar prep) — fully specified |
| SSE streaming | Complete implementation including error/abort handling |
| FCM notifications | Full setup (foreground + background + service worker) |
| Error codes | All 24 error codes with frontend handling rules |
| Empty states | 14 screens specified |
| Edge cases | Ghost scenario, token refresh race condition, workspace switch, polling fallbacks |
| Gap analysis | 9 gaps + inconsistencies documented with workarounds |

*Kith Frontend Architecture Document — Part 2: Implementation Layer*
*Together with Part 1, this constitutes a complete, zero-ambiguity specification for AI-agent-driven frontend codebase generation.*
