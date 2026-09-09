// ============================================================
// FILE: src/pages/growth/GrowthPage.tsx
//
// DEMO BUILD — for screenshots / product walkthroughs only.
//  - All data below is hardcoded and local. No network calls,
//    no react-query, no auth context, no loading states.
//  - Design and interaction patterns (tabs, expand/collapse,
//    dismiss, check-in flow, history pagination) are preserved
//    and fully functional against the static data.
//  - Swap the DEMO_* constants back out for real API-backed
//    hooks when wiring this up to the backend again.
// ============================================================
import React, { useState } from 'react';
import {
  Flame, TrendingUp, Award, Lightbulb, CheckCircle2,
  BookOpen, RefreshCw, X, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Minimal local utilities (replacing @/lib/utils, @/components/ui) ──
function cn(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);
  if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Button({
  children, onClick, size = 'sm', variant = 'primary', disabled, isLoading, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  size?: 'xs' | 'sm';
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}) {
  const sizeCls = size === 'xs' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-4 py-2';
  const variantCls =
    variant === 'ghost'
      ? 'text-text-primary hover:bg-black/5'
      : 'bg-brand text-white hover:bg-brand-600 shadow-sm';
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        sizeCls, variantCls, className,
      )}
    >
      {isLoading ? <Spinner size="xs" /> : children}
    </button>
  );
}

function Spinner({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
  const px = size === 'xs' ? 12 : 16;
  return (
    <svg
      className="animate-spin text-current"
      style={{ width: px, height: px }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Textarea({
  value, onChange, rows = 2, maxLength, placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      className="w-full rounded-lg border border-surface-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
    />
  );
}

function EmptyState({
  icon, headline, subline,
}: { icon: React.ReactNode; headline: string; subline: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 bg-surface-base/60 border border-dashed border-surface-border rounded-xl">
      <div className="text-text-muted mb-3">{icon}</div>
      <p className="text-sm font-semibold text-text-primary mb-1">{headline}</p>
      <p className="text-sm text-text-muted max-w-xs">{subline}</p>
    </div>
  );
}

// ── Types (mirroring @/api/types shapes) ────────────────────────
interface GrowthCard {
  id: string;
  card_type: string;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  action_label?: string;
  action_type?: 'internal_chat' | string;
}

interface DailyCheckIn {
  date: string;
  questions: string[];
  processed_at: string | null;
  ai_response: string | null;
}

// ── Card styles ───────────────────────────────────────────────
const CARD_STYLE: Record<string, { bg: string; icon: React.ReactNode }> = {
  tip:        { bg: 'bg-blue-50/60 border-brand-200',      icon: <Lightbulb    size={15} className="text-brand"        /> },
  strategy:   { bg: 'bg-indigo-50/60 border-indigo-200',   icon: <TrendingUp   size={15} className="text-indigo-500"   /> },
  challenge:  { bg: 'bg-amber-50/60 border-amber-200',     icon: <Award        size={15} className="text-amber-500"    /> },
  reflection: { bg: 'bg-purple-50/60 border-purple-200',   icon: <BookOpen     size={15} className="text-purple-500"   /> },
  resource:   { bg: 'bg-emerald-50/60 border-emerald-200', icon: <BookOpen     size={15} className="text-emerald-500"  /> },
  insight:    { bg: 'bg-blue-50/60 border-brand-200',      icon: <Lightbulb    size={15} className="text-brand"        /> },
  community:  { bg: 'bg-rose-50/60 border-rose-200',       icon: <CheckCircle2 size={15} className="text-rose-500"     /> },
};

// ============================================================
// DEMO DATA — hardcoded, realistic, varied. No API involved.
// ============================================================
const DEMO_USER = {
  name: 'Priya Nathan',
  archetype: 'The Closer',
  check_in_streak: 12,
};

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const DEMO_WEEKLY_PLAN = {
  id: 'plan_2026_w36',
  title: 'Tighten your discovery calls',
  body:
    "You've closed 4 deals this month, but call notes show discovery running long — average 34 minutes before you get to budget. This week, practice landing on the 3 qualifying questions (budget, timeline, decision process) inside the first 12 minutes. Try it on your next two calls with Meridian Logistics and Fenwick & Cole, then log what changed in your debrief.",
  action_label: 'Practice this in a role-play',
  action_type: 'internal_chat',
  cached: true,
};

const DEMO_CHECK_IN: DailyCheckIn = {
  date: now.toISOString().slice(0, 10),
  questions: [
    "What's one call or conversation today that didn't go the way you wanted?",
    'What would you do differently if you had it again?',
  ],
  processed_at: hoursAgo(3),
  ai_response:
    "Sounds like the Fenwick call stalled because the champion couldn't speak to budget — that's a common signal to loop in an economic buyer earlier, not push harder on features. Nice catch flagging it instead of glossing over it. Bring this into Thursday's role-play and we'll drill the pivot.",
};

// Full feed — first page's worth for the "Feed" tab
const DEMO_FEED_CARDS: GrowthCard[] = [
  {
    id: 'card_101',
    card_type: 'insight',
    title: 'Your close rate jumps 18% after a same-day recap email',
    body:
      "Across your last 26 closed-won deals, the 14 where you sent a recap email within 2 hours of the call closed 18% faster on average than the ones where the recap went out the next day or later. Prospects are still warm right after the call — momentum decays fast. Consider drafting the recap during the last 5 minutes of the call itself, before you move to the next thing.",
    created_at: hoursAgo(2),
    is_read: false,
    action_label: 'Draft a recap template',
    action_type: 'internal_chat',
  },
  {
    id: 'card_102',
    card_type: 'challenge',
    title: "This week's challenge: ask for the referral before the close",
    body:
      "You're strong at closing but referrals are down 40% quarter over quarter. On your next 3 closed deals, ask 'who else on your team is dealing with this same problem?' before you send the contract — not after. Log the outcome in your debrief so we can see what moves the needle.",
    created_at: hoursAgo(6),
    is_read: false,
    action_label: 'Role-play the ask',
    action_type: 'internal_chat',
  },
  {
    id: 'card_103',
    card_type: 'strategy',
    title: 'Reframe price objections around cost of inaction',
    body:
      "In your last 4 debriefs, price objections came up right after you presented ROI numbers — that's a sign the ROI framing landed but felt abstract. Try anchoring to what the status quo is already costing them per month before you introduce your price. It reorders the comparison from 'their budget vs. our price' to 'current cost vs. new cost.'",
    created_at: hoursAgo(10),
    is_read: true,
    action_label: 'Practice this reframe',
    action_type: 'internal_chat',
  },
  {
    id: 'card_104',
    card_type: 'tip',
    title: 'Slow down your intro by 10 seconds',
    body:
      'Calls that opened with a brief pause before the pitch — even just a beat after "thanks for making time" — had noticeably better engagement in the first two minutes. It signals confidence rather than a rehearsed script.',
    created_at: daysAgo(1),
    is_read: true,
  },
  {
    id: 'card_105',
    card_type: 'reflection',
    title: 'Look back at the Grantham Co. debrief',
    body:
      "You flagged feeling rushed on this call and it shows in the transcript — 6 questions in the first 90 seconds. Worth revisiting what triggered the rushed feeling: was it the prospect's tone, the clock, or something going in beforehand? Naming the trigger makes it easier to catch next time.",
    created_at: daysAgo(2),
    is_read: true,
  },
  {
    id: 'card_106',
    card_type: 'resource',
    title: 'Worth a read: "The Challenger Sale" framework on teaching for differentiation',
    body:
      "Given how often your calls default to feature walkthroughs, this framework on teaching prospects something new about their own business — rather than pitching capabilities — maps closely to what's already working in your strongest calls with Council Ridge and Fenwick & Cole.",
    created_at: daysAgo(3),
    is_read: true,
  },
  {
    id: 'card_107',
    card_type: 'community',
    title: '3 reps with a similar archetype hit a new milestone this week',
    body:
      "Other 'Closer' archetypes on your team crossed 90% quota attainment this week using the same early-qualification approach from your weekly plan. You're on a similar trajectory — 84% attainment with 9 days left in the cycle.",
    created_at: daysAgo(4),
    is_read: true,
  },
];

// Extra page to demonstrate "load more" without needing real pagination
const DEMO_FEED_CARDS_PAGE_2: GrowthCard[] = [
  {
    id: 'card_108',
    card_type: 'tip',
    title: 'Your Tuesday afternoon calls out-convert every other slot',
    body:
      'Tuesday 1–3pm calls have a 61% next-step conversion rate versus a 38% average across the rest of the week. Worth protecting that slot for high-priority accounts rather than internal syncs.',
    created_at: daysAgo(5),
    is_read: true,
  },
  {
    id: 'card_109',
    card_type: 'strategy',
    title: 'Bring a mutual success story into cold outreach',
    body:
      "Cold emails referencing a similar-industry customer story got a 22% higher reply rate than generic value-prop openers in your last batch. You already have three strong stories on file — Council Ridge, Meridian, and Aldwych Partners — worth rotating them by industry.",
    created_at: daysAgo(6),
    is_read: true,
  },
];

// History dataset — mix of tips and plans across several weeks
const DEMO_HISTORY_CARDS: GrowthCard[] = [
  ...DEMO_FEED_CARDS,
  ...DEMO_FEED_CARDS_PAGE_2,
  {
    id: 'card_201',
    card_type: 'strategy',
    title: "Last week's plan: Handle the 'send me something in writing' stall",
    body:
      "You improved from 6 to 2 stalled deals last week by proposing a 15-minute follow-up call instead of a cold email whenever a prospect asked for written info. Keep leaning on that pattern going into this month's renewals.",
    created_at: daysAgo(8),
    is_read: true,
  },
  {
    id: 'card_202',
    card_type: 'tip',
    title: 'Mirror the last 3 words before answering objections',
    body: 'A small mirroring habit — repeating the last few words of an objection before responding — correlated with longer, more detailed prospect responses across your recorded calls this month.',
    created_at: daysAgo(9),
    is_read: true,
  },
  {
    id: 'card_203',
    card_type: 'strategy',
    title: "Plan from 2 weeks ago: Shorten your proposal turnaround",
    body:
      'You cut average proposal turnaround from 3.4 days to 1.8 days by drafting a skeleton proposal live on the call. Two of the three deals that used this approach closed within the following week.',
    created_at: daysAgo(15),
    is_read: true,
  },
  {
    id: 'card_204',
    card_type: 'resource',
    title: 'Worth a read: negotiating without discounting on price',
    body: 'A short piece on trading value-adds (extended onboarding, priority support) instead of discounts when a prospect pushes on price late in the cycle — closely matches two situations from your recent debriefs.',
    created_at: daysAgo(18),
    is_read: true,
  },
  {
    id: 'card_205',
    card_type: 'challenge',
    title: 'Challenge from 3 weeks ago: multi-thread every deal over $20K',
    body: 'You added a second contact on 7 of 9 qualifying deals, and those 7 are moving 30% faster through the pipeline than single-threaded deals from the prior quarter.',
    created_at: daysAgo(21),
    is_read: true,
  },
  {
    id: 'card_206',
    card_type: 'strategy',
    title: "Plan from a month ago: Lead with outcomes, not features, in demos",
    body: 'Demos restructured around the 3 outcomes a prospect cared about (rather than a full feature tour) ran 9 minutes shorter on average and got booked follow-ups 25% more often.',
    created_at: daysAgo(28),
    is_read: true,
  },
];

// ── Growth feed card ──────────────────────────────────────────
interface GrowthFeedCardProps {
  card: GrowthCard;
  onDismiss: () => void;
  onStartChat: (card: GrowthCard) => void;
}

function GrowthFeedCard({ card, onDismiss, onStartChat }: GrowthFeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const style = CARD_STYLE[card.card_type] ?? { bg: 'bg-white border-surface-border', icon: null };
  const hasMore = (card.body?.length ?? 0) > 180;

  const handleDismiss = () => {
    setDismissing(true);
    setTimeout(() => onDismiss(), 150); // brief, purely local "optimistic" feel
  };

  const handleChat = () => {
    setStartingChat(true);
    setTimeout(() => {
      setStartingChat(false);
      onStartChat(card);
    }, 400);
  };

  return (
    <div className={cn('border rounded-xl p-4 space-y-2 relative transition-opacity', style.bg, dismissing && 'opacity-0')}>
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        className="absolute top-3 right-3 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors disabled:opacity-40"
        aria-label="Dismiss card"
      >
        <X size={13} />
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
        <Button size="xs" variant="ghost" className="mt-1" isLoading={startingChat} onClick={handleChat}>
          {card.action_label}
        </Button>
      )}
    </div>
  );
}

// ── Weekly plan section (static demo data) ─────────────────────
function WeeklyPlanSection({ onStartChat }: { onStartChat: (title: string) => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const plan = DEMO_WEEKLY_PLAN;

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleChat = () => {
    setStartingChat(true);
    setTimeout(() => {
      setStartingChat(false);
      onStartChat(plan.title);
    }, 400);
  };

  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-indigo-500" />
          <p className="text-sm font-semibold text-text-primary">This week's plan</p>
          {plan.cached && (
            <span className="text-xs text-indigo-400 bg-white/60 border border-indigo-100 rounded-full px-2 py-0.5">
              Current
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1 text-text-muted hover:text-indigo-500 transition-colors disabled:opacity-40"
          aria-label="Refresh plan"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="text-sm font-medium text-text-primary">{plan.title}</p>
      {plan.body && (
        <p className="text-sm text-text-secondary leading-relaxed">{plan.body}</p>
      )}
      {plan.action_label && plan.action_type === 'internal_chat' && (
        <Button size="xs" variant="ghost" className="mt-1" isLoading={startingChat} onClick={handleChat}>
          {plan.action_label}
        </Button>
      )}
    </div>
  );
}

// ── History section (static demo dataset, paginated locally) ──
type HistoryFilter = 'all' | 'tips' | 'plans';

const HISTORY_FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: 'All',   value: 'all'   },
  { label: 'Tips',  value: 'tips'  },
  { label: 'Plans', value: 'plans' },
];

const HISTORY_LIMIT = 6;

const PLAN_TYPES = new Set(['strategy', 'challenge']);

function HistorySection() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [page, setPage] = useState(0);

  const handleFilter = (f: HistoryFilter) => { setFilter(f); setPage(0); };

  const filtered = DEMO_HISTORY_CARDS.filter((c) => {
    if (filter === 'all') return true;
    if (filter === 'plans') return PLAN_TYPES.has(c.card_type);
    return !PLAN_TYPES.has(c.card_type);
  });

  const start = page * HISTORY_LIMIT;
  const cards = filtered.slice(start, start + HISTORY_LIMIT);
  const hasMore = start + HISTORY_LIMIT < filtered.length;
  const hasPrev = page > 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_LIMIT));

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
      {cards.length === 0 ? (
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
        <div className="space-y-3">
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
          <Button size="xs" variant="ghost" disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} className="mr-1" /> Previous
          </Button>
          <span className="text-xs text-text-muted">Page {page + 1} of {totalPages}</span>
          <Button size="xs" variant="ghost" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Check-in section (static demo data) ────────────────────────
function CheckInSection({ streak }: { streak: number }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [moodScore, setMoodScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const checkIn = DEMO_CHECK_IN;
  const questions = checkIn.questions.map((q, idx) => ({ id: `q${idx + 1}`, question: q }));
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id]?.trim());

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 500);
  };

  // Already submitted today (demo default) — show AI response
  if (!submitted && checkIn.processed_at && checkIn.ai_response) {
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

  if (submitted) {
    return (
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Flame size={15} className="text-orange-500" />
          <p className="text-sm font-semibold text-text-primary">{streak + 1}-day streak 🔥</p>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Check-in saved. Clutch is looking it over — your reflection will show up here shortly.
        </p>
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

      <Button size="sm" disabled={!allAnswered} isLoading={submitting} onClick={handleSubmit}>
        Submit check-in
      </Button>
    </div>
  );
}

// ── Main GrowthPage ───────────────────────────────────────────
type ActiveTab = 'feed' | 'history';

export default function GrowthPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('feed');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(DEMO_FEED_CARDS.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const combinedFeed = [...DEMO_FEED_CARDS, ...DEMO_FEED_CARDS_PAGE_2];
  const allCards = combinedFeed.slice(0, visibleCount).filter((c) => !dismissedIds.has(c.id));
  const hasNextPage = visibleCount < combinedFeed.length;
  const streak = DEMO_USER.check_in_streak;
  const archetype = DEMO_USER.archetype;

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const handleLoadMore = () => {
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((v) => Math.min(v + 2, combinedFeed.length));
      setLoadingMore(false);
    }, 500);
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div className="page-container space-y-5 max-w-2xl mx-auto p-6 relative">
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
          <WeeklyPlanSection onStartChat={(title) => showToast(`Starting a chat about "${title}"…`)} />

          {/* Growth feed */}
          {allCards.length === 0 ? (
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
                  onStartChat={(card) => showToast(`Starting a chat about "${card.title}"…`)}
                />
              ))}
              {hasNextPage && (
                <div className="h-10 flex items-center justify-center">
                  {loadingMore ? (
                    <Spinner size="sm" />
                  ) : (
                    <button
                      onClick={handleLoadMore}
                      className="text-xs text-brand hover:underline font-medium"
                    >
                      Load more
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <HistorySection />
      )}

      {/* Lightweight local toast (replaces useToast) */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text-primary text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
