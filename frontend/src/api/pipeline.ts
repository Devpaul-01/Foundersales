import apiClient from './client';
import type { Opportunity, PipelineMetrics, Feedback, CalendarPrompt } from './types';

export const pipelineApi = {
  getBoard: (view?: 'team') =>
    apiClient.get<{
      pipeline: {
        contacted:   Opportunity[];
        replied:     Opportunity[];
        call_demo:   Opportunity[];
        closed_won:  Opportunity[];
        closed_lost: Opportunity[];
      };
      view:    'individual' | 'team';
      metrics: PipelineMetrics;
    }>('/api/pipeline', { params: view ? { view } : {} }),

  getMetrics: () =>
    apiClient.get<PipelineMetrics>('/api/pipeline/metrics'),

  getTeam: () =>
    apiClient.get<{ deals: Opportunity[]; workspace_id: string }>('/api/pipeline/team'),

  getDeal: (id: string) =>
    apiClient.get<{ deal: Opportunity & { feedback: Feedback[] } }>(`/api/pipeline/${id}`),

  deleteDeal: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/pipeline/${id}`),

  updateStage: (id: string, stage: string, lostReason?: string) =>
    apiClient.put<{
      success:         boolean;
      previous_stage:  string;
      new_stage:       string;
      calendar_prompt: CalendarPrompt | null;
    }>(`/api/pipeline/${id}/stage`, {
      stage,
      ...(lostReason ? { lost_reason: lostReason } : {}),
    }),

  updateDealValue: (id: string, dealValueUsd: number) =>
    apiClient.patch<{ success: boolean; deal_value_usd: number }>(
      `/api/pipeline/${id}/deal-value`, { deal_value_usd: dealValueUsd },
    ),

  assignDeal: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>(
      `/api/pipeline/${id}/assign`, { user_id: userId },
    ),
};
