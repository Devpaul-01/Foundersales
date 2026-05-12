// ============================================================
// FILE: src/pages/growth/GrowthPage_CORRECTED.tsx
//
// CORRECTIONS vs original:
//  - Check-in uses dynamic AI-generated questions from
//    GET /api/growth/checkin/today (not fixed wins/challenges/focus)
//  - Submit body: { answers: Record<string, string>, mood_score }
//  - Proper today/is_new logic
//  - Feed uses GET /api/growth/feed (cards[], pagination)
//  - Archetype from feed response
//  - Matches growth-10.txt exactly
// ============================================================
import React, { useState, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQuery, useMutation } from '@tanstack/react-query';
import { growthApi }   from '@/api/growth';
import { queryClient } from '@/lib/queryClient';
import { queryKeys }   from '@/lib/queryKeys';
import { useAuth }     from '@/hooks/useAuth';
import { useToast }    from '@/hooks/useToast';
import { Button }      from '@/components/ui/Button';
import { Textarea }    from '@/components/ui/Input';
import { Skeleton }    from '@/components/ui/Skeleton';
import { EmptyState, Spinner, InlineAlert } from '@/components/common/index';
import { formatRelativeDate, cn } from '@/lib/utils';
import { Flame, TrendingUp, Award, Lightbulb, CheckCircle2, BookOpen, RefreshCw } from 'lucide-react';
import type { GrowthCard, DailyCheckIn } from '@/api/types';

// ── Growth card ───────────────────────────────────────────────
const CARD_STYLE: Record<string, { bg: string; icon: React.ReactNode }> = {
  tip:       { bg: 'bg-blue-50/60 border-brand-200',    icon: <Lightbulb  size={15} className="text-brand"        /> },
  strategy:  { bg: 'bg-indigo-50/60 border-indigo-200', icon: <TrendingUp size={15} className="text-indigo-500"   /> },
  challenge: { bg: 'bg-amber-50/60 border-amber-200',   icon: <Award      size={15} className="text-amber-500"    /> },
  reflection:{ bg: 'bg-purple-50/60 border-purple-200', icon: <BookOpen   size={15} className="text-purple-500"   /> },
  resource:  { bg: 'bg-emerald-50/60 border-emerald-200',icon: <BookOpen  size={15} className="text-emerald-500"  /> },
  insight:   { bg: 'bg-blue-50/60 border-brand-200',    icon: <Lightbulb  size={15} className="text-brand"        /> },
  community: { bg: 'bg-rose-50/60 border-rose-200',     icon: <CheckCircle2 size={15} className="text-rose-500"   /> },
};

function GrowthFeedCard({ card }: { card: GrowthCard }) {
  const [expanded, setExpanded] = useState(false);
  const style    = CARD_STYLE[card.card_type] ?? { bg: 'bg-white border-surface-border', icon: null };
  const hasMore  = (card.body?.length ?? 0) > 180;

  return (
    <div className={cn('border rounded-xl p-4 space-y-2', style.bg)}>
      <div className="flex items-start justify-between gap-3">
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
        <Button size="xs" variant="ghost" className="mt-1">
          {card.action_label}
        </Button>
      )}
    </div>
  );
}

// ── Check-in section (dynamic questions) ─────────────────────
function CheckInSection({ streak }: { streak: number }) {
  const { showToast } = useToast();
  const { refreshUser } = useAuth();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [moodScore, setMoodScore] = useState<number | null>(null);

  const { data: checkInData, isLoading: checkInLoading } = useQuery({
    queryKey: queryKeys.checkInToday,
    queryFn:  () => growthApi.getTodayCheckIn().then((r) => r.data),
    staleTime: 60 * 60_000, // 1 hour — only one per day
    refetchOnWindowFocus: false,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      growthApi.submitCheckIn({
        answers,
        mood_score: moodScore ?? undefined,
        date: checkInData?.check_in.date,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.checkInToday });
      queryClient.invalidateQueries({ queryKey: queryKeys.growthFeed() });
      refreshUser(); // updates check_in_streak
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

  if (checkInLoading) {
    return <Skeleton className="h-40" rounded="xl" />;
  }

  const checkIn: DailyCheckIn | undefined = checkInData?.check_in;
  const isNew = checkInData?.is_new;

  if (!checkIn) return null;

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

  // New check-in — show dynamic AI-generated questions
  const questions: Array<{ id: string; question: string }> = checkIn.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id]?.trim());

  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Flame size={15} className={streak > 0 ? 'text-orange-500' : 'text-brand'} />
        <p className="text-sm font-semibold text-text-primary">
          {streak > 0 ? `${streak}-day streak — Daily check-in` : "Today's check-in"}
        </p>
        {streak > 0 && <span className="text-xs text-orange-500 font-medium">Keep it going!</span>}
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

      {/* Mood score */}
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
export default function GrowthPage() {
  const { user }  = useAuth();
  const loaderRef = useRef<HTMLDivElement>(null);

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

  const observerCb = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  React.useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(observerCb, { rootMargin: '200px' });
    ob.observe(el);
    return () => ob.disconnect();
  }, [observerCb]);

  const allCards = data?.pages.flatMap((p) => p.cards) ?? [];
  const archetype = data?.pages[0]?.archetype;
  const streak    = user?.check_in_streak ?? 0;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Growth</h1>
        {archetype && (
          <span className="text-xs text-text-muted capitalize bg-surface-base border border-surface-border rounded-full px-3 py-1">
            {archetype}
          </span>
        )}
      </div>

      {/* Daily check-in (always first) */}
      <CheckInSection streak={streak} />

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
          {allCards.map((c) => <GrowthFeedCard key={c.id} card={c} />)}
          <div ref={loaderRef} className="h-4 flex items-center justify-center">
            {isFetchingNextPage && <Spinner size="sm" />}
          </div>
        </div>
      )}
    </div>
  );
}


