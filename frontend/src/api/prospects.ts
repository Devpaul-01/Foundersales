import apiClient from './client';
import type { Prospect, ProspectTimeline, ConversationSignal, ConversationCommitment, CalendarEvent, Chat } from './types';

export const prospectsApi = {
  list: (params?: { sort?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ prospects: Array<Prospect & { pending_commitments: number }> }>(
      '/api/prospects', { params },
    ),

  create: (body: {
    name:          string;
    company?:      string | null;
    title?:        string | null;
    email?:        string | null;
    linkedin_url?: string | null;
    platform?:     string | null;
    notes?:        string | null;
    stage?:        string;
  }) =>
    apiClient.post<{ prospect: Prospect }>('/api/prospects', body),

  getById: (id: string) =>
    apiClient.get<{
      prospect:    Prospect;
      timeline:    ProspectTimeline[];
      signals:     ConversationSignal[];
      commitments: ConversationCommitment[];
      meetings:    CalendarEvent[];
      chats:       Chat[];
    }>(`/api/prospects/${id}`),

  update: (id: string, body: Partial<{
    name:         string;
    company:      string | null;
    title:        string | null;
    email:        string | null;
    linkedin_url: string | null;
    platform:     string | null;
    notes:        string | null;
    stage:        string;
  }>) =>
    apiClient.put<{ success: boolean }>(`/api/prospects/${id}`, body),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/prospects/${id}`),

  refreshSummary: (id: string) =>
    apiClient.post<{ success: boolean; summary: string }>(`/api/prospects/${id}/refresh-summary`),
};
