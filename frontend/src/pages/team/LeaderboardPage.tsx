// FILE: src/pages/team/LeaderboardPage.tsx
// GET /api/metrics/workspace/leaderboard (manager+)
import React from 'react';
import { useQuery }   from '@tanstack/react-query';
import { metricsApi } from '@/api/metrics';
import { queryKeys }  from '@/lib/queryKeys';
import { Avatar }     from '@/components/ui/Avatar';
import { Skeleton }   from '@/components/ui/Skeleton';
import { formatCurrency, formatRate, cn } from '@/lib/utils';
import { Trophy } from 'lucide-react';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn:  () => metricsApi.getLeaderboard().then((r) => r.data.leaderboard),
    staleTime: 5 * 60_000,
  });

  const board = data ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Leaderboard</h1>
      <p className="text-sm text-text-muted">Last 30 days · based on messages sent, response rate, and closed deals</p>

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : board.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">No data yet.</div>
        ) : (
          board.map((m: any, i: number) => (
            <div
              key={m.user_id}
              className={cn(
                'flex items-center gap-4 px-4 py-3 border-b border-surface-border last:border-0',
                i === 0 && 'bg-amber-50/40',
              )}
            >
              <span className="text-lg w-6 text-center shrink-0">
                {MEDAL[i] ?? <span className="text-sm text-text-muted">{i + 1}</span>}
              </span>
              <Avatar name={m.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                <p className="text-xs text-text-muted">{m.role}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 shrink-0 text-right">
                <div>
                  <p className="text-xs text-text-muted">Sent</p>
                  <p className="text-sm font-bold text-text-primary">{m.sent_30d}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Rate</p>
                  <p className="text-sm font-bold text-text-primary">{formatRate(m.response_rate)}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Won</p>
                  <p className="text-sm font-bold text-success">{m.closed_won}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
