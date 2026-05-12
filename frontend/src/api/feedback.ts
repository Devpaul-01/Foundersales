import apiClient from './client';
import type { Feedback, Opportunity } from './types';

export const feedbackApi = {
  submit: (body: {
    opportunity_id:        string;
    outcome:               'positive' | 'negative' | 'pending';
    outcome_note?:         string | null;
    is_final?:             boolean;
    deal_value_usd?:       number | null;
    scheduled_call?:       boolean;
    scheduled_call_date?:  string | null;
    scheduled_call_notes?: string | null;
  }) =>
    apiClient.post<{ feedback: Feedback }>('/api/feedback', body),

  getPending: () =>
    apiClient.get<{ opportunities: Opportunity[] }>('/api/feedback/pending'),

  getHistory: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{
      feedback: Array<Feedback & { opportunities?: Opportunity }>;
    }>('/api/feedback/history', { params }),
};
