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
 * Server sends: data: {"type":"chunk","content":"..."}\n
 *               data: {"type":"done","message_id":"..."}\n
 *               data: {"type":"error","message":"..."}\n
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

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;

            try {
              const data = JSON.parse(raw) as {
                type:        'chunk' | 'done' | 'error';
                content?:    string;
                message_id?: string;
                message?:    string;
              };

              if (data.type === 'chunk' && data.content) {
                callbacks.onChunk(data.content);
              } else if (data.type === 'done' && data.message_id) {
                callbacks.onDone(data.message_id);
              } else if (data.type === 'error') {
                callbacks.onError(data.message ?? 'Stream error');
              }
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
