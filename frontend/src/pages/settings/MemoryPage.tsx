// FILE: src/pages/settings/MemoryPage.tsx
// GET /api/user/memory, DELETE /api/user/memory/:id
// Toggle memory_enabled
import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userApi }     from '@/api/user';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useAuth }     from '@/hooks/useAuth';
import { useToast }    from '@/hooks/useToast';
import { Toggle }      from '@/components/ui/Input';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState }  from '@/components/common/index';
import { formatRelativeDate } from '@/lib/utils';
import { Brain, Trash2 } from 'lucide-react';
import type { MemoryFact } from '@/api/types';

export default function MemoryPage() {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.memory,
    queryFn:  () => userApi.getMemory().then((r) => r.data.facts),
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      userApi.updatePreferences({ memory_enabled: enabled }),
    onSuccess: () => {
      refreshUser();
      showToast('Memory preference saved.', 'success');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userApi.deleteMemoryFact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory });
      showToast('Memory fact removed.', 'info');
    },
    onError: () => showToast('Could not remove fact.', 'error'),
  });

  const facts: MemoryFact[] = data ?? [];

  return (
    <div className="page-container max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-text-primary">AI Memory</h1>

      {/* Toggle */}
      <div className="bg-white border border-surface-border rounded-lg p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary">Memory enabled</p>
          <p className="text-xs text-text-muted mt-0.5">
            Clutch remembers facts about you across conversations.
          </p>
        </div>
        <Toggle
          checked={user?.memory_enabled ?? true}
          onChange={(v) => toggleMutation.mutate(v)}
        />
      </div>

      {/* Facts list */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">
          Stored facts ({facts.length})
        </p>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-6 h-6 rounded" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : facts.length === 0 ? (
          <EmptyState
            icon={<Brain size={24} />}
            headline="No memory facts yet"
            subline="Clutch will remember key facts as you chat."
          />
        ) : (
          facts.map((f) => (
            <div
              key={f.id}
              className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0"
            >
              <Brain size={13} className="text-brand mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{f.content}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {f.category && <span className="capitalize">{f.category} · </span>}
                  {formatRelativeDate(f.created_at)}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(f.id)}
                className="p-1 text-text-muted hover:text-danger transition-colors shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
