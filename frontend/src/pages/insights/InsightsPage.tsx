// ============================================================
// FILE: src/pages/insights/InsightsPage.tsx
// Static demo build — all data hardcoded locally, zero network calls.
// Recharts skill trend lines, loss reason breakdown.
// ============================================================
import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';

// ------------------------------------------------------------
// Lightweight local stand-ins for design-system components
// (kept API-compatible with the originals so JSX below is unchanged)
// ------------------------------------------------------------
function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function Badge({
  children,
  variant = 'gray',
  size = 'sm',
}: {
  children: React.ReactNode;
  variant?: 'green' | 'red' | 'gray' | 'blue';
  size?: 'xs' | 'sm';
}) {
  const variants: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  const sizes: Record<string, string> = {
    xs: 'text-[10px] px-1.5 py-0.5',
    sm: 'text-xs px-2 py-0.5',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium capitalize',
        variants[variant],
        sizes[size],
      )}
    >
      {children}
    </span>
  );
}

function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  variant?: 'underline';
}) {
  return (
    <div className="flex items-center gap-5 border-b border-surface-border">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'relative pb-2.5 text-sm font-medium transition-colors',
            value === t.value
              ? 'text-brand'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {t.label}
          {value === t.value && (
            <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-brand" />
          )}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
const INSIGHT_TABS = [
  { value: 'patterns', label: 'Patterns' },
  { value: 'why_losing', label: "Why you're losing" },
  { value: 'skill', label: 'Skill trend' },
];

const SKILL_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#f97316',
];

const SKILL_DIMENSION_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  objection_handling: 'Objection handling',
  negotiation: 'Negotiation',
  closing: 'Closing',
  active_listening: 'Active listening',
  rapport_building: 'Rapport building',
};

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp size={14} className="text-success" />;
  if (trend === 'down') return <TrendingDown size={14} className="text-danger" />;
  return <Minus size={14} className="text-text-muted" />;
}

// ------------------------------------------------------------
// Hardcoded demo data
// ------------------------------------------------------------
const MOCK_DATA = {
  patterns: [
    {
      title: 'You talk more than you listen on discovery calls',
      trend: 'down' as const,
      description:
        "Across your last 14 discovery calls, your average talk-to-listen ratio was 68:32 — well above the 45:55 benchmark for reps who move deals forward at this stage.",
      recommendation:
        "Try the 'two questions before you pitch' rule: ask two open-ended discovery questions before mentioning any feature or pricing.",
    },
    {
      title: 'Deals stall after the first pricing conversation',
      trend: 'down' as const,
      description:
        'In 6 of your last 9 opportunities, momentum dropped noticeably in the week following the first pricing discussion, with average time-to-next-touch increasing from 2.1 to 6.4 days.',
      recommendation:
        'Book the next step live, on the call, before pricing comes up — deals with a confirmed next meeting close 2.3x more often in your pipeline.',
    },
    {
      title: 'Your close rate on referral-sourced leads is climbing',
      trend: 'up' as const,
      description:
        'Referral-sourced opportunities closed at 58% over the last 90 days, up from 41% last quarter, and now outperform every other lead source you work.',
      recommendation:
        'Ask happy customers for introductions earlier — reps who request referrals within 30 days of close see a 20% lift in referral volume.',
    },
    {
      title: 'Objection handling on price is holding steady',
      trend: 'flat' as const,
      description:
        "Your recovery rate after a price objection has stayed flat at 52% for three consecutive months, neither improving nor declining significantly.",
      recommendation: '',
    },
  ],

  why_losing: {
    reasons: [
      { reason: 'Price too high', count: 27 },
      { reason: 'Chose competitor', count: 21 },
      { reason: 'No budget', count: 18 },
      { reason: 'Bad timing', count: 14 },
      { reason: 'No decision', count: 9 },
      { reason: 'Missing feature', count: 6 },
    ],
    ai_summary:
      "Price sensitivity is your leading loss driver this quarter, accounting for over a quarter of all closed-lost deals — but it's rarely the full story. In 16 of the 27 'price too high' losses, the deal also lacked a champion above the manager level, suggesting the real issue is value communicated to the wrong stakeholder rather than price itself. Competitive losses cluster heavily in the mid-market segment, where Rivera Cloud and Northbeam are winning on implementation speed. Tightening your discovery around budget authority in the first two calls would likely convert several 'no budget' and 'no decision' losses into qualified pipeline instead.",
  },

  skill_trend: {
    labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
    series: [
      { skill: 'discovery', data: [58, 61, 65, 63, 70, 74] },
      { skill: 'objection_handling', data: [49, 52, 50, 55, 59, 61] },
      { skill: 'negotiation', data: [66, 64, 68, 71, 69, 73] },
      { skill: 'closing', data: [42, 45, 48, 53, 57, 60] },
      { skill: 'active_listening', data: [71, 73, 75, 74, 78, 81] },
    ],
    deltas: [
      { skill: 'discovery', delta: 9 },
      { skill: 'closing', delta: 7 },
      { skill: 'active_listening', delta: 6 },
      { skill: 'objection_handling', delta: 4 },
      { skill: 'negotiation', delta: -2 },
      { skill: 'rapport_building', delta: 0 },
    ],
  },
};

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------
export default function InsightsPage() {
  const [tab, setTab] = useState('patterns');
  const data = MOCK_DATA;

  return (
    <div className="page-container space-y-5 max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-bold text-text-primary">Insights</h1>

      <Tabs tabs={INSIGHT_TABS} value={tab} onChange={setTab} variant="underline" />

      {/* ── Patterns tab ─────────────────────────────── */}
      {tab === 'patterns' && (
        <div className="space-y-4">
          {data.patterns.map((p, i) => (
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
          ))}
        </div>
      )}

      {/* ── Why you're losing tab ─────────────────────── */}
      {tab === 'why_losing' && (
        <div className="space-y-4">
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
                  {data.why_losing.reasons.map((_, i) => (
                    <Cell key={i} fill={SKILL_COLORS[i % SKILL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <p className="text-xs font-semibold text-text-primary mb-2">Clutch analysis</p>
            <p className="text-sm text-text-secondary leading-relaxed">{data.why_losing.ai_summary}</p>
          </div>
        </div>
      )}

      {/* ── Skill trend tab ───────────────────────────── */}
      {tab === 'skill' && (
        <div className="space-y-4">
          <div className="bg-white border border-surface-border rounded-lg p-5">
            <p className="text-xs font-semibold text-text-primary mb-4">Skill scores over time</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={data.skill_trend.labels.map((label, i) => {
                  const point: Record<string, any> = { name: label };
                  data.skill_trend.series.forEach((s) => {
                    point[s.skill] = s.data[i] ?? null;
                  });
                  return point;
                })}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                {data.skill_trend.series.map((s, i) => (
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
              {data.skill_trend.series.map((s, i) => (
                <span key={s.skill} className="flex items-center gap-1.5 text-xs text-text-muted">
                  <span
                    className="w-3 h-0.5 rounded-full inline-block"
                    style={{ background: SKILL_COLORS[i % SKILL_COLORS.length] }}
                  />
                  {SKILL_DIMENSION_LABELS[s.skill] ?? s.skill}
                </span>
              ))}
            </div>
          </div>

          {/* Skill deltas */}
          <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
            <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">
              30-day changes
            </p>
            {data.skill_trend.deltas.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2.5 border-b border-surface-border last:border-0"
              >
                <span className="text-sm text-text-primary">
                  {SKILL_DIMENSION_LABELS[d.skill] ?? d.skill}
                </span>
                <div className="flex items-center gap-2">
                  <TrendIcon trend={d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : 'flat'} />
                  <span
                    className={cn(
                      'text-sm font-mono font-semibold',
                      d.delta > 0 ? 'text-success' : d.delta < 0 ? 'text-danger' : 'text-text-muted',
                    )}
                  >
                    {d.delta > 0 ? '+' : ''}
                    {d.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
