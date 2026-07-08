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
//
// Scroll behavior: auto-scroll only "sticks" to the bottom while the user
// is already near the bottom. If they scroll up (e.g. to re-read earlier
// context) while a reply is streaming in, we stop yanking the view back
// down. A "scroll to bottom" button appears whenever they're not at the
// bottom, so they can jump back down on demand.
//
// NEW:
// - useSmoothStream decouples chunk arrival from on-screen reveal pace, so
//   streamed replies read as a smooth, steady stream instead of jerky bursts.
// - Attachments render beside the message they belong to (images as
//   thumbnails, other files as chips), for both the optimistic local
//   message and ones loaded from the server.
// - Fixed the composer visually showing message content behind it: the
//   messages pane was missing `min-h-0`, a classic flexbox gotcha where a
//   flex child with a fixed-size sibling won't actually shrink to scroll
//   and can bleed into the area below it. The composer's translucent
//   background made that bleed-through visible as a stray rounded box.
// - In-chat message search, chat deletion, editing your last message
//   (which triggers a regenerate), and manually regenerating the last
//   assistant response.
// - Automatic retry (with backoff) on transient network failure for the
//   streaming send/regenerate path, matching the retry behavior other
//   API calls already get from the axios client.
// ============================================================
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatApi }     from '@/api/chat';
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
  Calendar, MessageCircle, X, FileText, ChevronDown,
  Search, Trash2, RotateCw, Pencil, Check, Loader2,
  Square, Plus,
} from 'lucide-react';

// ── Attachments ─────────────────────────────────────────────
// Attachments aren't part of the shared ChatMessage type yet (the backend
// now persists them, but api/types.ts hasn't been updated) — this local
// type + accessor keep that gap from spreading `any` through the file.
// Once ChatMessage grows a real `attachments` field, this can be dropped
// and the prop type below can just be ChatMessage['attachments'].
type MessageAttachment = { name: string; type: string; url?: string };

// ── Retry helper for the streaming send/regenerate flow ────────
// `stream()` (useSSE) talks to the network directly rather than through
// apiClient, so it doesn't get the axios-level retry wrapper in api/chat.ts.
// This gives the same "a couple of automatic retries on transient network
// failure, with backoff" behavior for that path. Only retries actual
// network failures (fetch throwing / connection dropping before any SSE
// event arrived) — once the server has started streaming a reply, a
// failure partway through is surfaced to the user instead of silently
// retried, since re-sending could duplicate the turn.
const SEND_RETRY_ATTEMPTS = 2;
const SEND_RETRY_BASE_DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyNetworkFailure(err: unknown) {
  if (!err) return false;
  if (err instanceof TypeError) return true; // fetch's generic "network request failed"
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


// ChatPage.tsx - Modify getAttachments function
// The model occasionally emits raw `<br>` tags inside markdown (especially
// inside table cells, where it's the only way to force a line break within
// a single cell). react-markdown treats content as plain markdown, not
// HTML, so those tags were showing up as literal "<br>" text instead of
// breaking the line. Swapping them for a real newline before rendering
// fixes that without needing to turn on raw-HTML parsing (which would open
// the door to arbitrary HTML/script injection from model output).
function normalizeMarkdown(content: string): string {
  return content.replace(/<br\s*\/?>/gi, '\n');
}

function getAttachments(message?: ChatMessage): MessageAttachment[] {
  const raw = (message as unknown as { attachments?: MessageAttachment[] | null } | undefined)?.attachments;
  return raw?.map(att => {
    // Fix: Convert "image" to "image/png" for display
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

// ── Thinking indicator ──────────────────────────────────────
// Fills the gap between hitting Send (or Regenerate) and the first token
// actually arriving over the wire — that gap is real network/model latency
// (context assembly, queueing, time-to-first-token), not a rendering delay,
// so an empty streaming bubble sitting there with just a blinking cursor
// read as broken/stalled. Matches the assistant bubble's avatar so it reads
// as "the same message, still arriving" rather than a separate UI element.
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
// User turns keep a compact bubble (they're short, and the contrast
// helps you scan who said what). Assistant turns are set flush,
// like a written answer rather than a chat balloon — closer to how
// Linear/Notion render AI responses, and it reads less "app-generated"
// over long, multi-paragraph replies.
function ChatBubble({
  message, isStreaming, streamContent, isLastMessage, isEditing,
  onStartEdit, onCancelEdit, onSaveEdit, isSavingEdit,
  onRegenerate, isRegenerating,
}: {
  message?:      ChatMessage;
  isStreaming?:  boolean;
  streamContent?: string;
  isLastMessage?: boolean;
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
            <button
  onClick={() => onStartEdit?.(message)}
  title="Edit message"
  className="text-brand-200 hover:text-white"
>
  <Pencil size={11} />
</button>
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
        <div className={cn(
          'prose prose-sm max-w-none text-text-primary',
          isStreaming && 'streaming-cursor',
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p:    ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
              ul:   ({ children }) => <ul className="list-disc pl-4 mb-2 text-sm">{children}</ul>,
              ol:   ({ children }) => <ol className="list-decimal pl-4 mb-2 text-sm">{children}</ol>,
              li:   ({ children }) => <li className="mb-0.5">{children}</li>,
              code: ({ children }) => <code className="bg-surface-base px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
              strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
              // remark-gfm parses pipe tables; these give them real table
              // styling instead of rendering as one long run-on line of
              // text with stray "|" characters (what was happening before,
              // since the base react-markdown setup here had no GFM plugin
              // and no table components at all).
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
  // True from the moment a send/regenerate request goes out until the first
  // token actually arrives over the wire. Distinct from isStreaming (which
  // covers the whole reply, including the reveal-pacing tail after the
  // network has already finished) — this one is specifically the "dead air"
  // gap: request sent, nothing back yet.
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [attachments,   setAttachments]   = useState<Array<{ name: string; type: string; url: string }>>([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Whether the scroll pane is (close enough to) the bottom. Auto-scroll
  // only fires while this is true, so scrolling up to re-read something —
  // including while a reply is mid-stream — doesn't get fought by the
  // page pulling the view back down on every new chunk.
  const [isNearBottom,     setIsNearBottom]     = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const BOTTOM_THRESHOLD_PX = 120;

  // In-chat search
  const [showSearch,    setShowSearch]    = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [isSearching,   setIsSearching]   = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Delete chat
  const [isDeleting, setIsDeleting] = useState(false);

  // New chat (header shortcut)
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // Edit last message
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSavingEdit,     setIsSavingEdit]     = useState(false);

  // Regenerate last response
  const [isRegenerating, setIsRegenerating] = useState(false);
  // id of the stale assistant message being replaced — hidden from
  // `visibleMessages` while its streaming replacement renders in its place.
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);

  // Fires once a streamed reply has fully finished revealing on screen —
  // not the moment the network says it's done, but after every buffered
  // character has actually been drawn. See useSmoothStream for why that
  // distinction matters. Shared by both the normal send flow and regenerate,
  // since only one of them is ever active at a time.
  const handleStreamRevealComplete = useCallback(() => {
    setIsStreaming(false);
    setIsRegenerating(false);
    setRegeneratingMessageId(null);
    setAwaitingFirstToken(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
    setLocalMessages([]);
  }, [chatId]);

  const smooth = useSmoothStream(handleStreamRevealComplete);

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
  // Memoized on the actual message arrays (not recreated every render) so
  // the auto-scroll effect below doesn't fire on unrelated re-renders, e.g.
  // every keystroke while typing in the composer.
  const visibleMessages = useMemo(() => {
    return [...dbMessages, ...localMessages]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter((m) => m.role !== 'system');
  }, [dbMessages, localMessages]);

  // What actually renders: same as visibleMessages, but with the message
  // currently being regenerated hidden — its streaming replacement is
  // appended separately, below.
  const displayMessages = useMemo(() => {
    if (!regeneratingMessageId) return visibleMessages;
    return visibleMessages.filter((m) => m.id !== regeneratingMessageId);
  }, [visibleMessages, regeneratingMessageId]);

  // Track how close to the bottom the user currently is, so we know
  // whether to auto-stick on the next message/chunk and whether to show
  // the "scroll to bottom" button.
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

  // Auto-scroll — only while the user is already near the bottom. A new
  // user message they just sent always snaps the view down (they expect
  // to see it); an incoming streamed chunk only pulls the view if they
  // haven't scrolled away.
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
  }, [visibleMessages, smooth.displayed, isNearBottom, scrollToBottom]);

  // Cleanup streaming on unmount
  useEffect(() => () => abort(), [abort]);

  const handleSend = async () => {
    const text = message.trim();
    if ((!text && attachments.length === 0) || isStreaming || isRegenerating) return;

    // Optimistic user message — includes attachments so they render
    // immediately, before the round trip that persists them completes.
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
                setAwaitingFirstToken(false);
                smooth.push(chunk);
              },
              onDone:  () => smooth.finish(),
              onError: (err) => {
                smooth.reset();
                setIsStreaming(false);
                setAwaitingFirstToken(false);
                showToast(err || 'Message failed.', 'error');
              },
            },
          ),
        (attemptNumber) => showToast(`Connection dropped, retrying (${attemptNumber}/${SEND_RETRY_ATTEMPTS})…`, 'warning'),
      );
    } catch {
      smooth.reset();
      setIsStreaming(false);
      setAwaitingFirstToken(false);
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    }
  };

  // Stop button — interrupts an in-flight stream. `abort()` cancels the
  // underlying fetch/reader (see useSSE); `smooth.finish()` immediately
  // flushes whatever content has already arrived instead of waiting for
  // the reveal animation to catch up, so the bubble doesn't look "stuck"
  // after the user has asked it to stop.
  // NOTE: this assumes the backend's streamAndSave persists whatever the
  // model had generated up to the point the client disconnects (typically
  // via the response's 'close' event). Worth double-checking that in
  // services/streaming.js — if it only saves on a clean/full completion,
  // a stopped reply won't be there on refresh even though it was visible
  // on screen.
  const handleStop = useCallback(() => {
    abort();
    smooth.finish();
  }, [abort, smooth]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── In-chat search ──────────────────────────────────────────
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
      // Brief highlight flash so the jumped-to message is easy to spot —
      // done via inline style rather than a CSS class so this doesn't
      // depend on any global stylesheet addition.
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

  // ── Delete chat ─────────────────────────────────────────────
  const handleDeleteChat = async () => {
    if (!chatId) return;
    const confirmed = window.confirm('Delete this chat? This can\u2019t be undone from here.');
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await chatApi.delete(chatId);
      queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
      showToast('Chat deleted.', 'success');
      navigate('/chat');
    } catch {
      showToast('Could not delete chat. Please try again.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // ── New chat (header shortcut) ──────────────────────────────
  // Same behavior as the "New chat" button on ChatListPage: create a chat,
  // then jump straight into it rather than routing back through the list.
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

  // ── Regenerate last response ────────────────────────────────
  // Streams the replacement in, matching handleSend, rather than blocking
  // on a single non-streaming request. The stale assistant message is
  // hidden (via regeneratingMessageId) the moment the request goes out,
  // and a streaming bubble takes its place until the new reply finishes.
  const handleRegenerate = async () => {
    if (!chatId || isStreaming || isRegenerating) return;
    const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    setIsRegenerating(true);
    setRegeneratingMessageId(lastAssistant.id);
    setAwaitingFirstToken(true);
    smooth.reset();

    try {
      await withSendRetry(
        () =>
          stream(
            `/api/chat/${chatId}/regenerate`,
            { stream: true },
            {
              onChunk: (chunk) => {
                setAwaitingFirstToken(false);
                smooth.push(chunk);
              },
              onDone:  () => smooth.finish(),
              onError: (err) => {
                smooth.reset();
                setIsRegenerating(false);
                setRegeneratingMessageId(null);
                setAwaitingFirstToken(false);
                showToast(err || 'Could not regenerate that response.', 'error');
              },
            },
          ),
        (attemptNumber) => showToast(`Connection dropped, retrying (${attemptNumber}/${SEND_RETRY_ATTEMPTS})…`, 'warning'),
      );
    } catch {
      smooth.reset();
      setIsRegenerating(false);
      setRegeneratingMessageId(null);
      setAwaitingFirstToken(false);
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    }
  };

  // ── Edit last message ───────────────────────────────────────
  const handleStartEdit = (msg: ChatMessage) => setEditingMessageId(msg.id);
  const handleCancelEdit = () => setEditingMessageId(null);

  const handleSaveEdit = async (msg: ChatMessage, newText: string) => {
    if (!chatId) return;
    setIsSavingEdit(true);
    try {
      await chatApi.editMessage(chatId, msg.id, newText);
      setEditingMessageId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
    } catch {
      showToast('Could not save your edit. Please try again.', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    const fileList = Array.from(files);
    // Reset immediately so selecting the same file again (e.g. after
    // removing it) still fires a change event — browsers won't re-fire
    // onChange if the input's value hasn't changed.
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
        {isMeetingNotes && data?.linked_event && (
          <button
            onClick={() => navigate(`/calendar/${data.linked_event!.id}`)}
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
      {/* min-h-0 is load-bearing here: without it, a flex child with
          overflow-y-auto next to fixed-size siblings (the header/footer)
          won't actually cap its own height to the available space — its
          min-height defaults to the size of its content, so it can grow
          past the footer boundary instead of scrolling internally. That's
          what was letting the last message visually bleed in behind the
          composer. */}
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
            /* Suggestion chips for empty chat */
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
              {displayMessages.map((m, i) => {
                const isLastMessage = i === displayMessages.length - 1 && !isStreaming && !isRegenerating;
                return (
                  <div key={m.id} ref={(el) => { messageRefs.current[m.id] = el; }}>
                    <ChatBubble
                      message={m}
                      isLastMessage={isLastMessage}
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
              })}
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
          {/* Attachments preview */}
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

          {/* Composer: textarea + toolbar live inside one bordered surface.
              Background is solid (not translucent) so nothing behind it —
              e.g. a message that hasn't scrolled out of view yet — can
              show through. */}
          <div className="rounded-2xl border border-surface-border bg-white">
            <textarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Clutch AI…"
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
                {/* File attach */}
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

                {/* Web search toggle — now embedded in the input box itself */}
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
