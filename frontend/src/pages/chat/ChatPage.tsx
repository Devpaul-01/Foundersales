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
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button }      from '@/components/ui/Button';
import { CopyButton }  from '@/components/common/index';
import type { ChatMessage, Chat } from '@/api/types';
import { CHAT_MESSAGE_MAX_LENGTH, ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/constants';
import { formatRelativeDate, cn, generateId } from '@/lib/utils';

// ============================================================
// DEMO MODE: this page is wired to static, hardcoded data only.
// No network requests, no react-query, no SSE streaming, no
// loading states. All interactions mutate local component state
// so the UI stays fully interactive for a demo/screenshot.
// ============================================================
import {
  Send, Globe, Paperclip, ArrowLeft,
  Calendar, MessageCircle, X, FileText, ChevronDown, ChevronUp,
  Search, Trash2, RotateCw, Pencil, Check, Loader2,
  Square, Plus, ExternalLink, Download, FileDown,
} from 'lucide-react';

// ── Attachments ─────────────────────────────────────────────
type MessageAttachment = { name: string; type: string; url?: string };

// ── Hardcoded demo data ──────────────────────────────────────
const DEMO_CHAT: Chat = {
  id: 'chat-8841',
  title: 'Q3 pipeline review — Acme & Nimbus',
  chat_mode: 'general',
} as Chat;

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: 'm-1',
    chat_id: DEMO_CHAT.id,
    role: 'user',
    content: 'Can you summarize where the Acme Corp and Nimbus Retail deals stand, and flag anything at risk this quarter?',
    delivery_status: 'delivered',
    created_at: minsAgo(46),
  } as ChatMessage,
  {
    id: 'm-2',
    chat_id: DEMO_CHAT.id,
    role: 'assistant',
    content:
      "Here's where both deals stand:\n\n" +
      '| Deal | Stage | Value | Close date | Risk |\n' +
      '|---|---|---|---|---|\n' +
      '| Acme Corp | Negotiation | $84,000 | Sep 26 | Low |\n' +
      '| Nimbus Retail | Legal review | $52,500 | Oct 3 | Medium |\n\n' +
      '**Acme Corp** — pricing is agreed and procurement signed off yesterday. The main open item is a redline on the data-retention clause, which legal expects to close by Friday.\n\n' +
      "**Nimbus Retail** — the champion (Priya Shah) is supportive, but the deal has been sitting in legal review for 9 days with no response. I'd recommend a check-in call this week to keep momentum before quarter close.",
    delivery_status: 'delivered',
    created_at: minsAgo(45),
    citations: ['https://www.acmecorp.com/newsroom/q3-partnership', 'https://nimbusretail.com/press/expansion-2026'],
  } as ChatMessage,
  {
    id: 'm-3',
    chat_id: DEMO_CHAT.id,
    role: 'user',
    content: "Good catch on Nimbus. Draft a short follow-up email to Priya to get the legal review moving.",
    delivery_status: 'delivered',
    created_at: minsAgo(41),
    attachments: [{ name: 'nimbus-msa-redline-v3.pdf', type: 'application/pdf' }],
  } as ChatMessage,
  {
    id: 'm-4',
    chat_id: DEMO_CHAT.id,
    role: 'assistant',
    content:
      "Here's a draft:\n\n" +
      '_Subject: Quick check-in on the MSA review_\n\n' +
      "Hi Priya,\n\nHope the rollout planning is going well on your end. I wanted to check in on the MSA — I know legal has a lot on their plate, but we'd love to keep things moving toward an early-October close if that still works for your team.\n\n" +
      'Happy to hop on a 15-minute call this week if it would help unblock anything on the redline. Let me know what works.\n\nBest,\nJordan',
    delivery_status: 'delivered',
    created_at: minsAgo(40),
  } as ChatMessage,
  {
    id: 'm-5',
    chat_id: DEMO_CHAT.id,
    role: 'user',
    content: 'Perfect, sending that now. One more thing — what were last quarter\u2019s win rates by segment?',
    delivery_status: 'delivered',
    created_at: minsAgo(12),
  } as ChatMessage,
  {
    id: 'm-6',
    chat_id: DEMO_CHAT.id,
    role: 'assistant',
    content:
      'Q2 win rates by segment:\n\n' +
      '- **Enterprise** — 38% (up from 31% in Q1)\n' +
      '- **Mid-market** — 44%\n' +
      '- **SMB** — 52%\n\n' +
      'Enterprise is trending up mainly on faster security-review turnaround. Mid-market is flat quarter over quarter — worth digging into if you want a deeper breakdown.',
    delivery_status: 'delivered',
    created_at: minsAgo(11),
  } as ChatMessage,
];

const EARLIER_DEMO_MESSAGES: ChatMessage[] = [
  {
    id: 'm-0a',
    chat_id: DEMO_CHAT.id,
    role: 'user',
    content: 'Kick us off — any new leads from the webinar yesterday?',
    delivery_status: 'delivered',
    created_at: minsAgo(95),
  } as ChatMessage,
  {
    id: 'm-0b',
    chat_id: DEMO_CHAT.id,
    role: 'assistant',
    content: 'Yes — 14 new leads came in, 3 already marked sales-qualified: Northwind Logistics, Fenwick & Cole, and Tandem Health. Want me to draft outreach for those three?',
    delivery_status: 'delivered',
    created_at: minsAgo(94),
  } as ChatMessage,
];

const DEMO_SUGGESTIONS = [
  'What deals are closing this week?',
  'Draft a renewal email for our top account',
  'Summarize my calls from yesterday',
  'Which leads need follow-up today?',
];

const CANNED_REPLIES = [
  "Got it — I've noted that down. Based on the current pipeline, this looks consistent with what we discussed earlier in the thread.",
  "Here's a quick take: momentum looks solid overall, though it's worth keeping an eye on response times from legal this week.",
  'I can help with that. Want me to turn this into a follow-up task, or would you rather I draft an email now?',
];

function normalizeMarkdown(content: string): string {
  return content.replace(/<br\s*\/?>/gi, '\n');
}

// ── Conversation export (NEW) ────────────────────────────────
// The server only produces Markdown (no PDF engine in that service — see
// chat.js). "Export as PDF" reuses the same markdown and turns it into a
// PDF locally via the browser's print dialog, so users don't need a
// second round trip or a heavy client-side PDF library for something
// they'll mostly just save-as from the print sheet anyway.
function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Deliberately narrow: this only needs to handle the specific markdown
// subset chat.js's buildChatExportMarkdown produces (headers, hr rules,
// bold "Sources:" label, bullet lists, plain paragraphs) — not general
// CommonMark.
function chatExportMarkdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const htmlParts: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { htmlParts.push('</ul>'); inList = false; }
  };

  const inlineFormat = (text: string) =>
    escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    if (line === '---') { closeList(); htmlParts.push('<hr />'); continue; }
    if (line.startsWith('### ')) { closeList(); htmlParts.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('# ')) { closeList(); htmlParts.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }
    if (line.startsWith('- ')) {
      if (!inList) { htmlParts.push('<ul>'); inList = true; }
      htmlParts.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }
    if (line.startsWith('_') && line.endsWith('_') && line.length > 1) {
      closeList();
      htmlParts.push(`<p class="muted">${inlineFormat(line.slice(1, -1))}</p>`);
      continue;
    }
    closeList();
    htmlParts.push(`<p>${inlineFormat(line)}</p>`);
  }
  closeList();

  return htmlParts.join('\n');
}

function openPrintableExport(title: string, markdown: string) {
  const win = window.open('', '_blank');
  if (!win) return false;
  const bodyHtml = chatExportMarkdownToHtml(markdown);
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.55; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h3 { font-size: 0.95rem; margin: 1.25rem 0 0.35rem; color: #444; }
  p { font-size: 0.9rem; margin: 0.35rem 0; white-space: pre-wrap; }
  p.muted { color: #888; font-size: 0.8rem; }
  ul { margin: 0.35rem 0; padding-left: 1.25rem; font-size: 0.85rem; }
  hr { border: none; border-top: 1px solid #e2e2e2; margin: 1rem 0; }
  @media print { body { margin: 0; padding: 1rem; } }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`);
  win.document.close();
  win.focus();
  // Give the new document a beat to lay out before the print dialog opens.
  setTimeout(() => win.print(), 250);
  return true;
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
// NEW: accepts an optional `label`. Plain "waiting on the model" turns
// still get the classic bouncing dots; force_search turns pass a label
// so the gap while Exa runs (before any token has streamed back) reads
// as "Searching the web…" instead of unexplained silence.
function ThinkingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-md bg-brand-50 border border-surface-border flex items-center justify-center text-brand text-[10px] font-semibold shrink-0 mt-0.5">
        C
      </div>
      {label ? (
        <div className="flex items-center gap-1.5 h-6 text-xs text-text-muted">
          <Globe size={12} className="text-brand animate-pulse" />
          <span>{label}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 h-6">
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 animate-bounce" />
        </div>
      )}
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
                onClick={() => onRegenerate?.()}
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

function showToast(msg: string, _variant?: string) {
  // Demo mode: no toast host wired up; no-op so interactions don't throw.
  // eslint-disable-next-line no-console
  console.log('[toast]', msg);
}

export default function ChatPage() {
  const chatId          = DEMO_CHAT.id;
  const navigate        = useNavigate();
  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  const [message,       setMessage]       = useState('');
  const [forceSearch,   setForceSearch]   = useState(false);
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  // NEW: true only while a force_search turn is waiting on Exa, before
  // the model has started streaming a single token — lets the loading
  // state say "Searching the web…" instead of the generic thinking dots.
  const [awaitingWebSearch, setAwaitingWebSearch] = useState(false);
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>(DEMO_MESSAGES);
  const [hasEarlier, setHasEarlier] = useState(true);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [attachments,   setAttachments]   = useState<Array<{ name: string; type: string; url: string }>>([]);

  // NEW: conversation export (Markdown / print-to-PDF)
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting,    setIsExporting]    = useState<'markdown' | 'pdf' | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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
    setAwaitingWebSearch(false);
  }, []);

  // Demo mode: fixed, hardcoded chat + message list, no network fetch.
  const isLoading   = false;
  const chat        = DEMO_CHAT;
  const linkedEvent = null as null | { id: string };
  const suggestions = DEMO_SUGGESTIONS;
  const hasNextPage = hasEarlier;
  const isFetchingNextPage = false;
  const fetchNextPage = useCallback(() => {
    setDbMessages((prev) => [...EARLIER_DEMO_MESSAGES, ...prev]);
    setHasEarlier(false);
  }, []);

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
  }, [dbMessages]);

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

  // Replace lines ~304-316 with:
const messageCountRef = useRef(visibleMessages.length);
const isStreamingRef = useRef(isStreaming);

useEffect(() => {
  const messageCountGrew = visibleMessages.length > messageCountRef.current;
  messageCountRef.current = visibleMessages.length;
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const justSentByUser = messageCountGrew && lastMessage?.role === 'user';

  // NEW: Auto-scroll during streaming if we were at bottom or just sent a message
  const shouldScroll = 
    justSentByUser ||                                    // User just sent message
    (isStreaming && messageCountGrew) ||                 // Streaming new content
    (isNearBottom && messageCountGrew);                  // Already at bottom

  if (shouldScroll) {
    scrollToBottom();
  }
}, [visibleMessages, isNearBottom, scrollToBottom, isStreaming]);
  // Demo mode: "sending" a message appends it locally and appends a
  // canned assistant reply immediately after — no network, no streaming.
  const replyIndexRef = useRef(0);
  const handleSend = () => {
    const text = message.trim();
    if ((!text && attachments.length === 0) || isStreaming || isRegenerating) return;

    const userMsg: ChatMessage = {
      id:              `local-${generateId()}`,
      chat_id:         chatId,
      role:            'user',
      content:         text,
      delivery_status: 'delivered',
      created_at:      new Date().toISOString(),
      attachments:     attachments.length > 0 ? attachments : undefined,
    } as ChatMessage;

    const reply = CANNED_REPLIES[replyIndexRef.current % CANNED_REPLIES.length];
    replyIndexRef.current += 1;
    const assistantMsg: ChatMessage = {
      id:              `local-${generateId()}`,
      chat_id:         chatId,
      role:            'assistant',
      content:         reply,
      delivery_status: 'delivered',
      created_at:      new Date().toISOString(),
    } as ChatMessage;

    setLocalMessages((prev) => [...prev, userMsg, assistantMsg]);
    setMessage('');
    setForceSearch(false);
    setAttachments([]);
  };

  const handleStop = useCallback(() => {
    stopRequestedRef.current = true;
    setIsStreaming(false);
    setIsRegenerating(false);
    setRegeneratingMessageId(null);
    setAwaitingFirstToken(false);
    setAwaitingWebSearch(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const runSearch = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearchResults(
      visibleMessages.filter((m) => m.content?.toLowerCase().includes(q)),
    );
  }, [visibleMessages]);

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

  const handleDeleteChat = () => {
    const confirmed = window.confirm('Delete this chat? This can\u2019t be undone from here.');
    if (!confirmed) return;
    setIsDeleting(true);
    setTimeout(() => {
      setIsDeleting(false);
      showToast('Chat deleted.', 'success');
      navigate('/chat');
    }, 300);
  };

  const handleNewChat = () => {
    if (isCreatingChat) return;
    setIsCreatingChat(true);
    setTimeout(() => {
      setIsCreatingChat(false);
      navigate(`/chat/${DEMO_CHAT.id}`);
    }, 300);
  };

  // FIX: regenerate now accepts an optional force_search override so a
  // regenerated reply can pull fresh Exa results too, mirroring handleSend.
  // Reuses the composer's existing `forceSearch` toggle by default (if the
  // person left "Search" on before clicking Regenerate, the regenerated
  // reply searches too) — callers can also pass an explicit value.
  const handleRegenerate = (_forceSearchOverride?: boolean) => {
    if (isStreaming || isRegenerating) return;
    const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    const reply = CANNED_REPLIES[replyIndexRef.current % CANNED_REPLIES.length];
    replyIndexRef.current += 1;
    const newMsg: ChatMessage = {
      ...lastAssistant,
      id: `local-${generateId()}`,
      content: reply,
      created_at: new Date().toISOString(),
      citations: undefined,
    } as ChatMessage;

    setLocalMessages((prev) => [...prev.filter((m) => m.id !== lastAssistant.id), newMsg]);
    if (dbMessages.some((m) => m.id === lastAssistant.id)) {
      setDbMessages((prev) => prev.filter((m) => m.id !== lastAssistant.id));
    }
  };

  const handleStartEdit = (msg: ChatMessage) => setEditingMessageId(msg.id);
  const handleCancelEdit = () => setEditingMessageId(null);

  const handleSaveEdit = (msg: ChatMessage, newText: string) => {
    if (isStreaming || isRegenerating || isSavingEdit) return;
    const trimmed = newText.trim();
    if (!trimmed) return;

    const staleReply = [...visibleMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && new Date(m.created_at) > new Date(msg.created_at));

    const updateContent = (m: ChatMessage) => (m.id === msg.id ? { ...m, content: trimmed } : m);
    setDbMessages((prev) => prev.map(updateContent));
    setLocalMessages((prev) => prev.map(updateContent));

    setEditingMessageId(null);

    if (staleReply) {
      const reply = CANNED_REPLIES[replyIndexRef.current % CANNED_REPLIES.length];
      replyIndexRef.current += 1;
      const newMsg: ChatMessage = {
        ...staleReply,
        id: `local-${generateId()}`,
        content: reply,
        created_at: new Date().toISOString(),
        citations: undefined,
      } as ChatMessage;
      setLocalMessages((prev) => [...prev.filter((m) => m.id !== staleReply.id), newMsg]);
      setDbMessages((prev) => prev.filter((m) => m.id !== staleReply.id));
    }
  };

  const handleFileSelect = (files: FileList | null) => {
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
      // Demo mode: attach immediately using a local object URL, no upload.
      setAttachments((prev) => [...prev, {
        name: file.name,
        type: file.type,
        url:  URL.createObjectURL(file),
      }]);
    }
  };

  // Builds the same markdown shape the backend would have produced,
  // straight from the local message list — no network round trip.
  const buildExportMarkdown = () => {
    const lines: string[] = [`# ${chat?.title ?? 'Chat'}`, ''];
    for (const m of visibleMessages) {
      lines.push(`### ${m.role === 'user' ? 'You' : 'Clutch AI'}`);
      lines.push(m.content ?? '');
      if (m.citations?.length) {
        lines.push('**Sources:**');
        for (const c of m.citations) lines.push(`- ${c}`);
      }
      lines.push('---');
    }
    return lines.join('\n');
  };

  // ── conversation export (Markdown / print-to-PDF), fully local ──
  const handleExport = (format: 'markdown' | 'pdf') => {
    setShowExportMenu(false);
    setIsExporting(format);
    const markdown = buildExportMarkdown();
    const filename = `${(chat?.title ?? 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    if (format === 'markdown') {
      downloadTextFile(filename, markdown, 'text/markdown;charset=utf-8');
    } else {
      const opened = openPrintableExport(chat?.title || filename, markdown);
      if (!opened) showToast('Could not open the print window. Check your pop-up blocker.', 'error');
    }
    setIsExporting(null);
  };

  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showExportMenu]);

  // ── NEW: keyboard shortcuts (§ audit — Enter-to-send and
  // Escape-to-cancel-edit existed; stop/new-chat/focus-composer didn't) ─
  // Escape: stop an in-flight generation, else cancel an in-progress
  //   edit, else close the in-chat search panel — first one that applies.
  // Ctrl/Cmd+Shift+O: start a new chat (matches the convention several
  //   comparable chat products use for this action).
  // Ctrl/Cmd+/: focus the composer from anywhere in the page.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isModified = e.metaKey || e.ctrlKey;

      if (isModified && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
        return;
      }

      if (isModified && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        if (isStreaming || isRegenerating) {
          handleStop();
        } else if (editingMessageId) {
          handleCancelEdit();
        } else if (showExportMenu) {
          setShowExportMenu(false);
        } else if (showSearch) {
          closeSearch();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, isRegenerating, editingMessageId, showSearch, showExportMenu, handleStop]);

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
        {/* NEW: conversation export (Markdown / print-to-PDF) */}
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setShowExportMenu((v) => !v)}
            disabled={!chatId || visibleMessages.length === 0}
            title="Export conversation"
            className={cn(
              'p-1.5 rounded-md transition-colors disabled:opacity-40',
              showExportMenu ? 'text-brand bg-brand-50' : 'text-text-muted hover:text-brand hover:bg-brand-50',
            )}
          >
            {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-surface-border bg-white shadow-md py-1 z-20">
              <button
                onClick={() => handleExport('markdown')}
                disabled={!!isExporting}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-base hover:text-text-primary disabled:opacity-50"
              >
                <FileText size={13} /> Export as Markdown
              </button>
              <button
                onClick={() => handleExport('pdf')}
                disabled={!!isExporting}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-base hover:text-text-primary disabled:opacity-50"
              >
                <FileDown size={13} /> Export as PDF
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleNewChat}
          disabled={isCreatingChat}
          title="New chat (Ctrl/Cmd+Shift+O)"
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
          {displayMessages.length === 0 ? (
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
                <ThinkingIndicator label={awaitingWebSearch ? 'Searching the web…' : undefined} />
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
              placeholder="Message Clutch AI… (Ctrl/Cmd+/ to focus)"
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
                  <Paperclip size={15} />
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
                title={isStreaming ? 'Stop generating (Esc)' : 'Send'}
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
