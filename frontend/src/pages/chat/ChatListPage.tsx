// ============================================================
// FILE: src/pages/chat/ChatListPage.tsx
//
// CHAT AUDIT CHANGE (task #6): chat list is now paginated via
// useInfiniteQuery. Offset-based (not full keyset) — see
// IMPLEMENTATION_SUMMARY.md for why: last_message_at is nullable, which
// makes a clean keyset comparison meaningfully more complex for limited
// benefit at "hundreds/thousands of chats per user" scale. The backend
// (chat.js GET /) returns has_more/next_offset using the standard
// limit+1 trick so this doesn't need a separate COUNT query.
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi }     from '@/api/chat';
import { queryKeys }   from '@/lib/queryKeys';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState }  from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import { CHAT_LIST_PAGE_SIZE } from '@/lib/constants';
import {
  MessageCircle, Plus, ChevronRight, Search, X,
  MoreVertical, Pencil, Trash2, Check, Loader2,
} from 'lucide-react';
import type { Chat } from '@/api/types';

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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface ChatRowProps {
  chat: Chat;
  isMenuOpen: boolean;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  renameValue: string;
  isRenamePending: boolean;
  isDeletePending: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onStartRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ChatRow({
  chat,
  isMenuOpen,
  isEditing,
  isConfirmingDelete,
  renameValue,
  isRenamePending,
  isDeletePending,
  onOpenMenu,
  onCloseMenu,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: ChatRowProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const label = chat.chat_mode !== 'general' ? MODE_LABELS[chat.chat_mode] : chat.chat_type;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleRowClick = () => {
    if (isEditing || isConfirmingDelete) return;
    navigate(`/chat/${chat.id}`);
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
              disabled={isRenamePending || !renameValue.trim()}
              className="p-1 rounded text-brand hover:bg-surface-hover disabled:opacity-40 shrink-0"
              aria-label="Save title"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={onCancelRename}
              disabled={isRenamePending}
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
            disabled={isDeletePending}
            className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50"
          >
            {isDeletePending ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            disabled={isDeletePending}
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
  const navigate       = useNavigate();
  const queryClient     = useQueryClient();
  const { showToast }  = useToast();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const [openMenuId, setOpenMenuId]           = useState<string | null>(null);
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // FIX (task #6): paginated chat list. Re-keyed on `debouncedSearch` so
  // changing the search term starts a fresh paginated result set instead
  // of trying to splice pages fetched under a different query.
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [...queryKeys.chats(), { search: debouncedSearch }],
    queryFn: ({ pageParam }: { pageParam?: number }) =>
      chatApi.list({ limit: CHAT_LIST_PAGE_SIZE, offset: pageParam ?? 0, search: debouncedSearch || undefined })
        .then((r) => r.data),
    staleTime: 30_000,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_offset ?? undefined : undefined),
  });

  const chats = (data?.pages ?? []).flatMap((p) => p.chats);

  const newChatMutation = useMutation({
    mutationFn: () => chatApi.create({ chat_type: 'general', chat_mode: 'general' }).then((r) => r.data.chat),
    onSuccess: (chat) => navigate(`/chat/${chat.id}`),
    onError: () => showToast('Could not create chat.', 'error'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      chatApi.rename(chatId, title).then((r) => r.data.chat),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      setEditingId(null);
    },
    onError: () => showToast('Could not rename chat.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (chatId: string) => chatApi.archive(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      setConfirmDeleteId(null);
      showToast('Chat deleted.', 'success');
    },
    onError: () => showToast('Could not delete chat.', 'error'),
  });

  const handleCommitRename = (chatId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    renameMutation.mutate({ chatId, title: trimmed });
  };

  const hasSearch = debouncedSearch.trim().length > 0;

  return (
    <div className="page-container space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary tracking-tight">Chat</h1>
          {!!chats.length && (
            <p className="text-xs text-text-muted mt-0.5">
              {chats.length}{hasNextPage ? '+' : ''} conversation{chats.length === 1 && !hasNextPage ? '' : 's'}
            </p>
          )}
        </div>
        <Button
          size="sm"
          leftIcon={<Plus size={14} />}
          isLoading={newChatMutation.isPending}
          onClick={() => newChatMutation.mutate()}
        >
          New chat
        </Button>
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

      <div
        className={cn(
          'bg-white border border-surface-border rounded-lg',
          openMenuId ? 'overflow-visible' : 'overflow-hidden',
        )}
      >
        {isLoading ? (
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-1.5 h-1.5" rounded="full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : !chats.length ? (
          hasSearch ? (
            <EmptyState
              icon={<Search size={22} />}
              headline="No matching chats"
              subline={`Nothing matches "${debouncedSearch}". Try a different search.`}
              action={{ label: 'Clear search', onClick: () => setSearchInput('') }}
            />
          ) : (
            <EmptyState
              icon={<MessageCircle size={22} />}
              headline="No chats yet"
              subline="Start a conversation with your Clutch AI coach."
              action={{ label: 'Start chat', onClick: () => newChatMutation.mutate() }}
            />
          )
        ) : (
          <>
            {chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isMenuOpen={openMenuId === chat.id}
                isEditing={editingId === chat.id}
                isConfirmingDelete={confirmDeleteId === chat.id}
                renameValue={renameValue}
                isRenamePending={renameMutation.isPending && renameMutation.variables?.chatId === chat.id}
                isDeletePending={deleteMutation.isPending && deleteMutation.variables === chat.id}
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
                onConfirmDelete={() => deleteMutation.mutate(chat.id)}
              />
            ))}
            {hasNextPage && (
              <div className="flex justify-center py-3 border-t border-surface-border">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="flex items-center gap-1.5 text-xs text-text-muted hover:text-brand px-3 py-1.5 rounded-full hover:bg-brand-50 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage && <Loader2 size={12} className="animate-spin" />}
                  {isFetchingNextPage ? 'Loading…' : 'Load more chats'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
