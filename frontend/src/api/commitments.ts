import apiClient from './client';
import type { ConversationCommitment } from './types';

export const commitmentsApi = {
  list: (params?: { status?: string; owner?: string; limit?: number }) =>
    apiClient.get<{
      commitments: ConversationCommitment[];
      overdue:     ConversationCommitment[];
      due_soon:    ConversationCommitment[];
      pending:     ConversationCommitment[];
    }>('/api/commitments', { params }),

  update: (id: string, body: { status?: string; due_date?: string | null; completion_note?: string }) =>
    apiClient.put<{ success: boolean; commitment: ConversationCommitment }>(
      `/api/commitments/${id}`, body,
    ),

  generateMessage: (id: string) =>
    apiClient.post<{ success: boolean; message: string }>(
      `/api/commitments/${id}/generate-message`,
    ),
};
