// ============================================================
// FILE: src/pages/chat/ChatListPage.tsx
// From chat-9.txt HIGH-01: all queries filter by workspace_id
// ============================================================
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { chatApi }     from '@/api/chat';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Badge }       from '@/components/ui/Badge';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState }  from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import { MessageCircle, Plus, Archive, ChevronRight } from 'lucide-react';
import type { Chat } from '@/api/types';

const MODE_LABELS: Record<string, string> = {
  general:        'General',
  meeting_notes:  'Meeting notes',
  prep:           'Prep',
  followup_coach: 'Follow-up coach',
};

const TYPE_COLORS: Record<string, string> = {
  general:     'gray',
  opportunity: 'blue',
  practice:    'purple',
};

function ChatRow({ chat, onArchive }: { chat: Chat; onArchive: (id: string) => void }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/chat/${chat.id}`)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover cursor-pointer border-b border-surface-border last:border-0 transition-colors"
    >
      <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
        <MessageCircle size={16} className="text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text-primary truncate">{chat.title}</p>
          <Badge variant={TYPE_COLORS[chat.chat_type] as 'gray' | 'blue' | 'purple'} size="xs">
            {chat.chat_mode !== 'general' ? MODE_LABELS[chat.chat_mode] : chat.chat_type}
          </Badge>
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          {chat.message_count} messages · {formatRelativeDate(chat.last_message_at ?? chat.created_at)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(chat.id); }}
          className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger-light transition-colors"
          title="Archive"
        >
          <Archive size={13} />
        </button>
        <ChevronRight size={14} className="text-text-muted" />
      </div>
    </div>
  );
}

export default function ChatListPage() {
  const navigate   = useNavigate();
  const { showToast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.chats(),
    queryFn:  () => chatApi.list({ limit: 50 }).then((r) => r.data.chats),
    staleTime: 30_000,
  });

  const newChatMutation = useMutation({
    mutationFn: () => chatApi.create({ chat_type: 'general', chat_mode: 'general' }).then((r) => r.data.chat),
    onSuccess: (chat) => navigate(`/chat/${chat.id}`),
    onError: () => showToast('Could not create chat.', 'error'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => chatApi.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chats() }),
    onError: () => showToast('Could not archive chat.', 'error'),
  });

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Chat</h1>
        <Button
          leftIcon={<Plus size={14} />}
          isLoading={newChatMutation.isPending}
          onClick={() => newChatMutation.mutate()}
        >
          New chat
        </Button>
      </div>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-9 h-9" rounded="lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon={<MessageCircle size={28} />}
            headline="No chats yet"
            subline="Start a conversation with your Clutch AI coach."
            action={{ label: 'Start chat', onClick: () => newChatMutation.mutate() }}
          />
        ) : (
          data.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              onArchive={(id) => archiveMutation.mutate(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}