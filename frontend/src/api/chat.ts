import apiClient from './client';
import type { Chat, ChatMessage } from './types';

// ── Retry helper ─────────────────────────────────────────────
const DEFAULT_RETRIES = 2;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(error: any) {
  return !error?.response;
}

function isServerError(error: any) {
  const status = error?.response?.status;
  return typeof status === 'number' && status >= 500 && status < 600;
}

interface RetryOptions {
  retries?: number;
  retryOn?: (error: any) => boolean;
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryOn = options.retryOn ?? isNetworkError;

  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !retryOn(error)) throw error;

      const delay = BASE_DELAY_MS * 2 ** attempt;
      const jitter = delay * 0.3 * Math.random();
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}

const retryRead = <T>(fn: () => Promise<T>) =>
  withRetry(fn, { retryOn: (e) => isNetworkError(e) || isServerError(e) });

const retryWrite = <T>(fn: () => Promise<T>) =>
  withRetry(fn, { retryOn: isNetworkError });

// ── Pagination response shapes (chat audit §4.1, §6) ──────────
export interface ChatListResponse {
  chats: Chat[];
  has_more: boolean;
  next_offset: number | null;
}

export interface ChatMessagesResponse {
  chat: Chat;
  messages: ChatMessage[];
  linked_event: import('./types').CalendarEvent | null;
  has_more: boolean;
  oldest_seq: number | null;
}

export const chatApi = {
  list: (params?: { type?: string; mode?: string; limit?: number; offset?: number; search?: string }) =>
    retryRead(() => apiClient.get<ChatListResponse>('/api/chat', { params })),

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
    retryWrite(() => apiClient.post<{ chat: Chat }>('/api/chat', body)),

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
    retryWrite(() => apiClient.post<{ chat: Chat; message: ChatMessage }>('/api/chat/with-message', body)),

  // FIX §4.1: `before_seq` replaces the old `before` (created_at) cursor.
  // Omitting it fetches the LATEST `limit` messages (previously this
  // fetched the OLDEST — see chat.js's GET /:chatId comments). Pass
  // `before_seq: response.data.oldest_seq` to load the page further back.
  getById: (chatId: string, params?: { limit?: number; before_seq?: number }) =>
    retryRead(() => apiClient.get<ChatMessagesResponse>(`/api/chat/${chatId}`, { params })),

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
    retryWrite(() =>
      apiClient.post<{ message: ChatMessage; event_id?: string | null }>(
        `/api/chat/${chatId}/message`, body,
      ),
    ),

  archive: (chatId: string) =>
    retryWrite(() => apiClient.delete<{ success: boolean }>(`/api/chat/${chatId}`)),

  delete: (chatId: string) =>
    retryWrite(() => apiClient.delete<{ success: boolean }>(`/api/chat/${chatId}`)),

  rename: (chatId: string, title: string) =>
    retryWrite(() => apiClient.patch<{ chat: Chat }>(`/api/chat/${chatId}`, { title })),

  searchMessages: (chatId: string, query: string, params?: { limit?: number }) =>
    retryRead(() =>
      apiClient.get<{ messages: ChatMessage[]; query: string }>(
        `/api/chat/${chatId}/search`, { params: { q: query, ...params } },
      ),
    ),

  regenerate: (chatId: string, body?: { stream?: false }) =>
    apiClient.post<{ message: ChatMessage }>(`/api/chat/${chatId}/regenerate`, { stream: false, ...body }),

  editMessage: (chatId: string, messageId: string, message: string, stream: boolean = true) =>
    apiClient.patch<{ message: ChatMessage }>(
      `/api/chat/${chatId}/message/${messageId}`, { message, stream },
    ),
};
