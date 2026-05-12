import apiClient from './client';
import type { PracticeSession, PracticeBadge, ChatMessage, SkillProgression, BuyerProfile, BuyerState } from './types';

export interface StartSessionResponse {
  session_id:               string;
  chat_id:                  string;
  scenario_type:            string;
  scenario_label:           string;
  practice_prompt:          string;
  instruction:              string;
  difficulty:               string;
  buyer_profile:            BuyerProfile;
  buyer_state:              BuyerState;
  session_goal:             string | null;
  drill_type:               string | null;
  pressure_modifier:        string | null;
  pressure_modifier_label:  string | null;
  previous_debrief_context: string | null;
  realtime_channel:         string;
}

export interface SendMessageResponse {
  message_ids:          string[];
  buyer_state:          BuyerState;
  session_ended:        boolean;
  conversation_outcome: string | null;
  chunk_count_hint:     number;
  ghost_broke:          boolean | null;
  ghosted:              boolean | null;
  quality_score:        number | null;
  hint:                 string | null;
}

export const practiceApi = {
  startSession: (body: {
    scenario_type?:      string;
    session_goal?:       string;
    pressure_modifier?:  string;
    drill_type?:         string | null;
    opportunity_context?: string;
    bio_note?:           string;
    scenario_text?:      string;
  }) =>
    apiClient.post<StartSessionResponse>('/api/practice/start', body),

  listSessions: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      sessions:         PracticeSession[];
      stats: {
        total:      number;
        completed:  number;
        reply_rate: number;
        streak:     number;
        avg_score:  number;
      };
      badges:     PracticeBadge[];
      curriculum: unknown | null;
    }>('/api/practice/sessions', { params }),

  getSkillDashboard: () =>
    apiClient.get<{
      skill_history:   SkillProgression[];
      recent_sessions: PracticeSession[];
      badges:          PracticeBadge[];
    }>('/api/practice/skill-dashboard'),

  listBadges: () =>
    apiClient.get<{ badges: PracticeBadge[]; total: number }>('/api/practice/badges'),

  getHistory: (params?: { limit?: number; offset?: number; type?: string }) =>
    apiClient.get<{
      sessions:   PracticeSession[];
      pagination: import('./types').PaginationMeta;
    }>('/api/practice/history', { params }),

  getSession: (sessionId: string) =>
    apiClient.get<{ session: PracticeSession }>(`/api/practice/${sessionId}`),

  deleteSession: (sessionId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/practice/${sessionId}`),

  getMessages: (sessionId: string) =>
    apiClient.get<{ messages: ChatMessage[] }>(`/api/practice/${sessionId}/messages`),

  sendMessage: (sessionId: string, content: string) =>
    apiClient.post<SendMessageResponse>(`/api/practice/${sessionId}/message`, { content }),

  completeSession: (sessionId: string, rating?: number) =>
    apiClient.post<{
      success:           boolean;
      session_id:        string;
      total_completed:   number;
      already_completed: boolean;
    }>(`/api/practice/${sessionId}/complete`, rating ? { rating } : {}),

  getOutcome: (sessionId: string) =>
    apiClient.get<{ session: PracticeSession }>(`/api/practice/${sessionId}/outcome`),

  getReplay: (sessionId: string) =>
    apiClient.get<{
      session:            PracticeSession;
      messages:           ChatMessage[];
      internal_monologues: Array<{ message_id: string; thought: string }>;
    }>(`/api/practice/${sessionId}/replay`),

  retrySession: (sessionId: string) =>
    apiClient.post<StartSessionResponse>(`/api/practice/${sessionId}/retry`),

  getProgressSummary: () =>
    apiClient.get<{
      sessions_this_week:  number;
      avg_skill_score:     number | null;
      real_world_win_rate: number | null;
      weakest_axis:        string | null;
      strongest_axis:      string | null;
      weekly_progression:  SkillProgression | null;
    }>('/api/practice/progress-summary'),
};
