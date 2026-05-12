// ============================================================
// FILE: src/pages/commitments/CommitmentsPage.tsx
// GET /api/commitments — grouped by status (pending / overdue / done)
// PATCH /api/commitments/:id — mark done / add note
// Infinite scroll
// ============================================================
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { commitmentsApi } from '@/api/commitments';
import { queryClient }    from '@/lib/queryClient';
import { queryKeys }      from '@/lib/queryKeys';
import { useToast }       from '@/hooks/useToast';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { Button }         from '@/components/ui/Button';
import { Badge }          from '@/components/ui/Badge';
import { Modal }          from '@/components/ui/Modal';
import { Textarea }       from '@/components/ui/Input';
import { Skeleton }       from '@/components/ui/Skeleton';
import { EmptyState, Spinner } from '@/components/common/index';
import { COMMITMENT_STATUS_LABELS } from '@/lib/constants';
import { formatRelativeDate, formatShortDate, cn } from '@/lib/utils';
import { CheckSquare, CheckCircle2, Clock, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Commitment } from '@/api/types';

const STATUS_TABS = [
  { value: '',        label: 'All'     },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending' },
  { value: 'done',    label: 'Done'    },
];

function CommitmentRow({
  item,
  onDone,
}: {
  item:   Commitment;
  onDone: (id: string, note?: string) => void;
}) {
  const navigate  = useNavigate();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note,     setNote]     = useState('');
  const isOverdue = item.status === 'overdue';
  const isDone    = item.status === 'done';

  return (
    <>
      <div className={cn(
        'flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0',
        isOverdue && 'bg-red-50/30',
      )}>
        {/* Status icon */}
        <button
          onClick={() => !isDone && setNoteOpen(true)}
          className={cn(
            'mt-0.5 shrink-0 transition-colors',
            isDone    ? 'text-success cursor-default' :
            isOverdue ? 'text-danger hover:text-danger/80' :
            'text-text-muted hover:text-brand',
          )}
        >
          <CheckCircle2 size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm text-text-primary',
            isDone && 'line-through text-text-muted',
          )}>
            {item.commitment_text}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-text-muted capitalize">{item.owner}'s action</span>
            {item.due_date && (
              <span className={cn(
                'text-xs flex items-center gap-0.5',
                isOverdue ? 'text-danger' : 'text-text-muted',
              )}>
                {isOverdue && <AlertTriangle size={10} />}
                {isOverdue ? 'Overdue' : `Due ${formatShortDate(item.due_date)}`}
              </span>
            )}
            {item.event_title && (
              <button
                onClick={() => item.event_id && navigate(`/calendar/${item.event_id}`)}
                className="text-xs text-brand hover:underline truncate"
              >
                {item.event_title}
              </button>
            )}
          </div>
          {item.completion_note && (
            <p className="text-xs text-text-muted italic mt-1">"{item.completion_note}"</p>
          )}
        </div>

        <div className="shrink-0">
          <Badge
            variant={
              isDone    ? 'green' :
              isOverdue ? 'red'   : 'gray'
            }
            size="xs"
          >
            {COMMITMENT_STATUS_LABELS[item.status]}
          </Badge>
        </div>
      </div>

      <Modal isOpen={noteOpen} onClose={() => setNoteOpen(false)} title="Mark as done" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{item.commitment_text}</p>
          <Textarea
            label="Completion note (optional)"
            placeholder="What happened? Any follow-up needed?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              leftIcon={<CheckCircle2 size={12} />}
              onClick={() => { onDone(item.id, note || undefined); setNoteOpen(false); }}
            >
              Mark done
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function CommitmentsPage() {
  const { showToast }  = useToast();
  const { refreshCounts } = useNotificationContext();
  const [statusFilter, setStatusFilter] = useState('');
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: queryKeys.commitments({ status: statusFilter }),
      queryFn:  ({ pageParam = 1 }) =>
        commitmentsApi.list({ page: pageParam, limit: 25, status: statusFilter || undefined })
          .then((r) => r.data),
      getNextPageParam: (last) =>
        last.pagination.has_more ? last.pagination.page + 1 : undefined,
      initialPageParam: 1,
      staleTime: 60_000,
    });

  const observerCb = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  React.useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(observerCb, { rootMargin: '200px' });
    ob.observe(el);
    return () => ob.disconnect();
  }, [observerCb]);

  const updateMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      commitmentsApi.update(id, { status: 'done', completion_note: note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commitments() });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAlerts });
      refreshCounts();
      showToast('Commitment marked done!', 'success');
    },
    onError: () => showToast('Could not update.', 'error'),
  });

  const allItems = data?.pages.flatMap((p) => p.commitments) ?? [];
  const counts   = data?.pages[0]?.counts;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-text-primary">Commitments</h1>
        {(counts?.overdue ?? 0) > 0 && (
          <Badge variant="red" size="sm">{counts!.overdue} overdue</Badge>
        )}
      </div>

      {/* Summary */}
      {counts && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Overdue', count: counts.overdue, color: 'text-danger'  },
            { label: 'Pending', count: counts.pending, color: 'text-warning' },
            { label: 'Done',    count: counts.done,    color: 'text-success' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-surface-border rounded-lg p-3 text-center">
              <p className={cn('text-2xl font-bold', s.color)}>{s.count}</p>
              <p className="text-xs text-text-muted mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              statusFilter === t.value
                ? 'bg-brand text-white'
                : 'text-text-muted hover:bg-surface-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-4 h-4 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <EmptyState
            icon={<CheckSquare size={28} />}
            headline="No commitments"
            subline="Commitments are extracted automatically from meeting debriefs."
          />
        ) : (
          <>
            {allItems.map((item) => (
              <CommitmentRow
                key={item.id}
                item={item}
                onDone={(id, note) => updateMutation.mutate({ id, note })}
              />
            ))}
            <div ref={loaderRef} className="h-4 flex items-center justify-center">
              {isFetchingNextPage && <Spinner size="sm" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
