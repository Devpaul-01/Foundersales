// ============================================================
// FILE: src/pages/insights/InsightsPage.tsx
// GET /api/insights — patterns, why_losing, skill_trend
// Recharts skill trend lines, loss reason breakdown
// ============================================================
import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useQuery }    from '@tanstack/react-query';
import { insightsApi } from '@/api/insights';
import { queryKeys }   from '@/lib/queryKeys';
import { Badge }       from '@/components/ui/Badge';
import { Tabs }        from '@/components/ui/Tabs';
import { Skeleton }    from '@/components/ui/Skeleton';
import { InlineAlert } from '@/components/common/index';
import { SKILL_DIMENSION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';

const INSIGHT_TABS = [
  { value: 'patterns',  label: 'Patterns'      },
  { value: 'why_losing',label: 'Why you\'re losing' },
  { value: 'skill',     label: 'Skill trend'   },
];

const SKILL_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#f97316',
];

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up')   return <TrendingUp   size={14} className="text-success" />;
  if (trend === 'down') return <TrendingDown size={14} className="text-danger"  />;
  return <Minus size={14} className="text-text-muted" />;
}

export default function InsightsPage() {
  const [tab, setTab] = useState('patterns');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.insights(),
    queryFn:  () => insightsApi.get().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Insights</h1>

      <Tabs tabs={INSIGHT_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* ── Patterns tab ─────────────────────────────── */}
      {tab === 'patterns' && (
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" rounded="lg" />)
          ) : !data?.patterns?.length ? (
            <InlineAlert type="info" message="Complete more activities to unlock pattern insights." />
          ) : (
            data.patterns.map((p: any, i: number) => (
              <div key={i} className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">{p.title}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <TrendIcon trend={p.trend} />
                    <Badge
                      variant={p.trend === 'up' ? 'green' : p.trend === 'down' ? 'red' : 'gray'}
                      size="xs"
                    >
                      {p.trend}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-text-secondary">{p.description}</p>
                {p.recommendation && (
                  <div className="flex items-start gap-2 bg-brand-50 border border-brand-100 rounded-lg p-3">
                    <Zap size={12} className="text-brand mt-0.5 shrink-0" />
                    <p className="text-xs text-text-primary">{p.recommendation}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Why you're losing tab ─────────────────────── */}
      {tab === 'why_losing' && (
        <div className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-48" rounded="lg" />
          ) : !data?.why_losing?.reasons?.length ? (
            <InlineAlert type="info" message="Add lost opportunities to see why you're losing deals." />
          ) : (
            <>
              <div className="bg-white border border-surface-border rounded-lg p-5">
                <p className="text-xs font-semibold text-text-primary mb-4">Top loss reasons</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={data.why_losing.reasons}
                    layout="vertical"
                    margin={{ left: 8, right: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis dataKey="reason" type="category" tick={{ fontSize: 11, fill: '#64748b' }} width={110} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]}>
                      {data.why_losing.reasons.map((_: any, i: number) => (
                        <Cell key={i} fill={SKILL_COLORS[i % SKILL_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data.why_losing.ai_summary && (
                <div className="bg-white border border-surface-border rounded-lg p-5">
                  <p className="text-xs font-semibold text-text-primary mb-2">Clutch analysis</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{data.why_losing.ai_summary}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Skill trend tab ───────────────────────────── */}
      {tab === 'skill' && (
        <div className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-56" rounded="lg" />
          ) : !data?.skill_trend?.series?.length ? (
            <InlineAlert type="info" message="Complete practice sessions to see skill trends." />
          ) : (
            <div className="bg-white border border-surface-border rounded-lg p-5">
              <p className="text-xs font-semibold text-text-primary mb-4">Skill scores over time</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.skill_trend.labels.map((label: string, i: number) => {
                  const point: Record<string, any> = { name: label };
                  data.skill_trend.series.forEach((s: any) => {
                    point[s.skill] = s.data[i] ?? null;
                  });
                  return point;
                })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  {data.skill_trend.series.map((s: any, i: number) => (
                    <Line
                      key={s.skill}
                      type="monotone"
                      dataKey={s.skill}
                      name={SKILL_DIMENSION_LABELS[s.skill] ?? s.skill}
                      stroke={SKILL_COLORS[i % SKILL_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3">
                {data.skill_trend.series.map((s: any, i: number) => (
                  <span key={s.skill} className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: SKILL_COLORS[i % SKILL_COLORS.length] }} />
                    {SKILL_DIMENSION_LABELS[s.skill] ?? s.skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skill deltas */}
          {!isLoading && data?.skill_trend?.deltas?.length > 0 && (
            <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
              <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">30-day changes</p>
              {data.skill_trend.deltas.map((d: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-surface-border last:border-0">
                  <span className="text-sm text-text-primary">{SKILL_DIMENSION_LABELS[d.skill] ?? d.skill}</span>
                  <div className="flex items-center gap-2">
                    <TrendIcon trend={d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : 'flat'} />
                    <span className={cn(
                      'text-sm font-mono font-semibold',
                      d.delta > 0 ? 'text-success' : d.delta < 0 ? 'text-danger' : 'text-text-muted',
                    )}>
                      {d.delta > 0 ? '+' : ''}{d.delta}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
