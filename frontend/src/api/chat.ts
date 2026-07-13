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

// Conversation export (Markdown today; PDF is generated client-side from
// this same markdown via print-to-PDF — see ChatPage.tsx's handleExport).
export interface ChatExportResponse {
  chat_id:  string;
  format:   'markdown';
  filename: string;
  content:  string;
}

export const chatApi = {
  // FIX: `type`/`mode` are now typed against the same enums used by
  // create()/createWithMessage() (previously loose `string`). Param
  // names stay `type`/`mode` to match chat.js's GET / handler
  // (`const { type, mode, ... } = req.query`), which filters with
  // `.eq('chat_type', type)` / `.eq('chat_mode', mode)` when present.
  // Either, both, or neither may be supplied alongside search/pagination.
  list: (params?: {
    type?:   'general' | 'opportunity' | 'practice';
    mode?:   'general' | 'meeting_notes' | 'prep' | 'followup_coach';
    limit?:  number;
    offset?: number;
    search?: string;
  }) =>
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

  // NEW: conversation export. Server only produces markdown (no PDF
  // engine in this service); the client turns that markdown into a PDF
  // itself via the browser's print dialog. See ChatPage.tsx handleExport.
  export: (chatId: string) =>
    retryRead(() => apiClient.get<ChatExportResponse>(`/api/chat/${chatId}/export`, { params: { format: 'markdown' } })),

  searchMessages: (chatId: string, query: string, params?: { limit?: number }) =>
    retryRead(() =>
      apiClient.get<{ messages: ChatMessage[]; query: string }>(
        `/api/chat/${chatId}/search`, { params: { q: query, ...params } },
      ),
    ),

  // FIX: regenerate now accepts `force_search`, mirroring sendMessage's
  // exa-search override — see chat.js's POST /:chatId/regenerate, which
  // now runs the same checkWorkspaceExaUsage → searchForChat → citations
  // flow as POST /:chatId/message when force_search is true.
  regenerate: (chatId: string, body?: { stream?: false; force_search?: boolean }) =>
    apiClient.post<{ message: ChatMessage }>(`/api/chat/${chatId}/regenerate`, { stream: false, ...body }),

  editMessage: (chatId: string, messageId: string, message: string, stream: boolean = true) =>
    apiClient.patch<{ message: ChatMessage }>(
      `/api/chat/${chatId}/message/${messageId}`, { message, stream },
    ),
};
