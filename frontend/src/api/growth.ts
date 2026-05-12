import apiClient from './client';
import type { GrowthCard, DailyCheckIn, UserGoal, Opportunity, PaginationMeta } from './types';

export const growthApi = {
  getFeed: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      cards:         GrowthCard[];
      opportunities: Opportunity[];
      goals:         UserGoal[];
      archetype:     string;
      pagination:    PaginationMeta;
    }>('/api/growth/feed', { params }),

  markCardRead: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/growth/cards/${id}/read`),

  dismissCard: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/growth/cards/${id}/dismiss`),

  getTodayCheckIn: () =>
    apiClient.get<{ check_in: DailyCheckIn; is_new: boolean }>('/api/growth/checkin/today'),

  submitCheckIn: (body: {
    answers:     Record<string, string>;
    mood_score?: number | null;
    date?:       string;
  }) =>
    apiClient.post<{
      success:          boolean;
      ai_response:      string;
      check_in_streak:  number;
      message:          string;
    }>('/api/growth/checkin', body),

  getHistory: (params?: { limit?: number; offset?: number; type?: 'tips' | 'plans' }) =>
    apiClient.get<{ cards: GrowthCard[]; total: number }>(
      '/api/growth/history', { params },
    ),

  getWeeklyPlan: () =>
    apiClient.get<{ plan: GrowthCard; cached: boolean }>('/api/growth/plan'),

  detectArchetype: () =>
    apiClient.post<{
      success:    boolean;
      archetype:  string;
      confidence: number | null;
      cached:     boolean;
    }>('/api/growth/archetype/detect'),
};
