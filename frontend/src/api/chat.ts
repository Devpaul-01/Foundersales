import apiClient from './client';
import type { Chat, ChatMessage } from './types';

// ── Retry helper ─────────────────────────────────────────────
// Wraps a request so transient network failures (dropped connection, DNS
// hiccup, request timeout, CORS preflight blip, etc.) get a few automatic
// retries with exponential backoff instead of failing the user's action
// outright. Deliberately conservative about *what* gets retried:
//
//  - Network errors (the request never got a response at all, i.e.
//    `error.response` is undefined) are always safe-ish to retry: the
//    server either never saw the request or its reply never arrived, so
//    replaying it is the best available recovery.
//  - 5xx server errors are retried too, but only for calls we've marked
//    idempotent (GETs, and the few others explicitly opted in below) —
//    retrying a POST after a 5xx risks double-submitting if the server
//    actually processed the request before failing to respond.
//  - 4xx errors are never retried — they mean the request itself was
//    invalid, unauthorized, or not found, and retrying changes nothing.
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

      // Exponential backoff (500ms, 1000ms, 2000ms, ...) with up to 30%
      // jitter so a batch of clients retrying together don't all hammer
      // the server in lockstep.
      const delay = BASE_DELAY_MS * 2 ** attempt;
      const jitter = delay * 0.3 * Math.random();
      await sleep(delay + jitter);
    }
  }
  // Unreachable, but keeps TypeScript happy about the return type.
  throw lastError;
}

// Idempotent reads: safe to retry on both network errors and 5xxs.
const retryRead = <T>(fn: () => Promise<T>) =>
  withRetry(fn, { retryOn: (e) => isNetworkError(e) || isServerError(e) });

// Non-idempotent writes: only retry when the request never got a response.
// If the server returned a 5xx, it may well have processed the write before
// failing to reply, so blindly retrying risks duplicates.
const retryWrite = <T>(fn: () => Promise<T>) =>
  withRetry(fn, { retryOn: isNetworkError });

export const chatApi = {
  list: (params?: { type?: string; mode?: string; limit?: number; offset?: number; search?: string }) =>
    retryRead(() => apiClient.get<{ chats: Chat[] }>('/api/chat', { params })),

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
    retryWrite(() => apiClient.post<{ chat: Chat; message: ChatMessage }>('/api/chat/with-message', body)),

  getById: (chatId: string, params?: { limit?: number; before?: string }) =>
    retryRead(() => apiClient.get<{
      chat:         Chat;
      messages:     ChatMessage[];
      linked_event: import('./types').CalendarEvent | null;
    }>(`/api/chat/${chatId}`, { params })),

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

  // NEW: alias for archive — reads more clearly at call sites that are
  // specifically deleting a chat (e.g. a trash-icon button) rather than
  // archiving it as part of some other flow. Same soft-delete endpoint.
  delete: (chatId: string) =>
    retryWrite(() => apiClient.delete<{ success: boolean }>(`/api/chat/${chatId}`)),

  // NEW: rename a chat's title
  rename: (chatId: string, title: string) =>
    retryWrite(() => apiClient.patch<{ chat: Chat }>(`/api/chat/${chatId}`, { title })),

  // NEW: search within a single chat's messages (distinct from `list`'s
  // title search, which searches across the whole chat list).
  searchMessages: (chatId: string, query: string, params?: { limit?: number }) =>
    retryRead(() =>
      apiClient.get<{ messages: ChatMessage[]; query: string }>(
        `/api/chat/${chatId}/search`, { params: { q: query, ...params } },
      ),
    ),

  // NEW: regenerate the most recent assistant reply. Deletes the stale
  // reply server-side and re-runs the model against the same history.
  // Not retried on network failure automatically (see `sendMessage`-style
  // callers) because a lost response here is ambiguous about whether the
  // regenerate already happened — callers should re-check chat state
  // (e.g. refetch) before calling again after a failure.
  regenerate: (chatId: string, body?: { stream?: false }) =>
    apiClient.post<{ message: ChatMessage }>(`/api/chat/${chatId}/regenerate`, { stream: false, ...body }),

  // NEW: edit a message (only the most recent message in the chat is
  // eligible) and regenerate the response that follows it. Anything after
  // the edited message is discarded server-side.
  editMessage: (chatId: string, messageId: string, message: string) =>
    apiClient.patch<{ message: ChatMessage }>(
      `/api/chat/${chatId}/message/${messageId}`, { message, stream: false },
    ),
};
