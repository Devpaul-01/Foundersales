// ============================================================
// FILE: src/pages/growth/GrowthPage.tsx
//
// Changes vs previous version:
//  - GrowthFeedCard: marks card as read via IntersectionObserver
//    (POST /api/growth/cards/:id/read, fires once at 60% visibility)
//  - GrowthFeedCard: dismiss button (POST /api/growth/cards/:id/dismiss)
//    with optimistic local removal + query invalidation
//  - WeeklyPlanSection: fetches GET /api/growth/plan and renders
//    a dedicated card above the feed
//  - HistorySection: fetches GET /api/growth/history with
//    All / Tips / Plans filter tabs + prev/next pagination
//  - GrowthPage: Feed | History tab switcher in header area
// ============================================================
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation } from '@tanstack/react-query';
import { growthApi }   from '@/api/growth';
import { chatApi }     from '@/api/chat';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useAuth }     from '@/hooks/useAuth';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Textarea }    from '@/components/ui/Input';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState, Spinner } from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import {
  Flame, TrendingUp, Award, Lightbulb, CheckCircle2,
  BookOpen, RefreshCw, X, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { GrowthCard, DailyCheckIn } from '@/api/types';

// ── Card styles ───────────────────────────────────────────────
const CARD_STYLE: Record<string, { bg: string; icon: React.ReactNode }> = {
  tip:        { bg: 'bg-blue-50/60 border-brand-200',     icon: <Lightbulb    size={15} className="text-brand"        /> },
  strategy:   { bg: 'bg-indigo-50/60 border-indigo-200',  icon: <TrendingUp   size={15} className="text-indigo-500"   /> },
  challenge:  { bg: 'bg-amber-50/60 border-amber-200',    icon: <Award        size={15} className="text-amber-500"    /> },
  reflection: { bg: 'bg-purple-50/60 border-purple-200',  icon: <BookOpen     size={15} className="text-purple-500"   /> },
  resource:   { bg: 'bg-emerald-50/60 border-emerald-200', icon: <BookOpen    size={15} className="text-emerald-500"  /> },
  insight:    { bg: 'bg-blue-50/60 border-brand-200',     icon: <Lightbulb    size={15} className="text-brand"        /> },
  community:  { bg: 'bg-rose-50/60 border-rose-200',      icon: <CheckCircle2 size={15} className="text-rose-500"     /> },
};

// ── Growth feed card ──────────────────────────────────────────
interface GrowthFeedCardProps {
  card:      GrowthCard;
  onDismiss: () => void;
}

function GrowthFeedCard({ card, onDismiss }: GrowthFeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate     = useNavigate();
  const { showToast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const style   = CARD_STYLE[card.card_type] ?? { bg: 'bg-white border-surface-border', icon: null };
  const hasMore = (card.body?.length ?? 0) > 180;

  // ── Mark as read (POST /api/growth/cards/:id/read) ────────
  const readMutation = useMutation({
    mutationFn: () => growthApi.markCardRead(card.id),
  });

  useEffect(() => {
    if (card.is_read || readMutation.isSuccess || readMutation.isPending) return;
    const el = cardRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          readMutation.mutate();
          ob.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.is_read]);

  // ── Dismiss (POST /api/growth/cards/:id/dismiss) ──────────
  const dismissMutation = useMutation({
    mutationFn: () => growthApi.dismissCard(card.id),
    onSuccess:  () => onDismiss(),
  });

  // ── Start chat about this card ────────────────────────────
  const chatMutation = useMutation({
    mutationFn: () =>
      chatApi.createWithMessage({
        message:        `Let's discuss this: "${card.title}"`,
        chat_type:      'general',
        chat_mode:      'general',
        growth_card_id: card.id,
        title:          `Growth: ${card.title}`.slice(0, 100),
      }),
    onSuccess: (response) => navigate(`/chat/${response.data.chat.id}`),
    onError:   () => showToast('Could not start chat. Please try again.', 'error'),
  });

  return (
    <div ref={cardRef} className={cn('border rounded-xl p-4 space-y-2 relative', style.bg)}>
      {/* Dismiss button */}
      <button
        onClick={() => dismissMutation.mutate()}
        disabled={dismissMutation.isPending}
        className="absolute top-3 right-3 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors disabled:opacity-40"
        aria-label="Dismiss card"
      >
        {dismissMutation.isPending ? <Spinner size="xs" /> : <X size={13} />}
      </button>

      <div className="flex items-start justify-between gap-3 pr-6">
        <div className="flex items-center gap-2">
          {style.icon}
          <p className="text-sm font-semibold text-text-primary">{card.title}</p>
        </div>
        <span className="text-xs text-text-muted shrink-0">{formatRelativeDate(card.created_at)}</span>
      </div>

      {card.body && (
        <p className="text-sm text-text-secondary leading-relaxed">
          {!expanded && hasMore ? `${card.body.slice(0, 180)}…` : card.body}
        </p>
      )}
      {hasMore && (
        <button onClick={() => setExpanded((v) => !v)} className="text-xs text-brand hover:underline">
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {card.action_label && card.action_type === 'internal_chat' && (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1"
          isLoading={chatMutation.isPending}
          onClick={() => chatMutation.mutate()}
        >
          {card.action_label}
        </Button>
      )}
    </div>
  );
}

// ── Weekly plan section (GET /api/growth/plan) ────────────────
function WeeklyPlanSection() {
  const navigate      = useNavigate();
  const { showToast } = useToast();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    // NOTE: add queryKeys.growthPlan to your queryKeys file
    queryKey: ['growth', 'plan'],
    queryFn:  () => growthApi.getWeeklyPlan().then((r) => r.data),
    staleTime: 60 * 60_000, // plan is generated weekly — 1 hr stale is fine
    retry: 1,
  });

  const chatMutation = useMutation({
    mutationFn: (plan: typeof data['plan']) =>
      chatApi.createWithMessage({
        message:        `Let's explore this week's plan: "${plan.title}"`,
        chat_type:      'general',
        chat_mode:      'general',
        growth_card_id: plan.id,
        title:          `Growth: ${plan.title}`.slice(0, 100),
      }),
    onSuccess: (response) => navigate(`/chat/${response.data.chat.id}`),
    onError:   () => showToast('Could not start chat. Please try again.', 'error'),
  });

  if (isLoading) return <Skeleton className="h-28" rounded="xl" />;
  if (isError || !data?.plan) return null; // silently skip if unavailable

  const { plan, cached } = data;

  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-indigo-500" />
          <p className="text-sm font-semibold text-text-primary">This week's plan</p>
          {cached && (
            <span className="text-xs text-indigo-400 bg-white/60 border border-indigo-100 rounded-full px-2 py-0.5">
              Current
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-1 text-text-muted hover:text-indigo-500 transition-colors disabled:opacity-40"
          aria-label="Refresh plan"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="text-sm font-medium text-text-primary">{plan.title}</p>
      {plan.body && (
        <p className="text-sm text-text-secondary leading-relaxed">{plan.body}</p>
      )}
      {plan.action_label && plan.action_type === 'internal_chat' && (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1"
          isLoading={chatMutation.isPending}
          onClick={() => chatMutation.mutate(plan)}
        >
          {plan.action_label}
        </Button>
      )}
    </div>
  );
}

// ── History section (GET /api/growth/history) ─────────────────
type HistoryFilter = 'all' | 'tips' | 'plans';

const HISTORY_FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: 'All',   value: 'all'   },
  { label: 'Tips',  value: 'tips'  },
  { label: 'Plans', value: 'plans' },
];

const HISTORY_LIMIT = 15;

function HistorySection() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [page,   setPage  ] = useState(0);

  const handleFilter = (f: HistoryFilter) => { setFilter(f); setPage(0); };

  const { data, isLoading, isError, isFetching } = useQuery({
    // NOTE: add queryKeys.growthHistory to your queryKeys file
    queryKey: ['growth', 'history', filter, page],
    queryFn:  () =>
      growthApi.getHistory({
        limit:  HISTORY_LIMIT,
        offset: page * HISTORY_LIMIT,
        type:   filter === 'all' ? undefined : filter,
      }).then((r) => r.data),
    staleTime: 2 * 60_000,
    placeholderData: (prev) => prev, // keep previous page visible while fetching next
  });

  const cards   = data?.cards ?? [];
  const hasMore = cards.length === HISTORY_LIMIT;
  const hasPrev = page > 0;

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              filter === f.value
                ? 'bg-brand text-white border-brand'
                : 'border-surface-border text-text-muted hover:border-brand hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Card list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="xl" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-text-muted text-center py-8">Could not load history.</p>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          headline="No history yet"
          subline={
            filter === 'plans'
              ? 'Weekly plans will appear here once generated.'
              : 'Your growth cards will show up here over time.'
          }
        />
      ) : (
        <div className={cn('space-y-3 transition-opacity duration-150', isFetching && 'opacity-50')}>
          {cards.map((card) => {
            const style = CARD_STYLE[card.card_type] ?? { bg: 'bg-white border-surface-border', icon: null };
            return (
              <div key={card.id} className={cn('border rounded-xl p-4 space-y-2', style.bg)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {style.icon}
                    <p className="text-sm font-semibold text-text-primary">{card.title}</p>
                  </div>
                  <span className="text-xs text-text-muted shrink-0">
                    {formatRelativeDate(card.created_at)}
                  </span>
                </div>
                {card.body && (
                  <p className="text-sm text-text-secondary leading-relaxed line-clamp-3">
                    {card.body}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(hasPrev || hasMore) && (
        <div className="flex items-center justify-between pt-1">
          <Button
            size="xs"
            variant="ghost"
            disabled={!hasPrev || isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={14} className="mr-1" /> Previous
          </Button>
          <span className="text-xs text-text-muted">Page {page + 1}</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={!hasMore || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Check-in section (unchanged logic) ───────────────────────
function CheckInSection({ streak }: { streak: number }) {
  const { showToast }   = useToast();
  const { refreshUser } = useAuth();
  const [answers,   setAnswers  ] = useState<Record<string, string>>({});
  const [moodScore, setMoodScore] = useState<number | null>(null);

  const { data: checkInData, isLoading: checkInLoading } = useQuery({
    queryKey: queryKeys.checkInToday,
    queryFn:  () => growthApi.getTodayCheckIn().then((r) => r.data),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      growthApi.submitCheckIn({
        answers,
        mood_score: moodScore ?? undefined,
        date: checkInData?.check_in.date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
      queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
      refreshUser();
      showToast('Check-in saved!', 'success');
    },
    onError: (err: any) => {
      if (err?.code === 'ALREADY_SUBMITTED') {
        queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
      } else {
        showToast('Could not save check-in.', 'error');
      }
    },
  });

  if (checkInLoading) return <Skeleton className="h-40" rounded="xl" />;

  const checkIn: DailyCheckIn | undefined = checkInData?.check_in;
  const isNew = checkInData?.is_new;
  if (!checkIn) return null;

  // Handle both string[] and object[] formats
  const rawQuestions = checkIn.questions ?? [];
  const questions: Array<{ id: string; question: string }> = rawQuestions.map((q, idx) => {
    if (typeof q === 'string') {
      return { id: `q${idx + 1}`, question: q };
    }
    if (q?.question) {
      return { id: q.id || `q${idx + 1}`, question: q.question };
    }
    return { id: `q${idx + 1}`, question: String(q) };
  });

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id]?.trim());

  // Already submitted today — show AI response
  if (!isNew && checkIn.processed_at && checkIn.ai_response) {
    return (
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Flame size={15} className={streak > 0 ? 'text-orange-500' : 'text-brand'} />
          <p className="text-sm font-semibold text-text-primary">
            {streak > 0 ? `${streak}-day streak 🔥` : "Today's check-in"}
          </p>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">{checkIn.ai_response}</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Flame size={15} className={streak > 0 ? 'text-orange-500' : 'text-brand'} />
        <p className="text-sm font-semibold text-text-primary">
          {streak > 0 ? `${streak}-day streak — Daily check-in` : "Today's check-in"}
        </p>
        {streak > 0 && (
          <span className="text-xs text-orange-500 font-medium">Keep it going!</span>
        )}
      </div>

      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.id}>
            <p className="text-sm font-medium text-text-primary mb-1">{q.question}</p>
            <Textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              rows={2}
              maxLength={1000}
              placeholder="Be honest — this is just for you and Clutch…"
            />
          </div>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium text-text-primary mb-2">How are you feeling? (1–10)</p>
        <div className="flex gap-1.5 flex-wrap">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setMoodScore(n)}
              className={cn(
                'w-8 h-8 rounded-lg text-sm font-semibold border transition-all',
                moodScore === n
                  ? 'bg-brand text-white border-brand'
                  : 'border-surface-border text-text-muted hover:border-brand',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        disabled={!allAnswered}
        isLoading={submitMutation.isPending}
        onClick={() => submitMutation.mutate()}
      >
        Submit check-in
      </Button>
    </div>
  );
}

// ── Main GrowthPage ───────────────────────────────────────────
type ActiveTab = 'feed' | 'history';

export default function GrowthPage() {
  const { user }    = useAuth();
  const loaderRef   = useRef<HTMLDivElement>(null);
  const [activeTab,    setActiveTab   ] = useState<ActiveTab>('feed');
  // Optimistic dismiss: track dismissed IDs locally so the card
  // vanishes immediately without waiting for a refetch.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: queryKeys.growthFeed(),
      queryFn:  ({ pageParam = 0 }) =>
        growthApi.getFeed({ limit: 20, offset: pageParam }).then((r) => r.data),
      getNextPageParam: (last) =>
        last.pagination.has_more
          ? (last.pagination.offset ?? 0) + (last.pagination.limit ?? 20)
          : undefined,
      initialPageParam: 0,
      staleTime: 2 * 60_000,
    });

  // Infinite scroll
  const observerCb = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(observerCb, { rootMargin: '200px' });
    ob.observe(el);
    return () => ob.disconnect();
  }, [observerCb]);

  const allCards  = (data?.pages.flatMap((p) => p.cards) ?? []).filter((c) => !dismissedIds.has(c.id));
  const archetype = data?.pages[0]?.archetype;
  const streak    = user?.check_in_streak ?? 0;

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    // Invalidate so the dismissed card is excluded on next background refetch
    queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
  }, []);

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Growth</h1>
        {archetype && (
          <span className="text-xs text-text-muted capitalize bg-surface-base border border-surface-border rounded-full px-3 py-1">
            {archetype}
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-base border border-surface-border rounded-xl p-1">
        {(['feed', 'history'] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all',
              activeTab === tab
                ? 'bg-white shadow-sm text-text-primary'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'feed' ? (
        <>
          {/* Daily check-in (always first) */}
          <CheckInSection streak={streak} />

          {/* Weekly plan */}
          <WeeklyPlanSection />

          {/* Growth feed */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24" rounded="xl" />
              ))}
            </div>
          ) : allCards.length === 0 ? (
            <EmptyState
              icon={<TrendingUp size={28} />}
              headline="Your growth feed is building"
              subline="Complete practice sessions, submit meeting debriefs, and check in daily to unlock your feed."
            />
          ) : (
            <div className="space-y-3">
              {allCards.map((c) => (
                <GrowthFeedCard
                  key={c.id}
                  card={c}
                  onDismiss={() => handleDismiss(c.id)}
                />
              ))}
              <div ref={loaderRef} className="h-4 flex items-center justify-center">
                {isFetchingNextPage && <Spinner size="sm" />}
              </div>
            </div>
          )}
        </>
      ) : (
        <HistorySection />
      )}
    </div>
  );
}
