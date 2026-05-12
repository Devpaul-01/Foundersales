// FILE: src/pages/team/ActivityFeedPage.tsx
// GET /api/workspace/activity (manager+)
// Infinite scroll paginated activity feed
import React, { useRef, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { workspaceActivityApi } from '@/api/misc';
import { queryKeys }            from '@/lib/queryKeys';
import { Avatar }               from '@/components/ui/Avatar';
import { Skeleton }             from '@/components/ui/Skeleton';
import { EmptyState, Spinner }  from '@/components/common/index';
import { formatRelativeDate }   from '@/lib/utils';
import { Activity } from 'lucide-react';
import type { WorkspaceActivity } from '@/api/types';

const ACTIVITY_ICONS: Record<string, string> = {
  opportunity_created: '💡',
  opportunity_won:     '🏆',
  opportunity_lost:    '😔',
  meeting_scheduled:   '📅',
  meeting_debriefed:   '📝',
  practice_completed:  '🎯',
  goal_achieved:       '✅',
  member_joined:       '👋',
  check_in_submitted:  '🌟',
};

export default function ActivityFeedPage() {
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: queryKeys.workspaceActivity(),
      queryFn:  ({ pageParam = 1 }) =>
        workspaceActivityApi.list({ page: pageParam, limit: 25 }).then((r) => r.data),
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

  const allEvents = data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team activity</h1>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : allEvents.length === 0 ? (
          <EmptyState
            icon={<Activity size={28} />}
            headline="No activity yet"
            subline="Team activity will appear here as members use the platform."
          />
        ) : (
          <>
            {allEvents.map((ev: WorkspaceActivity) => (
              <div
                key={ev.id}
                className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0"
              >
                <div className="w-8 h-8 rounded-full bg-surface-base border border-surface-border flex items-center justify-center text-sm shrink-0">
                  {ACTIVITY_ICONS[ev.event_type] ?? '📌'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">
                    <span className="font-semibold">{ev.actor_name ?? 'Someone'}</span>
                    {' '}
                    <span className="text-text-secondary">{ev.description}</span>
                  </p>
                  {ev.metadata?.detail && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">{ev.metadata.detail}</p>
                  )}
                </div>
                <span className="text-xs text-text-muted shrink-0">{formatRelativeDate(ev.created_at)}</span>
              </div>
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
