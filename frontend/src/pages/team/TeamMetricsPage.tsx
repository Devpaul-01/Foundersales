// FILE: src/pages/team/TeamMetricsPage.tsx
// GET /api/metrics/workspace/team-overview   (manager+)
// GET /api/metrics/workspace/leaderboard     (manager+)
// GET /api/metrics/workspace/coaching-queue  (manager+)
// GET /api/metrics/workspace/team-velocity   (manager+)
// GET /api/metrics/workspace/activity-feed   (manager+)
import React, { useState } from 'react';
import { useQuery }        from '@tanstack/react-query';
import { metricsApi }      from '@/api/metrics';
import { queryKeys }       from '@/lib/queryKeys';
import { Avatar }          from '@/components/ui/Avatar';
import { Badge }           from '@/components/ui/Badge';
import { Tabs }            from '@/components/ui/Tabs';
import { Skeleton }        from '@/components/ui/Skeleton';
import { InlineAlert }     from '@/components/common/index';
import { cn }              from '@/lib/utils';

// ─── Tab config ────────────────────────────────────────────────
const TEAM_METRICS_TABS = [
  { value: 'overview',  label: 'Overview'       },
  { value: 'board',     label: 'Leaderboard'    },
  { value: 'coaching',  label: 'Coaching queue' },
  { value: 'velocity',  label: 'Velocity'       },
  { value: 'activity',  label: 'Activity feed'  },
];

// ─── Tiny shared helpers ───────────────────────────────────────
function ScorePill({ value, max = 10 }: { value: number | null; max?: number }) {
  if (value == null) return <span className="text-xs text-text-muted font-mono">—</span>;
  const pct = Math.min(100, (value / max) * 100);
  const color =
    pct >= 70 ? 'text-success' :
    pct >= 40 ? 'text-warning' :
               'text-danger';
  return <span className={cn('text-sm font-bold font-mono tabular-nums', color)}>{value}</span>;
}

function MiniBar({ pct, color = 'bg-primary' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-1 bg-surface-base rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 border-b border-surface-border bg-surface-base">
      {label}
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="p-8 text-center text-sm text-text-muted">{message}</div>;
}

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white border border-surface-border rounded-lg overflow-hidden', className)}>
      {children}
    </div>
  );
}

// ─── Flag labels for coaching queue ───────────────────────────
const FLAG_META: Record<string, { label: string; color: string }> = {
  no_outreach_7d:        { label: 'No outreach',    color: 'bg-amber-100 text-amber-700' },
  no_practice_7d:        { label: 'No practice',    color: 'bg-blue-100  text-blue-700'  },
  score_declining:       { label: 'Score ↓',        color: 'bg-red-100   text-red-700'   },
  low_skill_score:       { label: 'Low skill',      color: 'bg-red-100   text-red-700'   },
  low_relationship_health:{ label: 'Cold pipeline', color: 'bg-purple-100 text-purple-700'},
};

// ─── Activity event labels ─────────────────────────────────────
function eventLabel(type: string): string {
  const map: Record<string, string> = {
    message_sent:          'Sent a message',
    deal_closed_won:       'Closed a deal ✓',
    deal_closed_lost:      'Lost a deal',
    practice_completed:    'Completed practice',
    check_in_submitted:    'Submitted check-in',
    goal_achieved:         'Hit a goal 🎯',
    prospect_added:        'Added prospect',
    skill_score_updated:   'Skill score updated',
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 2)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ═══════════════════════════════════════════════════════════════
// Tab: Overview
// ═══════════════════════════════════════════════════════════════
function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceTeamOverview,
    queryFn:  () => metricsApi.getWorkspaceTeamOverview().then(r => r.data),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <OverviewSkeleton />;
  if (!data?.members?.length) return <InlineAlert type="info" message="No active members found in this workspace." />;

  const { members, team_avg_score, team_weakest_axis, members_not_practiced_this_week, team_objections, team_signals } = data;

  const totalOutreach = members.reduce((s: number, m: any) => s + (m.outreach_sent_this_week ?? 0), 0);
  const totalSessions = members.reduce((s: number, m: any) => s + (m.sessions_this_week ?? 0), 0);
  const needsCoaching = members_not_practiced_this_week?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Team skill score" value={team_avg_score != null ? team_avg_score.toFixed(1) : '—'} sub="avg composite" />
        <KpiCard label="Outreach this week" value={String(totalOutreach)} sub="messages sent" />
        <KpiCard label="Practice sessions" value={String(totalSessions)} sub="7-day total" />
        <KpiCard label="No practice 7d" value={String(needsCoaching)} sub="members" highlight={needsCoaching > 0} />
      </div>

      {/* Weak axis + signal strip */}
      {(team_weakest_axis || team_signals?.top_signals?.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {team_weakest_axis && (
            <CardShell>
              <div className="p-4 space-y-1">
                <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">Team weak spot</p>
                <p className="text-sm font-semibold text-text-primary capitalize">{team_weakest_axis.replace(/_/g, ' ')}</p>
                <p className="text-xs text-text-secondary">Most common weakest axis across reps — target this in coaching.</p>
              </div>
            </CardShell>
          )}
          {team_signals?.top_signals?.length > 0 && (
            <CardShell>
              <div className="p-4 space-y-2">
                <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">Buying signals (7d)</p>
                {team_signals.top_signals.slice(0, 3).map((s: any) => (
                  <div key={s.type} className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary capitalize">{s.type.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-semibold text-success">{s.count}×</span>
                  </div>
                ))}
              </div>
            </CardShell>
          )}
        </div>
      )}

      {/* Member table */}
      <CardShell>
        <SectionHeader label="All members" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface-base">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Member</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">Skill</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">Outreach</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">Sessions</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-text-muted">Goals %</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-text-muted">Weakness</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m: any) => (
                <tr key={m.user_id} className="border-b border-surface-border last:border-0 hover:bg-surface-base/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} size="xs" />
                      <div>
                        <p className="text-text-primary text-sm">{m.name}</p>
                        {m.last_active && (
                          <p className="text-xs text-text-muted">Active {m.last_active}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <ScorePill value={m.avg_skill_score} />
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <span className="text-xs font-mono text-text-primary">{m.outreach_sent_this_week ?? 0}</span>
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <span className={cn('text-xs font-mono', m.sessions_this_week === 0 ? 'text-danger' : 'text-text-primary')}>
                      {m.sessions_this_week ?? 0}
                    </span>
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <span className="text-xs font-mono text-text-secondary">{m.goal_completion_pct ?? 0}%</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {m.weakest_axis
                      ? <span className="text-xs text-warning capitalize">{m.weakest_axis.replace(/_/g, ' ')}</span>
                      : <span className="text-xs text-text-muted">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardShell>

      {/* Team objection patterns */}
      {team_objections?.common_patterns?.length > 0 && (
        <CardShell>
          <SectionHeader label="Team objection patterns" />
          {team_objections.common_patterns.map((o: any) => (
            <div key={o.type} className="flex items-center gap-3 px-4 py-3 border-b border-surface-border last:border-0">
              <div className="flex-1">
                <p className="text-sm text-text-primary capitalize">{o.type.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-danger rounded-full"
                    style={{ width: `${Math.min(100, (o.count / (team_objections.top?.[0]?.occurrence_count || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted w-6 text-right font-mono">{o.count}×</span>
              </div>
            </div>
          ))}
        </CardShell>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" rounded="lg" />)}
      </div>
      <Skeleton className="h-48" rounded="lg" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Leaderboard
// ═══════════════════════════════════════════════════════════════
function LeaderboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceLeaderboard,
    queryFn:  () => metricsApi.getWorkspaceLeaderboard().then(r => r.data),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-64" rounded="lg" />;
  if (!data?.leaderboard?.length) return <InlineAlert type="info" message="No leaderboard data yet." />;

  const { leaderboard } = data;
  const topScore = leaderboard[0]?.score ?? 1;

  return (
    <CardShell>
      <SectionHeader label={`${leaderboard.length} members ranked`} />
      <div className="divide-y divide-surface-border">
        {leaderboard.map((m: any, i: number) => {
          const ratePct = Math.round((m.positive_rate ?? 0) * 100);
          const rankColor = i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-text-muted';
          return (
            <div key={m.user_id} className="px-4 py-3 flex items-center gap-4 hover:bg-surface-base/50 transition-colors">
              {/* Rank */}
              <span className={cn('text-base font-bold w-6 text-center shrink-0 tabular-nums', rankColor)}>
                {i + 1}
              </span>

              {/* Avatar + name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Avatar name={m.name} size="xs" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{m.name}</p>
                  {m.role && <p className="text-xs text-text-muted capitalize">{m.role}</p>}
                </div>
              </div>

              {/* Score bar */}
              <div className="flex-1 max-w-[120px] hidden sm:block space-y-1">
                <MiniBar pct={(m.score / topScore) * 100} color="bg-primary" />
                <p className="text-xs text-text-muted text-right">{m.score} pts</p>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-x-6 text-right shrink-0 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-text-muted">Sent 30d</p>
                  <p className="text-sm font-semibold text-text-primary tabular-nums">{m.sent_30d}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Reply %</p>
                  <p className={cn('text-sm font-semibold tabular-nums', ratePct >= 20 ? 'text-success' : ratePct >= 10 ? 'text-warning' : 'text-danger')}>
                    {ratePct}%
                  </p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-text-muted">Closed</p>
                  <p className="text-sm font-semibold text-text-primary tabular-nums">{m.closed_won}</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-text-muted">Skill</p>
                  <ScorePill value={m.skill_score} />
                </div>
              </div>

              {/* Score badge (mobile) */}
              <span className="text-sm font-bold text-text-primary sm:hidden tabular-nums">{m.score}</span>
            </div>
          );
        })}
      </div>

      {/* Score breakdown legend */}
      <div className="px-4 py-3 border-t border-surface-border bg-surface-base">
        <p className="text-xs text-text-muted">
          Score = outreach volume (15) + reply rate (30) + deals closed (20) + skill level (20) + goal progress (15)
        </p>
      </div>
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Coaching queue
// ═══════════════════════════════════════════════════════════════
function CoachingQueueTab() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceCoachingQueue,
    queryFn:  () => metricsApi.getWorkspaceCoachingQueue().then(r => r.data),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" rounded="lg" />)}
    </div>
  );

  if (!data?.queue?.length) return <InlineAlert type="success" message="No coaching flags raised — team is on track." />;

  const { queue } = data;
  const urgentCount  = queue.filter((m: any) => m.needs_coaching).length;

  return (
    <div className="space-y-3">
      {urgentCount > 0 && (
        <InlineAlert
          type="warning"
          message={`${urgentCount} member${urgentCount > 1 ? 's' : ''} flagged for coaching — ${urgentCount > 1 ? 'they have' : 'they have'} 2+ risk signals.`}
        />
      )}

      {queue.map((m: any) => (
        <CardShell key={m.user_id}>
          <div className="p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Avatar name={m.name} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">{m.name}</p>
                  {m.top_weakness && (
                    <p className="text-xs text-text-muted">
                      Weakest: <span className="capitalize text-warning">{m.top_weakness.replace(/_/g, ' ')}</span>
                    </p>
                  )}
                </div>
              </div>
              {m.needs_coaching && (
                <Badge variant="danger" size="sm">Needs coaching</Badge>
              )}
            </div>

            {/* Flags */}
            <div className="flex flex-wrap gap-1.5">
              {m.flags.map((f: string) => {
                const meta = FLAG_META[f] ?? { label: f.replace(/_/g, ' '), color: 'bg-slate-100 text-slate-600' };
                return (
                  <span key={f} className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', meta.color)}>
                    {meta.label}
                  </span>
                );
              })}
            </div>

            {/* Skill + health */}
            <div className="flex items-center gap-6">
              {m.skill_score != null && (
                <div>
                  <p className="text-xs text-text-muted">Skill score</p>
                  <ScorePill value={m.skill_score} />
                  {m.score_delta != null && (
                    <p className={cn('text-xs', m.score_delta < 0 ? 'text-danger' : 'text-success')}>
                      {m.score_delta > 0 ? '+' : ''}{m.score_delta?.toFixed(1)} wk
                    </p>
                  )}
                </div>
              )}
              {m.avg_relationship_health != null && (
                <div>
                  <p className="text-xs text-text-muted">Pipeline health</p>
                  <span className={cn('text-sm font-bold tabular-nums', m.avg_relationship_health < 40 ? 'text-danger' : m.avg_relationship_health < 70 ? 'text-warning' : 'text-success')}>
                    {m.avg_relationship_health}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardShell>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Velocity
// ═══════════════════════════════════════════════════════════════
function VelocityTab() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceTeamVelocity,
    queryFn:  () => metricsApi.getWorkspaceTeamVelocity().then(r => r.data),
    staleTime: 10 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-56" rounded="lg" />;
  if (!data?.has_data) return <InlineAlert type="info" message="Not enough weekly data yet — check back once more members have sessions across two weeks." />;

  const { current_week, previous_week, team_composite_current, team_composite_previous, team_composite_delta, active_members_current, active_members_previous, trend } = data;

  const trendColor = trend === 'improving' ? 'text-success' : trend === 'declining' ? 'text-danger' : 'text-text-muted';
  const trendIcon  = trend === 'improving' ? '↑' : trend === 'declining' ? '↓' : '→';

  const formatWeek = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* Hero delta */}
      <CardShell>
        <div className="p-6 text-center space-y-2">
          <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">Week-over-week team skill change</p>
          <div className="flex items-center justify-center gap-2">
            <span className={cn('text-4xl font-bold tabular-nums', trendColor)}>
              {trendIcon}{team_composite_delta != null ? Math.abs(team_composite_delta).toFixed(2) : '—'}
            </span>
          </div>
          <p className="text-sm text-text-secondary capitalize">
            Team is <strong className={trendColor}>{trend}</strong>
          </p>
        </div>
      </CardShell>

      {/* Week comparison */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardShell>
          <div className="p-4 space-y-1">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">
              Current week <span className="font-normal normal-case ml-1 text-text-muted">{formatWeek(current_week)}</span>
            </p>
            <p className="text-2xl font-bold text-text-primary tabular-nums">
              {team_composite_current?.toFixed(2) ?? '—'}
            </p>
            <p className="text-xs text-text-secondary">{active_members_current} active member{active_members_current !== 1 ? 's' : ''}</p>
          </div>
        </CardShell>
        <CardShell>
          <div className="p-4 space-y-1">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">
              Previous week <span className="font-normal normal-case ml-1 text-text-muted">{formatWeek(previous_week)}</span>
            </p>
            <p className="text-2xl font-bold text-text-secondary tabular-nums">
              {team_composite_previous?.toFixed(2) ?? '—'}
            </p>
            <p className="text-xs text-text-secondary">{active_members_previous} active member{active_members_previous !== 1 ? 's' : ''}</p>
          </div>
        </CardShell>
      </div>

      {/* Visual bar comparison */}
      <CardShell>
        <div className="p-4 space-y-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Score comparison</p>
          {[
            { label: `Current (${formatWeek(current_week)})`, val: team_composite_current, color: 'bg-primary' },
            { label: `Previous (${formatWeek(previous_week)})`, val: team_composite_previous, color: 'bg-slate-300' },
          ].map(row => {
            const pct = row.val != null ? Math.min(100, (row.val / 10) * 100) : 0;
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{row.label}</p>
                  <p className="text-xs font-mono text-text-primary">{row.val?.toFixed(2) ?? '—'}</p>
                </div>
                <div className="h-2 bg-surface-base rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', row.color)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Activity feed
// ═══════════════════════════════════════════════════════════════
function ActivityFeedTab() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaceActivityFeed,
    queryFn:  () => metricsApi.getWorkspaceActivityFeed().then(r => r.data),
    staleTime: 2 * 60_000,
  });

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" rounded="lg" />)}
    </div>
  );

  if (!data?.feed?.length) return <InlineAlert type="info" message="No recent team activity to show." />;

  const { feed } = data;

  return (
    <CardShell>
      <SectionHeader label="Last 30 events" />
      <div className="divide-y divide-surface-border">
        {feed.map((event: any, i: number) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-base/50 transition-colors">
            <Avatar name={event.user_name} size="xs" className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">
                <span className="font-medium">{event.user_name}</span>{' '}
                <span className="text-text-secondary">{eventLabel(event.event_type)}</span>
              </p>
              {event.metadata && Object.keys(event.metadata).length > 0 && (
                <p className="text-xs text-text-muted truncate mt-0.5">
                  {Object.entries(event.metadata)
                    .slice(0, 2)
                    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                    .join(' · ')}
                </p>
              )}
            </div>
            <span className="text-xs text-text-muted shrink-0 tabular-nums">{timeAgo(event.created_at)}</span>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// KPI Card helper (used by Overview)
// ═══════════════════════════════════════════════════════════════
function KpiCard({ label, value, sub, highlight = false }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <CardShell>
      <div className="p-4 space-y-1">
        <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">{label}</p>
        <p className={cn('text-2xl font-bold tabular-nums', highlight ? 'text-danger' : 'text-text-primary')}>{value}</p>
        <p className="text-xs text-text-secondary">{sub}</p>
      </div>
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════
// Root page
// ═══════════════════════════════════════════════════════════════
export default function TeamMetricsPage() {
  const [tab, setTab] = useState('overview');

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Team metrics</h1>
        <Badge variant="outline" size="sm">Manager view</Badge>
      </div>

      <Tabs tabs={TEAM_METRICS_TABS} value={tab} onChange={setTab} variant="underline" />

      {tab === 'overview'  && <OverviewTab />}
      {tab === 'board'     && <LeaderboardTab />}
      {tab === 'coaching'  && <CoachingQueueTab />}
      {tab === 'velocity'  && <VelocityTab />}
      {tab === 'activity'  && <ActivityFeedTab />}
    </div>
  );
}
