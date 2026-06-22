// ============================================================
// FILE: src/pages/opportunities/OpportunitiesPage.tsx
// ============================================================
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { opportunitiesApi } from '@/api/opportunities';
import { queryClient }      from '@/lib/queryClient';
import { queryKeys }        from '@/lib/queryKeys';
import { useRole }          from '@/hooks/useRole';
import { useAuth }          from '@/hooks/useAuth';
import { useToast }         from '@/hooks/useToast';
import { Button }           from '@/components/ui/Button';
import { Badge, PlatformBadge, ScoreBadge } from '@/components/ui/Badge';
import { Tabs }             from '@/components/ui/Tabs';
import { SkeletonOpportunityCard } from '@/components/ui/Skeleton';
import { EmptyState, Spinner } from '@/components/common/index';
import { AppError, type Opportunity } from '@/api/types';
import { ROUTES, STATUS_LABELS } from '@/lib/constants';
import { formatRelativeDate, cn }     from '@/lib/utils';
import { Zap, RefreshCw, ChevronRight, AlertTriangle, Plus, ExternalLink, Copy, Check } from 'lucide-react';

// Platform labels mapping
export const PLATFORM_LABELS: Record<string, string> = {
  reddit:       'Reddit',
  linkedin:     'LinkedIn',
  twitter:      'X / Twitter',
  facebook:     'Facebook',
  instagram:    'Instagram',
  producthunt:  'Product Hunt',
  indiehackers: 'Indie Hackers',
  hackernews:   'Hacker News',
  quora:        'Quora',
  youtube:      'YouTube',
  other:        'Other',
};

const STATUS_TABS = [
  { value: 'all',     label: 'All'     },
  { value: 'pending', label: 'Pending' },
  { value: 'viewed',  label: 'Viewed'  },
];

// ── Opportunity Card ─────────────────────────────────────────────────────────

function OpportunityCard({ opp, currentUserId }: { opp: Opportunity; currentUserId: string }) {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();
  const pct = opp.composite_score;
  const scoreColor =
    pct >= 7 ? 'text-success' : pct >= 4 ? 'text-warning' : 'text-danger';

  const isAssignedToMe =
    !!opp.assigned_to &&
    opp.assigned_to === currentUserId &&
    opp.user_id !== currentUserId;

  const isManual = opp.generated_by === 'manual';

  const handleSourceClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation(); // don't navigate to detail page
    // Fire-and-forget — don't block the browser from opening the URL
    opportunitiesApi.trackLinkClick(opp.id).then(() => {
      // Optimistically update the cached opportunity so link_clicked_at reflects
      // immediately in any detail view that reads from cache.
      queryClient.setQueryData<{ opportunity: Opportunity }>(
        ['opportunities', opp.id],
        (old) => old ? { opportunity: { ...old.opportunity, link_clicked_at: new Date().toISOString() } } : old,
      );
    }).catch(() => {/* non-critical — swallow silently */});
  };

  const [copied, setCopied] = useState(false);

  const handleCopyMessage = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // don't navigate to detail page
    try {
      await navigator.clipboard.writeText(opp.prepared_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      opportunitiesApi.trackMessageCopy(opp.id).then(() => {
        queryClient.setQueryData<{ opportunity: Opportunity }>(
          ['opportunities', opp.id],
          (old) => old ? { opportunity: { ...old.opportunity, message_copied_at: new Date().toISOString() } } : old,
        );
      }).catch(() => {/* non-critical — swallow silently */});
    } catch {
      // clipboard API unavailable — fail silently
    }
  };

  return (
    <div
      onClick={() => navigate(`/opportunities/${opp.id}`)}
      className="bg-white border border-surface-border rounded-lg p-4 hover:shadow-card-md hover:border-slate-300 transition-all cursor-pointer space-y-3"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PlatformBadge platform={opp.platform} />
          <span className="text-sm font-medium text-text-primary truncate max-w-[200px]">
            {opp.target_name ?? 'Anonymous prospect'}
          </span>
          {isAssignedToMe && (
            <Badge variant="purple" size="xs">Assigned to me</Badge>
          )}
          {isManual && (
            <Badge variant="gray" size="xs">Manual</Badge>
          )}
        </div>
        {/* Composite score circle — show dash for manual entries with no score */}
        <div className={cn(
          'w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 font-bold text-sm',
          pct >= 7 ? 'border-success text-success' :
          pct >= 4 ? 'border-warning text-warning' :
          isManual  ? 'border-slate-300 text-text-muted' :
          'border-danger text-danger',
        )}>
          {isManual && !pct ? '—' : Math.round(pct)}
        </div>
      </div>

      {/* Context */}
      <p className="text-sm text-text-secondary leading-relaxed line-clamp-3">
        {opp.target_context ?? <span className="italic text-text-muted">No context added</span>}
      </p>

      {/* Source URL */}
      {opp.source_url && (
        <div className="flex items-center gap-1.5">
          <a
            href={opp.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSourceClick}
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium truncate max-w-[260px] hover:underline',
              opp.link_clicked_at ? 'text-text-muted' : 'text-brand',
            )}
          >
            <ExternalLink size={11} className="shrink-0" />
            {opp.source_url.replace(/^https?:\/\//, '')}
          </a>
          {opp.link_clicked_at && (
            <span className="text-xs text-text-muted shrink-0">· visited</span>
          )}
        </div>
      )}

      {/* Sub-scores — hidden for manual entries with no scores */}
      {!isManual && (
        <div className="flex items-center gap-3">
          {[
            { label: 'Fit',    value: opp.fit_score },
            { label: 'Timing', value: opp.timing_score },
            { label: 'Intent', value: opp.intent_score },
          ].filter((s) => s.value != null).map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <span className="text-xs text-text-muted">{s.label}</span>
              <span className={cn('text-xs font-mono font-semibold', scoreColor)}>{s.value}/10</span>
            </div>
          ))}
          <span className="ml-auto text-xs text-text-muted">{formatRelativeDate(opp.created_at)}</span>
        </div>
      )}
      {isManual && (
        <div className="flex items-center justify-end">
          <span className="text-xs text-text-muted">{formatRelativeDate(opp.created_at)}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-surface-border">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              opp.status === 'sent'   ? 'green' :
              opp.status === 'viewed' ? 'blue'  : 'gray'
            }
            size="xs"
          >
            {STATUS_LABELS[opp.status] ?? opp.status}
          </Badge>
          {opp.message_copied_at && (
            <span className="text-xs text-text-muted">· message copied</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyMessage}
            title="Copy prepared message"
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium transition-colors',
              copied ? 'text-success' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy message'}
          </button>
          <span className="text-xs text-brand flex items-center gap-0.5 font-medium">
            View details <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const navigate      = useNavigate();
  const { isManager } = useRole();
  const { user }      = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeStatus = searchParams.get('status') ?? 'pending';

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.opportunities({ status: activeStatus }),
    queryFn: ({ pageParam = 0 }) =>
      opportunitiesApi.list({ status: activeStatus, limit: 20, offset: pageParam as number })
        .then((r) => r.data),
    getNextPageParam: (last, pages) =>
      last.opportunities.length === 20 ? pages.length * 20 : undefined,
    initialPageParam: 0,
    staleTime: 60_000,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const refreshMutation = useMutation({
    mutationFn: () => opportunitiesApi.refresh().then((r) => r.data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      showToast(`Found ${res.count} new opportunities!`, 'success');
      if (res.notice) showToast(res.notice, 'info');
    },
    onError: (err) => {
      if (err instanceof AppError && err.status === 429) {
        showToast('Discovery limit reached (5/hr). Try again later.', 'warning');
      } else {
        showToast('Could not discover opportunities.', 'error');
      }
    },
  });

  const allOpps       = data?.pages.flatMap((p) => p.opportunities) ?? [];
  const shouldRefresh = data?.pages[0]?.should_refresh;

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-text-primary">Opportunities</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isManager && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/team/opportunities')}>
              Team view
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus size={13} />}
            onClick={() => navigate('/opportunities/create')}
          >
            Add manually
          </Button>
          <Button
            size="sm"
            leftIcon={<RefreshCw size={13} className={refreshMutation.isPending ? 'animate-spin' : ''} />}
            isLoading={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
          >
            Discover new
          </Button>
        </div>
      </div>

      {/* Staleness banner */}
      {shouldRefresh && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">
            Your opportunity list is getting stale. Discover fresh prospects.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => refreshMutation.mutate()}
            isLoading={refreshMutation.isPending}
          >
            Discover now
          </Button>
        </div>
      )}

      {/* Status tabs */}
      <Tabs
        variant="pill"
        size="sm"
        tabs={STATUS_TABS}
        value={activeStatus}
        onChange={(v) => setSearchParams({ status: v }, { replace: true })}
      />

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonOpportunityCard key={i} />)}
        </div>
      ) : allOpps.length === 0 ? (
        <EmptyState
          icon={<Zap size={32} />}
          headline="No opportunities yet"
          subline={shouldRefresh ? 'Discover new prospects to get started.' : 'Check back soon or run discovery.'}
          action={{ label: 'Discover now', onClick: () => refreshMutation.mutate() }}
        />
      ) : (
        <>
          <div className="space-y-3">
            {allOpps.map((opp) => (
              <OpportunityCard key={opp.id} opp={opp} currentUserId={user?.id ?? ''} />
            ))}
          </div>
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isFetchingNextPage && <Spinner size="sm" />}
          </div>
        </>
      )}

    </div>
  );
}