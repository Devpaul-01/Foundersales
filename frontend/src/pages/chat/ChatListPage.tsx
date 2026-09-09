// ============================================================
// FILE: src/pages/chat/ChatListPage.tsx
//
// DEMO BUILD — all API/query-client calls removed and replaced with
// realistic hardcoded local data so this page renders fully offline for
// screenshots. Search, filters, rename, and delete are all wired up
// against in-memory state so the UI still behaves like the real thing;
// nothing here talks to a network.
// ============================================================
import React, { useMemo, useState } from 'react';
import {
  MessageCircle, Plus, ChevronRight, Search, X,
  MoreVertical, Pencil, Trash2, Check,
} from 'lucide-react';

// ── Local types (mirrors the shape of the real Chat model) ──────────
interface Chat {
  id: string;
  title: string;
  chat_type: 'general' | 'opportunity' | 'practice';
  chat_mode: 'general' | 'meeting_notes' | 'prep' | 'followup_coach';
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

const MODE_LABELS: Record<string, string> = {
  general:        'General',
  meeting_notes:  'Meeting notes',
  prep:           'Prep',
  followup_coach: 'Follow-up coach',
};

const TYPE_DOT: Record<string, string> = {
  general:     'bg-text-muted',
  opportunity: 'bg-brand',
  practice:    'bg-purple-500',
};

const TYPE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',            label: 'All types' },
  { value: 'general',     label: 'General' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'practice',    label: 'Practice' },
];

const MODE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',               label: 'All modes' },
  { value: 'general',        label: 'General' },
  { value: 'meeting_notes',  label: 'Meeting notes' },
  { value: 'prep',           label: 'Prep' },
  { value: 'followup_coach', label: 'Follow-up coach' },
];

// ── Minimal relative-date formatter (no external util dependency) ───
function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now  = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHr  = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

// ── Hardcoded demo dataset ────────────────────────────────────────
// Realistic conversation titles, types, modes, message counts, and
// timestamps spread across the last few weeks so the list feels lived-in.
const now = new Date();
const daysAgo = (d: number, h = 0, m = 0) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  dt.setHours(dt.getHours() - h, dt.getMinutes() - m, 0, 0);
  return dt.toISOString();
};

const INITIAL_CHATS: Chat[] = [
  {
    id: 'chat_1001',
    title: 'Northwind Logistics — renewal risk review',
    chat_type: 'opportunity',
    chat_mode: 'prep',
    message_count: 18,
    last_message_at: daysAgo(0, 0, 12),
    created_at: daysAgo(2),
  },
  {
    id: 'chat_1002',
    title: 'Weekly pipeline sync — notes',
    chat_type: 'general',
    chat_mode: 'meeting_notes',
    message_count: 34,
    last_message_at: daysAgo(0, 1, 45),
    created_at: daysAgo(0, 2, 10),
  },
  {
    id: 'chat_1003',
    title: 'Objection handling: "too expensive"',
    chat_type: 'practice',
    chat_mode: 'general',
    message_count: 9,
    last_message_at: daysAgo(0, 4),
    created_at: daysAgo(0, 5),
  },
  {
    id: 'chat_1004',
    title: 'Acme Corp — discovery call follow-up',
    chat_type: 'opportunity',
    chat_mode: 'followup_coach',
    message_count: 12,
    last_message_at: daysAgo(1, 3),
    created_at: daysAgo(1, 6),
  },
  {
    id: 'chat_1005',
    title: 'Brightline Health kickoff prep',
    chat_type: 'opportunity',
    chat_mode: 'prep',
    message_count: 22,
    last_message_at: daysAgo(1, 8),
    created_at: daysAgo(3),
  },
  {
    id: 'chat_1006',
    title: 'Cold outreach script — mid-market SaaS',
    chat_type: 'general',
    chat_mode: 'general',
    message_count: 6,
    last_message_at: daysAgo(2),
    created_at: daysAgo(2, 1),
  },
  {
    id: 'chat_1007',
    title: 'Vantage Retail QBR — meeting notes',
    chat_type: 'general',
    chat_mode: 'meeting_notes',
    message_count: 41,
    last_message_at: daysAgo(2, 5),
    created_at: daysAgo(2, 7),
  },
  {
    id: 'chat_1008',
    title: 'Roleplay: negotiating a multi-year contract',
    chat_type: 'practice',
    chat_mode: 'general',
    message_count: 15,
    last_message_at: daysAgo(3, 2),
    created_at: daysAgo(3, 4),
  },
  {
    id: 'chat_1009',
    title: 'Summit Manufacturing — champion follow-up',
    chat_type: 'opportunity',
    chat_mode: 'followup_coach',
    message_count: 8,
    last_message_at: daysAgo(4),
    created_at: daysAgo(4, 1),
  },
  {
    id: 'chat_1010',
    title: 'Pricing page copy review',
    chat_type: 'general',
    chat_mode: 'general',
    message_count: 5,
    last_message_at: daysAgo(4, 9),
    created_at: daysAgo(4, 10),
  },
  {
    id: 'chat_1011',
    title: 'Q3 territory planning notes',
    chat_type: 'general',
    chat_mode: 'meeting_notes',
    message_count: 27,
    last_message_at: daysAgo(5),
    created_at: daysAgo(5, 2),
  },
  {
    id: 'chat_1012',
    title: 'Redwood Analytics — security questionnaire prep',
    chat_type: 'opportunity',
    chat_mode: 'prep',
    message_count: 19,
    last_message_at: daysAgo(6),
    created_at: daysAgo(6, 3),
  },
  {
    id: 'chat_1013',
    title: 'Practice: cold call opener variations',
    chat_type: 'practice',
    chat_mode: 'general',
    message_count: 11,
    last_message_at: daysAgo(7),
    created_at: daysAgo(7, 1),
  },
  {
    id: 'chat_1014',
    title: 'Harborview Insurance — renewal follow-up',
    chat_type: 'opportunity',
    chat_mode: 'followup_coach',
    message_count: 14,
    last_message_at: daysAgo(8),
    created_at: daysAgo(9),
  },
  {
    id: 'chat_1015',
    title: 'Onboarding call notes — Delta Freight',
    chat_type: 'general',
    chat_mode: 'meeting_notes',
    message_count: 23,
    last_message_at: daysAgo(10),
    created_at: daysAgo(10, 1),
  },
  {
    id: 'chat_1016',
    title: 'Competitive positioning vs. Ridgeline',
    chat_type: 'general',
    chat_mode: 'general',
    message_count: 7,
    last_message_at: daysAgo(12),
    created_at: daysAgo(12, 2),
  },
];

interface ChatRowProps {
  chat: Chat;
  isMenuOpen: boolean;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  renameValue: string;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onStartRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onOpen: () => void;
}

function ChatRow({
  chat,
  isMenuOpen,
  isEditing,
  isConfirmingDelete,
  renameValue,
  onOpenMenu,
  onCloseMenu,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onOpen,
}: ChatRowProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const label = chat.chat_mode !== 'general' ? MODE_LABELS[chat.chat_mode] : chat.chat_type;

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleRowClick = () => {
    if (isEditing || isConfirmingDelete) return;
    onOpen();
  };

  return (
    <div
      onClick={handleRowClick}
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0 transition-colors',
        isEditing || isConfirmingDelete ? 'bg-surface-hover' : 'hover:bg-surface-hover cursor-pointer',
        isMenuOpen && 'z-30',
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', TYPE_DOT[chat.chat_type] ?? 'bg-text-muted')} />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={renameValue}
              maxLength={200}
              onChange={(e) => onRenameValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              className="flex-1 min-w-0 text-sm font-medium text-text-primary bg-white border border-brand rounded px-2 py-1 outline-none"
              placeholder="Chat title"
            />
            <button
              type="button"
              onClick={onCommitRename}
              disabled={!renameValue.trim()}
              className="p-1 rounded text-brand hover:bg-surface-hover disabled:opacity-40 shrink-0"
              aria-label="Save title"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={onCancelRename}
              className="p-1 rounded text-text-muted hover:bg-surface-hover shrink-0"
              aria-label="Cancel rename"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-medium text-text-primary truncate">{chat.title}</p>
              <span className="text-xs text-text-muted shrink-0">{label}</span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {chat.message_count} messages · {formatRelativeDate(chat.last_message_at ?? chat.created_at)}
            </p>
          </>
        )}
      </div>

      {isConfirmingDelete ? (
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-text-muted">Delete chat?</span>
          <button
            type="button"
            onClick={onConfirmDelete}
            className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-surface-hover"
          >
            Cancel
          </button>
        </div>
      ) : !isEditing ? (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => (isMenuOpen ? onCloseMenu() : onOpenMenu())}
            className={cn(
              'p-1.5 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary transition-opacity',
              isMenuOpen ? 'opacity-100 bg-surface-hover' : 'opacity-0 group-hover:opacity-100',
            )}
            aria-label="Chat options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <MoreVertical size={15} />
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={onCloseMenu} />
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-36 bg-white border border-surface-border rounded-md shadow-lg py-1 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu();
                    onStartRename();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover text-left"
                >
                  <Pencil size={13} />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu();
                    onStartDelete();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {!isEditing && !isConfirmingDelete && (
        <ChevronRight
          size={14}
          className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      )}
    </div>
  );
}

export default function ChatListPage() {
  const [chats, setChats] = useState<Chat[]>(INITIAL_CHATS);

  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');

  const [openMenuId, setOpenMenuId]           = useState<string | null>(null);
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredChats = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return chats.filter((chat) => {
      if (q && !chat.title.toLowerCase().includes(q)) return false;
      if (typeFilter && chat.chat_type !== typeFilter) return false;
      if (modeFilter && chat.chat_mode !== modeFilter) return false;
      return true;
    });
  }, [chats, searchInput, typeFilter, modeFilter]);

  const handleNewChat = () => {
    const newChat: Chat = {
      id: `chat_${Date.now()}`,
      title: 'New chat',
      chat_type: 'general',
      chat_mode: 'general',
      message_count: 0,
      last_message_at: null,
      created_at: new Date().toISOString(),
    };
    setChats((prev) => [newChat, ...prev]);
  };

  const handleCommitRename = (chatId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c)));
    setEditingId(null);
  };

  const handleConfirmDelete = (chatId: string) => {
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    setConfirmDeleteId(null);
  };

  const hasSearch  = searchInput.trim().length > 0;
  const hasFilters = hasSearch || !!typeFilter || !!modeFilter;

  return (
    <div className="page-container space-y-4 max-w-2xl mx-auto py-6 px-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary tracking-tight">Chat</h1>
          {!!chats.length && (
            <p className="text-xs text-text-muted mt-0.5">
              {chats.length} conversation{chats.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <button
          onClick={handleNewChat}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand hover:bg-brand-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          <Plus size={14} />
          New chat
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search chats by title…"
          aria-label="Search chats by title"
          className="w-full text-sm bg-white border border-surface-border rounded-lg pl-9 pr-8 py-2 outline-none focus:border-brand text-text-primary placeholder:text-text-muted"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by chat type"
          className={cn(
            'text-xs border border-surface-border rounded-md pl-2.5 pr-7 py-1.5 outline-none focus:border-brand bg-white',
            typeFilter ? 'text-text-primary font-medium' : 'text-text-muted',
          )}
        >
          {TYPE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          aria-label="Filter by chat mode"
          className={cn(
            'text-xs border border-surface-border rounded-md pl-2.5 pr-7 py-1.5 outline-none focus:border-brand bg-white',
            modeFilter ? 'text-text-primary font-medium' : 'text-text-muted',
          )}
        >
          {MODE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {(typeFilter || modeFilter) && (
          <button
            type="button"
            onClick={() => { setTypeFilter(''); setModeFilter(''); }}
            className="text-xs text-text-muted hover:text-brand px-1.5 py-1 rounded hover:bg-surface-hover"
          >
            Clear filters
          </button>
        )}
      </div>

      <div
        className={cn(
          'bg-white border border-surface-border rounded-lg',
          openMenuId ? 'overflow-visible' : 'overflow-hidden',
        )}
      >
        {!filteredChats.length ? (
          hasFilters ? (
            <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-base flex items-center justify-center text-text-muted">
                <Search size={20} />
              </div>
              <p className="text-sm font-medium text-text-primary">No matching chats</p>
              <p className="text-xs text-text-muted max-w-xs">
                {hasSearch
                  ? `Nothing matches "${searchInput}". Try a different search or filter.`
                  : 'No chats match the selected filters.'}
              </p>
              <button
                onClick={() => { setSearchInput(''); setTypeFilter(''); setModeFilter(''); }}
                className="text-xs font-medium text-brand hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-base flex items-center justify-center text-text-muted">
                <MessageCircle size={20} />
              </div>
              <p className="text-sm font-medium text-text-primary">No chats yet</p>
              <p className="text-xs text-text-muted max-w-xs">Start a conversation with your Clutch AI coach.</p>
              <button
                onClick={handleNewChat}
                className="text-xs font-medium text-white bg-brand hover:bg-brand-600 rounded-md px-3 py-1.5"
              >
                Start chat
              </button>
            </div>
          )
        ) : (
          <>
            {filteredChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isMenuOpen={openMenuId === chat.id}
                isEditing={editingId === chat.id}
                isConfirmingDelete={confirmDeleteId === chat.id}
                renameValue={renameValue}
                onOpenMenu={() => setOpenMenuId(chat.id)}
                onCloseMenu={() => setOpenMenuId(null)}
                onStartRename={() => {
                  setRenameValue(chat.title);
                  setEditingId(chat.id);
                }}
                onRenameValueChange={setRenameValue}
                onCommitRename={() => handleCommitRename(chat.id)}
                onCancelRename={() => setEditingId(null)}
                onStartDelete={() => setConfirmDeleteId(chat.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={() => handleConfirmDelete(chat.id)}
                onOpen={() => { /* demo: navigation disabled */ }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
