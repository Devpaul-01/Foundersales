// ============================================================
// FILE: src/pages/chat/ChatPage.tsx
// From chat-9.txt:
// - SSE streaming (fetch + ReadableStream)
// - workspace_id on all inserts (HIGH-01)
// - user_memory scoped to workspace_id (HIGH-05 read-side)
// - workspace-level Perplexity quota (HIGH-11)
// - LOW-07: message max 5000 chars
// - LOW-08: buildChatSystemPrompt called unconditionally
// - meeting_notes mode support
// ============================================================
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { chatApi }     from '@/api/chat';
import { uploadApi }   from '@/api/misc';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useSSE }      from '@/hooks/useSSE';
import { useToast }    from '@/hooks/useToast';
import { suggestionsApi } from '@/api/misc';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { Skeleton }    from '@/components/ui/Skeleton';
import { CopyButton, InlineAlert, Spinner } from '@/components/common/index';
import { AppError, type ChatMessage, type Chat } from '@/api/types';
import { CHAT_MESSAGE_MAX_LENGTH, ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/constants';
import { formatRelativeDate, cn, generateId } from '@/lib/utils';
import {
  Send, Globe, Paperclip, ArrowLeft,
  Calendar, MessageCircle, X,
} from 'lucide-react';

// ── Message bubble ────────────────────────────────────────────
function ChatBubble({
  message, isStreaming, streamContent,
}: {
  message?:      ChatMessage;
  isStreaming?:  boolean;
  streamContent?: string;
}) {
  const content  = streamContent ?? message?.content ?? '';
  const isUser   = message?.role === 'user';
  const isSystem = message?.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <p className="text-xs text-text-muted italic bg-surface-base border border-surface-border rounded-full px-3 py-1">
          {content.slice(0, 80)}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand text-xs shrink-0 mt-1 font-bold">
          C
        </div>
      )}
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-2.5',
        isUser
          ? 'bg-brand text-white rounded-br-sm text-sm'
          : 'bg-white border border-surface-border text-text-primary rounded-bl-sm',
      )}>
        {isUser ? (
          <p className="text-sm leading-relaxed">{content}</p>
        ) : (
          <div className={cn(
            'prose prose-sm max-w-none text-text-primary',
            isStreaming && 'streaming-cursor',
          )}>
            <ReactMarkdown
              components={{
                p:    ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
                ul:   ({ children }) => <ul className="list-disc pl-4 mb-2 text-sm">{children}</ul>,
                ol:   ({ children }) => <ol className="list-decimal pl-4 mb-2 text-sm">{children}</ol>,
                li:   ({ children }) => <li className="mb-0.5">{children}</li>,
                code: ({ children }) => <code className="bg-surface-base px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
        {!isStreaming && message && (
          <div className={cn(
            'flex items-center gap-1 mt-1',
            isUser ? 'justify-end' : 'justify-start',
          )}>
            <span className={cn('text-xs', isUser ? 'text-brand-200' : 'text-text-muted')}>
              {formatRelativeDate(message.created_at)}
            </span>
            {!isUser && <CopyButton text={content} className="opacity-0 group-hover:opacity-100" />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { chatId }     = useParams<{ chatId: string }>();
  const navigate       = useNavigate();
  const { showToast }  = useToast();
  const { stream, abort } = useSSE();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  const [message,       setMessage]       = useState('');
  const [forceSearch,   setForceSearch]   = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [attachments,   setAttachments]   = useState<Array<{ name: string; type: string; url: string }>>([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Fetch chat + messages
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn:  () => chatApi.getById(chatId!).then((r) => r.data),
    enabled:  !!chatId,
    staleTime: 30_000,
  });

  const { data: suggestions } = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn:  () => suggestionsApi.get().then((r) => r.data.suggestions),
    staleTime: 5 * 60_000,
  });

  const chat     = data?.chat;
  const dbMessages = data?.messages ?? [];
  const allMessages = [
    ...dbMessages,
    ...localMessages,
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const visibleMessages = allMessages.filter((m) => m.role !== 'system');

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages, streamContent]);

  // Cleanup streaming on unmount
  useEffect(() => () => abort(), [abort]);

  const handleSend = async () => {
    const text = message.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;

    // Optimistic user message
    const tempId = `temp-${generateId()}`;
    const tempMsg: ChatMessage = {
      id:              tempId,
      chat_id:         chatId!,
      role:            'user',
      content:         text,
      delivery_status: 'delivered',
      created_at:      new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, tempMsg]);
    setMessage('');
    setForceSearch(false);
    setAttachments([]);
    setIsStreaming(true);
    setStreamContent('');

    try {
      await stream(
        `/api/chat/${chatId}/message`,
        {
          message:      text || '[attachment]',
          stream:       true,
          force_search: forceSearch,
          attachments:  attachments.length > 0 ? attachments : undefined,
        },
        {
          onChunk: (chunk) => setStreamContent((prev) => prev + chunk),
          onDone:  (messageId) => {
            setIsStreaming(false);
            setStreamContent('');
            // Refetch to get real AI message
            queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
            setLocalMessages([]);
          },
          onError: (err) => {
            setIsStreaming(false);
            setStreamContent('');
            showToast(err || 'Message failed.', 'error');
          },
        },
      );
    } catch {
      setIsStreaming(false);
      setStreamContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        showToast(`${file.name}: unsupported file type.`, 'error');
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        showToast(`${file.name}: file too large (max 10MB).`, 'error');
        continue;
      }
      if (attachments.length >= 10) {
        showToast('Maximum 10 attachments per message.', 'warning');
        break;
      }
      setUploadingFile(true);
      try {
        const { data: res } = await uploadApi.upload(file, chatId);
        setAttachments((prev) => [...prev, {
          name: res.file.filename,
          type: res.file.type,
          url:  res.file.url,
        }]);
      } catch {
        showToast(`Could not upload ${file.name}.`, 'error');
      } finally {
        setUploadingFile(false);
      }
    }
  };

  const isMeetingNotes = chat?.chat_mode === 'meeting_notes';

  return (
    <div className="flex flex-col h-dvh bg-surface-base">
      {/* Header */}
      <div className="bg-white border-b border-surface-border px-4 py-3 shrink-0 flex items-center gap-3">
        <button onClick={() => navigate('/chat')} className="text-text-muted hover:text-text-primary">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{chat?.title ?? 'Chat'}</p>
          {chat?.chat_mode && chat.chat_mode !== 'general' && (
            <Badge variant="blue" size="xs" className="mt-0.5">{chat.chat_mode.replace('_', ' ')}</Badge>
          )}
        </div>
        {isMeetingNotes && data?.linked_event && (
          <button
            onClick={() => navigate(`/calendar/${data.linked_event!.id}`)}
            className="text-text-muted hover:text-brand flex items-center gap-1 text-xs"
          >
            <Calendar size={13} /> Event
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
              <Skeleton className={cn('h-12', i % 2 === 0 ? 'w-64' : 'w-48')} rounded="2xl" />
            </div>
          ))
        ) : visibleMessages.length === 0 ? (
          /* Suggestion chips for empty chat */
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-8">
            <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center">
              <MessageCircle size={22} className="text-brand" />
            </div>
            <p className="text-sm text-text-muted">Ask Clutch AI anything about sales</p>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {(suggestions ?? []).slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => { setMessage(s); inputRef.current?.focus(); }}
                  className="text-sm text-left px-4 py-2 rounded-xl border border-surface-border hover:border-brand-300 hover:bg-brand-50 hover:text-brand transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {visibleMessages.map((m) => <ChatBubble key={m.id} message={m} />)}
            {isStreaming && (
              <ChatBubble streamContent={streamContent} isStreaming />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="shrink-0 px-4 py-2 flex gap-2 flex-wrap bg-white border-t border-surface-border">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-surface-base border border-surface-border rounded-lg px-2.5 py-1.5 text-xs">
              <Paperclip size={11} className="text-text-muted" />
              <span className="text-text-secondary truncate max-w-[120px]">{a.name}</span>
              <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                <X size={11} className="text-text-muted hover:text-danger" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 bg-white border-t border-surface-border px-4 py-3">
        <div className="flex items-end gap-2">
          {/* File attach */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-text-muted hover:text-brand transition-colors shrink-0 mb-2"
            title="Attach file"
          >
            {uploadingFile ? <Spinner size="sm" /> : <Paperclip size={17} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_FILE_TYPES.join(',')}
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />

          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Clutch AI…"
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-xl border border-surface-border px-3 py-2',
              'text-sm text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand',
              'transition-colors max-h-32 overflow-y-auto',
            )}
            style={{ minHeight: '40px' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />

          {/* Web search toggle */}
          <button
            onClick={() => setForceSearch((v) => !v)}
            title="Force web search"
            className={cn(
              'mb-2 p-1.5 rounded-lg transition-colors shrink-0',
              forceSearch
                ? 'bg-brand text-white'
                : 'text-text-muted hover:text-brand hover:bg-brand-50',
            )}
          >
            <Globe size={16} />
          </button>

          <Button
            size="sm"
            leftIcon={<Send size={13} />}
            disabled={(!message.trim() && attachments.length === 0) || isStreaming}
            isLoading={isStreaming}
            onClick={handleSend}
            className="shrink-0"
          >
            Send
          </Button>
        </div>

        {message.length > CHAT_MESSAGE_MAX_LENGTH * 0.9 && (
          <p className="text-xs text-warning mt-1">
            {message.length}/{CHAT_MESSAGE_MAX_LENGTH}
          </p>
        )}
      </div>
    </div>
  );
}
