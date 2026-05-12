// FILE: src/pages/team/TeamInsightsPage.tsx
// GET /api/insights/workspace/why-losing (manager+)
// GET /api/insights/workspace/skill-matrix (manager+)
import React, { useState } from 'react';
import { useQuery }      from '@tanstack/react-query';
import { insightsApi }   from '@/api/insights';
import { queryKeys }     from '@/lib/queryKeys';
import { Badge }         from '@/components/ui/Badge';
import { Avatar }        from '@/components/ui/Avatar';
import { Tabs }          from '@/components/ui/Tabs';
import { Skeleton }      from '@/components/ui/Skeleton';
import { InlineAlert }   from '@/components/common/index';
import { SKILL_DIMENSION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const TEAM_INSIGHT_TABS = [
  { value: 'why_losing', label: 'Why losing'   },
  { value: 'matrix',     label: 'Skill matrix' },
];

export default function TeamInsightsPage() {
  const [tab, setTab] = useState('why_losing');

  const { data: whyData, isLoading: whyLoading } = useQuery({
    queryKey: queryKeys.workspaceWhyLosing,
    queryFn:  () => insightsApi.getWorkspaceWhyLosing().then((r) => r.data),
    staleTime: 10 * 60_000,
  });

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: queryKeys.skillMatrix,
    queryFn:  () => insightsApi.getWorkspaceSkillMatrix().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'matrix',
  });

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Team insights</h1>

      <Tabs tabs={TEAM_INSIGHT_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* Why losing */}
      {tab === 'why_losing' && (
        <div className="space-y-4">
          {whyLoading ? (
            <Skeleton className="h-48" rounded="lg" />
          ) : !whyData?.reasons?.length ? (
            <InlineAlert type="info" message="Add more lost deals to see team-wide loss patterns." />
          ) : (
            <>
              {whyData.summary && (
                <div className="bg-white border border-surface-border rounded-lg p-5">
                  <p className="text-xs font-semibold text-text-primary mb-2">Team summary</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{whyData.summary}</p>
                </div>
              )}
              <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
                  Top reasons
                </p>
                {whyData.reasons.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0">
                    <div className="flex-1">
                      <p className="text-sm text-text-primary">{r.reason}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-danger rounded-full"
                          style={{ width: `${Math.min(100, (r.count / (whyData.total ?? 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-muted w-8 text-right">{r.count}×</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Skill matrix */}
      {tab === 'matrix' && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          {matrixLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !(matrixData?.members ?? []).length ? (
            <div className="p-8 text-center text-sm text-text-muted">No skill data yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-base">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Member</th>
                    {Object.keys(SKILL_DIMENSION_LABELS).slice(0, 3).map((k) => (
                      <th key={k} className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">
                        {SKILL_DIMENSION_LABELS[k].split(' ')[0]}
                      </th>
                    ))}
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData?.members.map((m: any) => (
                    <tr key={m.user_id} className="border-b border-surface-border last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={m.name} size="xs" />
                          <span className="text-text-primary">{m.name}</span>
                        </div>
                      </td>
                      {Object.keys(SKILL_DIMENSION_LABELS).slice(0, 3).map((k) => (
                        <td key={k} className="text-right px-3 py-2.5">
                          <span className={cn(
                            'text-xs font-mono',
                            (m.skills?.[k] ?? 0) >= 70 ? 'text-success' :
                            (m.skills?.[k] ?? 0) >= 40 ? 'text-warning' : 'text-danger',
                          )}>
                            {m.skills?.[k] ?? '—'}
                          </span>
                        </td>
                      ))}
                      <td className="text-right px-4 py-2.5">
                        <span className={cn(
                          'text-sm font-bold',
                          (m.overall_score ?? 0) >= 70 ? 'text-success' :
                          (m.overall_score ?? 0) >= 40 ? 'text-warning' : 'text-danger',
                        )}>
                          {m.overall_score ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
