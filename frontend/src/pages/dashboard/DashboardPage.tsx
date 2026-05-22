// ============================================================h
// FILE: src/pages/dashboard/DashboardPage.tsx
// ============================================================
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { metricsApi }     from '@/api/metrics';
import { growthApi }      from '@/api/growth';
import { suggestionsApi } from '@/api/misc';
import { goalsApi }       from '@/api/goals';
import { chatApi }        from '@/api/chat';
import { queryClient }    from '@/lib/queryClient';
import { queryKeys }      from '@/lib/queryKeys';
import { useAuth }        from '@/hooks/useAuth';
import { useToast }       from '@/hooks/useToast';
import { Button }         from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { Badge }          from '@/components/ui/Badge';
import { ScoreGauge, BarGauge } from '@/components/ui/ScoreGauge';
import { Skeleton, SkeletonStatCard } from '@/components/ui/Skeleton';
import { EmptyState }     from '@/components/common/index';
import { GROWTH_CARD_TYPE_ICONS, ROUTES, ARCHETYPE_ICONS, ARCHETYPE_LABELS } from '@/lib/constants';
import {
  getGreeting, formatRelativeDate, formatRate, formatCurrency,
  formatShortDate, daysUntil, cn,
} from '@/lib/utils';
import { AppError, type GrowthCard, type UserGoal } from '@/api/types';
import {
  Zap, TrendingUp, Target, CheckSquare,
  BarChart2, MessageCircle, X, ChevronRight,
  RefreshCw, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '@/lib/animations';

// ── Check-in card ────────────────────────────────────────────
function CheckInCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.checkInToday,
    queryFn:  () => growthApi.getTodayCheckIn().then((r) => r.data),
    staleTime: Infinity,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" rounded="lg" />;
  if (!data) return null;

  if (!data.is_new && data.check_in.ai_response) {
    return (
      <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-brand mb-1">Clutch AI — Today's coaching</p>
        <p className="text-sm text-text-primary leading-relaxed">{data.check_in.ai_response}</p>
      </div>
    );
  }

  return (
    <div
      onClick={() => navigate(ROUTES.GROWTH)}
      className="bg-white border border-surface-border rounded-lg p-4 flex items-center gap-3 cursor-pointer hover:bg-surface-hover transition-colors"
    >
      <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
        <CheckSquare size={18} className="text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">Daily check-in ready</p>
        <p className="text-xs text-text-muted">2 mins · Personalised coaching awaits</p>
      </div>
      <ChevronRight size={16} className="text-text-muted shrink-0" />
    </div>
  );
}

// ── Growth card ───────────────────────────────────────────────
function GrowthCardItem({ card, onDismiss }: { card: GrowthCard; onDismiss: (id: string) => void }) {
  const navigate  = useNavigate();
  const { showToast } = useToast();

  const readMutation = useMutation({
    mutationFn: (id: string) => growthApi.markCardRead(id),
  });

  const handleClick = () => {
    if (!card.is_read) readMutation.mutate(card.id);
    if (card.action_type === 'internal_chat') {
      navigate(ROUTES.CHAT);
    } else if (card.action_type === 'external_url' && card.metadata?.source_url) {
      window.open(card.metadata.source_url as string, '_blank', 'noopener,noreferrer');
    } else if (card.action_type === 'internal_nav') {
      navigate(ROUTES.GROWTH);
    }
  };

  return (
    <div className={cn(
      'bg-white border border-surface-border rounded-lg p-4 space-y-2 shrink-0 w-72',
      !card.is_read && 'border-l-2 border-l-brand',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{GROWTH_CARD_TYPE_ICONS[card.card_type] ?? '💡'}</span>
          <Badge variant="gray" size="xs">{card.card_type}</Badge>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(card.id); }}
          className="text-text-muted hover:text-text-primary transition-colors shrink-0"
        >
          <X size={13} />
        </button>
      </div>
      <p className="text-sm font-semibold text-text-primary leading-snug">{card.title}</p>
      <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">{card.body}</p>
      {card.action_label && (
        <button
          onClick={handleClick}
          className="text-xs text-brand font-medium hover:underline flex items-center gap-1"
        >
          {card.action_label}
          {card.action_type === 'external_url'
            ? <ExternalLink size={10} />
            : <ChevronRight size={11} />}
        </button>
      )}
    </div>
  );
}

// ── Goal progress row ─────────────────────────────────────────
function GoalRow({ goal }: { goal: UserGoal }) {
  const navigate = useNavigate();
  const pct = goal.target_value
    ? Math.min(100, (goal.current_value / goal.target_value) * 100)
    : 0;
  const days = daysUntil(goal.target_date);

  return (
    <div
      onClick={() => navigate(`/goals/${goal.id}`)}
      className="flex items-center gap-3 cursor-pointer hover:bg-surface-hover rounded-md px-2 py-2 -mx-2 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{goal.goal_text}</p>
        <div className="mt-1.5">
          <BarGauge value={pct} max={100} />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-muted">
            {goal.current_value ?? 0}{goal.target_unit ? ` ${goal.target_unit}` : ''} / {goal.target_value ?? '?'}{goal.target_unit ? ` ${goal.target_unit}` : ''}
          </span>
          {days !== null && (
            <span className={cn('text-xs', days < 0 ? 'text-danger' : days <= 3 ? 'text-warning' : 'text-text-muted')}>
              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function DashboardPage() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const { showToast } = useToast();
  const [chartMetric, setChartMetric] = useState<'sent' | 'positive' | 'positive_rate'>('sent');

  // ── Data fetching ────────────────────────────────────────────
  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn:  () => metricsApi.getDashboard().then((r) => r.data),
    staleTime: 2 * 60_000,
  });

  const { data: feedData, isLoading: feedLoading, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey:         queryKeys.growthFeed(),
    queryFn:          ({ pageParam = 0 }) => growthApi.getFeed({ limit: 10, offset: pageParam as number }).then((r) => r.data),
    getNextPageParam: (last, pages) =>
      last.pagination.has_more ? pages.length * 10 : undefined,
    initialPageParam: 0,
    staleTime: 5 * 60_000,
  });

  const { data: suggestionsData } = useQuery({
    queryKey: queryKeys.suggestions,
    queryFn:  () => suggestionsApi.get().then((r) => r.data.suggestions),
    staleTime: 5 * 60_000,
  });

  // ── Mutations ────────────────────────────────────────────────
  const dismissMutation = useMutation({
    mutationFn: (id: string) => growthApi.dismissCard(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.growthFeed() });
      queryClient.setQueryData(queryKeys.growthFeed(), (old: unknown) => {
        const o = old as { pages: Array<{ cards: GrowthCard[] }> } | undefined;
        if (!o) return o;
        return {
          ...o,
          pages: o.pages.map((page) => ({
            ...page,
            cards: page.cards.filter((c) => c.id !== id),
          })),
        };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() }),
  });

  // Replace lines 178-188 with:
const newChatMutation = useMutation({
  mutationFn: (message: string) =>
    chatApi.createWithMessage({ 
      message: message,
      chat_type: 'general', 
      chat_mode: 'general' 
    }),
  onSuccess: (response) => {
    navigate(`/chat/${response.data.chat.id}`);
  },
  onError: () => showToast('Could not start chat.', 'error'),
});

  const db    = dashData?.dashboard;
  const cards = feedData?.pages.flatMap((p) => p.cards) ?? [];
  const goals = dashData?.goals ?? [];
  const archetype = feedData?.pages[0]?.archetype;

  return (
    <div className="page-container space-y-6">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{getGreeting(user?.name)}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {archetype && (
              <span className="text-xs text-text-muted">
                {ARCHETYPE_ICONS[archetype]} {ARCHETYPE_LABELS[archetype]}
              </span>
            )}
            {user?.check_in_streak != null && user.check_in_streak > 0 && (
              <span className="text-xs text-text-muted">🔥 {user.check_in_streak}-day streak</span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Zap size={14} />}
          onClick={() => navigate(ROUTES.OPPORTUNITIES)}
        >
          Opportunities
        </Button>
      </div>

      {/* ── Check-in ──────────────────────────────────────── */}
      <CheckInCard />

      {/* ── Momentum + Stats ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Momentum gauge */}
        <div className="lg:col-span-1 bg-white border border-surface-border rounded-lg p-5 flex flex-col items-center gap-4">
          {dashLoading ? (
            <Skeleton className="w-28 h-28" rounded="full" />
          ) : (
            <>
              <ScoreGauge
                score={db?.momentum_score ?? 0}
                size="lg"
                label="Momentum"
                colorMode="brand"
              />
              {db && (
                <div className="w-full space-y-2">
                  {Object.entries(db.momentum_breakdown).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-text-muted w-20 capitalize shrink-0">{key}</span>
                      <BarGauge value={val as number} max={30} className="flex-1" />
                      <span className="text-xs font-mono text-text-muted w-6 text-right">{val}</span>
                    </div>
                  ))}
                </div>
              )}
              {db?.momentum_insight && (
                <p className="text-xs text-text-secondary text-center italic leading-relaxed">
                  {db.momentum_insight}
                </p>
              )}
            </>
          )}
        </div>

        {/* Stat cards */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {dashLoading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)
            : (
              <>
                <StatCard
                  label="Sent (30d)"
                  value={db?.sent_count_30d ?? 0}
                  icon={<Zap size={16} />}
                />
                <StatCard
                  label="Reply Rate"
                  value={formatRate(db?.positive_rate ?? 0)}
                  icon={<TrendingUp size={16} />}
                />
                <StatCard
                  label="Pipeline"
                  value={formatCurrency(dashData?.pipeline?.pipeline_value ?? 0, true)}
                  icon={<BarChart2 size={16} />}
                />
                <StatCard
                  label="Win Rate"
                  value={`${dashData?.pipeline?.win_rate_pct ?? 0}%`}
                  icon={<Target size={16} />}
                />
              </>
            )
          }
        </div>
      </div>

      {/* ── Chart ─────────────────────────────────────────── */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">30-day activity</h2>
          <div className="flex gap-1.5">
            {(['sent', 'positive', 'positive_rate'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setChartMetric(m)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded font-medium transition-colors',
                  chartMetric === m
                    ? 'bg-brand text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                )}
              >
                {m === 'positive_rate' ? 'Rate %' : m === 'positive' ? 'Positive' : 'Sent'}
              </button>
            ))}
          </div>
        </div>
        {dashLoading ? (
          <Skeleton className="h-48 w-full" rounded="md" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={dashData?.chart_data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickFormatter={(v: string) => v.slice(5)}
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
        )}
      </div>

      {/* ── Growth cards feed ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Growth feed</h2>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => navigate(ROUTES.GROWTH)}
          >
            See all
          </Button>
        </div>

        {feedLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="w-72 h-40 shrink-0" rounded="lg" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <EmptyState
            icon="🌱"
            headline="Generating your first growth tips…"
            subline="Check back in a moment — Clutch is personalising your feed."
            compact
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {cards.map((card) => (
              <GrowthCardItem
                key={card.id}
                card={card}
                onDismiss={(id) => dismissMutation.mutate(id)}
              />
            ))}
            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                className="shrink-0 w-72 h-full min-h-[160px] border-2 border-dashed border-surface-border rounded-lg flex items-center justify-center text-sm text-text-muted hover:border-slate-300 hover:text-text-primary transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Goals + Suggestions ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Active goals */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <Target size={14} className="text-brand" /> Active goals
            </h2>
            <Button variant="ghost" size="xs" onClick={() => navigate(ROUTES.GOALS)}>
              Manage
            </Button>
          </div>
          {goals.length === 0 ? (
            <EmptyState
              icon="🎯"
              headline="No active goals"
              subline="Set a goal to track your progress."
              action={{ label: 'Add goal', onClick: () => navigate(ROUTES.GOALS) }}
              compact
            />
          ) : (
            <div className="space-y-1 divide-y divide-surface-border">
              {goals.map((goal) => <GoalRow key={goal.id} goal={goal} />)}
            </div>
          )}
        </div>

        {/* Clutch AI starters */}
        <div className="bg-white border border-surface-border rounded-lg p-5">
          <div className="flex items-center gap-1.5 mb-4">
            <MessageCircle size={14} className="text-brand" />
            <h2 className="text-sm font-semibold text-text-primary">Chat with Clutch AI</h2>
          </div>
          <div className="space-y-2">
            {(suggestionsData ?? [
              'Help me write a better cold message',
              'Why am I getting ghosted?',
              'Review my outreach approach',
              'What should I say after no response?',
              'Help me handle a price objection',
            ]).map((s) => (
              <button
                key={s}
                onClick={() => newChatMutation.mutate(s)}
                className="w-full text-left text-sm text-text-secondary px-3 py-2 rounded-md border border-surface-border hover:border-brand-300 hover:text-brand hover:bg-brand-50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
