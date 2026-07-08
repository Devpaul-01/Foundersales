import apiClient from './client';
import type { Followup } from './types';

// ── Metrics API ────────────────────────────────────────────────

export const metricsApi = {
  getDashboard: () =>
    apiClient.get<{
      dashboard: {
        outreach_streak:    number;
        sent_count_30d:     number;
        positive_rate:      number;
        momentum_score:     number;
        momentum_breakdown: Record<string, number>;
        momentum_insight:   string;
        average_mood:       number | null;
        // legacy aliases still returned by the route
        sent_30d?:             number;
        response_rate?:        number;
        response_rate_delta?:  number;
      };
      pipeline: {
        contacted_count:  number;
        replied_count:    number;
        call_demo_count:  number;
        closed_won_count: number;
        closed_lost_count: number;
        total_revenue:    number;
        pipeline_value:   number;
        win_rate_pct:     number;
      } | null;
      chart_data: Array<{
        date:          string;
        sent:          number;
        discovered:    number;
        positive:      number;
        positive_rate: number;
      }>;
      goals:        any[];
      practice:     { sessions_30d: number; sessions_7d: number };
      workspace_id: string;
    }>('/api/metrics/dashboard'),

  getSkillBreakdown: () =>
    apiClient.get<{
      has_data:       boolean;
      scores: {
        hook:            number | null;
        clarity:         number | null;
        value_prop:      number | null;
        personalization: number | null;
        cta:             number | null;
        tone:            number | null;
      };
      composite:      number | null;
      weakest:        string | null;
      strongest:      string | null;
      analyzed_count: number;
    }>('/api/metrics/skill-breakdown'),

  getIntelligence: () =>
    apiClient.get<{
      insights: Array<{
        type:    'pattern' | 'opportunity' | 'warning' | 'coaching';
        icon:    string;
        title:   string;
        body:    string;
        action:  string | null;
      }>;
      cached:    boolean;
      fallback?: boolean;
    }>('/api/metrics/intelligence'),

  getAlerts: () =>
    apiClient.get<{
      alerts: Array<{
        type:     string;
        icon:     string;
        priority: 'high' | 'medium' | 'low';
        title:    string;
        body:     string;
        action:   string | null;
      }>;
      count: number;
    }>('/api/metrics/alerts'),

  getPracticeRecommendations: () =>
    apiClient.get<{
      recommendations: Array<{
        priority:    'high' | 'medium' | 'low';
        scenario:    string;
        title:       string;
        description: string;
      }>;
    }>('/api/metrics/practice-recommendations'),

  getProspectsHealth: () =>
    apiClient.get<{
      has_data:           boolean;
      total_prospects?:   number;
      avg_health_score?:  number | null;
      at_risk?: Array<{
        id: string; name: string; company: string | null; stage: string | null;
        relationship_health_score: number | null; last_contact_at: string | null; total_interactions: number | null;
      }>;
      top_relationships?: Array<{
        id: string; name: string; company: string | null; relationship_health_score: number | null;
      }>;
      stale_count?:        number;
      stage_distribution?: Record<string, number>;
    }>('/api/metrics/prospects-health'),

  getCalendarPrep: () =>
    apiClient.get<{
      has_data:      boolean;
      needs_prep?:    Array<{ id: string; title: string; event_date: string; event_type: string | null; attendee_name: string | null }>;
      needs_debrief?: Array<{ id: string; title: string; event_date: string; outcome: string | null; attendee_name: string | null }>;
      avg_energy_score?:     number | null;
      outcome_distribution?: Record<string, number>;
    }>('/api/metrics/calendar-prep'),

  getPracticeSkillProfile: () =>
    apiClient.get<{
      has_data: boolean;
      period?:  { start: string; end: string };
      axes?: {
        clarity: number | null; value: number | null; discovery: number | null;
        objection: number | null; brevity: number | null; cta: number | null;
      };
      overall_avg?:   number | null;
      overall_delta?: number | null;
      weakest_axis?:   string | null;
      strongest_axis?: string | null;
      sessions_count?: number | null;
      weekly_monologue_score?: number | null;
      outcome_distribution?:   Record<string, number>;
      pressure_scores?:        Record<string, number>;
    }>('/api/metrics/practice-skill-profile'),

  getAchievements: () =>
    apiClient.get<{
      badges: Array<{
        badge_type: string; badge_label: string; badge_description: string | null; earned_at: string;
      }>;
      recent_drills: Array<{
        drill_type: string; target_axis: string; score_before: number; score_after: number; completed_at: string;
      }>;
      drill_improvements: Array<{ axis: string; avg_improvement: number; drills_completed: number }>;
    }>('/api/metrics/achievements'),

  getPracticeSummary: (period: '7d' | '30d' | '90d' = '30d') =>
    apiClient.get<{
      has_data:  boolean;
      period:    string;
      total_sessions?:     number;
      completed_sessions?: number;
      goal_achieved_rate?:  number;
      avg_session_score?:   number | null;
      avg_exchanges?:       number | null;
      reply_received_rate?: number;
      ai_ended_rate?:       number;
      retry_rate?:          number;
      by_scenario?: Record<string, { count: number; avg_score: number | null; goal_achieved_rate: number }>;
      pressure_modifier_performance?: Record<string, number>;
      badges_earned?: number;
    }>('/api/metrics/practice/summary', { params: { period } }),

  getObjections: () =>
    apiClient.get<{
      has_data: boolean;
      objections: Array<{
        type: string; occurrence_count: number; first_seen_at: string; last_seen_at: string;
        best_response: string | null; response_score: number | null; practice_score: number | null;
        outcome_after: string | null; has_market_intel: boolean; sample_phrase: string;
      }>;
      total_unique_types: number;
    }>('/api/metrics/objections'),

  getMeetingsSummary: (period: '30d' | '90d' = '30d') =>
    apiClient.get<{
      has_data: boolean;
      period:   string;
      total_meetings?:  number;
      debriefed?:       number;
      debrief_completion_rate?: number;
      outcomes?: { positive: number; negative: number; pending: number };
      avg_energy_score?:  number | null;
      meetings_with_prep_generated?: number;
      follow_up_options_generated?:  number;
    }>('/api/metrics/meetings/summary', { params: { period } }),

  getConversationAnalyses: () =>
    apiClient.get<{
      has_data:      boolean;
      total:         number;
      avg_scores: {
        hook:            number | null;
        clarity:         number | null;
        value_prop:      number | null;
        personalization: number | null;
        cta:             number | null;
        tone:            number | null;
        composite:       number | null;
      };
      trend_delta:   number | null;
      top_failures:  Array<{ label: string; count: number }>;
      top_successes: Array<{ label: string; count: number }>;
      improvements:  Array<{
        priority:   number;
        dimension:  string;
        suggestion: string;
        example?:   string;
        outcome:    string;
        date:       string;
      }>;
      recent: Array<{
        id:                      string;
        outcome:                 string;
        platform:                string | null;
        composite_score:         number | null;
        analysis_text:           string | null;
        failure_categories:      string[];
        success_signals:         string[];
        improvement_suggestions: any[];
        rewritten_message:       string | null;
        has_social_proof:        boolean;
        has_specific_ask:        boolean;
        self_referential_ratio:  number | null;
        word_count:              number | null;
        created_at:              string;
      }>;
    }>('/api/metrics/conversation-analyses'),

  // Workspace / manager routes
  getLeaderboard: () =>
    apiClient.get<{
      leaderboard: Array<{
        user_id:       string;
        role:          string;
        name:          string;
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
        user_id:        string;
        name:           string;
        flags:          string[];
        skill_score:    number | null;
        score_delta:    number | null;
        top_weakness:   string | null;
        needs_coaching: boolean;
      }>;
      workspace_id: string;
    }>('/api/metrics/workspace/coaching-queue'),

  getTeamVelocity: () =>
    apiClient.get<{
      has_data:                 boolean;
      current_week?:            string;
      previous_week?:           string;
      team_composite_current?:  number | null;
      team_composite_previous?: number | null;
      team_composite_delta?:    number | null;
      active_members_current?:  number;
      active_members_previous?: number;
      trend?:                   'improving' | 'declining' | 'stable' | 'no_data';
      message?:                 string;
    }>('/api/metrics/workspace/team-velocity'),

  getTeamOverview: () =>
    apiClient.get<{
      members: Array<{
        user_id:                 string;
        name:                    string;
        sessions_this_week:      number;
        avg_skill_score:         number | null;
        weakest_axis:            string | null;
        last_active:             string | null;
        outreach_sent_this_week: number;
        goal_completion_pct:     number;
      }>;
      team_avg_score:                   number | null;
      team_weakest_axis:                string | null;
      members_not_practiced_this_week:  string[];
      workspace_id:                     string;
    }>('/api/metrics/workspace/team-overview'),
};

// ── Follow-up API ──────────────────────────────────────────────

export const followupApi = {
  list: (params?: { page?: number; limit?: number; urgency?: string }) =>
    apiClient.get<{
      followups:  Followup[];
      pagination: { has_more: boolean; page: number };
      counts:     { overdue: number; today: number; upcoming: number };
    }>('/api/followup', { params }),

  markDone: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/followup/${id}/done`),

  snooze: (id: string, body: { days: number }) =>
    apiClient.post<{ success: boolean }>(`/api/followup/${id}/snooze`, body),

  markSent: (id: string) =>
    apiClient.post<{ success: boolean; follow_up_count: number }>(`/api/followup/${id}/sent`),

  dismiss: (id: string) =>
    apiClient.post<{ success: boolean }>(`/api/followup/${id}/dismiss`),

  getUnviewedCount: () =>
    apiClient.get<{ unviewed_count: number }>('/api/followup/unviewed-count'),
};
