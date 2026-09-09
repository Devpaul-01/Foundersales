// FILE: src/pages/team/TeamMetricsPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots. No network calls.
import React, { useState } from 'react';
import { Avatar }          from '@/components/ui/Avatar';
import { Badge }           from '@/components/ui/Badge';
import { Tabs }             from '@/components/ui/Tabs';
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

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white border border-surface-border rounded-lg overflow-hidden', className)}>
      {children}
    </div>
  );
}

// ─── Flag labels for coaching queue ───────────────────────────
const FLAG_META: Record<string, { label: string; color: string }> = {
  no_outreach_7d:          { label: 'No outreach',    color: 'bg-amber-100 text-amber-700' },
  no_practice_7d:          { label: 'No practice',    color: 'bg-blue-100  text-blue-700'  },
  score_declining:         { label: 'Score ↓',        color: 'bg-red-100   text-red-700'   },
  low_skill_score:         { label: 'Low skill',      color: 'bg-red-100   text-red-700'   },
  low_relationship_health: { label: 'Cold pipeline',  color: 'bg-purple-100 text-purple-700'},
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

function daysAgoIso(days: number, hours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════
// Hardcoded demo data
// ═══════════════════════════════════════════════════════════════
const OVERVIEW_DATA = {
  members: [
    { user_id: 'u1', name: 'Priya Natarajan', last_active: '2h ago',  avg_skill_score: 8.4, outreach_sent_this_week: 61, sessions_this_week: 5, goal_completion_pct: 92, weakest_axis: 'negotiation' },
    { user_id: 'u2', name: 'Marcus Webb',     last_active: '1h ago',  avg_skill_score: 7.9, outreach_sent_this_week: 54, sessions_this_week: 4, goal_completion_pct: 88, weakest_axis: 'objection_handling' },
    { user_id: 'u3', name: 'Elena Torres',    last_active: '4h ago',  avg_skill_score: 7.5, outreach_sent_this_week: 47, sessions_this_week: 3, goal_completion_pct: 74, weakest_axis: 'discovery' },
    { user_id: 'u4', name: 'Jordan Kim',      last_active: '30m ago', avg_skill_score: 6.8, outreach_sent_this_week: 39, sessions_this_week: 2, goal_completion_pct: 65, weakest_axis: 'closing' },
    { user_id: 'u5', name: 'Sofia Alvarez',   last_active: '1d ago',  avg_skill_score: 6.2, outreach_sent_this_week: 22, sessions_this_week: 1, goal_completion_pct: 48, weakest_axis: 'discovery' },
    { user_id: 'u6', name: 'Devon Marsh',     last_active: '3d ago',  avg_skill_score: 5.4, outreach_sent_this_week: 8,  sessions_this_week: 0, goal_completion_pct: 31, weakest_axis: 'objection_handling' },
    { user_id: 'u7', name: 'Aisha Bello',     last_active: '6h ago',  avg_skill_score: 8.1, outreach_sent_this_week: 58, sessions_this_week: 6, goal_completion_pct: 95, weakest_axis: 'negotiation' },
    { user_id: 'u8', name: 'Ryan O\u2019Connell', last_active: '2d ago', avg_skill_score: 6.0, outreach_sent_this_week: 19, sessions_this_week: 1, goal_completion_pct: 52, weakest_axis: 'closing' },
  ],
  team_avg_score: 7.04,
  team_weakest_axis: 'objection_handling',
  members_not_practiced_this_week: [{ user_id: 'u6', name: 'Devon Marsh' }],
  team_objections: {
    common_patterns: [
      { type: 'price_too_high',        count: 34 },
      { type: 'no_budget',             count: 27 },
      { type: 'need_to_check_with_team', count: 21 },
      { type: 'happy_with_current_vendor', count: 16 },
      { type: 'bad_timing',            count: 11 },
    ],
    top: [{ occurrence_count: 34 }],
  },
  team_signals: {
    top_signals: [
      { type: 'pricing_page_visit',  count: 41 },
      { type: 'demo_requested',      count: 23 },
      { type: 'case_study_download', count: 17 },
    ],
  },
};

const LEADERBOARD_DATA = {
  leaderboard: [
    { user_id: 'u7', name: 'Aisha Bello',        role: 'senior rep', score: 94, sent_30d: 231, positive_rate: 0.27, closed_won: 9, skill_score: 8.1 },
    { user_id: 'u1', name: 'Priya Natarajan',    role: 'senior rep', score: 91, sent_30d: 248, positive_rate: 0.24, closed_won: 8, skill_score: 8.4 },
    { user_id: 'u2', name: 'Marcus Webb',        role: 'rep',        score: 83, sent_30d: 219, positive_rate: 0.22, closed_won: 6, skill_score: 7.9 },
    { user_id: 'u3', name: 'Elena Torres',       role: 'rep',        score: 76, sent_30d: 190, positive_rate: 0.19, closed_won: 5, skill_score: 7.5 },
    { user_id: 'u4', name: 'Jordan Kim',         role: 'rep',        score: 64, sent_30d: 156, positive_rate: 0.16, closed_won: 3, skill_score: 6.8 },
    { user_id: 'u5', name: 'Sofia Alvarez',      role: 'associate',  score: 51, sent_30d: 98,  positive_rate: 0.13, closed_won: 2, skill_score: 6.2 },
    { user_id: 'u8', name: 'Ryan O\u2019Connell', role: 'associate', score: 47, sent_30d: 84,  positive_rate: 0.11, closed_won: 1, skill_score: 6.0 },
    { user_id: 'u6', name: 'Devon Marsh',        role: 'associate',  score: 29, sent_30d: 41,  positive_rate: 0.07, closed_won: 0, skill_score: 5.4 },
  ],
};

const COACHING_QUEUE_DATA = {
  queue: [
    {
      user_id: 'u6', name: 'Devon Marsh', needs_coaching: true, top_weakness: 'objection_handling',
      flags: ['no_outreach_7d', 'no_practice_7d', 'score_declining'],
      skill_score: 5.4, score_delta: -0.6, avg_relationship_health: 34,
    },
    {
      user_id: 'u8', name: 'Ryan O\u2019Connell', needs_coaching: true, top_weakness: 'closing',
      flags: ['low_skill_score', 'low_relationship_health'],
      skill_score: 6.0, score_delta: -0.2, avg_relationship_health: 41,
    },
    {
      user_id: 'u5', name: 'Sofia Alvarez', needs_coaching: false, top_weakness: 'discovery',
      flags: ['no_practice_7d'],
      skill_score: 6.2, score_delta: 0.1, avg_relationship_health: 58,
    },
    {
      user_id: 'u4', name: 'Jordan Kim', needs_coaching: false, top_weakness: 'closing',
      flags: ['score_declining'],
      skill_score: 6.8, score_delta: -0.3, avg_relationship_health: 63,
    },
  ],
};

const VELOCITY_DATA = {
  has_data: true,
  current_week: daysAgoIso(3),
  previous_week: daysAgoIso(10),
  team_composite_current: 7.34,
  team_composite_previous: 6.98,
  team_composite_delta: 0.36,
  active_members_current: 8,
  active_members_previous: 7,
  trend: 'improving',
};

const ACTIVITY_FEED_DATA = {
  feed: [
    { user_name: 'Aisha Bello',     event_type: 'deal_closed_won',    created_at: daysAgoIso(0, 0.5), metadata: { deal_value: '$18,400', account: 'Northwind Logistics' } },
    { user_name: 'Priya Natarajan', event_type: 'practice_completed', created_at: daysAgoIso(0, 1),   metadata: { scenario: 'Cold call — enterprise', score: '8.7' } },
    { user_name: 'Marcus Webb',     event_type: 'message_sent',       created_at: daysAgoIso(0, 1.5), metadata: { channel: 'email', sequence: 'Q3 outbound' } },
    { user_name: 'Jordan Kim',      event_type: 'goal_achieved',      created_at: daysAgoIso(0, 2),   metadata: { goal: 'Weekly outreach target' } },
    { user_name: 'Elena Torres',    event_type: 'check_in_submitted', created_at: daysAgoIso(0, 3),   metadata: { mood: 'confident' } },
    { user_name: 'Sofia Alvarez',   event_type: 'prospect_added',     created_at: daysAgoIso(0, 4),   metadata: { company: 'Braxton Retail Group' } },
    { user_name: 'Devon Marsh',     event_type: 'deal_closed_lost',   created_at: daysAgoIso(0, 5),   metadata: { reason: 'price_too_high' } },
    { user_name: 'Aisha Bello',     event_type: 'skill_score_updated', created_at: daysAgoIso(0, 6),  metadata: { axis: 'negotiation', delta: '+0.4' } },
    { user_name: 'Ryan O\u2019Connell', event_type: 'message_sent',   created_at: daysAgoIso(1, 1),   metadata: { channel: 'linkedin', sequence: 'Warm re-engage' } },
    { user_name: 'Priya Natarajan', event_type: 'deal_closed_won',    created_at: daysAgoIso(1, 3),   metadata: { deal_value: '$9,200', account: 'Fernbrook Studio' } },
    { user_name: 'Marcus Webb',     event_type: 'practice_completed', created_at: daysAgoIso(1, 5),   metadata: { scenario: 'Objection: budget', score: '7.9' } },
    { user_name: 'Jordan Kim',      event_type: 'prospect_added',     created_at: daysAgoIso(1, 7),   metadata: { company: 'Halden Manufacturing' } },
    { user_name: 'Elena Torres',    event_type: 'message_sent',       created_at: daysAgoIso(2, 0.5), metadata: { channel: 'email', sequence: 'Renewal outreach' } },
    { user_name: 'Sofia Alvarez',   event_type: 'check_in_submitted', created_at: daysAgoIso(2, 2),   metadata: { mood: 'stretched thin' } },
    { user_name: 'Aisha Bello',     event_type: 'goal_achieved',      created_at: daysAgoIso(2, 4),   metadata: { goal: 'Monthly demo target' } },
    { user_name: 'Devon Marsh',     event_type: 'message_sent',       created_at: daysAgoIso(2, 6),   metadata: { channel: 'email', sequence: 'Cold outbound' } },
    { user_name: 'Ryan O\u2019Connell', event_type: 'practice_completed', created_at: daysAgoIso(3, 1), metadata: { scenario: 'Discovery call', score: '6.4' } },
    { user_name: 'Priya Natarajan', event_type: 'skill_score_updated', created_at: daysAgoIso(3, 3),  metadata: { axis: 'closing', delta: '+0.2' } },
    { user_name: 'Marcus Webb',     event_type: 'prospect_added',     created_at: daysAgoIso(3, 5),   metadata: { company: 'Ostrow Financial' } },
    { user_name: 'Jordan Kim',      event_type: 'deal_closed_lost',   created_at: daysAgoIso(4, 1),   metadata: { reason: 'bad_timing' } },
  ],
};

// ═══════════════════════════════════════════════════════════════
// Tab: Overview
// ═══════════════════════════════════════════════════════════════
function OverviewTab() {
  const { members, team_avg_score, team_weakest_axis, members_not_practiced_this_week, team_objections, team_signals } = OVERVIEW_DATA;

  const totalOutreach = members.reduce((s, m) => s + (m.outreach_sent_this_week ?? 0), 0);
  const totalSessions = members.reduce((s, m) => s + (m.sessions_this_week ?? 0), 0);
  const needsCoaching = members_not_practiced_this_week?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Team skill score" value={team_avg_score.toFixed(1)} sub="avg composite" />
        <KpiCard label="Outreach this week" value={String(totalOutreach)} sub="messages sent" />
        <KpiCard label="Practice sessions" value={String(totalSessions)} sub="7-day total" />
        <KpiCard label="No practice 7d" value={String(needsCoaching)} sub="members" highlight={needsCoaching > 0} />
      </div>

      {/* Weak axis + signal strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardShell>
          <div className="p-4 space-y-1">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">Team weak spot</p>
            <p className="text-sm font-semibold text-text-primary capitalize">{team_weakest_axis.replace(/_/g, ' ')}</p>
            <p className="text-xs text-text-secondary">Most common weakest axis across reps — target this in coaching.</p>
          </div>
        </CardShell>
        <CardShell>
          <div className="p-4 space-y-2">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wide">Buying signals (7d)</p>
            {team_signals.top_signals.slice(0, 3).map((s) => (
              <div key={s.type} className="flex items-center justify-between">
                <span className="text-xs text-text-secondary capitalize">{s.type.replace(/_/g, ' ')}</span>
                <span className="text-xs font-semibold text-success">{s.count}×</span>
              </div>
            ))}
          </div>
        </CardShell>
      </div>

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
              {members.map((m) => (
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
      <CardShell>
        <SectionHeader label="Team objection patterns" />
        {team_objections.common_patterns.map((o) => (
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab: Leaderboard
// ═══════════════════════════════════════════════════════════════
function LeaderboardTab() {
  const { leaderboard } = LEADERBOARD_DATA;
  const topScore = leaderboard[0]?.score ?? 1;

  return (
    <CardShell>
      <SectionHeader label={`${leaderboard.length} members ranked`} />
      <div className="divide-y divide-surface-border">
        {leaderboard.map((m, i) => {
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
  const { queue } = COACHING_QUEUE_DATA;
  const urgentCount = queue.filter((m) => m.needs_coaching).length;

  return (
    <div className="space-y-3">
      {urgentCount > 0 && (
        <InlineAlert
          type="warning"
          message={`${urgentCount} member${urgentCount > 1 ? 's' : ''} flagged for coaching — ${urgentCount > 1 ? 'they have' : 'they have'} 2+ risk signals.`}
        />
      )}

      {queue.map((m) => (
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
              {m.flags.map((f) => {
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
                      {m.score_delta > 0 ? '+' : ''}{m.score_delta.toFixed(1)} wk
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
  const { current_week, previous_week, team_composite_current, team_composite_previous, team_composite_delta, active_members_current, active_members_previous, trend } = VELOCITY_DATA;

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
              {trendIcon}{Math.abs(team_composite_delta).toFixed(2)}
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
              {team_composite_current.toFixed(2)}
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
              {team_composite_previous.toFixed(2)}
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
            const pct = Math.min(100, (row.val / 10) * 100);
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{row.label}</p>
                  <p className="text-xs font-mono text-text-primary">{row.val.toFixed(2)}</p>
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
  const { feed } = ACTIVITY_FEED_DATA;

  return (
    <CardShell>
      <SectionHeader label="Last 30 events" />
      <div className="divide-y divide-surface-border">
        {feed.map((event, i) => (
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
