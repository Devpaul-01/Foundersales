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
import { TrendingUp, AlertTriangle, Zap, BarChart2, ShieldAlert, Target, Trophy, CalendarClock, CalendarCheck2 } from 'lucide-react';

const METRIC_TABS = [
  { value: 'overview',  label: 'Overview'  },
  { value: 'pipeline',  label: 'Pipeline'  },
  { value: 'skills',    label: 'Skills'    },
  { value: 'practice',  label: 'Practice'  },
  { value: 'analyses',  label: 'Analyses'  },
  { value: 'calendar',  label: 'Calendar'  },
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
  pattern:     <TrendingUp    size={14} className="text-brand"   />,
  opportunity: <Zap           size={14} className="text-success" />,
  warning:     <AlertTriangle size={14} className="text-warning" />,
  coaching:    <Target        size={14} className="text-brand"   />,
};

// ── Alert banner (Overview) ──────────────────────────────────
function AlertBanner({ alerts }: { alerts: any[] }) {
  if (!alerts?.length) return null;
  const styleMap: Record<string, { bg: string; border: string; text: string }> = {
    high:   { bg: 'bg-danger/5',  border: 'border-danger/20',  text: 'text-danger'  },
    medium: { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning' },
    low:    { bg: 'bg-brand/5',   border: 'border-brand/20',   text: 'text-brand'   },
  };
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const s = styleMap[a.priority] ?? styleMap.low;
        return (
          <div key={i} className={cn('border rounded-lg p-3 flex items-start gap-2.5', s.bg, s.border)}>
            <span className="text-base leading-none mt-0.5">{a.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-semibold', s.text)}>{a.title}</p>
              <p className="text-xs text-text-secondary mt-0.5">{a.body}</p>
              {a.action && <p className="text-xs text-text-muted mt-1">{a.action} →</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Prospect relationship health (Pipeline tab) ──────────────
function ProspectHealthSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-56" rounded="lg" />;
  if (!data?.has_data) return <InlineAlert type="info" message="Add prospects to see relationship health." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Prospects" value={data.total_prospects ?? 0} />
        <StatCard
          label="Avg health"
          value={data.avg_health_score ?? '—'}
          color={(data.avg_health_score ?? 0) >= 70 ? 'success' : (data.avg_health_score ?? 0) >= 40 ? 'warning' : 'danger'}
        />
        <StatCard label="Going cold" value={data.stale_count ?? 0} color={data.stale_count ? 'warning' : undefined} />
      </div>

      {data.stage_distribution && Object.keys(data.stage_distribution).length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-2">
          <p className="text-xs font-semibold text-text-primary mb-2">Stage distribution</p>
          {Object.entries(data.stage_distribution).map(([stage, count]) => (
            <div key={stage} className="flex justify-between text-xs">
              <span className="text-text-secondary capitalize">{stage.replace(/_/g, ' ')}</span>
              <span className="font-mono text-text-primary">{count as number}</span>
            </div>
          ))}
        </div>
      )}

      {data.at_risk?.length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
          <p className="text-xs font-semibold text-danger flex items-center gap-1.5">
            <ShieldAlert size={13} /> At risk
          </p>
          {data.at_risk.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">{p.name}{p.company ? ` · ${p.company}` : ''}</span>
              <span className="font-mono text-danger">{p.relationship_health_score ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {data.top_relationships?.length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
          <p className="text-xs font-semibold text-success">Strongest relationships</p>
          {data.top_relationships.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">{p.name}{p.company ? ` · ${p.company}` : ''}</span>
              <span className="font-mono text-success">{p.relationship_health_score ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Practice skill axes (Skills tab) ─────────────────────────
const AXIS_LABELS: Record<string, string> = {
  clarity: 'Clarity', value: 'Value prop', discovery: 'Discovery',
  objection: 'Objection handling', brevity: 'Brevity', cta: 'CTA',
};

function PracticeSkillProfileSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-56" rounded="lg" />;
  if (!data?.has_data) return null;
  const axes = data.axes ?? {};
  return (
    <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-text-primary">Practice skill axes</p>
        {data.overall_delta != null && (
          <span className={cn('text-xs font-semibold', data.overall_delta >= 0 ? 'text-success' : 'text-danger')}>
            {data.overall_delta >= 0 ? '▲' : '▼'} {Math.abs(data.overall_delta)} vs last period
          </span>
        )}
      </div>
      {Object.entries(axes).map(([axis, score]) => {
        const val = (score as number) ?? 0;
        const pct = Math.min(100, Math.round((val / 10) * 100));
        return (
          <div key={axis} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">{AXIS_LABELS[axis] ?? axis}</span>
              <span className={cn('font-semibold', pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-danger')}>
                {score != null ? val : '—'}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {(data.weakest_axis || data.strongest_axis) && (
        <div className="flex gap-2 pt-1 flex-wrap">
          {data.strongest_axis && (
            <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
              Strongest: {AXIS_LABELS[data.strongest_axis] ?? data.strongest_axis}
            </span>
          )}
          {data.weakest_axis && (
            <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">
              Focus: {AXIS_LABELS[data.weakest_axis] ?? data.weakest_axis}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Practice summary / achievements / recommendations (Practice tab) ──
function PracticeSummarySection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-56" rounded="lg" />;
  if (!data?.has_data) return <InlineAlert type="info" message="Complete practice sessions to see performance stats." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Sessions" value={data.total_sessions ?? 0} />
        <StatCard
          label="Goal achieved"
          value={formatRate(data.goal_achieved_rate)}
          color={(data.goal_achieved_rate ?? 0) >= 0.5 ? 'success' : 'warning'}
        />
        <StatCard label="Avg score" value={data.avg_session_score ?? '—'} unit="/100" />
        <StatCard label="Reply rate" value={formatRate(data.reply_received_rate)} />
      </div>

      {data.by_scenario && Object.keys(data.by_scenario).length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
          <p className="text-xs font-semibold text-text-primary">By scenario</p>
          {Object.entries(data.by_scenario).map(([scenario, s]: [string, any]) => (
            <div key={scenario} className="flex items-center justify-between text-xs gap-2">
              <span className="text-text-secondary capitalize flex-1">{scenario.replace(/_/g, ' ')}</span>
              <span className="text-text-muted">{s.count} session{s.count === 1 ? '' : 's'}</span>
              <span className="font-mono text-text-primary w-8 text-right">{s.avg_score ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AchievementsSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-40" rounded="lg" />;
  const badges = data?.badges ?? [];
  const drillImprovements = data?.drill_improvements ?? [];
  if (!badges.length && !drillImprovements.length) return null;
  return (
    <div className="space-y-4">
      {badges.length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-2">
          <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
            <Trophy size={13} className="text-warning" /> Badges earned
          </p>
          <div className="flex flex-wrap gap-2">
            {badges.map((b: any, i: number) => (
              <span
                key={i}
                title={b.badge_description ?? ''}
                className="text-xs bg-brand/10 text-brand px-2 py-1 rounded-full font-medium"
              >
                {b.badge_label}
              </span>
            ))}
          </div>
        </div>
      )}
      {drillImprovements.length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-2">
          <p className="text-xs font-semibold text-text-primary">Drill improvement by axis</p>
          {drillImprovements.map((d: any) => (
            <div key={d.axis} className="flex items-center justify-between text-xs gap-2">
              <span className="text-text-secondary capitalize flex-1">{d.axis.replace(/_/g, ' ')}</span>
              <span className="text-text-muted">{d.drills_completed} drills</span>
              <span className={cn('font-mono w-10 text-right', d.avg_improvement >= 0 ? 'text-success' : 'text-danger')}>
                {d.avg_improvement >= 0 ? '+' : ''}{d.avg_improvement}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationsSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-32" rounded="lg" />;
  const recs = data?.recommendations ?? [];
  if (!recs.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-text-primary px-0.5">Recommended practice</p>
      {recs.map((r: any, i: number) => (
        <div key={i} className="bg-white border border-surface-border rounded-lg p-4 space-y-1">
          <div className="flex items-center gap-2">
            <Target size={13} className={r.priority === 'high' ? 'text-danger' : 'text-warning'} />
            <p className="text-sm font-semibold text-text-primary">{r.title}</p>
          </div>
          <p className="text-xs text-text-secondary">{r.description}</p>
        </div>
      ))}
    </div>
  );
}

// ── Objections (Analyses tab) ────────────────────────────────
function ObjectionsSection({ data, isLoading }: { data: any; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-56" rounded="lg" />;
  if (!data?.has_data) return null;
  return (
    <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
      <p className="text-xs font-semibold text-text-primary">Objections ({data.total_unique_types})</p>
      {data.objections.slice(0, 8).map((o: any) => (
        <div key={o.type} className="border-l-2 border-warning pl-3 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-text-primary capitalize">{o.type.replace(/_/g, ' ')}</span>
            <span className="text-xs text-text-muted">{o.occurrence_count}×</span>
            {!o.best_response && (
              <span className="text-xs bg-danger/10 text-danger px-1.5 py-0.5 rounded-full">No saved response</span>
            )}
            {o.has_market_intel && (
              <span className="text-xs bg-brand/10 text-brand px-1.5 py-0.5 rounded-full">Market intel</span>
            )}
          </div>
          <p className="text-xs text-text-secondary italic">"{o.sample_phrase}"</p>
          {(o.response_score != null || o.practice_score != null) && (
            <p className="text-xs text-text-muted">
              {o.response_score != null && `Response score ${o.response_score}`}
              {o.response_score != null && o.practice_score != null && ' · '}
              {o.practice_score != null && `Practice score ${o.practice_score}`}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Calendar prep + meeting performance (Calendar tab) ───────
function CalendarTabContent({ prep, prepLoading, meetings, meetingsLoading }: any) {
  return (
    <div className="space-y-4">
      {prepLoading ? (
        <Skeleton className="h-40" rounded="lg" />
      ) : !prep?.has_data ? (
        <InlineAlert type="info" message="No meetings in the last 2 weeks or scheduled in the next 7 days." />
      ) : (
        <>
          {prep.needs_prep?.length > 0 && (
            <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-warning flex items-center gap-1.5">
                <CalendarClock size={13} /> Needs prep
              </p>
              {prep.needs_prep.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">{e.title}{e.attendee_name ? ` · ${e.attendee_name}` : ''}</span>
                  <span className="text-text-muted font-mono">{formatShortDate(e.event_date)}</span>
                </div>
              ))}
            </div>
          )}
          {prep.needs_debrief?.length > 0 && (
            <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-brand flex items-center gap-1.5">
                <CalendarCheck2 size={13} /> Needs debrief
              </p>
              {prep.needs_debrief.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">{e.title}{e.attendee_name ? ` · ${e.attendee_name}` : ''}</span>
                  <span className="text-text-muted font-mono">{formatShortDate(e.event_date)}</span>
                </div>
              ))}
            </div>
          )}
          {!prep.needs_prep?.length && !prep.needs_debrief?.length && (
            <InlineAlert type="info" message="You're all caught up on prep and debriefs." />
          )}
        </>
      )}

      {meetingsLoading ? (
        <Skeleton className="h-40" rounded="lg" />
      ) : meetings?.has_data && (
        <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
          <p className="text-xs font-semibold text-text-primary">Meeting performance ({meetings.period})</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Meetings" value={meetings.total_meetings ?? 0} />
            <StatCard label="Debriefed" value={formatRate(meetings.debrief_completion_rate)} />
            <StatCard label="Avg energy" value={meetings.avg_energy_score ?? '—'} />
            <StatCard label="Prepped" value={meetings.meetings_with_prep_generated ?? 0} />
          </div>
          {meetings.outcomes && (
            <div className="flex gap-4 text-xs pt-1">
              <span className="text-success">Positive: {meetings.outcomes.positive}</span>
              <span className="text-danger">Negative: {meetings.outcomes.negative}</span>
              <span className="text-text-muted">Pending: {meetings.outcomes.pending}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MetricsPage() {
  const [tab, setTab] = useState('overview');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn:  () => metricsApi.getDashboard().then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: queryKeys.alerts,
    queryFn:  () => metricsApi.getAlerts().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: skillData, isLoading: skillLoading } = useQuery({
    queryKey: queryKeys.skillBreakdown,
    queryFn:  () => metricsApi.getSkillBreakdown().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'skills',
  });

  const { data: skillProfile, isLoading: skillProfileLoading } = useQuery({
    queryKey: queryKeys.practiceSkillProfile,
    queryFn:  () => metricsApi.getPracticeSkillProfile().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'skills',
  });

  const { data: prospectsHealth, isLoading: prospectsLoading } = useQuery({
    queryKey: queryKeys.prospectsHealth,
    queryFn:  () => metricsApi.getProspectsHealth().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'pipeline',
  });

  const { data: practiceSummary, isLoading: practiceSummaryLoading } = useQuery({
    queryKey: queryKeys.practiceSummary('30d'),
    queryFn:  () => metricsApi.getPracticeSummary('30d').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'practice',
  });

  const { data: achievements, isLoading: achievementsLoading } = useQuery({
    queryKey: queryKeys.achievements,
    queryFn:  () => metricsApi.getAchievements().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'practice',
  });

  const { data: recommendations, isLoading: recommendationsLoading } = useQuery({
    queryKey: queryKeys.practiceRecommendations,
    queryFn:  () => metricsApi.getPracticeRecommendations().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'practice',
  });

  const { data: analysesData, isLoading: analysesLoading } = useQuery({
    queryKey: queryKeys.metrics('conversation-analyses'),
    queryFn:  () => metricsApi.getConversationAnalyses().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'analyses',
  });

  const { data: objectionsData, isLoading: objectionsLoading } = useQuery({
    queryKey: queryKeys.objections,
    queryFn:  () => metricsApi.getObjections().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'analyses',
  });

  const { data: calendarPrep, isLoading: calendarPrepLoading } = useQuery({
    queryKey: queryKeys.calendarPrep,
    queryFn:  () => metricsApi.getCalendarPrep().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'calendar',
  });

  const { data: meetingsSummary, isLoading: meetingsSummaryLoading } = useQuery({
    queryKey: queryKeys.meetingsSummary('30d'),
    queryFn:  () => metricsApi.getMeetingsSummary('30d').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'calendar',
  });

  const { data: intelligenceData, isLoading: intelligenceLoading } = useQuery({
    queryKey: queryKeys.intelligence,
    queryFn:  () => metricsApi.getIntelligence().then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled:  tab === 'ai',
  });

  const dashboard   = data?.dashboard;
  const pipeline    = data?.pipeline;
  const chartData   = data?.chart_data ?? [];

  return (
    <div className="page-container space-y-5">
      <h1 className="text-xl font-bold text-text-primary">Metrics</h1>

      <Tabs tabs={METRIC_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* ── Overview tab ─────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <AlertBanner alerts={alertsData?.alerts} />

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

          <ProspectHealthSection data={prospectsHealth} isLoading={prospectsLoading} />
        </div>
      )}

      {/* ── Skills tab ───────────────────────────────── */}
      {tab === 'skills' && (
        <div className="space-y-4">
          {skillLoading ? (
            <Skeleton className="h-64" rounded="lg" />
          ) : !skillData?.has_data ? (
            <InlineAlert type="info" message="Complete practice sessions to see skill scores." />
          ) : (
            <>
              <div className="bg-white border border-surface-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-text-primary">Skill radar (7d)</p>
                  {skillData.composite != null && (
                    <span className="text-xs text-text-muted">
                      Composite <span className="font-mono text-text-primary font-semibold">{skillData.composite}</span>/10
                    </span>
                  )}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart
                    data={Object.entries(skillData.scores).map(([skill, score]) => ({
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
                {(skillData.weakest || skillData.strongest) && (
                  <div className="flex gap-2 pt-3 flex-wrap">
                    {skillData.strongest && (
                      <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                        Strongest: {SKILL_DIMENSION_LABELS[skillData.strongest] ?? skillData.strongest}
                      </span>
                    )}
                    {skillData.weakest && (
                      <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">
                        Focus: {SKILL_DIMENSION_LABELS[skillData.weakest] ?? skillData.weakest}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Skill bars — scores are on a 0–10 scale, same as conversation_analyses */}
              <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
                {Object.entries(skillData.scores).map(([skill, score]) => {
                  const pct = Math.min(100, Math.round(((score as number) ?? 0) * 10));
                  return (
                    <div key={skill} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-text-secondary">{SKILL_DIMENSION_LABELS[skill] ?? skill}</span>
                        <span className={cn(
                          'font-semibold',
                          pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-danger',
                        )}>
                          {score as number ?? '—'}
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

          <PracticeSkillProfileSection data={skillProfile} isLoading={skillProfileLoading} />
        </div>
      )}

      {/* ── Practice tab ─────────────────────────────── */}
      {tab === 'practice' && (
        <div className="space-y-4">
          <PracticeSummarySection data={practiceSummary} isLoading={practiceSummaryLoading} />
          <RecommendationsSection data={recommendations} isLoading={recommendationsLoading} />
          <AchievementsSection data={achievements} isLoading={achievementsLoading} />
        </div>
      )}

      {/* ── Analyses tab ─────────────────────────────── */}
      {tab === 'analyses' && (
        <div className="space-y-4">
          {analysesLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" rounded="lg" />)
          ) : !analysesData?.has_data ? (
            <InlineAlert type="info" message="Message analyses appear here after you submit feedback on sent opportunities." />
          ) : (
            <>
              {/* Score overview row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Composite avg" value={analysesData.avg_scores?.composite ?? '—'} unit="/10"
                  color={(analysesData.avg_scores?.composite ?? 0) >= 7 ? 'success' : (analysesData.avg_scores?.composite ?? 0) >= 4 ? 'warning' : 'danger'} />
                <StatCard label="Analysed (30d)" value={analysesData.total ?? 0} />
                <StatCard label="Trend (15d)" value={analysesData.trend_delta != null ? `${analysesData.trend_delta > 0 ? '+' : ''}${analysesData.trend_delta}` : '—'}
                  color={analysesData.trend_delta == null ? undefined : analysesData.trend_delta >= 0 ? 'success' : 'danger'} />
                <StatCard label="Hook avg" value={analysesData.avg_scores?.hook ?? '—'} unit="/10" />
              </div>

              {/* Dimension breakdown bars */}
              <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
                <p className="text-xs font-semibold text-text-primary">Score dimensions</p>
                {([
                  ['hook',            'Hook'],
                  ['clarity',         'Clarity'],
                  ['value_prop',      'Value prop'],
                  ['personalization', 'Personalization'],
                  ['cta',             'CTA'],
                  ['tone',            'Tone'],
                ] as [string, string][]).map(([key, label]) => {
                  const raw = analysesData.avg_scores?.[key];
                  const pct = raw != null ? Math.min(100, Math.round((raw / 10) * 100)) : null;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-text-secondary">{label}</span>
                        <span className={cn('font-semibold',
                          pct == null ? 'text-text-muted' : pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-danger'
                        )}>
                          {raw != null ? raw : '—'}
                        </span>
                      </div>
                      {pct != null && (
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger')}
                            style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Top improvements */}
              {analysesData.improvements?.length > 0 && (
                <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
                  <p className="text-xs font-semibold text-text-primary">Priority improvements</p>
                  {analysesData.improvements.map((imp: any, i: number) => (
                    <div key={i} className="border-l-2 border-brand pl-3 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-brand capitalize">{imp.dimension}</span>
                        <span className="text-xs text-text-muted">{imp.date}</span>
                        {imp.outcome && (
                          <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                            imp.outcome === 'positive' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                          )}>
                            {imp.outcome}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary">{imp.suggestion}</p>
                      {imp.example && <p className="text-xs text-text-muted italic">e.g. "{imp.example}"</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Failure / success signals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analysesData.top_failures?.length > 0 && (
                  <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                    <p className="text-xs font-semibold text-danger">Common failure patterns</p>
                    {analysesData.top_failures.map((f: any) => (
                      <div key={f.label} className="flex justify-between text-xs">
                        <span className="text-text-secondary capitalize">{f.label.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-danger">{f.count}×</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysesData.top_successes?.length > 0 && (
                  <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                    <p className="text-xs font-semibold text-success">Success signals</p>
                    {analysesData.top_successes.map((s: any) => (
                      <div key={s.label} className="flex justify-between text-xs">
                        <span className="text-text-secondary capitalize">{s.label.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-success">{s.count}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent analyses */}
              {analysesData.recent?.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-text-primary px-0.5">Recent analyses</p>
                  {analysesData.recent.map((a: any) => (
                    <div key={a.id} className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold',
                            a.outcome === 'positive' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                          )}>
                            {a.outcome}
                          </span>
                          {a.platform && <span className="text-xs text-text-muted capitalize">{a.platform}</span>}
                          {a.word_count && <span className="text-xs text-text-muted">{a.word_count}w</span>}
                        </div>
                        <span className={cn('text-sm font-bold',
                          (a.composite_score ?? 0) >= 7 ? 'text-success' : (a.composite_score ?? 0) >= 4 ? 'text-warning' : 'text-danger'
                        )}>
                          {a.composite_score ?? '—'}<span className="text-xs font-normal text-text-muted">/10</span>
                        </span>
                      </div>
                      {a.analysis_text && <p className="text-xs text-text-secondary">{a.analysis_text}</p>}
                      {a.failure_categories?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {a.failure_categories.map((f: string) => (
                            <span key={f} className="text-xs bg-danger/10 text-danger px-1.5 py-0.5 rounded-full capitalize">
                              {f.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      {a.success_signals?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {a.success_signals.map((s: string) => (
                            <span key={s} className="text-xs bg-success/10 text-success px-1.5 py-0.5 rounded-full capitalize">
                              {s.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      {a.has_social_proof === false && (
                        <p className="text-xs text-text-muted">⚠ No social proof detected</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <ObjectionsSection data={objectionsData} isLoading={objectionsLoading} />
        </div>
      )}

      {/* ── Calendar tab ─────────────────────────────── */}
      {tab === 'calendar' && (
        <CalendarTabContent
          prep={calendarPrep} prepLoading={calendarPrepLoading}
          meetings={meetingsSummary} meetingsLoading={meetingsSummaryLoading}
        />
      )}

      {/* ── AI Insights tab ──────────────────────────── */}
      {tab === 'ai' && (
        <div className="space-y-3">
          {intelligenceLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" rounded="lg" />)
          ) : !intelligenceData?.insights?.length ? (
            <InlineAlert type="info" message="AI insights will appear as you use the platform." />
          ) : (
            <>
              {intelligenceData.fallback && (
                <p className="text-xs text-text-muted px-0.5">Showing rule-based insights while AI analysis is unavailable.</p>
              )}
              {intelligenceData.insights.map((item: any, i: number) => (
                <div key={i} className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    {INTELLIGENCE_ICONS[item.type] ?? <BarChart2 size={14} className="text-text-muted" />}
                    <p className="text-sm font-semibold text-text-primary">{item.title}</p>
                  </div>
                  <p className="text-sm text-text-secondary">{item.body}</p>
                  {item.action && (
                    <p className="text-xs text-brand font-medium">{item.action} →</p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
