import apiClient from './client';
import type { Chat, ChatMessage } from './types';

export const chatApi = {
  list: (params?: { type?: string; mode?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ chats: Chat[] }>('/api/chat', { params }),

  create: (body: {
    title?:         string;
    chat_type?:     'general' | 'opportunity' | 'practice';
    chat_mode?:     'general' | 'meeting_notes' | 'prep' | 'followup_coach';
    opportunity_id?: string | null;
    prospect_id?:   string | null;
    event_id?:      string | null;
    initial_context?: string | null;
    growth_card_id?: string | null;
  }) =>
    apiClient.post<{ chat: Chat }>('/api/chat', body),

  // NEW: Create chat with initial message in one request
  createWithMessage: (body: {
    message:        string;
    chat_type?:     'general' | 'opportunity' | 'practice';
    chat_mode?:     'general' | 'meeting_notes' | 'prep' | 'followup_coach';
    opportunity_id?: string | null;
    prospect_id?:   string | null;
    event_id?:      string | null;
    title?:         string;
    force_search?:  boolean;
    attachments?:   Array<{ name: string; type: string; url?: string }>;
    growth_card_id?: string | null;
  }) =>
    apiClient.post<{ chat: Chat; message: ChatMessage }>('/api/chat/with-message', body),

  getById: (chatId: string, params?: { limit?: number; before?: string }) =>
    apiClient.get<{
      chat:         Chat;
      messages:     ChatMessage[];
      linked_event: import('./types').CalendarEvent | null;
    }>(`/api/chat/${chatId}`, { params }),

  sendMessage: (
    chatId: string,
    body: {
      message:       string;
      stream:        false;
      force_search?: boolean;
      attachments?:  Array<{ name: string; type: string; url?: string }>;
      chat_mode?:    string;
    },
  ) =>
    apiClient.post<{ message: ChatMessage; event_id?: string | null }>(
      `/api/chat/${chatId}/message`, body,
    ),

  archive: (chatId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/chat/${chatId}`),
};