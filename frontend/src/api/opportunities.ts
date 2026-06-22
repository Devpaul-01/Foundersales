import apiClient from './client';
import type { Opportunity, OpportunityIntel, OpportunityOutreach } from './types';

export const opportunitiesApi = {
  list: (params: { status?: string; limit?: number; offset?: number }) =>
    apiClient.get<{
      opportunities:  Opportunity[];
      should_refresh: boolean;
      workspace_id:   string;
    }>('/api/opportunities', { params }),
    create: (body: {
  platform:          string;
  prepared_message:  string;
  stage?:            string;
  target_name?:      string;
  target_context?:   string;
  source_url?:       string;
  follow_up_message?: string;
  fit_score?:        number;
  timing_score?:     number;
  intent_score?:     number;
}) =>
  apiClient.post<{ opportunity: Opportunity }>('/api/opportunities', body),

  refresh: () =>
    apiClient.post<{
      opportunities: { id: string }[];
      count:         number;
      notice:        string | null;
      is_fallback:   boolean;
    }>('/api/opportunities/refresh'),

  listTeam: () =>
    apiClient.get<{ opportunities: Opportunity[]; workspace_id: string }>(
      '/api/opportunities/team',
    ),

  getById: (id: string) =>
    apiClient.get<{ opportunity: Opportunity }>(`/api/opportunities/${id}`),

  getIntel: (id: string) =>
    apiClient.get<{
      intel:    OpportunityIntel    | null;
      outreach: OpportunityOutreach | null;
      research: { citations: string[] } | null;
      reason:   string | null;
      cached:   boolean;
    }>(`/api/opportunities/${id}/intel`),

  updateStatus: (id: string, status: string) =>
    apiClient.put<{ success: boolean; status: string }>(
      `/api/opportunities/${id}/status`, { status },
    ),

  assign: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>(
      `/api/opportunities/${id}/assign`, { user_id: userId },
    ),

  trackLinkClick: (id: string) =>
    apiClient.put<{ success: boolean; link_clicked_at: string }>(
      `/api/opportunities/${id}/link-clicked`, {},
    ),

  trackMessageCopy: (id: string) =>
    apiClient.put<{ success: boolean; message_copied_at: string }>(
      `/api/opportunities/${id}/message-copied`, {},
    ),
};
