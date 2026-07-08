import { useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { AppError } from '@/api/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface SSECallbacks {
  onChunk: (content: string) => void;
  onDone:  (messageId: string) => void;
  onError: (message: string)  => void;
}

/**
 * Streams a POST request using native fetch + ReadableStream.
 *
 * Server (services/streaming.js `sendSSE`) sends standard two-line SSE
 * frames — the event name on its own line, JSON payload on the next:
 *
 *   event: message_id
 *   data: {"id":"..."}
 *
 *   event: token
 *   data: {"token":"..."}
 *
 *   event: complete
 *   data: {"message_id":"...","tokens_used":42,"model_used":"groq"}
 *
 *   event: error
 *   data: {"message":"..."}
 *
 * There is no `type` field inside the payload — the event name IS the type.
 */
export function useSSE() {
  const { accessToken } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const stream = useCallback(
    async (
      url:       string,
      body:      Record<string, unknown>,
      callbacks: SSECallbacks,
    ) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(`${API_URL}${url}`, {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${accessToken ?? ''}`,
            'Content-Type': 'application/json',
          },
          body:   JSON.stringify({ ...body, stream: true }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new AppError(
            (errorData as { message?: string }).message ?? 'Request failed',
            (errorData as { error?: string }).error   ?? 'UNKNOWN',
            response.status,
          );
        }

        if (!response.body) {
          throw new Error('No response body available for streaming');
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';
        // SSE frames are `event: <name>\ndata: <json>\n\n` — the event
        // name arrives on its own line ahead of the data line, so we
        // have to hold onto it until its matching data line shows up.
        let   pendingEvent = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              pendingEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith('data: ')) continue;

            const raw = line.slice(6).trim();
            const eventName = pendingEvent;
            pendingEvent = '';
            if (!raw || raw === '[DONE]') continue;

            try {
              const data = JSON.parse(raw) as {
                token?:      string;
                message_id?: string;
                message?:    string;
              };

              if (eventName === 'token' && data.token) {
                callbacks.onChunk(data.token);
              } else if (eventName === 'complete' && data.message_id) {
                callbacks.onDone(data.message_id);
              } else if (eventName === 'error') {
                callbacks.onError(data.message ?? 'Stream error');
              }
              // 'message_id' event (sent before streaming starts) is
              // intentionally not surfaced — ChatPage refetches on
              // 'complete' rather than needing it early.
            } catch {
              // Ignore malformed JSON lines
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const message =
          error instanceof AppError
            ? error.message
            : 'Connection failed. Please try again.';
        callbacks.onError(message);
      }
    },
    [accessToken],
  );

  return { stream, abort };
}
