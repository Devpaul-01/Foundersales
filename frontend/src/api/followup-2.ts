import apiClient from './client';
import type { Followup } from './types';

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
