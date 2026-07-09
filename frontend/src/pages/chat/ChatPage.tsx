// ============================================================
// FILE: src/pages/chat/ChatPage.tsx
//
// CHAT AUDIT CHANGES (this revision):
// - MESSAGE PAGINATION (§4.1, CRITICAL): the chat/message fetch is now a
//   useInfiniteQuery keyed by `before_seq` (the new stable `seq` cursor
//   from the backend — see chat.js). The initial page loads the LATEST
//   messages (previously the oldest 50, with no way to reach anything
//   after them). A "Load earlier messages" affordance at the top of the
//   scroll pane calls fetchNextPage() to page further back in time, with
//   scroll position preserved across the prepend so the view doesn't
//   jump.
// - CITATIONS (§5.6/§7.1): assistant messages that were informed by a web
//   search now render their sources as small pill links under the reply,
//   using ChatMessage.citations (persisted server-side, previously
//   computed and discarded).
// - ACCESSIBILITY (§10): the streaming bubble is now wrapped in an
//   aria-live="polite" region so screen readers get incremental updates
//   as tokens arrive, and the composer textarea has an explicit
//   aria-label instead of relying on placeholder text alone.
//
// (All prior behavior — SSE streaming, workspace_id on inserts, LOW-07
// max length, in-chat search, delete, editing/regenerating the last
// message, retry-with-backoff, smooth reveal pacing, attachment preview
// — is unchanged.)
// ============================================================
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatApi, type ChatMessagesResponse }     from '@/api/chat';
import { uploadApi }   from '@/api/misc';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useSSE }      from '@/hooks/useSSE';
import { useSmoothStream } from '@/hooks/useSmoothStream';
import { useToast }    from '@/hooks/useToast';
import { suggestionsApi } from '@/api/misc';
import { Button }      from '@/components/ui/Button';
import { Skeleton }    from '@/components/ui/Skeleton';
import { CopyButton, InlineAlert, Spinner } from '@/components/common/index';
import { AppError, type ChatMessage, type Chat } from '@/api/types';
import { CHAT_MESSAGE_MAX_LENGTH, ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/constants';
import { formatRelativeDate, cn, generateId } from '@/lib/utils';
import {
  Send, Globe, Paperclip, ArrowLeft,
  Calendar, MessageCircle, X, FileText, ChevronDown, ChevronUp,
  Search, Trash2, RotateCw, Pencil, Check, Loader2,
  Square, Plus, ExternalLink,
} from 'lucide-react';

// ── Attachments ─────────────────────────────────────────────
type MessageAttachment = { name: string; type: string; url?: string };

const SEND_RETRY_ATTEMPTS = 2;
const SEND_RETRY_BASE_DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyNetworkFailure(err: unknown) {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const message = (err as Error)?.message?.toLowerCase?.() ?? '';
  return message.includes('network') || message.includes('failed to fetch') || message.includes('offline');
}

async function withSendRetry(attempt: () => Promise<void>, onRetry?: (attemptNumber: number) => void) {
  let lastError: unknown;
  for (let i = 0; i <= SEND_RETRY_ATTEMPTS; i++) {
    try {
      await attempt();
      return;
    } catch (err) {
      lastError = err;
      const isLastAttempt = i === SEND_RETRY_ATTEMPTS;
      if (isLastAttempt || !isLikelyNetworkFailure(err)) throw err;
      onRetry?.(i + 1);
      const delay = SEND_RETRY_BASE_DELAY_MS * 2 ** i;
      await sleep(delay + delay * 0.3 * Math.random());
    }
  }
  throw lastError;
}

function normalizeMarkdown(content: string): string {
  return content.replace(/<br\s*\/?>/gi, '\n');
}

function getAttachments(message?: ChatMessage): MessageAttachment[] {
  const raw = (message as unknown as { attachments?: MessageAttachment[] | null } | undefined)?.attachments;
  return raw?.map(att => {
    let fixedType = att.type;
    if (att.type === 'image') fixedType = 'image/png';
    if (att.type === 'pdf') fixedType = 'application/pdf';
    if (att.type === 'document') fixedType = 'application/octet-stream';

    return {
      ...att,
      type: fixedType
    };
  }) ?? [];
}

function AttachmentPreview({ attachment, variant }: { attachment: MessageAttachment; variant: 'user' | 'assistant' }) {
  const isImage = attachment.type?.startsWith('image/');

  if (isImage && attachment.url) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="block w-32 h-32 rounded-lg overflow-hidden border border-black/10 shrink-0"
      >
        <img src={attachment.url} alt={attachment.name} className="w-full h-full object-cover" />
      </a>
    );
  }

  const chip = (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs max-w-[200px]',
        variant === 'user'
          ? 'bg-white/15 text-white'
          : 'bg-surface-base border border-surface-border text-text-secondary',
      )}
    >
      {isImage ? <FileText size={12} className="shrink-0 opacity-80" /> : <Paperclip size={11} className="shrink-0 opacity-80" />}
      <span className="truncate">{attachment.name}</span>
    </div>
  );

  return attachment.url ? (
    <a href={attachment.url} target="_blank" rel="noreferrer">{chip}</a>
  ) : chip;
}

function AttachmentList({ attachments, variant }: { attachments: MessageAttachment[]; variant: 'user' | 'assistant' }) {
  if (!attachments.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', variant === 'user' ? 'mb-1.5' : 'mb-2')}>
      {attachments.map((a, i) => (
        <AttachmentPreview key={`${a.url ?? a.name}-${i}`} attachment={a} variant={variant} />
      ))}
    </div>
  );
}

// ── Citations (NEW — audit §5.6/§7.1) ────────────────────────
// Small pill links under a web-search-informed reply. Persisted on
// ChatMessage.citations server-side instead of being computed and thrown
// away — see streaming.js / chat.js.
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function CitationList({ citations }: { citations?: string[] | null }) {
  if (!citations?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {citations.map((url, i) => (
        <a
          key={`${url}-${i}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-brand bg-brand-50 hover:bg-brand-100 px-2 py-0.5 rounded-full truncate max-w-[220px]"
          title={url}
        >
          <ExternalLink size={10} className="shrink-0" />
          <span className="truncate">{hostnameOf(url)}</span>
        </a>
      ))}
    </div>
  );
}

// ── Thinking indicator ──────────────────────────────────────
function ThinkingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-md bg-brand-50 border border-surface-border flex items-center justify-center text-brand text-[10px] font-semibold shrink-0 mt-0.5">
        C
      </div>
      <div className="flex items-center gap-1 h-6">
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce" />
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────
function ChatBubble({
  message, isStreaming, streamContent, isLastMessage, isLastUserMessage, isEditing,
  onStartEdit, onCancelEdit, onSaveEdit, isSavingEdit,
  onRegenerate, isRegenerating,
}: {
  message?:      ChatMessage;
  isStreaming?:  boolean;
  streamContent?: string;
  isLastMessage?: boolean;
  isLastUserMessage?: boolean;
  isEditing?:    boolean;
  onStartEdit?:  (message: ChatMessage) => void;
  onCancelEdit?: () => void;
  onSaveEdit?:   (message: ChatMessage, newText: string) => void;
  isSavingEdit?: boolean;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}) {
  const content     = streamContent ?? message?.content ?? '';
  const isUser      = message?.role === 'user';
  const isSystem    = message?.role === 'system';
  const attachments = getAttachments(message);
  const [draft, setDraft] = useState(content);

  useEffect(() => { setDraft(content); }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <p className="text-xs text-text-muted bg-surface-base border border-surface-border rounded-full px-3 py-1">
          {content.slice(0, 80)}
        </p>
      </div>
    );
  }

  if (isUser) {
    if (isEditing && message) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] w-full rounded-lg rounded-br-sm bg-brand text-white px-3.5 py-2">
            <textarea
              autoFocus
              aria-label="Edit your message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) onSaveEdit?.(message, draft.trim());
                }
                if (e.key === 'Escape') onCancelEdit?.();
              }}
              rows={Math.min(6, Math.max(1, draft.split('\n').length))}
              className="w-full resize-none bg-white/10 rounded-md px-2 py-1.5 text-sm leading-relaxed placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button
                onClick={onCancelEdit}
                disabled={isSavingEdit}
                className="text-[11px] px-2 py-1 rounded-md text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => draft.trim() && onSaveEdit?.(message, draft.trim())}
                disabled={isSavingEdit || !draft.trim()}
                className="text-[11px] px-2 py-1 rounded-md bg-white/20 hover:bg-white/30 disabled:opacity-50 flex items-center gap-1"
              >
                {isSavingEdit ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Save &amp; regenerate
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end group">
        <div className="max-w-[75%] rounded-lg rounded-br-sm bg-brand text-white px-3.5 py-2">
          <AttachmentList attachments={attachments} variant="user" />
          {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
          <div className="flex justify-end items-center gap-1.5 mt-1">
            {isLastUserMessage && (
              <button
                onClick={() => onStartEdit?.(message)}
                title="Edit message"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-200 hover:text-white"
              >
                <Pencil size={11} />
              </button>
            )}
            {message && (
              <CopyButton
                text={content}
                className="opacity-0 group-hover:opacity-100 !text-brand-200 hover:!text-white"
              />
            )}
            {message && (
              <span className="text-[11px] text-brand-200">{formatRelativeDate(message.created_at)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-md bg-brand-50 border border-surface-border flex items-center justify-center text-brand text-[10px] font-semibold shrink-0 mt-0.5">
        C
      </div>
      <div className="flex-1 min-w-0 group">
        <AttachmentList attachments={attachments} variant="assistant" />
        {/* aria-live region (audit §10) — only meaningfully "live" while
            streaming; for settled messages this is just a static region,
            which is harmless. */}
        <div
          aria-live={isStreaming ? 'polite' : 'off'}
          className={cn(
            'prose prose-sm max-w-none text-text-primary',
            isStreaming && 'streaming-cursor',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p:    ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
              ul:   ({ children }) => <ul className="list-disc pl-4 mb-2 text-sm">{children}</ul>,
              ol:   ({ children }) => <ol className="list-decimal pl-4 mb-2 text-sm">{children}</ol>,
              li:   ({ children }) => <li className="mb-0.5">{children}</li>,
              code: ({ children }) => <code className="bg-surface-base px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
              strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
              table: ({ children }) => (
                <div className="mb-2 overflow-x-auto rounded-md border border-surface-border">
                  <table className="w-full text-sm border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-surface-base">{children}</thead>,
              tr:    ({ children }) => <tr className="border-b border-surface-border last:border-0">{children}</tr>,
              th:    ({ children }) => (
                <th className="text-left font-semibold text-text-primary px-3 py-1.5 align-top">{children}</th>
              ),
              td:    ({ children }) => (
                <td className="text-text-secondary px-3 py-1.5 align-top">{children}</td>
              ),
            }}
          >
            {normalizeMarkdown(content)}
          </ReactMarkdown>
        </div>
        {!isStreaming && message && <CitationList citations={message.citations} />}
        {!isStreaming && message && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-text-muted">{formatRelativeDate(message.created_at)}</span>
            <CopyButton text={content} className="opacity-0 group-hover:opacity-100" />
            {isLastMessage && (
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                title="Regenerate response"
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-text-muted hover:text-brand disabled:opacity-50"
              >
                {isRegenerating ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
                Regenerate
              </button>
            )}
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
  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  const [message,       setMessage]       = useState('');
  const [forceSearch,   setForceSearch]   = useState(false);
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [attachments,   setAttachments]   = useState<Array<{ name: string; type: string; url: string }>>([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [isNearBottom,     setIsNearBottom]     = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const BOTTOM_THRESHOLD_PX = 120;

  const [showSearch,    setShowSearch]    = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [isSearching,   setIsSearching]   = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSavingEdit,     setIsSavingEdit]     = useState(false);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);

  const stopRequestedRef = useRef(false);

  const handleStreamRevealComplete = useCallback(() => {
    setIsStreaming(false);
    setIsRegenerating(false);
    setRegeneratingMessageId(null);
    setAwaitingFirstToken(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
    setLocalMessages([]);
  }, [chatId]);

  const smooth = useSmoothStream(handleStreamRevealComplete);

  // ── FIX §4.1: infinite-scroll message pagination ────────────
  // Initial page has no `before_seq` → backend returns the LATEST
  // messages. `getNextPageParam` reads `oldest_seq` off the last-fetched
  // page so "load earlier" pages backward in time via a stable keyset
  // cursor instead of the old (broken) oldest-50-with-no-way-forward
  // behavior.
  const {
    data: messagesData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn: ({ pageParam }: { pageParam?: number }) =>
      chatApi.getById(chatId!, pageParam ? { before_seq: pageParam } : undefined).then((r) => r.data),
    enabled: !!chatId,
    staleTime: 30_000,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage: ChatMessagesResponse) =>
      lastPage.has_more ? lastPage.oldest_seq ?? undefined : undefined,
  });

  const { data: suggestions } = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn:  () => suggestionsApi.get().then((r) => r.data.suggestions),
    staleTime: 5 * 60_000,
  });

  // Newest page is fetched first (data.pages[0]); older pages get
  // appended after via fetchNextPage. Reverse before flattening so the
  // final array is in chronological (oldest-first) order for display.
  const chat        = messagesData?.pages[0]?.chat;
  const linkedEvent = messagesData?.pages[0]?.linked_event ?? null;
  const dbMessages  = useMemo(
    () => [...(messagesData?.pages ?? [])].reverse().flatMap((p) => p.messages),
    [messagesData],
  );

  const visibleMessages = useMemo(() => {
    return [...dbMessages, ...localMessages]
      .filter((m) => m.role !== 'system');
  }, [dbMessages, localMessages]);

  const displayMessages = useMemo(() => {
    if (!regeneratingMessageId) return visibleMessages;
    return visibleMessages.filter((m) => m.id !== regeneratingMessageId);
  }, [visibleMessages, regeneratingMessageId]);

  // Preserve scroll position when older messages get prepended — without
  // this, fetching an earlier page yanks the view because new content is
  // inserted above what's currently visible.
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(null);
  const handleLoadEarlier = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) preservedScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    fetchNextPage();
  }, [fetchNextPage]);

  useEffect(() => {
    if (!preservedScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const { height, top } = preservedScrollRef.current;
    const delta = el.scrollHeight - height;
    el.scrollTop = top + delta;
    preservedScrollRef.current = null;
  }, [messagesData]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;
    setIsNearBottom(nearBottom);
    setShowScrollButton(!nearBottom);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setIsNearBottom(true);
    setShowScrollButton(false);
  }, []);

  const messageCountRef = useRef(visibleMessages.length);
  useEffect(() => {
    const messageCountGrew = visibleMessages.length > messageCountRef.current;
    messageCountRef.current = visibleMessages.length;
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    const justSentByUser = messageCountGrew && lastMessage?.role === 'user';

    if (justSentByUser) {
      scrollToBottom();
    } else if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMessages, isNearBottom, scrollToBottom]);

  useEffect(() => () => abort(), [abort]);

  const handleSend = async () => {
    const text = message.trim();
    if ((!text && attachments.length === 0) || isStreaming || isRegenerating) return;

    const tempId = `temp-${generateId()}`;
    const tempMsg: ChatMessage = {
      id:              tempId,
      chat_id:         chatId!,
      role:            'user',
      content:         text,
      delivery_status: 'delivered',
      created_at:      new Date().toISOString(),
      attachments:     attachments.length > 0 ? attachments : undefined,
    } as ChatMessage;
    setLocalMessages((prev) => [...prev, tempMsg]);
    setMessage('');
    setForceSearch(false);
    setAttachments([]);
    setIsStreaming(true);
    setAwaitingFirstToken(true);
    stopRequestedRef.current = false;
    smooth.reset();

    try {
      await withSendRetry(
        () =>
          stream(
            `/api/chat/${chatId}/message`,
            {
              message:      text || '[attachment]',
              stream:       true,
              force_search: forceSearch,
              attachments:  attachments.length > 0 ? attachments : undefined,
            },
            {
              onChunk: (chunk) => {
                if (stopRequestedRef.current) return;
                setAwaitingFirstToken(false);
                smooth.push(chunk);
              },
              onDone:  (_messageId: string, _citations?: string[]) => { if (!stopRequestedRef.current) smooth.finish(); },
              onError: (errMsg) => {
                if (stopRequestedRef.current) return;
                smooth.reset();
                setIsStreaming(false);
                setAwaitingFirstToken(false);
                showToast(errMsg || 'Message failed.', 'error');
              },
            },
          ),
        (attemptNumber) => showToast(`Connection dropped, retrying (${attemptNumber}/${SEND_RETRY_ATTEMPTS})…`, 'warning'),
      );
    } catch {
      if (stopRequestedRef.current) return;
      smooth.reset();
      setIsStreaming(false);
      setAwaitingFirstToken(false);
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    }
  };

  const handleStop = useCallback(() => {
    stopRequestedRef.current = true;
    abort();
    smooth.finish();
    setIsStreaming(false);
    setIsRegenerating(false);
    setRegeneratingMessageId(null);
    setAwaitingFirstToken(false);
    if (chatId) queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
    setLocalMessages([]);
  }, [abort, smooth, chatId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const runSearch = useCallback((query: string) => {
    if (!chatId || !query.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    chatApi.searchMessages(chatId, query.trim())
      .then((r) => setSearchResults(r.data.messages))
      .catch(() => showToast('Search failed. Try again.', 'error'))
      .finally(() => setIsSearching(false));
  }, [chatId, showToast]);

  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => runSearch(value), 350);
  };

  const closeSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults(null);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  };

  const jumpToMessage = (messageId: string) => {
    const el = messageRefs.current[messageId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const previousTransition = el.style.transition;
      const previousBackground = el.style.backgroundColor;
      el.style.transition = 'background-color 0.3s ease';
      el.style.backgroundColor = 'var(--color-brand-50, rgba(99,102,241,0.12))';
      setTimeout(() => {
        el.style.backgroundColor = previousBackground;
        setTimeout(() => { el.style.transition = previousTransition; }, 350);
      }, 1200);
    }
    closeSearch();
  };

  const handleDeleteChat = async () => {
    if (!chatId) return;
    const confirmed = window.confirm('Delete this chat? This can\u2019t be undone from here.');
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await chatApi.delete(chatId);
      // Invalidate the chats list (not the deleted chat's own key) so the
      // sidebar / list page reflects the removal immediately.
      queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      showToast('Chat deleted.', 'success');
      navigate('/chat');
    } catch {
      showToast('Could not delete chat. Please try again.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleNewChat = async () => {
    if (isCreatingChat) return;
    setIsCreatingChat(true);
    try {
      const { data } = await chatApi.create({ chat_type: 'general', chat_mode: 'general' });
      navigate(`/chat/${data.chat.id}`);
    } catch {
      showToast('Could not start a new chat. Please try again.', 'error');
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleRegenerate = async () => {
    if (!chatId || isStreaming || isRegenerating) return;
    const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    setIsRegenerating(true);
    setRegeneratingMessageId(lastAssistant.id);
    setAwaitingFirstToken(true);
    stopRequestedRef.current = false;
    smooth.reset();

    try {
      await withSendRetry(
        () =>
          stream(
            `/api/chat/${chatId}/regenerate`,
            { stream: true },
            {
              onChunk: (chunk) => {
                if (stopRequestedRef.current) return;
                setAwaitingFirstToken(false);
                smooth.push(chunk);
              },
              onDone:  (_messageId: string, _citations?: string[]) => { if (!stopRequestedRef.current) smooth.finish(); },
              onError: (errMsg) => {
                if (stopRequestedRef.current) return;
                smooth.reset();
                setIsRegenerating(false);
                setRegeneratingMessageId(null);
                setAwaitingFirstToken(false);
                showToast(errMsg || 'Could not regenerate that response.', 'error');
              },
            },
          ),
        (attemptNumber) => showToast(`Connection dropped, retrying (${attemptNumber}/${SEND_RETRY_ATTEMPTS})…`, 'warning'),
      );
    } catch {
      if (stopRequestedRef.current) return;
      smooth.reset();
      setIsRegenerating(false);
      setRegeneratingMessageId(null);
      setAwaitingFirstToken(false);
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    }
  };

  const handleStartEdit = (msg: ChatMessage) => setEditingMessageId(msg.id);
  const handleCancelEdit = () => setEditingMessageId(null);

  const handleSaveEdit = async (msg: ChatMessage, newText: string) => {
    if (!chatId || isStreaming || isRegenerating || isSavingEdit) return;
    const trimmed = newText.trim();
    if (!trimmed) return;

    const staleReply = [...visibleMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && new Date(m.created_at) > new Date(msg.created_at));

    queryClient.setQueryData(queryKeys.chat(chatId), (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: ChatMessagesResponse) => ({
          ...page,
          messages: page.messages.map((m: ChatMessage) => (m.id === msg.id ? { ...m, content: trimmed } : m)),
        })),
      };
    });

    setEditingMessageId(null);
    setIsSavingEdit(true);
    setIsRegenerating(true);
    setRegeneratingMessageId(staleReply?.id ?? null);
    setAwaitingFirstToken(true);
    stopRequestedRef.current = false;
    smooth.reset();

    try {
      await withSendRetry(
        () =>
          stream(
            `/api/chat/${chatId}/message/${msg.id}`,
            { message: trimmed, stream: true },
            {
              onChunk: (chunk) => {
                if (stopRequestedRef.current) return;
                setAwaitingFirstToken(false);
                smooth.push(chunk);
              },
              onDone:  (_messageId: string, _citations?: string[]) => { if (!stopRequestedRef.current) smooth.finish(); },
              onError: (errMsg) => {
                if (stopRequestedRef.current) return;
                smooth.reset();
                setIsRegenerating(false);
                setRegeneratingMessageId(null);
                setAwaitingFirstToken(false);
                setIsSavingEdit(false);
                showToast(errMsg || 'Could not save your edit. Please try again.', 'error');
              },
            },
          ),
        (attemptNumber) => showToast(`Connection dropped, retrying (${attemptNumber}/${SEND_RETRY_ATTEMPTS})…`, 'warning'),
      );
    } catch {
      if (stopRequestedRef.current) return;
      smooth.reset();
      setIsRegenerating(false);
      setRegeneratingMessageId(null);
      setAwaitingFirstToken(false);
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    const fileList = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
    for (const file of fileList) {
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
            <p className="text-xs text-text-muted mt-0.5 capitalize">{chat.chat_mode.replace('_', ' ')}</p>
          )}
        </div>
        {isMeetingNotes && linkedEvent && (
          <button
            onClick={() => navigate(`/calendar/${linkedEvent.id}`)}
            className="text-text-muted hover:text-brand flex items-center gap-1 text-xs"
          >
            <Calendar size={13} /> Event
          </button>
        )}
        <button
          onClick={() => setShowSearch((v) => !v)}
          title="Search this chat"
          className={cn(
            'p-1.5 rounded-md transition-colors',
            showSearch ? 'text-brand bg-brand-50' : 'text-text-muted hover:text-brand hover:bg-brand-50',
          )}
        >
          <Search size={15} />
        </button>
        <button
          onClick={handleNewChat}
          disabled={isCreatingChat}
          title="New chat"
          className="p-1.5 rounded-md text-text-muted hover:text-brand hover:bg-brand-50 transition-colors disabled:opacity-50"
        >
          {isCreatingChat ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        </button>
        <button
          onClick={handleDeleteChat}
          disabled={isDeleting}
          title="Delete chat"
          className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
        >
          {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </div>

      {/* In-chat search panel */}
      {showSearch && (
        <div className="bg-white border-b border-surface-border px-4 py-2 shrink-0">
          <div className="max-w-4xl ml-0 mr-auto w-full">
            <div className="flex items-center gap-2 rounded-lg border border-surface-border px-2.5 py-1.5">
              <Search size={13} className="text-text-muted shrink-0" />
              <input
                autoFocus
                aria-label="Search messages in this chat"
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                placeholder="Search messages in this chat…"
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-text-muted"
              />
              {isSearching && <Loader2 size={13} className="text-text-muted animate-spin shrink-0" />}
              <button onClick={closeSearch} className="text-text-muted hover:text-text-primary shrink-0">
                <X size={13} />
              </button>
            </div>
            {searchResults !== null && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-surface-border divide-y divide-surface-border">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-text-muted px-3 py-2">No messages match "{searchQuery}".</p>
                ) : (
                  searchResults.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => jumpToMessage(m.id)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-base transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-text-muted uppercase">{m.role}</span>
                        <span className="text-[11px] text-text-muted shrink-0">{formatRelativeDate(m.created_at)}</span>
                      </div>
                      <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">{m.content}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollContainerRef} className="h-full overflow-y-auto px-4 py-4">
          <div className="max-w-4xl ml-0 mr-auto w-full space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                <Skeleton className={cn('h-12', i % 2 === 0 ? 'w-64' : 'w-48')} rounded="lg" />
              </div>
            ))
          ) : displayMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 pb-8">
              <div className="w-10 h-10 rounded-md bg-brand-50 border border-surface-border flex items-center justify-center">
                <MessageCircle size={18} className="text-brand" />
              </div>
              <p className="text-sm text-text-muted">Ask Clutch AI anything about sales</p>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {(suggestions ?? []).slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setMessage(s); inputRef.current?.focus(); }}
                    className="text-sm text-left px-4 py-2 rounded-lg border border-surface-border hover:border-brand-300 hover:bg-brand-50 hover:text-brand transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* FIX §4.1: "load earlier" affordance for the keyset cursor */}
              {hasNextPage && (
                <div className="flex justify-center pb-2">
                  <button
                    onClick={handleLoadEarlier}
                    disabled={isFetchingNextPage}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-brand px-3 py-1.5 rounded-full border border-surface-border hover:border-brand-300 hover:bg-brand-50 transition-colors disabled:opacity-50"
                  >
                    {isFetchingNextPage
                      ? <Loader2 size={12} className="animate-spin" />
                      : <ChevronUp size={12} />}
                    {isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              )}
              {(() => {
                let lastUserIdx = -1;
                for (let j = displayMessages.length - 1; j >= 0; j--) {
                  if (displayMessages[j].role === 'user') { lastUserIdx = j; break; }
                }
                return displayMessages.map((m, i) => {
                  const isLastMessage = i === displayMessages.length - 1 && !isStreaming && !isRegenerating;
                  const isLastUserMessage = i === lastUserIdx && !isStreaming && !isRegenerating;
                  return (
                    <div key={m.id} ref={(el) => { messageRefs.current[m.id] = el; }}>
                      <ChatBubble
                        message={m}
                        isLastMessage={isLastMessage}
                        isLastUserMessage={isLastUserMessage}
                        isEditing={editingMessageId === m.id}
                        onStartEdit={handleStartEdit}
                        onCancelEdit={handleCancelEdit}
                        onSaveEdit={handleSaveEdit}
                        isSavingEdit={isSavingEdit}
                        onRegenerate={handleRegenerate}
                        isRegenerating={isRegenerating}
                      />
                    </div>
                  );
                });
              })()}
              {(isStreaming || isRegenerating) && (
                awaitingFirstToken
                  ? <ThinkingIndicator />
                  : <ChatBubble streamContent={smooth.displayed} isStreaming />
              )}
            </>
          )}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollButton && (
          <button
            onClick={() => scrollToBottom()}
            title="Scroll to bottom"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-white border border-surface-border shadow-md text-text-secondary hover:text-brand hover:border-brand-300 transition-colors"
          >
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="relative z-10 shrink-0 bg-white border-t border-surface-border px-4 py-3">
        <div className="max-w-4xl ml-0 mr-auto w-full">
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-surface-base border border-surface-border rounded-md px-2.5 py-1.5 text-xs">
                  <Paperclip size={11} className="text-text-muted" />
                  <span className="text-text-secondary truncate max-w-[120px]">{a.name}</span>
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                    <X size={11} className="text-text-muted hover:text-danger" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-surface-border bg-white">
            <textarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Clutch AI…"
              aria-label="Message Clutch AI"
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              rows={1}
              className={cn(
                'w-full resize-none bg-transparent px-4 pt-3 pb-1',
                'text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none max-h-32 overflow-y-auto',
                'focus:ring-0 focus:ring-offset-0'
              )}
              style={{ minHeight: '24px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
            />

            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  className="p-1.5 rounded-full text-text-muted hover:text-brand hover:bg-brand-50 transition-colors"
                >
                  {uploadingFile ? <Spinner size="sm" /> : <Paperclip size={15} />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_FILE_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />

                <button
                  onClick={() => setForceSearch((v) => !v)}
                  title={forceSearch ? 'Web search on' : 'Search the web'}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-medium transition-colors',
                    forceSearch
                      ? 'bg-brand text-white'
                      : 'text-text-muted hover:text-brand hover:bg-brand-50',
                  )}
                >
                  <Globe size={15} />
                  <span className="hidden sm:inline">Search</span>
                </button>
              </div>

              <Button
                size="sm"
                leftIcon={isStreaming ? <Square size={12} className="fill-current" /> : <Send size={13} />}
                disabled={isRegenerating || (!isStreaming && !message.trim() && attachments.length === 0)}
                onClick={isStreaming ? handleStop : handleSend}
                title={isStreaming ? 'Stop generating' : 'Send'}
                className="!rounded-full shrink-0"
              >
                {isStreaming ? 'Stop' : 'Send'}
              </Button>
            </div>
          </div>

          {message.length > CHAT_MESSAGE_MAX_LENGTH * 0.9 && (
            <p className="text-xs text-warning mt-1">
              {message.length}/{CHAT_MESSAGE_MAX_LENGTH}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
