import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, AlertTriangle, Zap, BarChart2, ShieldAlert, Target, Trophy,
  CalendarClock, CalendarCheck2, Gauge,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────
   This is a static demo build of the Metrics page.
   All data below is hardcoded sample data for screenshots — there
   are no API calls, network requests, or loading states. Swap the
   constants back for live queries when wiring this up for real.
──────────────────────────────────────────────────────────────── */

// ── tiny local utils (stand-ins for @/lib/utils) ────────────────
function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
function formatCurrency(value: number | undefined, compact = false) {
  if (value == null) return '—';
  if (compact) {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  }
  return `$${value.toLocaleString()}`;
}
function formatRate(value: number | undefined) {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}
function formatShortDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── tiny local UI primitives (stand-ins for @/components/ui/*) ──
function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'brand' | 'success' | 'warning' | 'danger' }) {
  const toneMap: Record<string, string> = {
    default: 'bg-slate-100 text-slate-600',
    brand:   'bg-brand/10 text-brand',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger:  'bg-danger/10 text-danger',
  };
  return <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', toneMap[tone])}>{children}</span>;
}

function Tabs({
  tabs, value, onChange,
}: {
  tabs: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-surface-border overflow-x-auto no-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
            value === t.value
              ? 'border-brand text-brand'
              : 'border-transparent text-text-muted hover:text-text-secondary',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function InlineAlert({ type = 'info', message }: { type?: 'info' | 'warning'; message: string }) {
  const map = {
    info:    { bg: 'bg-brand/5',   border: 'border-brand/20',   text: 'text-brand'   },
    warning: { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning' },
  };
  const s = map[type];
  return (
    <div className={cn('border rounded-lg px-3.5 py-3 text-sm', s.bg, s.border, s.text)}>
      {message}
    </div>
  );
}

function ScoreGauge({ score, size = 'lg', label }: { score: number; size?: 'lg' | 'md'; label?: string }) {
  const dim = size === 'lg' ? 96 : 72;
  const stroke = size === 'lg' ? 8 : 6;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - pct / 100);
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} className="-rotate-90">
          <circle cx={dim / 2} cy={dim / 2} r={radius} stroke="#f1f5f9" strokeWidth={stroke} fill="none" />
          <circle
            cx={dim / 2} cy={dim / 2} r={radius}
            stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-text-primary leading-none">{Math.round(score)}</span>
        </div>
      </div>
      {label && <span className="text-xs text-text-muted font-medium">{label}</span>}
    </div>
  );
}

// ── static demo constants ────────────────────────────────────────
const SKILL_DIMENSION_LABELS: Record<string, string> = {
  hook: 'Hook', clarity: 'Clarity', value_prop: 'Value prop',
  personalization: 'Personalization', cta: 'CTA', tone: 'Tone',
};

const METRIC_TABS = [
  { value: 'overview',  label: 'Overview'  },
  { value: 'pipeline',  label: 'Pipeline'  },
  { value: 'skills',    label: 'Skills'    },
  { value: 'practice',  label: 'Practice'  },
  { value: 'analyses',  label: 'Analyses'  },
  { value: 'calendar',  label: 'Calendar'  },
  { value: 'ai',        label: 'AI Insights'},
];

// dashboard / overview
const DASHBOARD = {
  momentum_score: 74,
  momentum_insight: "You're pacing ahead of last month — reply rate is up and your follow-up cadence on warm leads has tightened noticeably.",
  momentum_breakdown: {
    consistency: 82,
    responsiveness: 68,
    'pipeline health': 76,
    'follow-up speed': 71,
  },
  sent_30d: 214,
  response_rate: 0.34,
  response_rate_delta: 6,
};

const PIPELINE = {
  contacted_count: 214,
  replied_count: 73,
  call_demo_count: 28,
  closed_won_count: 11,
  total_revenue: 138500,
  win_rate_pct: 39,
  pipeline_value: 96000,
};

const CHART_DATA = [
  { date: '2026-08-10', sent: 6,  responses: 1 },
  { date: '2026-08-11', sent: 9,  responses: 3 },
  { date: '2026-08-12', sent: 4,  responses: 2 },
  { date: '2026-08-13', sent: 11, responses: 4 },
  { date: '2026-08-14', sent: 8,  responses: 2 },
  { date: '2026-08-15', sent: 3,  responses: 1 },
  { date: '2026-08-16', sent: 5,  responses: 2 },
  { date: '2026-08-17', sent: 12, responses: 5 },
  { date: '2026-08-18', sent: 10, responses: 3 },
  { date: '2026-08-19', sent: 7,  responses: 3 },
  { date: '2026-08-20', sent: 14, responses: 6 },
  { date: '2026-08-21', sent: 9,  responses: 4 },
  { date: '2026-08-22', sent: 6,  responses: 2 },
  { date: '2026-08-23', sent: 8,  responses: 3 },
  { date: '2026-08-24', sent: 13, responses: 5 },
  { date: '2026-08-25', sent: 11, responses: 4 },
  { date: '2026-08-26', sent: 9,  responses: 3 },
  { date: '2026-08-27', sent: 15, responses: 7 },
  { date: '2026-08-28', sent: 10, responses: 4 },
  { date: '2026-08-29', sent: 12, responses: 5 },
  { date: '2026-08-30', sent: 14, responses: 6 },
  { date: '2026-09-01', sent: 16, responses: 6 },
  { date: '2026-09-02', sent: 13, responses: 5 },
  { date: '2026-09-03', sent: 9,  responses: 4 },
  { date: '2026-09-04', sent: 11, responses: 5 },
  { date: '2026-09-05', sent: 8,  responses: 3 },
  { date: '2026-09-06', sent: 7,  responses: 2 },
  { date: '2026-09-07', sent: 10, responses: 4 },
];

const ALERTS = [
  {
    icon: '🔥',
    priority: 'high',
    title: '3 hot leads have gone quiet',
    body: 'Avery Chen, Marcus Boyle, and Dana Whitfield haven\'t replied in 6+ days despite strong earlier engagement.',
    action: 'Send a follow-up',
  },
  {
    icon: '⚡',
    priority: 'medium',
    title: 'Objection pattern detected: pricing',
    body: 'Pricing objections are up 40% this week across your outbound sequences.',
    action: 'Review saved responses',
  },
  {
    icon: '📅',
    priority: 'low',
    title: 'Demo with Northwind Retail tomorrow',
    body: 'No prep notes generated yet for this call.',
    action: 'Generate prep',
  },
];

// pipeline / prospects health
const PROSPECTS_HEALTH = {
  has_data: true,
  total_prospects: 58,
  avg_health_score: 64,
  stale_count: 7,
  stage_distribution: {
    contacted: 22,
    replied: 15,
    call_scheduled: 9,
    proposal_sent: 7,
    closed_won: 5,
  },
  at_risk: [
    { id: 1, name: 'Priya Nathan', company: 'Lumen Freight', relationship_health_score: 22 },
    { id: 2, name: 'Owen Faraday', company: 'Brightline Labs', relationship_health_score: 31 },
    { id: 3, name: 'Isabel Marchetti', company: 'Overtone Media', relationship_health_score: 28 },
  ],
  top_relationships: [
    { id: 4, name: 'Dana Whitfield', company: 'Northwind Retail', relationship_health_score: 91 },
    { id: 5, name: 'Marcus Boyle', company: 'Ferrovia Systems', relationship_health_score: 87 },
    { id: 6, name: 'Avery Chen', company: 'Solstice Robotics', relationship_health_score: 84 },
  ],
};

// skills tab
const SKILL_DATA = {
  has_data: true,
  composite: 7.4,
  scores: {
    hook: 7.8,
    clarity: 8.2,
    value_prop: 6.9,
    personalization: 7.1,
    cta: 6.4,
    tone: 8.0,
  },
  strongest: 'clarity',
  weakest: 'cta',
};

const SKILL_PROFILE = {
  has_data: true,
  axes: {
    clarity: 8,
    value: 7,
    discovery: 6,
    objection: 5,
    brevity: 8,
    cta: 6,
  },
  overall_delta: 4,
  strongest_axis: 'brevity',
  weakest_axis: 'objection',
};

// practice tab
const PRACTICE_SUMMARY = {
  has_data: true,
  total_sessions: 42,
  goal_achieved_rate: 0.64,
  avg_session_score: 78,
  reply_received_rate: 0.38,
  by_scenario: {
    cold_outreach: { count: 18, avg_score: 74 },
    objection_handling: { count: 12, avg_score: 69 },
    discovery_call: { count: 8, avg_score: 82 },
    demo_pitch: { count: 4, avg_score: 88 },
  },
};

const ACHIEVEMENTS = {
  badges: [
    { badge_label: '7-day streak', badge_description: 'Practiced for 7 days in a row' },
    { badge_label: 'Objection crusher', badge_description: 'Handled 20 objections in drills' },
    { badge_label: 'First close', badge_description: 'Closed your first deal via Foundersales' },
    { badge_label: 'Discovery pro', badge_description: 'Scored 85+ on 5 discovery calls' },
  ],
  drill_improvements: [
    { axis: 'objection_handling', drills_completed: 14, avg_improvement: 12 },
    { axis: 'cta', drills_completed: 9, avg_improvement: 8 },
    { axis: 'discovery', drills_completed: 11, avg_improvement: -2 },
    { axis: 'brevity', drills_completed: 7, avg_improvement: 5 },
  ],
};

const RECOMMENDATIONS = {
  recommendations: [
    { priority: 'high',   title: 'Drill: handling price objections', description: 'Your objection-handling score dipped 2 points this week — three quick drills should close the gap.' },
    { priority: 'medium', title: 'Tighten your CTAs',                 description: 'CTAs are your lowest-scoring axis. Try ending with a single, specific next step.' },
    { priority: 'medium', title: 'Practice a discovery call',         description: 'It has been 9 days since your last discovery-call drill.' },
  ],
};

// analyses tab
const ANALYSES_DATA = {
  has_data: true,
  avg_scores: {
    composite: 7.2,
    hook: 7.6,
    clarity: 8.1,
    value_prop: 6.8,
    personalization: 6.5,
    cta: 6.2,
    tone: 7.9,
  },
  total: 36,
  trend_delta: 5,
  improvements: [
    { dimension: 'cta', date: 'Sep 4', outcome: 'positive', suggestion: 'End with one specific ask instead of two open-ended options.', example: 'Worth 15 min Thursday to walk through it?' },
    { dimension: 'personalization', date: 'Sep 2', outcome: 'negative', suggestion: 'Reference something specific from their recent activity, not just their industry.', example: '' },
    { dimension: 'value_prop', date: 'Aug 29', outcome: 'positive', suggestion: 'Lead with the outcome, not the feature list.', example: 'Cut onboarding time from 3 weeks to 4 days.' },
  ],
  top_failures: [
    { label: 'generic_opener', count: 9 },
    { label: 'no_clear_cta', count: 6 },
    { label: 'too_long', count: 5 },
  ],
  top_successes: [
    { label: 'specific_metric', count: 14 },
    { label: 'social_proof', count: 11 },
    { label: 'concise', count: 9 },
  ],
  recent: [
    {
      id: 1, outcome: 'positive', platform: 'linkedin', word_count: 78, composite_score: 8.4,
      analysis_text: 'Strong hook referencing their recent funding round, clear value prop, and a low-friction CTA.',
      success_signals: ['specific_metric', 'social_proof'],
    },
    {
      id: 2, outcome: 'negative', platform: 'email', word_count: 210, composite_score: 4.1,
      analysis_text: 'Opens generically and takes too long to reach the point — the ask is buried in the fourth paragraph.',
      failure_categories: ['generic_opener', 'too_long'],
      has_social_proof: false,
    },
    {
      id: 3, outcome: 'positive', platform: 'linkedin', word_count: 64, composite_score: 7.9,
      analysis_text: 'Tight message with a concrete metric and a single clear next step.',
      success_signals: ['specific_metric', 'concise'],
    },
    {
      id: 4, outcome: 'negative', platform: 'email', word_count: 145, composite_score: 5.2,
      analysis_text: 'Value prop is there but the CTA asks for a full call rather than a smaller first step.',
      failure_categories: ['no_clear_cta'],
    },
  ],
};

const OBJECTIONS_DATA = {
  has_data: true,
  total_unique_types: 6,
  objections: [
    { type: 'pricing', occurrence_count: 14, sample_phrase: "This is more than we budgeted for this quarter.", best_response: true, has_market_intel: true, response_score: 8, practice_score: 7 },
    { type: 'timing', occurrence_count: 11, sample_phrase: "Can we revisit this next quarter instead?", best_response: true, has_market_intel: false, response_score: 6, practice_score: 6 },
    { type: 'no_authority', occurrence_count: 9, sample_phrase: "I'd need to loop in our VP before moving forward.", best_response: false, has_market_intel: false },
    { type: 'competitor', occurrence_count: 7, sample_phrase: "We're already piloting a similar tool.", best_response: true, has_market_intel: true, response_score: 7, practice_score: 8 },
    { type: 'trust', occurrence_count: 5, sample_phrase: "How do we know this actually works for a team our size?", best_response: false, has_market_intel: false },
    { type: 'feature_gap', occurrence_count: 3, sample_phrase: "Does it integrate with our existing CRM?", best_response: true, has_market_intel: false, response_score: 9, practice_score: 8 },
  ],
};

// calendar tab
const CALENDAR_PREP = {
  has_data: true,
  needs_prep: [
    { id: 1, title: 'Demo call', attendee_name: 'Northwind Retail', event_date: '2026-09-09' },
    { id: 2, title: 'Intro call', attendee_name: 'Ferrovia Systems', event_date: '2026-09-10' },
  ],
  needs_debrief: [
    { id: 3, title: 'Discovery call', attendee_name: 'Solstice Robotics', event_date: '2026-09-06' },
  ],
};

const MEETINGS_SUMMARY = {
  has_data: true,
  period: '30d',
  total_meetings: 19,
  debrief_completion_rate: 0.79,
  avg_energy_score: 7.3,
  meetings_with_prep_generated: 15,
  outcomes: { positive: 11, negative: 3, pending: 5 },
};

// AI insights tab
const INTELLIGENCE_DATA = {
  fallback: false,
  insights: [
    {
      type: 'pattern',
      title: 'Tuesday and Wednesday sends outperform',
      body: 'Messages sent Tuesday–Wednesday morning get a 41% higher reply rate than the rest of the week.',
      action: 'Shift your send schedule',
    },
    {
      type: 'opportunity',
      title: 'Warm re-engagement window',
      body: '6 prospects who went cold 3+ weeks ago recently interacted with your LinkedIn posts — good time to re-open.',
      action: 'View the list',
    },
    {
      type: 'warning',
      title: 'Pricing objections trending up',
      body: 'Pricing pushback has risen for three straight weeks, mostly from prospects under 50 employees.',
      action: 'Adjust your pitch for SMB',
    },
    {
      type: 'coaching',
      title: 'Your CTA is your biggest lever right now',
      body: 'Tightening your CTA phrasing alone could lift session scores by an estimated 5–8 points based on your recent drills.',
      action: 'Practice CTA drills',
    },
  ],
};

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
function ProspectHealthSection({ data }: { data: any }) {
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

function PracticeSkillProfileSection({ data }: { data: any }) {
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
function PracticeSummarySection({ data }: { data: any }) {
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

function AchievementsSection({ data }: { data: any }) {
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

function RecommendationsSection({ data }: { data: any }) {
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
function ObjectionsSection({ data }: { data: any }) {
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
function CalendarTabContent({ prep, meetings }: any) {
  return (
    <div className="space-y-4">
      {!prep?.has_data ? (
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

      {meetings?.has_data && (
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

  const dashboard   = DASHBOARD;
  const pipeline    = PIPELINE;
  const chartData   = CHART_DATA;

  return (
    <div className="page-container space-y-5 max-w-3xl mx-auto p-5 bg-surface min-h-screen" style={{
      // local CSS variables so this renders correctly with no external design system
      // @ts-ignore
      '--brand': '#2563eb',
      '--success': '#10b981',
      '--warning': '#f59e0b',
      '--danger': '#ef4444',
    } as React.CSSProperties}>
      <style>{`
        .text-brand { color: #2563eb; } .bg-brand { background-color: #2563eb; }
        .bg-brand\\/5 { background-color: rgba(37,99,235,0.05); } .bg-brand\\/10 { background-color: rgba(37,99,235,0.1); }
        .border-brand { border-color: #2563eb; } .border-brand\\/20 { border-color: rgba(37,99,235,0.2); }
        .text-success { color: #10b981; } .bg-success { background-color: #10b981; }
        .bg-success\\/5 { background-color: rgba(16,185,129,0.05); } .bg-success\\/10 { background-color: rgba(16,185,129,0.1); }
        .border-success\\/20 { border-color: rgba(16,185,129,0.2); }
        .text-warning { color: #f59e0b; } .bg-warning { background-color: #f59e0b; }
        .bg-warning\\/5 { background-color: rgba(245,158,11,0.05); } .bg-warning\\/10 { background-color: rgba(245,158,11,0.1); }
        .border-warning\\/20 { border-color: rgba(245,158,11,0.2); }
        .text-danger { color: #ef4444; } .bg-danger { background-color: #ef4444; }
        .bg-danger\\/5 { background-color: rgba(239,68,68,0.05); } .bg-danger\\/10 { background-color: rgba(239,68,68,0.1); }
        .border-danger\\/20 { border-color: rgba(239,68,68,0.2); }
        .text-text-primary { color: #0f172a; } .text-text-secondary { color: #475569; } .text-text-muted { color: #94a3b8; }
        .border-surface-border { border-color: #e2e8f0; } .bg-surface { background-color: #f8fafc; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
          <Gauge size={16} className="text-brand" />
        </div>
        <h1 className="text-xl font-bold text-text-primary">Metrics</h1>
      </div>

      <Tabs tabs={METRIC_TABS} value={tab} onChange={setTab} />

      {/* ── Overview tab ─────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <AlertBanner alerts={ALERTS} />

          <div className="bg-white border border-surface-border rounded-lg p-5 flex items-center gap-5">
            <ScoreGauge score={dashboard.momentum_score} size="lg" label="Momentum" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm text-text-secondary">{dashboard.momentum_insight}</p>
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
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Sent (30d)" value={dashboard.sent_30d} color="brand" />
            <StatCard
              label="Response rate"
              value={formatRate(dashboard.response_rate)}
              delta={dashboard.response_rate_delta}
              color={
                dashboard.response_rate >= 0.3 ? 'success' :
                dashboard.response_rate >= 0.15 ? 'warning' : 'danger'
              }
            />
            <StatCard label="Pipeline value" value={formatCurrency(pipeline.pipeline_value, true)} color="success" />
            <StatCard
              label="Win rate"
              value={`${pipeline.win_rate_pct}%`}
              color={
                pipeline.win_rate_pct >= 30 ? 'success' :
                pipeline.win_rate_pct >= 15 ? 'warning' : 'danger'
              }
            />
          </div>

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
                <Area type="monotone" dataKey="sent" name="Sent" stroke="#2563eb" strokeWidth={2} fill="url(#sentGrad)" />
                <Area type="monotone" dataKey="responses" name="Responses" stroke="#10b981" strokeWidth={2} fill="url(#respGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Pipeline tab ─────────────────────────────── */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
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
                  { stage: 'Contacted',  count: pipeline.contacted_count  },
                  { stage: 'Replied',    count: pipeline.replied_count    },
                  { stage: 'Call/Demo',  count: pipeline.call_demo_count  },
                  { stage: 'Closed won', count: pipeline.closed_won_count },
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

          <ProspectHealthSection data={PROSPECTS_HEALTH} />
        </div>
      )}

      {/* ── Skills tab ───────────────────────────────── */}
      {tab === 'skills' && (
        <div className="space-y-4">
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-text-primary">Skill radar (7d)</p>
              <span className="text-xs text-text-muted">
                Composite <span className="font-mono text-text-primary font-semibold">{SKILL_DATA.composite}</span>/10
              </span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart
                data={Object.entries(SKILL_DATA.scores).map(([skill, score]) => ({
                  skill: SKILL_DIMENSION_LABELS[skill] ?? skill,
                  score: (score as number) ?? 0,
                }))}
              >
                <PolarGrid stroke="#f1f5f9" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: '#64748b' }} />
                <Radar dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex gap-2 pt-3 flex-wrap">
              <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                Strongest: {SKILL_DIMENSION_LABELS[SKILL_DATA.strongest] ?? SKILL_DATA.strongest}
              </span>
              <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">
                Focus: {SKILL_DIMENSION_LABELS[SKILL_DATA.weakest] ?? SKILL_DATA.weakest}
              </span>
            </div>
          </div>

          <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
            {Object.entries(SKILL_DATA.scores).map(([skill, score]) => {
              const pct = Math.min(100, Math.round(((score as number) ?? 0) * 10));
              return (
                <div key={skill} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">{SKILL_DIMENSION_LABELS[skill] ?? skill}</span>
                    <span className={cn('font-semibold', pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-danger')}>
                      {score as number ?? '—'}
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
          </div>

          <PracticeSkillProfileSection data={SKILL_PROFILE} />
        </div>
      )}

      {/* ── Practice tab ─────────────────────────────── */}
      {tab === 'practice' && (
        <div className="space-y-4">
          <PracticeSummarySection data={PRACTICE_SUMMARY} />
          <RecommendationsSection data={RECOMMENDATIONS} />
          <AchievementsSection data={ACHIEVEMENTS} />
        </div>
      )}

      {/* ── Analyses tab ─────────────────────────────── */}
      {tab === 'analyses' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Composite avg" value={ANALYSES_DATA.avg_scores.composite} unit="/10"
              color={ANALYSES_DATA.avg_scores.composite >= 7 ? 'success' : ANALYSES_DATA.avg_scores.composite >= 4 ? 'warning' : 'danger'} />
            <StatCard label="Analysed (30d)" value={ANALYSES_DATA.total} />
            <StatCard label="Trend (15d)" value={`${ANALYSES_DATA.trend_delta > 0 ? '+' : ''}${ANALYSES_DATA.trend_delta}`}
              color={ANALYSES_DATA.trend_delta >= 0 ? 'success' : 'danger'} />
            <StatCard label="Hook avg" value={ANALYSES_DATA.avg_scores.hook} unit="/10" />
          </div>

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
              const raw = (ANALYSES_DATA.avg_scores as any)[key];
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

          <div className="bg-white border border-surface-border rounded-lg p-5 space-y-3">
            <p className="text-xs font-semibold text-text-primary">Priority improvements</p>
            {ANALYSES_DATA.improvements.map((imp: any, i: number) => (
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-danger">Common failure patterns</p>
              {ANALYSES_DATA.top_failures.map((f: any) => (
                <div key={f.label} className="flex justify-between text-xs">
                  <span className="text-text-secondary capitalize">{f.label.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-danger">{f.count}×</span>
                </div>
              ))}
            </div>
            <div className="bg-white border border-surface-border rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-success">Success signals</p>
              {ANALYSES_DATA.top_successes.map((s: any) => (
                <div key={s.label} className="flex justify-between text-xs">
                  <span className="text-text-secondary capitalize">{s.label.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-success">{s.count}×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-text-primary px-0.5">Recent analyses</p>
            {ANALYSES_DATA.recent.map((a: any) => (
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

          <ObjectionsSection data={OBJECTIONS_DATA} />
        </div>
      )}

      {/* ── Calendar tab ─────────────────────────────── */}
      {tab === 'calendar' && (
        <CalendarTabContent prep={CALENDAR_PREP} meetings={MEETINGS_SUMMARY} />
      )}

      {/* ── AI Insights tab ──────────────────────────── */}
      {tab === 'ai' && (
        <div className="space-y-3">
          {INTELLIGENCE_DATA.fallback && (
            <p className="text-xs text-text-muted px-0.5">Showing rule-based insights while AI analysis is unavailable.</p>
          )}
          {INTELLIGENCE_DATA.insights.map((item: any, i: number) => (
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
        </div>
      )}
    </div>
  );
}
