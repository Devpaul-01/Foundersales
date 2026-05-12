import apiClient from './client';
import type { CommunicationPattern, SkillProgression } from './types';

export const insightsApi = {
  getSummary: () =>
    apiClient.get<{
      has_patterns:      boolean;
      top_pattern:       CommunicationPattern | null;
      patterns_count:    number;
      composite_score:   number | null;
      composite_delta:   number | null;
      top_weakness:      string | null;
      top_strength:      string | null;
      positive_rate_30d: number | null;
      messages_analyzed: number;
      has_enough_data:   boolean;
    }>('/api/insights/summary'),

  listPatterns: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{ patterns: CommunicationPattern[]; total: number }>(
      '/api/insights/patterns', { params },
    ),

  deletePattern: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/insights/patterns/${id}`),

  getWeekly: () =>
    apiClient.get<{ insights: Array<{ id: string; text?: string; is_dismissed: boolean; created_at: string }> }>(
      '/api/insights/weekly',
    ),

  getSignalsSummary: () =>
    apiClient.get<{ summary: Record<string, number>; total: number }>(
      '/api/insights/signals/summary',
    ),

  getCommitmentsSummary: () =>
    apiClient.get<{ overdue: number; due_soon: number; total_active: number }>(
      '/api/insights/commitments/summary',
    ),

  getWhyLosing: () =>
    apiClient.get<{
      has_data: boolean;
      report: {
        primary_diagnosis: string;
        evidence_summary:  string;
        immediate_fix:     string;
        skill_to_focus:    string;
        encouraging_note:  string;
        data_status:       string;
      } | null;
      generated_at: string;
      cached:       boolean;
    }>('/api/insights/why-losing'),

  getSkillTrend: () =>
    apiClient.get<{
      has_data:          boolean;
      current_week?:     string;
      previous_week?:    string;
      composite_delta?:  number | null;
      composite_current?: number | null;
      trend_status?:     string;
      summary?:          string;
      biggest_gain?:     Record<string, unknown> | null;
      biggest_drop?:     Record<string, unknown> | null;
      dimensions?:       Record<string, unknown>;
      top_weakness?:     string | null;
      top_strength?:     string | null;
    }>('/api/insights/skill-trends'),

  getWorkspaceWhyLosing: () =>
    apiClient.get<{
      has_data:     boolean;
      report:       Record<string, unknown> | null;
      scope:        string;
      generated_at: string;
    }>('/api/insights/workspace/why-losing'),

  getWorkspaceSkillMatrix: () =>
    apiClient.get<{
      members: Array<{
        user_id:        string;
        role:           string;
        name:           string;
        email:          string;
        skill_snapshot: SkillProgression | null;
        has_data:       boolean;
      }>;
      workspace_id: string;
    }>('/api/insights/workspace/skill-matrix'),

  dismissWeeklyInsight: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/insights/weekly/dismiss/${id}`),
};
