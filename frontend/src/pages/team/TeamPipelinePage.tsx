// FILE: src/pages/team/TeamPipelinePage.tsx
// GET /api/pipeline?view=team (manager+)
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { pipelineApi } from '@/api/pipeline';
import { queryKeys }   from '@/lib/queryKeys';
import { Badge }       from '@/components/ui/Badge';
import { Skeleton }    from '@/components/ui/Skeleton';
import { InlineAlert } from '@/components/common/index';
import { Avatar }      from '@/components/ui/Avatar';
import { PIPELINE_STAGE_LABELS, PIPELINE_STAGE_COLORS } from '@/lib/constants';
import { formatCurrency, formatRelativeDate, cn } from '@/lib/utils';
import { Building2 } from 'lucide-react';
import type { Opportunity } from '@/api/types';

const STAGE_ORDER = ['contacted', 'replied', 'call_demo', 'closed_won', 'closed_lost'] as const;

function DealCard({ opp }: { opp: Opportunity }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/pipeline/${opp.id}`)}
      className="bg-white border border-surface-border rounded-lg p-3 space-y-2 hover:shadow-card-sm cursor-pointer transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-text-primary truncate flex-1">
          {opp.target_name || opp.company_name || 'Prospect'}
        </p>
        {opp.deal_value_usd && (
          <span className="text-xs font-mono text-success shrink-0">
            {formatCurrency(opp.deal_value_usd, true)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Avatar name={opp.owner_name ?? 'U'} size="xs" />
          <span className="text-xs text-text-muted truncate max-w-[80px]">{opp.owner_name}</span>
        </div>
        <span className="text-xs text-text-muted">{formatRelativeDate(opp.last_stage_changed_at ?? opp.created_at)}</span>
      </div>
    </div>
  );
}

export default function TeamPipelinePage() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.pipeline('team'),
    queryFn:  () => pipelineApi.getBoard('team').then((r) => r.data),
    staleTime: 60_000,
  });

  const pipeline = data?.pipeline;
  const metrics  = data?.metrics;

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team pipeline</h1>

      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pipeline value',  value: formatCurrency(metrics.pipeline_value, true)  },
            { label: 'Total revenue',   value: formatCurrency(metrics.total_revenue, true)    },
            { label: 'Win rate',        value: `${metrics.win_rate_pct}%`                     },
            { label: 'Closed won',      value: metrics.closed_won_count                       },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-surface-border rounded-lg p-3">
              <p className="text-xs text-text-muted">{s.label}</p>
              <p className="text-lg font-bold text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="shrink-0 w-60 space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-20 w-full" rounded="lg" />
              <Skeleton className="h-20 w-full" rounded="lg" />
            </div>
          ))}
        </div>
      ) : !pipeline ? (
        <InlineAlert type="info" message="No pipeline data." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_ORDER.map((stage) => {
            const opps: Opportunity[] = (pipeline as any)[stage] ?? [];
            return (
              <div key={stage} className="shrink-0 w-64 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: PIPELINE_STAGE_COLORS[stage] }}
                  />
                  <p className="text-xs font-semibold text-text-primary">
                    {PIPELINE_STAGE_LABELS[stage]}
                  </p>
                  <span className="ml-auto text-xs text-text-muted">{opps.length}</span>
                </div>
                {opps.length === 0 ? (
                  <div className="bg-slate-50 border border-dashed border-surface-border rounded-lg p-4 text-center text-xs text-text-muted">
                    Empty
                  </div>
                ) : (
                  <div className="space-y-2">
                    {opps.map((o) => <DealCard key={o.id} opp={o} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
