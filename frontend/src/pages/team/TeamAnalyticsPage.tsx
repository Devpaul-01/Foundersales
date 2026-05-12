// FILE: src/pages/team/TeamAnalyticsPage.tsx
// GET /api/workspaces/:id/analytics (manager+)
// Per-member breakdown + workspace-level patterns
import React from 'react';
import { useQuery }      from '@tanstack/react-query';
import { workspacesApi } from '@/api/workspaces';
import { queryKeys }     from '@/lib/queryKeys';
import { useWorkspace }  from '@/hooks/useWorkspace';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Skeleton }      from '@/components/ui/Skeleton';
import { formatRate, cn } from '@/lib/utils';
import { BarChart2 }     from 'lucide-react';

export default function TeamAnalyticsPage() {
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceAnalytics(wsId),
    queryFn:  () => workspacesApi.getAnalytics(wsId).then((r) => r.data),
    enabled:  !!wsId,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team analytics</h1>
      <p className="text-sm text-text-muted">Last 30 days</p>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" rounded="lg" />)}
        </div>
      ) : data?.totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Messages sent',    value: data.totals.sent                 },
            { label: 'Positive replies', value: data.totals.positive_replies     },
            { label: 'Response rate',    value: formatRate(data.totals.response_rate) },
            { label: 'Demos booked',     value: data.totals.demos_booked         },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-surface-border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-text-primary">{s.value ?? '—'}</p>
              <p className="text-xs text-text-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
          Member breakdown
        </p>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border bg-surface-base">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Member</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Sent</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Responses</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Rate</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Demos</th>
                </tr>
              </thead>
              <tbody>
                {(data?.members ?? []).map((m: any) => (
                  <tr key={m.user_id} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={m.name} size="xs" />
                        <span className="text-text-primary">{m.name}</span>
                        <Badge variant="gray" size="xs">{m.role}</Badge>
                      </div>
                    </td>
                    <td className="text-right px-4 py-2.5 text-text-secondary">{m.sent ?? 0}</td>
                    <td className="text-right px-4 py-2.5 text-text-secondary">{m.responses ?? 0}</td>
                    <td className="text-right px-4 py-2.5">
                      <span className={cn(
                        'font-medium',
                        (m.response_rate ?? 0) >= 0.3 ? 'text-success' :
                        (m.response_rate ?? 0) >= 0.15 ? 'text-warning' : 'text-danger',
                      )}>
                        {formatRate(m.response_rate)}
                      </span>
                    </td>
                    <td className="text-right px-4 py-2.5 text-text-secondary">{m.demos ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
