// src/api/pipeline.ts
import apiClient from './client';
import type { 
  Opportunity, 
  PipelineMetrics, 
  Feedback, 
  CalendarPrompt,
  PipelineBoardOpportunity,
  PipelineBoardResponse 
} from './types';

export const pipelineApi = {
  getBoard: (view?: 'team') =>
    apiClient.get<PipelineBoardResponse>('/api/pipeline', { 
      params: view ? { view } : {} 
    }),

  getMetrics: () =>
    apiClient.get<PipelineMetrics>('/api/pipeline/metrics'),

  getTeam: () =>
    apiClient.get<{ deals: PipelineBoardOpportunity[]; workspace_id: string }>('/api/pipeline/team'),

  getDeal: (id: string) =>
    apiClient.get<{ deal: Opportunity & { feedback: Feedback[] } }>(`/api/pipeline/${id}`).then(response => {
      const deal = response.data.deal;
      if (deal.feedback && !Array.isArray(deal.feedback)) {
        deal.feedback = [deal.feedback];
      }
      if (!deal.feedback) {
        deal.feedback = [];
      }
      return response;
    }),

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
      `/api/pipeline/${id}/deal-value`, 
      { deal_value_usd: dealValueUsd },
    ),

  assignDeal: (id: string, userId: string) =>
    apiClient.put<{ success: boolean; assigned_to: string }>(
      `/api/pipeline/${id}/assign`, 
      { user_id: userId },
    ),
};