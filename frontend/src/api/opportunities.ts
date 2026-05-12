import apiClient from './client';
import type { Opportunity, OpportunityIntel } from './types';

export const opportunitiesApi = {
  list: (params: { status?: string; limit?: number; offset?: number }) =>
    apiClient.get<{
      opportunities:  Opportunity[];
      should_refresh: boolean;
      workspace_id:   string;
    }>('/api/opportunities', { params }),

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
    apiClient.get<{ intel: OpportunityIntel | null; reason: string | null }>(
      `/api/opportunities/${id}/intel`,
    ),

  updateStatus: (id: string, status: string) =>
    apiClient.put<{ success: boolean; status: string }>(
      `/api/opportunities/${id}/status`, { status },
    ),

  assign: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>(
      `/api/opportunities/${id}/assign`, { user_id: userId },
    ),
};
