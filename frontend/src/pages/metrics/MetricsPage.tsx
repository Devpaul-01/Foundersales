import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useQuery }    from '@tanstack/react-query';
import { metricsApi }  from '@/api/metrics';
import { queryKeys }   from '@/lib/queryKeys';
import { ScoreGauge }  from '@/components/ui/ScoreGauge';
import { Badge }       from '@/components/ui/Badge';
import { Tabs }        from '@/components/ui/Tabs';
import { Skeleton }    from '@/components/ui/Skeleton';
import { InlineAlert } from '@/components/common/index';
import { SKILL_DIMENSION_LABELS, PIPELINE_STAGE_LABELS } from '@/lib/constants';
import { formatCurrency, formatRate, formatShortDate, cn } from '@/lib/utils';
import { TrendingUp, Award, AlertTriangle, Zap, BarChart2 } from 'lucide-react';

const METRIC_TABS = [
  { value: 'overview',  label: 'Overview'  },
  { value: 'pipeline',  label: 'Pipeline'  },
  { value: 'skills',    label: 'Skills'    },
  { value: 'ai',        label: 'AI Insights'},
];

// ── Stat card ─────────────────────────────────────────────────
function StatCard({
  label, value, delta, unit, color,
}: {
  label:  string;
  value:  string | number;
  delta?: number | null;
  unit?:  string;
  color?: 'brand' | 'success' | 'warning' | 'danger';
}) {
  const colorMap = {
    brand:   'text-brand',
    success: 'text-success',
    warning: 'text-warning',
    danger:  'text-danger',
  };
  return (
    <div className="bg-white border border-surface-border rounded-lg p-4 space-y-1">
      <p className="text-xs text-text-muted">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <p className={cn('text-2xl font-bold', color ? colorMap[color] : 'text-text-primary')}>
          {value}
        </p>
        {unit && <span className="text-sm text-text-muted">{unit}</span>}
      </div>
      {delta != null && (
        <p className={cn('text-xs', delta >= 0 ? 'text-success' : 'text-danger')}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs last period
        </p>
      )}
    </div>
  );
}

const INTELLIGENCE_ICONS: Record<string, React.ReactNode> = {
  win:      <Award       size={14} className="text-success" />,
  tip:      <Zap         size={14} className="text-brand"   />,
  warning:  <AlertTriangle size={14} className="text-warning" />,
};

export default function MetricsPage() {
  const [tab, setTab] = useState('overview');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.metrics(),
    queryFn:  () => metricsApi.getDashboard().then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const dashboard   = data?.dashboard;
  const pipeline    = data?.pipeline;
  const skillData   = data?.skill_breakdown;
  const intelligence = data?.intelligence ?? [];
  const chartData   = data?.chart_data ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Metrics</h1>

      <Tabs tabs={METRIC_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* ── Overview tab ─────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Momentum gauge + key stats */}
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" rounded="lg" />)}
            </div>
          ) : (
            <>
              <div className="bg-white border border-surface-border rounded-lg p-5 flex items-center gap-5">
                <ScoreGauge
                  score={dashboard?.momentum_score ?? 0}
                  size="lg"
                  label="Momentum"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm text-text-secondary">{dashboard?.momentum_insight}</p>
                  {dashboard?.momentum_breakdown && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                      {Object.entries(dashboard.momentum_breakdown).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-xs">
                          <span className="text-text-muted capitalize">{k}</span>
                          <div className="flex-1 mx-2 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand rounded-full"
                              style={{ width: `${Math.min(100, v as number)}%` }}
                            />
                          </div>
                          <span className="text-text-primary font-mono w-6 text-right">{v as number}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Sent (30d)"
                  value={dashboard?.sent_30d ?? 0}
                  color="brand"
                />
                <StatCard
                  label="Response rate"
                  value={formatRate(dashboard?.response_rate)}
                  delta={dashboard?.response_rate_delta}
                  color={
                    (dashboard?.response_rate ?? 0) >= 0.3 ? 'success' :
                    (dashboard?.response_rate ?? 0) >= 0.15 ? 'warning' : 'danger'
                  }
                />
                <StatCard
                  label="Pipeline value"
                  value={formatCurrency(pipeline?.pipeline_value, true)}
                  color="success"
                />
                <StatCard
                  label="Win rate"
                  value={`${pipeline?.win_rate_pct ?? 0}%`}
                  color={
                    (pipeline?.win_rate_pct ?? 0) >= 30 ? 'success' :
                    (pipeline?.win_rate_pct ?? 0) >= 15 ? 'warning' : 'danger'
                  }
                />
              </div>
            </>
          )}

          {/* Activity chart */}
          {isLoading ? (
            <Skeleton className="h-52" rounded="lg" />
          ) : chartData.length > 1 ? (
            <div className="bg-white border border-surface-border rounded-lg p-5">
              <p className="text-xs font-semibold text-text-primary mb-4">30-day activity</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="respGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => v.slice(5)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    labelFormatter={(v) => formatShortDate(v as string)}
                  />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Sent"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#sentGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="responses"
                    name="Responses"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#respGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Pipeline tab ─────────────────────────────── */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-56" rounded="lg" />
          ) : !pipeline ? (
            <InlineAlert type="info" message="No pipeline data yet." />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Contacted"    value={pipeline.contacted_count}   />
                <StatCard label="Replied"      value={pipeline.replied_count}     />
                <StatCard label="Call / Demo"  value={pipeline.call_demo_count}   />
                <StatCard label="Closed won"   value={pipeline.closed_won_count}  color="success" />
                <StatCard label="Total revenue" value={formatCurrency(pipeline.total_revenue, true)} color="success" />
                <StatCard label="Win rate"      value={`${pipeline.win_rate_pct}%`} />
              </div>

              <div className="bg-white border border-surface-border rounded-lg p-5">
                <p className="text-xs font-semibold text-text-primary mb-4">Pipeline funnel</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={[
                      { stage: 'Contacted',   count: pipeline.contacted_count  },
                      { stage: 'Replied',     count: pipeline.replied_count    },
                      { stage: 'Call/Demo',   count: pipeline.call_demo_count  },
                      { stage: 'Closed won',  count: pipeline.closed_won_count },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="stage" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Skills tab ───────────────────────────────── */}
      {tab === 'skills' && (
        <div className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-64" rounded="lg" />
          ) : !skillData ? (
            <InlineAlert type="info" message="Complete practice sessions to see skill scores." />
          ) : (
            <>
              <div className="bg-white border border-surface-border rounded-lg p-5">
                <p className="text-xs font-semibold text-text-primary mb-4">Skill radar</p>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart
                    data={Object.entries(skillData).map(([skill, score]) => ({
                      skill: SKILL_DIMENSION_LABELS[skill] ?? skill,
                      score: (score as number) ?? 0,
                    }))}
                  >
                    <PolarGrid stroke="#f1f5f9" />
                    <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Radar
                      dataKey="score"
                      stroke="#2563eb"
                      fill="#2563eb"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Skill bars */}
              <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
                {Object.entries(skillData).map(([skill, score]) => {
                  const pct = Math.min(100, ((score as number) ?? 0));
                  return (
                    <div key={skill} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-text-secondary">{SKILL_DIMENSION_LABELS[skill] ?? skill}</span>
                        <span className={cn(
                          'font-semibold',
                          pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-danger',
                        )}>
                          {pct}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── AI Insights tab ──────────────────────────── */}
      {tab === 'ai' && (
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" rounded="lg" />)
          ) : intelligence.length === 0 ? (
            <InlineAlert type="info" message="AI insights will appear as you use the platform." />
          ) : (
            intelligence.map((item: any, i: number) => (
              <div key={i} className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {INTELLIGENCE_ICONS[item.type] ?? <BarChart2 size={14} className="text-text-muted" />}
                  <p className="text-sm font-semibold text-text-primary">{item.title}</p>
                </div>
                <p className="text-sm text-text-secondary">{item.description}</p>
                {item.action_label && item.action_url && (
                  <button className="text-xs text-brand hover:underline">
                    {item.action_label} →
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
