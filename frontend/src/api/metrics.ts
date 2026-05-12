import apiClient from './client';
import type { MetricsDashboard } from './types';

export const metricsApi = {
  getDashboard: () =>
    apiClient.get<MetricsDashboard>('/api/metrics/dashboard'),

  getSkillBreakdown: () =>
    apiClient.get<{
      has_data:      boolean;
      scores?:       Record<string, number | null>;
      composite?:    number | null;
      weakest?:      string | null;
      strongest?:    string | null;
      analyzed_count?: number;
    }>('/api/metrics/skill-breakdown'),

  getIntelligence: () =>
    apiClient.get<{
      insights: Array<{
        type:        'pattern' | 'opportunity' | 'warning';
        icon:        string;
        title:       string;
        body:        string;
        action:      string | null;
      }>;
      cached:   boolean;
      fallback?: boolean;
    }>('/api/metrics/intelligence'),

  getTeamLeaderboard: () =>
    apiClient.get<{
      leaderboard: Array<{
        user_id:       string;
        name:          string;
        role:          string;
        sent_30d:      number;
        positive_rate: number;
        closed_won:    number;
        total_revenue: number;
        score:         number;
      }>;
      workspace_id: string;
    }>('/api/metrics/workspace/leaderboard'),

  getCoachingQueue: () =>
    apiClient.get<{
      queue: Array<{
        user_id:       string;
        name:          string;
        flags:         string[];
        skill_score:   number | null;
        score_delta:   number | null;
        top_weakness:  string | null;
        needs_coaching: boolean;
      }>;
      workspace_id: string;
    }>('/api/metrics/workspace/coaching-queue'),

  getTeamVelocity: () =>
    apiClient.get<{
      has_data:                  boolean;
      current_week?:             string;
      previous_week?:            string;
      team_composite_current?:   number | null;
      team_composite_previous?:  number | null;
      team_composite_delta?:     number | null;
      trend?:                    string;
    }>('/api/metrics/workspace/team-velocity'),

  getTeamOverview: () =>
    apiClient.get<{
      members: Array<{
        user_id:                  string;
        name:                     string;
        sessions_this_week:       number;
        avg_skill_score:          number | null;
        weakest_axis:             string | null;
        last_active:              string | null;
        outreach_sent_this_week:  number;
        goal_completion_pct:      number;
      }>;
      team_avg_score:                       number | null;
      team_weakest_axis:                    string | null;
      members_not_practiced_this_week:      string[];
      workspace_id:                         string;
    }>('/api/metrics/workspace/team-overview'),
};
