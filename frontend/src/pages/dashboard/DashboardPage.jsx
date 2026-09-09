// ============================================================
// FILE: src/pages/dashboard/DashboardPage.tsx
// DEMO BUILD — all data is hardcoded locally for screenshots.
// No network calls, no loading states, no empty states.
// ============================================================
import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Zap, TrendingUp, Target, CheckSquare,
  BarChart2, MessageCircle, X, ChevronRight,
  ExternalLink,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────
// Static demo data
// ────────────────────────────────────────────────────────────

const CURRENT_USER = {
  name: 'Jordan',
  check_in_streak: 12,
};

const ARCHETYPE_ICONS = {
  closer: '🎯',
  connector: '🤝',
  hunter: '🏹',
  strategist: '♟️',
};

const ARCHETYPE_LABELS = {
  closer: 'The Closer',
  connector: 'The Connector',
  hunter: 'The Hunter',
  strategist: 'The Strategist',
};

const CURRENT_ARCHETYPE = 'hunter';

const GROWTH_CARD_TYPE_ICONS = {
  tip: '💡',
  insight: '📊',
  challenge: '🔥',
  milestone: '🏆',
  warning: '⚠️',
};

const DASHBOARD = {
  momentum_score: 78,
  momentum_breakdown: {
    outreach: 24,
    engagement: 19,
    followups: 21,
    consistency: 14,
  },
  momentum_insight:
    "You're 12% ahead of last week's pace — your Tuesday follow-ups are converting especially well.",
  sent_count_30d: 342,
  positive_rate: 0.284,
  chart_data: [
    { date: '2026-08-09', sent: 8, positive: 2, positive_rate: 0.25 },
    { date: '2026-08-10', sent: 11, positive: 3, positive_rate: 0.27 },
    { date: '2026-08-11', sent: 6, positive: 1, positive_rate: 0.17 },
    { date: '2026-08-12', sent: 14, positive: 4, positive_rate: 0.29 },
    { date: '2026-08-13', sent: 9, positive: 3, positive_rate: 0.33 },
    { date: '2026-08-14', sent: 4, positive: 1, positive_rate: 0.25 },
    { date: '2026-08-15', sent: 2, positive: 0, positive_rate: 0.0 },
    { date: '2026-08-16', sent: 13, positive: 4, positive_rate: 0.31 },
    { date: '2026-08-17', sent: 15, positive: 5, positive_rate: 0.33 },
    { date: '2026-08-18', sent: 10, positive: 2, positive_rate: 0.2 },
    { date: '2026-08-19', sent: 12, positive: 4, positive_rate: 0.33 },
    { date: '2026-08-20', sent: 9, positive: 3, positive_rate: 0.33 },
    { date: '2026-08-21', sent: 5, positive: 1, positive_rate: 0.2 },
    { date: '2026-08-22', sent: 3, positive: 1, positive_rate: 0.33 },
    { date: '2026-08-23', sent: 16, positive: 6, positive_rate: 0.38 },
    { date: '2026-08-24', sent: 14, positive: 5, positive_rate: 0.36 },
    { date: '2026-08-25', sent: 11, positive: 3, positive_rate: 0.27 },
    { date: '2026-08-26', sent: 13, positive: 4, positive_rate: 0.31 },
    { date: '2026-08-27', sent: 8, positive: 2, positive_rate: 0.25 },
    { date: '2026-08-28', sent: 6, positive: 2, positive_rate: 0.33 },
    { date: '2026-08-29', sent: 4, positive: 1, positive_rate: 0.25 },
    { date: '2026-08-30', sent: 15, positive: 5, positive_rate: 0.33 },
    { date: '2026-08-31', sent: 17, positive: 6, positive_rate: 0.35 },
    { date: '2026-09-01', sent: 12, positive: 4, positive_rate: 0.33 },
    { date: '2026-09-02', sent: 10, positive: 3, positive_rate: 0.3 },
    { date: '2026-09-03', sent: 14, positive: 5, positive_rate: 0.36 },
    { date: '2026-09-04', sent: 9, positive: 3, positive_rate: 0.33 },
    { date: '2026-09-05', sent: 7, positive: 2, positive_rate: 0.29 },
    { date: '2026-09-06', sent: 5, positive: 2, positive_rate: 0.4 },
    { date: '2026-09-07', sent: 18, positive: 7, positive_rate: 0.39 },
  ],
  pipeline: {
    pipeline_value: 184500,
    win_rate_pct: 34,
  },
};

const CHECK_IN = {
  is_new: false,
  check_in: {
    ai_response:
      "Nice work landing two replies from cold outreach yesterday. Your subject lines are getting sharper — the direct, no-fluff style is clearly resonating with VP-level prospects. Keep leading with the specific metric, not the pitch.",
  },
};

const GROWTH_CARDS = [
  {
    id: 'gc-1',
    card_type: 'insight',
    title: 'Your Tuesday sends outperform every other day',
    body: 'Messages sent on Tuesdays between 9–11am get a 41% higher reply rate than your weekly average. Consider shifting more of your batch there.',
    is_read: false,
    action_type: 'internal_chat',
    action_label: 'Discuss this insight',
  },
  {
    id: 'gc-2',
    card_type: 'tip',
    title: 'Try a shorter opening line',
    body: 'Your top 10 replies all opened with under 12 words. Long context-setting openers are correlating with lower response rates this month.',
    is_read: true,
    action_type: 'internal_chat',
    action_label: 'Get rewrite examples',
  },
  {
    id: 'gc-3',
    card_type: 'milestone',
    title: "You've crossed 300 sends this month",
    body: "That's a new personal best — 18% more volume than August while keeping your reply rate steady. Consistency is compounding.",
    is_read: false,
    action_type: 'internal_nav',
    action_label: 'View full report',
  },
  {
    id: 'gc-4',
    card_type: 'challenge',
    title: '5-day follow-up streak challenge',
    body: 'You have 6 prospects waiting on a second touch. Clear them this week to keep your pipeline moving before they go cold.',
    is_read: false,
    action_type: 'internal_nav',
    action_label: 'See prospects',
  },
  {
    id: 'gc-5',
    card_type: 'warning',
    title: 'Reply rate dipped on LinkedIn outreach',
    body: 'LinkedIn response rate fell to 14% this week, down from a 26% average. Your last 4 messages leaned heavily on a template — try personalizing the opener.',
    is_read: true,
    action_type: 'external_url',
    action_label: 'Read the playbook',
    metadata: { source_url: 'https://example.com/playbook' },
  },
  {
    id: 'gc-6',
    card_type: 'tip',
    title: 'Ask one question, not three',
    body: "Prospects are 2.1x more likely to reply when your message ends with a single clear question instead of multiple asks.",
    is_read: true,
    action_type: 'internal_chat',
    action_label: 'Practice this',
  },
];

const GOALS = [
  {
    id: 'goal-1',
    goal_text: 'Close $50K in new pipeline this quarter',
    current_value: 34200,
    target_value: 50000,
    target_unit: '$',
    target_date: '2026-09-30',
  },
  {
    id: 'goal-2',
    goal_text: 'Send 400 outbound messages this month',
    current_value: 342,
    target_value: 400,
    target_unit: 'msgs',
    target_date: '2026-09-30',
  },
  {
    id: 'goal-3',
    goal_text: 'Book 15 discovery calls',
    current_value: 15,
    target_value: 15,
    target_unit: 'calls',
    target_date: '2026-09-15',
  },
  {
    id: 'goal-4',
    goal_text: 'Improve reply rate to 30%',
    current_value: 28.4,
    target_value: 30,
    target_unit: '%',
    target_date: '2026-09-12',
  },
];

const SUGGESTIONS = [
  'Help me write a better cold message',
  'Why am I getting ghosted?',
  'Review my outreach approach',
  'What should I say after no response?',
  'Help me handle a price objection',
];

// ────────────────────────────────────────────────────────────
// Small utils (inlined, no external deps)
// ────────────────────────────────────────────────────────────

function cn(...args) {
  return args.filter(Boolean).join(' ');
}

function getGreeting(name) {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${time}, ${name}` : time;
}

function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

function formatCurrency(value, compact) {
  if (compact && value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toLocaleString()}`;
}

function daysUntil(dateStr) {
  const target = new Date(dateStr);
  const now = new Date('2026-09-08');
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

// ────────────────────────────────────────────────────────────
// UI primitives (inlined, lightweight replacements)
// ────────────────────────────────────────────────────────────

function Button({ children, size = 'md', variant = 'primary', leftIcon, onClick, className }) {
  const sizeCls = size === 'sm' ? 'px-3 py-1.5 text-xs' : size === 'xs' ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm';
  const variantCls =
    variant === 'secondary'
      ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
      : variant === 'ghost'
      ? 'bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100'
      : 'bg-blue-600 text-white hover:bg-blue-700';
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
        sizeCls,
        variantCls,
        className,
      )}
    >
      {leftIcon}
      {children}
    </button>
  );
}

function Badge({ children, variant = 'gray', size = 'sm' }) {
  const sizeCls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const variantCls =
    variant === 'gray' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700';
  return (
    <span className={cn('inline-block rounded font-medium capitalize', sizeCls, variantCls)}>
      {children}
    </span>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <span className="text-xl font-bold text-slate-900">{value}</span>
    </div>
  );
}

function ScoreGauge({ score, size = 'lg', label }) {
  const dim = size === 'lg' ? 112 : 80;
  const stroke = 10;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} className="-rotate-90">
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={radius}
          fill="none"
          stroke="#2563eb"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-slate-900">{score}</span>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function BarGauge({ value, max, className }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('h-1.5 rounded-full bg-slate-100 overflow-hidden', className)}>
      <div
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Check-in card
// ────────────────────────────────────────────────────────────

function CheckInCard() {
  const data = CHECK_IN;

  if (!data.is_new && data.check_in.ai_response) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-blue-700 mb-1">Clutch AI — Today's coaching</p>
        <p className="text-sm text-slate-800 leading-relaxed">{data.check_in.ai_response}</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
        <CheckSquare size={18} className="text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900">Daily check-in ready</p>
        <p className="text-xs text-slate-500">2 mins · Personalised coaching awaits</p>
      </div>
      <ChevronRight size={16} className="text-slate-400 shrink-0" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Growth card
// ────────────────────────────────────────────────────────────

function GrowthCardItem({ card, onDismiss }) {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-lg p-4 space-y-2 shrink-0 w-72',
        !card.is_read && 'border-l-2 border-l-blue-600',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{GROWTH_CARD_TYPE_ICONS[card.card_type] ?? '💡'}</span>
          <Badge variant="gray" size="xs">{card.card_type}</Badge>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(card.id); }}
          className="text-slate-400 hover:text-slate-700 transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>
      <p className="text-sm font-semibold text-slate-900 leading-snug">{card.title}</p>
      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{card.body}</p>
      {card.action_label && (
        <button className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1">
          {card.action_label}
          {card.action_type === 'external_url'
            ? <ExternalLink size={10} />
            : <ChevronRight size={11} />}
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Goal progress row
// ────────────────────────────────────────────────────────────

function GoalRow({ goal }) {
  const pct = goal.target_value
    ? Math.min(100, (goal.current_value / goal.target_value) * 100)
    : 0;
  const days = daysUntil(goal.target_date);

  return (
    <div className="flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-md px-2 py-2 -mx-2 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 truncate">{goal.goal_text}</p>
        <div className="mt-1.5">
          <BarGauge value={pct} max={100} />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-slate-500">
            {goal.target_unit === '$'
              ? `${formatCurrency(goal.current_value ?? 0, true)} / ${formatCurrency(goal.target_value ?? 0, true)}`
              : `${goal.current_value ?? 0}${goal.target_unit ? ` ${goal.target_unit}` : ''} / ${goal.target_value ?? '?'}${goal.target_unit ? ` ${goal.target_unit}` : ''}`}
          </span>
          {days !== null && (
            <span className={cn('text-xs', days < 0 ? 'text-red-600' : days <= 3 ? 'text-amber-600' : 'text-slate-500')}>
              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [chartMetric, setChartMetric] = useState('sent');
  const [cards, setCards] = useState(GROWTH_CARDS);

  const db = DASHBOARD;
  const goals = GOALS;
  const archetype = CURRENT_ARCHETYPE;

  const handleDismiss = (id) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* ── Header ────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{getGreeting(CURRENT_USER.name)}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {archetype && (
                <span className="text-xs text-slate-500">
                  {ARCHETYPE_ICONS[archetype]} {ARCHETYPE_LABELS[archetype]}
                </span>
              )}
              {CURRENT_USER.check_in_streak > 0 && (
                <span className="text-xs text-slate-500">🔥 {CURRENT_USER.check_in_streak}-day streak</span>
              )}
            </div>
          </div>
          <Button size="sm" variant="secondary" leftIcon={<Zap size={14} />}>
            Opportunities
          </Button>
        </div>

        {/* ── Check-in ──────────────────────────────────────── */}
        <CheckInCard />

        {/* ── Momentum + Stats ──────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Momentum gauge */}
          <div className="lg:col-span-1 bg-white border border-slate-200 rounded-lg p-5 flex flex-col items-center gap-4">
            <ScoreGauge score={db.momentum_score} size="lg" label="Momentum" />
            <div className="w-full space-y-2">
              {Object.entries(db.momentum_breakdown).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-20 capitalize shrink-0">{key}</span>
                  <BarGauge value={val} max={30} className="flex-1" />
                  <span className="text-xs font-mono text-slate-500 w-6 text-right">{val}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 text-center italic leading-relaxed">
              {db.momentum_insight}
            </p>
          </div>

          {/* Stat cards */}
          <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Sent (30d)" value={db.sent_count_30d} icon={<Zap size={16} />} />
            <StatCard label="Reply Rate" value={formatRate(db.positive_rate)} icon={<TrendingUp size={16} />} />
            <StatCard label="Pipeline" value={formatCurrency(db.pipeline.pipeline_value, true)} icon={<BarChart2 size={16} />} />
            <StatCard label="Win Rate" value={`${db.pipeline.win_rate_pct}%`} icon={<Target size={16} />} />
          </div>
        </div>

        {/* ── Chart ─────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">30-day activity</h2>
            <div className="flex gap-1.5">
              {['sent', 'positive', 'positive_rate'].map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMetric(m)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded font-medium transition-colors',
                    chartMetric === m
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100',
                  )}
                >
                  {m === 'positive_rate' ? 'Rate %' : m === 'positive' ? 'Positive' : 'Sent'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={db.chart_data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickFormatter={(v) => v.slice(5)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}
                labelStyle={{ color: '#0f172a', fontWeight: 600 }}
              />
              <Line
                type="monotone"
                dataKey={chartMetric}
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ── Growth cards feed ─────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Growth feed</h2>
            <Button variant="ghost" size="xs">See all</Button>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {cards.map((card) => (
              <GrowthCardItem key={card.id} card={card} onDismiss={handleDismiss} />
            ))}
            <button className="shrink-0 w-72 h-full min-h-[160px] border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-sm text-slate-500 hover:border-slate-300 hover:text-slate-900 transition-colors">
              Load more
            </button>
          </div>
        </div>

        {/* ── Goals + Suggestions ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Active goals */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Target size={14} className="text-blue-600" /> Active goals
              </h2>
              <Button variant="ghost" size="xs">Manage</Button>
            </div>
            <div className="space-y-1 divide-y divide-slate-100">
              {goals.map((goal) => <GoalRow key={goal.id} goal={goal} />)}
            </div>
          </div>

          {/* Clutch AI starters */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-1.5 mb-4">
              <MessageCircle size={14} className="text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">Chat with Clutch AI</h2>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="w-full text-left text-sm text-slate-600 px-3 py-2 rounded-md border border-slate-200 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
